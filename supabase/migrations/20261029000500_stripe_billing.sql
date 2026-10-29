-- ADR-044 paso 2 (aprobado el 2026-10-29): cobro de la suscripción con Stripe
-- Billing. La dueña de la organización paga en Stripe Checkout (modo suscripción)
-- con el precio del plan que guarda la base; Stripe avisa por webhook firmado y
-- solo entonces cambia la suscripción (regla 11: nada se confirma desde el
-- navegador). El cobro manual de la consola sigue funcionando igual.

-- -----------------------------------------------------------------------------
-- 1. Eventos de cobro recibidos (idempotencia por id de evento del proveedor).
-- -----------------------------------------------------------------------------
create table system.billing_events (
  id                uuid primary key default app.uuid_v7(),
  provider          text not null check (provider in ('stripe')),
  provider_event_id text not null check (char_length(provider_event_id) between 3 and 255),
  type              text not null check (char_length(type) between 1 and 100),
  organization_id   uuid references public.organizations (id) on delete set null,
  outcome           text,
  received_at       timestamptz not null default now(),
  unique (provider, provider_event_id)
);
alter table system.billing_events enable row level security;
alter table system.billing_events force row level security;
revoke all on table system.billing_events from public, anon, authenticated, service_role, storefront_gateway, system_worker;

-- Momento del último evento aplicado: un evento más viejo que llegue tarde se ignora.
alter table public.subscriptions add column provider_event_at timestamptz;

-- -----------------------------------------------------------------------------
-- 2. Datos para abrir el Checkout: solo quien gestiona la facturación de la organización.
-- -----------------------------------------------------------------------------
create function public.org_billing_checkout_input(p_store_id uuid, p_plan_key text, p_interval text)
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
revoke all on function public.org_billing_checkout_input(uuid, text, text) from public;
grant execute on function public.org_billing_checkout_input(uuid, text, text) to authenticated;

