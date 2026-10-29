-- ADR-044 (aprobado el 2026-10-29, Stripe Billing): precios en los planes.
-- Primer paso, sin cobrar nada todavía: los planes guardan precio mensual y
-- anual (centavos, regla 14) y días de prueba; cada suscripción guarda si es
-- mensual o anual. Con eso Consola → Métricas calcula el MRR real. Los precios
-- los fija el propietario en la consola: el sistema no los inventa.

alter table public.plans
  add column price_monthly bigint,
  add column price_annual  bigint,
  add column currency      text not null default 'MXN',
  add column trial_days    integer;
alter table public.plans
  add constraint plans_price_monthly_check check (price_monthly is null or price_monthly between 0 and 100000000),
  add constraint plans_price_annual_check check (price_annual is null or price_annual between 0 and 1000000000),
  add constraint plans_currency_check check (currency ~ '^[A-Z]{3}$'),
  add constraint plans_trial_days_check check (trial_days is null or trial_days between 0 and 90);

alter table public.subscriptions
  add column billing_interval text not null default 'monthly';
alter table public.subscriptions
  add constraint subscriptions_billing_interval_check check (billing_interval in ('monthly', 'annual'));

-- Precios de un plan (solo dueña y administración, con auditoría). null = sin precio.
create function public.platform_set_plan_pricing(p_key text, p_price_monthly bigint, p_price_annual bigint,
                                                 p_trial_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan   public.plans;
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
  update public.plans
     set price_monthly = p_price_monthly, price_annual = p_price_annual, trial_days = p_trial_days
   where id = v_plan.id;
  perform audit.record('plan.pricing_saved', 'plan', v_plan.id, null, null,
                       jsonb_build_object('price_monthly', v_plan.price_monthly, 'price_annual', v_plan.price_annual,
                                          'trial_days', v_plan.trial_days),
                       jsonb_build_object('price_monthly', p_price_monthly, 'price_annual', p_price_annual,
                                          'trial_days', p_trial_days));
end
$$;
revoke all on function public.platform_set_plan_pricing(text, bigint, bigint, integer) from public;
grant execute on function public.platform_set_plan_pricing(text, bigint, bigint, integer) to authenticated;

-- La lista de planes de la consola incluye los precios.
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

-- Métricas con MRR (redefine la de 20261029000300).
create or replace function public.platform_metrics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days  integer;
  v_since timestamptz;
begin
  -- Ventas de todas las tiendas: no las ve soporte (solo dueña y administración).
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  if p_days is null or p_days not in (7, 30, 90, 365) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'days';
  end if;
  v_days := p_days;
  v_since := now() - make_interval(days => v_days);

  return jsonb_build_object(
    'days', v_days,
    'organizations', (
      select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where o.status = 'active'),
        'new', count(*) filter (where o.created_at >= v_since))
        from public.organizations o),
    'subscriptions', (
      select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
        from (select s.status, count(*) as n from public.subscriptions s
               where s.status <> 'cancelled' group by s.status) x),
    -- MRR: suscripciones que pagan (activas y con pago vencido en gracia). Las
    -- anuales cuentan su precio entre 12. Sin precio cargado no se inventa: se cuentan aparte.
    'mrr', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'amount', x.amount,
                                                   'subscriptions', x.n) order by x.currency), '[]'::jsonb)
        from (select p.currency,
                     round(sum(case when s.billing_interval = 'annual' then p.price_annual / 12.0
                                    else p.price_monthly end))::bigint as amount,
                     count(*) as n
                from public.subscriptions s join public.plans p on p.id = s.plan_id
               where s.status in ('active', 'past_due')
                 and case when s.billing_interval = 'annual' then p.price_annual else p.price_monthly end is not null
               group by p.currency) x),
    'paying_without_price', (
      select count(*) from public.subscriptions s join public.plans p on p.id = s.plan_id
       where s.status in ('active', 'past_due')
         and case when s.billing_interval = 'annual' then p.price_annual else p.price_monthly end is null),
    'trials_ending_7d', (
      select count(*) from public.subscriptions s
       where s.status = 'trialing' and s.trial_ends_at between now() and now() + interval '7 days'),
    'plans', (
      select coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'name', x.name, 'organizations', x.n)
                                order by x.n desc, x.key), '[]'::jsonb)
        from (select p.key, p.name, count(*) as n
                from public.subscriptions s join public.plans p on p.id = s.plan_id
               where s.status <> 'cancelled'
               group by p.key, p.name) x),
    'stores', (
      select jsonb_build_object(
        'total', count(*) filter (where st.status <> 'closed'),
        'live', count(*) filter (where st.status = 'active'),
        'draft', count(*) filter (where st.status = 'draft'),
        'with_sales', (select count(distinct od.store_id) from public.orders od
                        where od.paid_at >= v_since and od.paid_total > 0))
        from public.stores st),
    'sales', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'orders', x.orders,
                                                   'net', x.net, 'refunded', x.refunded)
                                order by x.currency), '[]'::jsonb)
        from (select od.currency, count(*) as orders,
                     sum(od.paid_total - od.refunded_total) as net, sum(od.refunded_total) as refunded
                from public.orders od
               where od.paid_at >= v_since and od.paid_total > 0
               group by od.currency) x),
    'top_stores', (
      select coalesce(jsonb_agg(jsonb_build_object('store', x.name, 'handle', x.handle,
                                                   'currency', x.currency, 'orders', x.orders, 'net', x.net)
                                order by x.net desc, x.handle), '[]'::jsonb)
        from (select st.name, st.handle, od.currency, count(*) as orders,
                     sum(od.paid_total - od.refunded_total) as net
                from public.orders od join public.stores st on st.id = od.store_id
               where od.paid_at >= v_since and od.paid_total > 0
               group by st.name, st.handle, od.currency
               order by sum(od.paid_total - od.refunded_total) desc, st.handle
               limit 10) x)
  );
end
$$;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029000400'::text
$$;
