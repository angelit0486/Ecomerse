-- Precios aprobados por el propietario el 2026-11-17 (ADR-068, extiende ADR-044):
-- Tienda MXN 699/mes y Tienda Plus MXN 1,299/mes, anual = 10 meses, prueba de
-- 14 días sin tarjeta y una CUOTA ÚNICA DE ARRANQUE por plan (2,900 / 5,900).
--
-- Lo que ya existía cubre mensual, anual y prueba (20261029000400/0500). Esto
-- agrega solo la cuota de arranque:
--   1. plans.setup_fee (centavos, regla 14; null = sin cuota).
--   2. organizations.setup_fee_settled_at: la plataforma la marca cuando la
--      cuota se cobró por fuera (transferencia) o se condonó (con motivo y
--      auditoría). Sin marca y sin haber pagado nunca con tarjeta, se debe.
--   3. app.org_setup_fee_due(org): la cuota se cobra UNA vez, en el primer pago
--      con tarjeta (Stripe la pone solo en la primera factura). Si la
--      organización ya tuvo una suscripción de Stripe con cliente, no se cobra
--      otra vez (por ejemplo al volver después de cancelar).
--   4. platform_set_plan_pricing con 5 argumentos (con cuota); la de 4 sigue
--      igual y no toca la cuota, así que el código anterior funciona mientras se
--      despliega.
--   5. platform_list_plans, org_billing_plans y org_billing_checkout_input
--      devuelven la cuota; el precio sigue saliendo solo de la base (regla 8).
--   6. platform_org_setup_fee / platform_set_setup_fee_settled para la consola.
-- Sin datos nuevos: ningún plan queda con cuota hasta que la plataforma la
-- capture en Consola → Planes.

alter table public.plans
  add column setup_fee bigint;
alter table public.plans
  add constraint plans_setup_fee_check check (setup_fee is null or setup_fee between 0 and 100000000);

alter table public.organizations
  add column setup_fee_settled_at timestamptz;

-- ¿Se debe la cuota de arranque? Ni marcada por la plataforma ni pagada antes con tarjeta.
create function app.org_setup_fee_due(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.organizations o
                      where o.id = p_org and o.setup_fee_settled_at is not null)
     and not exists (select 1 from public.subscriptions s
                      where s.organization_id = p_org and s.provider = 'stripe'
                        and s.provider_customer_id is not null)
$$;
revoke all on function app.org_setup_fee_due(uuid) from public;

-- Precios de un plan con la cuota de arranque (solo dueña y administración, con auditoría).
create function public.platform_set_plan_pricing(p_key text, p_price_monthly bigint, p_price_annual bigint,
                                                 p_trial_days integer, p_setup_fee bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  select * into v_plan from public.plans p where p.key = p_key for update;
  if v_plan.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'plan';
  end if;
  if p_price_monthly is not null and p_price_monthly not between 0 and 100000000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'price_monthly';
  end if;
  if p_price_annual is not null and p_price_annual not between 0 and 1000000000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'price_annual';
  end if;
  if p_trial_days is not null and p_trial_days not between 0 and 90 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'trial_days';
  end if;
  if p_setup_fee is not null and p_setup_fee not between 0 and 100000000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'setup_fee';
  end if;
  update public.plans
     set price_monthly = p_price_monthly, price_annual = p_price_annual, trial_days = p_trial_days,
         setup_fee = p_setup_fee
   where id = v_plan.id;
  perform audit.record('plan.pricing_saved', 'plan', v_plan.id, null, null,
                       jsonb_build_object('price_monthly', v_plan.price_monthly, 'price_annual', v_plan.price_annual,
                                          'trial_days', v_plan.trial_days, 'setup_fee', v_plan.setup_fee),
                       jsonb_build_object('price_monthly', p_price_monthly, 'price_annual', p_price_annual,
                                          'trial_days', p_trial_days, 'setup_fee', p_setup_fee));
end
$$;
revoke all on function public.platform_set_plan_pricing(text, bigint, bigint, integer, bigint) from public;
grant execute on function public.platform_set_plan_pricing(text, bigint, bigint, integer, bigint) to authenticated;

-- La lista de planes de la consola incluye la cuota de arranque (redefine la de 20261029000400).
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
             'currency', p.currency, 'trial_days', p.trial_days, 'setup_fee', p.setup_fee,
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

-- Datos para abrir el Checkout, con la cuota si se debe (redefine la de 20261029000500).
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
    'customer_id', case when v_sub.provider = 'stripe' then v_sub.provider_customer_id end,
    -- Cuota única de arranque (ADR-068): solo en el primer pago con tarjeta.
    'setup_fee', case when coalesce(v_plan.setup_fee, 0) > 0 and app.org_setup_fee_due(v_org)
                      then v_plan.setup_fee else 0 end);
end
$$;

-- Planes que se pueden pagar con tarjeta, con la cuota que le tocaría a esta organización.
create or replace function public.org_billing_plans(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_due boolean;
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
  v_due := app.org_setup_fee_due(v_org);
  return coalesce((
    select jsonb_agg(jsonb_build_object('key', p.key, 'name', p.name, 'currency', p.currency,
                                        'price_monthly', p.price_monthly, 'price_annual', p.price_annual,
                                        'setup_fee', case when v_due then coalesce(p.setup_fee, 0) else 0 end)
                     order by p.sort, p.name)
      from public.plans p
     where p.status = 'active' and (coalesce(p.price_monthly, 0) > 0 or coalesce(p.price_annual, 0) > 0)
  ), '[]'::jsonb);
end
$$;

-- Consola: estado de la cuota de arranque de una organización.
create function public.platform_org_setup_fee(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin', 'platform_support']);
  select * into v_org from public.organizations o where o.id = p_organization_id;
  if v_org.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'organization';
  end if;
  return jsonb_build_object(
    'settled_at', v_org.setup_fee_settled_at,
    'paid_by_card', exists (select 1 from public.subscriptions s
                             where s.organization_id = v_org.id and s.provider = 'stripe'
                               and s.provider_customer_id is not null),
    'due', app.org_setup_fee_due(v_org.id));
end
$$;
revoke all on function public.platform_org_setup_fee(uuid) from public;
grant execute on function public.platform_org_setup_fee(uuid) to authenticated;

-- Consola: marcar la cuota como cobrada por fuera o condonada (p_settled = true),
-- o volver a deberla (false). Siempre con motivo y auditoría.
create function public.platform_set_setup_fee_settled(p_organization_id uuid, p_settled boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    public.organizations;
  v_reason text := btrim(p_reason);
  v_at     timestamptz;
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  if p_settled is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'settled';
  end if;
  if v_reason is null or char_length(v_reason) not between 5 and 500 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reason';
  end if;
  select * into v_org from public.organizations o where o.id = p_organization_id for update;
  if v_org.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'organization';
  end if;
  v_at := case when p_settled then coalesce(v_org.setup_fee_settled_at, now()) end;
  update public.organizations set setup_fee_settled_at = v_at where id = v_org.id;
  perform audit.record(case when p_settled then 'organization.setup_fee_settled'
                            else 'organization.setup_fee_reopened' end,
                       'organization', v_org.id, v_org.id, null,
                       jsonb_build_object('setup_fee_settled_at', v_org.setup_fee_settled_at),
                       jsonb_build_object('setup_fee_settled_at', v_at), v_reason);
end
$$;
revoke all on function public.platform_set_setup_fee_settled(uuid, boolean, text) from public;
grant execute on function public.platform_set_setup_fee_settled(uuid, boolean, text) to authenticated;

-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261117000500'::text
$$;