-- Planes que se pueden pagar con tarjeta (activos y con precio), para «Plan y uso».
create function public.org_billing_plans(p_store_id uuid)
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
revoke all on function public.org_billing_plans(uuid) from public;
grant execute on function public.org_billing_plans(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Aplicar un evento de Stripe ya verificado (lo llama el webhook como system_worker).
--    p_event: event_id, created (epoch s), type, organization_id, customer_id,
--    subscription_id, status (de Stripe), plan_key, interval, current_period_end (epoch s).
-- -----------------------------------------------------------------------------
create function system.billing_apply_stripe_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_row uuid;
  v_org       public.organizations;
  v_plan      uuid;
  v_sub       public.subscriptions;
  v_after     public.subscriptions;
  v_status    text;
  v_created   timestamptz;
  v_period    timestamptz;
  v_interval  text := coalesce(p_event ->> 'interval', 'monthly');
  v_outcome   text;
begin
  if p_event is null or jsonb_typeof(p_event) <> 'object'
     or nullif(p_event ->> 'event_id', '') is null or nullif(p_event ->> 'type', '') is null
     or (p_event ->> 'created') !~ '^\d{1,12}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'event';
  end if;
  if v_interval not in ('monthly', 'annual') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'interval';
  end if;
  v_created := to_timestamp((p_event ->> 'created')::bigint);
  v_period := case when (p_event ->> 'current_period_end') ~ '^\d{1,12}$'
                   then to_timestamp((p_event ->> 'current_period_end')::bigint) end;

  -- Idempotencia: el mismo evento dos veces no hace nada la segunda.
  insert into system.billing_events (provider, provider_event_id, type)
  values ('stripe', p_event ->> 'event_id', p_event ->> 'type')
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_row;
  if v_event_row is null then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  if (p_event ->> 'organization_id') !~ '^[0-9a-f-]{36}$' then
    update system.billing_events set outcome = 'ignored:organization' where id = v_event_row;
    return jsonb_build_object('outcome', 'ignored', 'reason', 'organization');
  end if;
  select o.* into v_org from public.organizations o where o.id = (p_event ->> 'organization_id')::uuid for update;
  if v_org.id is null then
    update system.billing_events set outcome = 'ignored:organization' where id = v_event_row;
    return jsonb_build_object('outcome', 'ignored', 'reason', 'organization');
  end if;
  update system.billing_events set organization_id = v_org.id where id = v_event_row;

  -- Estado de Stripe → ciclo de la plataforma (Fase 10). «incomplete» = el primer
  -- cobro aún no pasa: no cambia nada.
  v_status := case p_event ->> 'status'
                when 'active' then 'active'
                when 'trialing' then 'trialing'
                when 'past_due' then 'past_due'
                when 'unpaid' then 'paused'
                when 'paused' then 'paused'
                when 'incomplete_expired' then 'cancelled'
                when 'canceled' then 'cancelled'
              end;
  if v_status is null then
    update system.billing_events set outcome = 'ignored:status' where id = v_event_row;
    return jsonb_build_object('outcome', 'ignored', 'reason', 'status');
  end if;

  select p.id into v_plan from public.plans p where p.key = p_event ->> 'plan_key';
  select s.* into v_sub from public.subscriptions s
   where s.organization_id = v_org.id and s.status <> 'cancelled' for update;

  -- Un evento de otra suscripción de Stripe (por ejemplo, la cancelación de una
  -- anterior) no toca la vigente; tampoco uno más viejo que el último aplicado.
  if v_sub.id is not null and v_sub.provider = 'stripe'
     and v_sub.provider_subscription_id is distinct from p_event ->> 'subscription_id' then
    update system.billing_events set outcome = 'ignored:other_subscription' where id = v_event_row;
    return jsonb_build_object('outcome', 'ignored', 'reason', 'other_subscription');
  end if;
  if v_sub.provider_event_at is not null and v_created < v_sub.provider_event_at then
    update system.billing_events set outcome = 'ignored:stale' where id = v_event_row;
    return jsonb_build_object('outcome', 'ignored', 'reason', 'stale');
  end if;

  if v_sub.id is null then
    if v_status = 'cancelled' or v_plan is null then
      update system.billing_events set outcome = 'ignored:no_subscription' where id = v_event_row;
      return jsonb_build_object('outcome', 'ignored', 'reason', 'no_subscription');
    end if;
    insert into public.subscriptions (organization_id, plan_id, status, current_period_start, current_period_end,
                                      trial_ends_at, grace_ends_at, provider, provider_customer_id,
                                      provider_subscription_id, billing_interval, provider_event_at)
    values (v_org.id, v_plan, v_status, now(), v_period,
            case when v_status = 'trialing' then coalesce(v_period, now() + interval '14 days') end,
            case when v_status = 'past_due' then now() + interval '7 days' end,
            'stripe', p_event ->> 'customer_id', p_event ->> 'subscription_id', v_interval, v_created)
    returning * into v_after;
    v_outcome := 'created';
  else
    update public.subscriptions s set
      plan_id = coalesce(v_plan, s.plan_id),
      status = v_status,
      current_period_end = coalesce(v_period, s.current_period_end),
      trial_ends_at = case when v_status = 'trialing' then coalesce(v_period, s.trial_ends_at, now() + interval '14 days') end,
      -- La gracia de 7 días empieza con el primer aviso de pago vencido, no con cada reintento.
      grace_ends_at = case when v_status = 'past_due' then
                             case when s.status = 'past_due' then s.grace_ends_at else now() + interval '7 days' end
                      end,
      provider = 'stripe',
      provider_customer_id = coalesce(p_event ->> 'customer_id', s.provider_customer_id),
      provider_subscription_id = coalesce(p_event ->> 'subscription_id', s.provider_subscription_id),
      billing_interval = v_interval,
      provider_event_at = v_created
     where s.id = v_sub.id
    returning * into v_after;
    v_outcome := 'updated';
  end if;

  update system.billing_events set outcome = v_outcome where id = v_event_row;
  perform audit.record('subscription.provider_' || v_outcome, 'subscription', v_after.id, v_org.id, null,
                       case when v_sub.id is not null then to_jsonb(v_sub) - 'notes' end,
                       to_jsonb(v_after) - 'notes', 'Stripe: ' || (p_event ->> 'type'));
  return jsonb_build_object('outcome', v_outcome, 'status', v_status);
end
$$;
revoke all on function system.billing_apply_stripe_event(jsonb) from public;
grant execute on function system.billing_apply_stripe_event(jsonb) to system_worker;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029000500'::text
$$;
