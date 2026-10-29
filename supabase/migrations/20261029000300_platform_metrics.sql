-- Misión vendible F4 (plataforma como producto SaaS): Consola → Métricas.
-- Una sola lectura agregada para la dueña y la administración de la plataforma:
-- organizaciones y suscripciones por estado, tiendas lanzadas, pedidos cobrados y
-- ventas (cobrado menos reembolsado) por moneda en una ventana de días, y las
-- tiendas con más ventas. Solo conteos y sumas: ningún dato de clientes.
-- El MRR no se calcula: los planes aún no tienen precio (ADR-044, propuesto).

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
revoke all on function public.platform_metrics(integer) from public;
grant execute on function public.platform_metrics(integer) to authenticated;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029000300'::text
$$;
