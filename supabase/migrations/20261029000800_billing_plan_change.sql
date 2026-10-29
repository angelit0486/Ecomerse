-- ADR-044 (prorrateo aprobado por el propietario el 2026-10-29): la dueña cambia
-- de plan o de periodo una suscripción que ya paga con Stripe. El precio sale de
-- la base (regla 8) y el cambio solo se aplica aquí cuando llega el webhook
-- firmado `customer.subscription.updated` (regla 11); Stripe prorratea el cobro.

-- -----------------------------------------------------------------------------
-- 1. Datos para pedir el cambio a Stripe: solo quien gestiona la facturación.
-- -----------------------------------------------------------------------------
create function public.org_billing_change_input(p_store_id uuid, p_plan_key text, p_interval text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_plan   public.plans;
  v_sub    public.subscriptions;
  v_amount bigint;
  v_key    text;
  v_limit  integer;
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
  if v_amount is null or v_amount <= 0 then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'plan_without_price';
  end if;
  select s.* into v_sub from public.subscriptions s
   where s.organization_id = v_org and s.status <> 'cancelled';
  if v_sub.provider is distinct from 'stripe' or v_sub.provider_subscription_id is null
     or v_sub.status not in ('active', 'trialing', 'past_due') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'no_card_subscription';
  end if;
  -- Con un cobro pendiente, primero se regulariza el pago (no se suma otro cargo).
  if v_sub.status = 'past_due' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'past_due';
  end if;
  if v_sub.plan_id = v_plan.id and v_sub.billing_interval = p_interval then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'same_plan';
  end if;
  -- Bajar de plan no puede dejar a la organización por encima de sus límites.
  foreach v_key in array array['max_stores', 'max_products', 'max_staff'] loop
    v_limit := coalesce(
      (select o.value_int from public.organization_entitlement_overrides o
        where o.organization_id = v_org and o.key = v_key and (o.expires_at is null or o.expires_at > now())),
      (select e.value_int from public.plan_entitlements e where e.plan_id = v_plan.id and e.key = v_key),
      0);
    if app.current_usage(v_org, v_key) > v_limit then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'over_limit:' || v_key;
    end if;
  end loop;
  return jsonb_build_object(
    'organization_id', v_org,
    'subscription_id', v_sub.provider_subscription_id,
    'plan_key', v_plan.key,
    'plan_name', v_plan.name,
    'interval', p_interval,
    'amount', v_amount,
    'currency', v_plan.currency);
end
$$;
revoke all on function public.org_billing_change_input(uuid, text, text) from public;
grant execute on function public.org_billing_change_input(uuid, text, text) to authenticated;

-- Opciones de cambio para «Plan y uso»: solo con una suscripción de Stripe vigente.
create function public.org_billing_change_options(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_sub public.subscriptions;
begin
  select s.organization_id into v_org from public.stores s where s.id = p_store_id;
  if v_org is null or not app.has_org_permission(v_org, 'org.billing.read') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  select s.* into v_sub from public.subscriptions s
   where s.organization_id = v_org and s.status <> 'cancelled';
  if v_sub.provider is distinct from 'stripe' or v_sub.status not in ('active', 'trialing', 'past_due') then
    return null;
  end if;
  return jsonb_build_object(
    'current', jsonb_build_object('plan_key', (select p.key from public.plans p where p.id = v_sub.plan_id),
                                  'interval', v_sub.billing_interval, 'status', v_sub.status),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object('key', p.key, 'name', p.name, 'currency', p.currency,
                                          'price_monthly', p.price_monthly, 'price_annual', p.price_annual)
                       order by p.sort, p.name)
        from public.plans p
       where p.status = 'active' and (coalesce(p.price_monthly, 0) > 0 or coalesce(p.price_annual, 0) > 0)
    ), '[]'::jsonb));
end
$$;
revoke all on function public.org_billing_change_options(uuid) from public;
grant execute on function public.org_billing_change_options(uuid) to authenticated;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029000800'::text
$$;
