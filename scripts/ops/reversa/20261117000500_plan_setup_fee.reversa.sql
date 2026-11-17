-- =============================================================================
-- Reversa de 20261117000500_plan_setup_fee.sql (cuota de arranque, ADR-068).
-- 2026-11-17.
--
-- *** CON PÉRDIDA MENOR. *** Solo con autorización expresa y en la ventana.
-- SE PIERDE (se puede reconstruir desde audit.audit_logs, que se conserva):
--   - public.plans.setup_fee: la cuota de arranque capturada en cada plan
--     (acción «plan.pricing_saved», campo setup_fee).
--   - public.organizations.setup_fee_settled_at: qué organizaciones la saldaron
--     por fuera (acciones «organization.setup_fee_settled» / «_reopened»).
-- SE CONSERVA: precios mensual y anual, días de prueba, suscripciones, pagos y
-- toda la auditoría. Lo ya cobrado en Stripe no se toca.
--
-- Vuelve a las definiciones de 20261029000400_plan_pricing.sql
-- (platform_list_plans) y 20261029000500_stripe_billing.sql
-- (org_billing_checkout_input, org_billing_plans), borra las funciones nuevas y
-- deja public.app_schema_version() EXACTA a la de 20261113000400. El esquema
-- queda idéntico (pg_dump -s, con permisos) al de una base con las migraciones
-- hasta 20261113000400; lo prueba scripts/ops/reversa/comprobar-0400.sh (paso 0).
--
-- Orden: 1. desplegar el código que espera 20261113000400 (sin este cambio: el
-- código nuevo llama a platform_set_plan_pricing de 5 argumentos y a
-- platform_org_setup_fee); 2. correr esto.
-- ORDEN DE REVERSA: de la migración más nueva a la más vieja, cada una con su
-- candado de versión.
--
-- Uso (SOLO con autorización y en la ventana): psql -X -1 -v ON_ERROR_STOP=1 -f <este archivo>
-- =============================================================================

-- Candado: solo sobre una base exactamente en 20261117000500.
do $$
begin
  if coalesce(public.app_schema_version(), '') <> '20261117000500' then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = format('La base está en %s; esta reversa solo aplica a 20261117000500.',
                      coalesce(public.app_schema_version(), 'desconocida'));
  end if;
end
$$;

-- 1. Funciones nuevas fuera.
drop function public.platform_set_setup_fee_settled(uuid, boolean, text);
drop function public.platform_org_setup_fee(uuid);
drop function public.platform_set_plan_pricing(text, bigint, bigint, integer, bigint);

-- 2. Funciones redefinidas, como estaban.
-- 2a. platform_list_plans como en 20261029000400_plan_pricing.sql.
create or replace function public.platform_list_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin', 'platform_support']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', p.key, 'name', p.name, 'status', p.status, 'sort', p.sort,
             'price_monthly', p.price_monthly, 'price_annual', p.price_annual,
             'currency', p.currency, 'trial_days', p.trial_days,
             'subscribers', (select count(*) from public.subscriptions s
                              where s.plan_id = p.id and s.status <> 'cancelled'),
             'entitlements', (select coalesce(jsonb_object_agg(e.key,
                                       coalesce(to_jsonb(e.value_int), to_jsonb(e.value_bool))), '{}'::jsonb)
                                from public.plan_entitlements e where e.plan_id = p.id))
           order by p.sort, p.name)
      from public.plans p
  ), '[]'::jsonb);
end
$$;

-- 2b. org_billing_checkout_input como en 20261029000500_stripe_billing.sql.
create or replace function public.org_billing_checkout_input(p_store_id uuid, p_plan_key text, p_interval text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_plan public.plans;
  v_sub  public.subscriptions;
  v_amount bigint;
begin
  perform app.require_aal2_user();
  select s.organization_id into v_org from public.stores s where s.id = p_store_id;
  if v_org is null or not app.has_org_permission(v_org, 'org.billing.manage') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_interval is null or p_interval not in ('monthly', 'annual') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'interval';
  end if;
  select p.* into v_plan from public.plans p where p.key = p_plan_key and p.status = 'active';
  if v_plan.id is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'plan';
  end if;
  v_amount := case p_interval when 'annual' then v_plan.price_annual else v_plan.price_monthly end;
  -- Sin precio (o gratis) no hay nada que cobrar con tarjeta.
  if v_amount is null or v_amount <= 0 then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'plan_without_price';
  end if;
  select s.* into v_sub from public.subscriptions s
   where s.organization_id = v_org and s.status <> 'cancelled';
  -- Una suscripción de Stripe vigente se administra en Stripe, no se abre otra.
  if v_sub.provider = 'stripe' and v_sub.status in ('active', 'past_due', 'trialing') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'already_subscribed';
  end if;
  return jsonb_build_object(
    'organization_id', v_org,
    'plan_key', v_plan.key,
    'plan_name', v_plan.name,
    'interval', p_interval,
    'amount', v_amount,
    'currency', v_plan.currency,
    'customer_id', case when v_sub.provider = 'stripe' then v_sub.provider_customer_id end);
end
$$;

-- 2c. org_billing_plans como en 20261029000500_stripe_billing.sql.
create or replace function public.org_billing_plans(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select s.organization_id into v_org from public.stores s where s.id = p_store_id;
  if v_org is null or not app.has_org_permission(v_org, 'org.billing.read') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  -- Ya paga con Stripe: la suscripción se administra allá, no se ofrece otra.
  if exists (select 1 from public.subscriptions s
              where s.organization_id = v_org and s.provider = 'stripe'
                and s.status in ('active', 'past_due', 'trialing')) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('key', p.key, 'name', p.name, 'currency', p.currency,
                                        'price_monthly', p.price_monthly, 'price_annual', p.price_annual)
                     order by p.sort, p.name)
      from public.plans p
     where p.status = 'active' and (coalesce(p.price_monthly, 0) > 0 or coalesce(p.price_annual, 0) > 0)
  ), '[]'::jsonb);
end
$$;

-- 3. El cálculo interno y las columnas (aquí se pierde lo de arriba).
drop function app.org_setup_fee_due(uuid);
alter table public.organizations drop column setup_fee_settled_at;
alter table public.plans drop column setup_fee;

-- 4. Versión del esquema (D-POR-06): idéntica a la de 20261113000400_import_batches.sql.
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261113000400'::text
$$;
