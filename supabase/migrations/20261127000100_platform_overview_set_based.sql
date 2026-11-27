-- =============================================================================
-- «Mis clientes» más rápido (auditoría del 26 nov 2026, PERF-02). 2026-11-27.
--
-- platform_store_overview calculaba 11 subconsultas correlacionadas POR TIENDA
-- antes de ordenar por urgencia. Medido en local con 9,221 tiendas: 1.8 s en
-- caliente y 30.8 s en frío. Solo el conteo de productos activos tardaba 5 s.
--
-- Mismo contrato (columnas, tipos, permisos, búsqueda, orden y límite); cambia
-- solo cómo se calcula: cada tabla se agrupa UNA vez por store_id, limitada a
-- las tiendas que coinciden con la búsqueda, y luego se une.
--
-- Único cambio visible: si una organización tiene varias dueñas, `owner_email`
-- es la que entró primero a la organización (antes: cualquiera, sin orden).
--
-- Reversa: scripts/ops/reversa/20261127000100_platform_overview_set_based.reversa.sql
-- (sin pérdida: vuelve a la definición de 20261126000200).
-- =============================================================================

create or replace function public.platform_store_overview(p_search text default null, p_limit integer default 300)
returns table (
  store_id                uuid,
  store_name              text,
  handle                  text,
  store_status            text,
  store_created_at        timestamptz,
  launched_at             timestamptz,
  organization_id         uuid,
  organization_name       text,
  organization_status     text,
  owner_email             text,
  plan_key                text,
  subscription_status     text,
  trial_ends_at           timestamptz,
  grace_ends_at           timestamptz,
  products_active         integer,
  paid_orders_30d         integer,
  last_paid_at            timestamptz,
  stale_pending_payments  integer,
  unshipped_paid          integer,
  orders_need_attention   integer,
  dead_jobs_7d            integer,
  last_staff_sign_in_at   timestamptz,
  visitors_7d             integer,
  total_count             integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_like   text;
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  v_like := '%' || replace(replace(replace(coalesce(v_search, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  with sel as (
    select st.id, st.name, st.handle, st.status, st.created_at, st.launched_at, st.timezone,
           o.id as org_id, o.name as org_name, o.status as org_status
      from public.stores st
      join public.organizations o on o.id = st.organization_id
     where st.status <> 'closed'
       and (v_search is null or st.name ilike v_like or st.handle ilike v_like or o.name ilike v_like)
  ),
  prod as (
    select pr.store_id, count(*)::integer as n
      from public.products pr
      join sel on sel.id = pr.store_id
     where pr.status = 'active' and pr.deleted_at is null
     group by pr.store_id
  ),
  ord as (
    select od.store_id,
           (count(*) filter (where od.paid_at >= now() - interval '30 days' and od.paid_total > 0))::integer as paid30,
           max(od.paid_at) filter (where od.paid_total > 0) as last_paid,
           (count(*) filter (where od.status = 'pending_payment'
                               and od.payment_status in ('unpaid', 'pending')
                               and coalesce(od.placed_at, od.created_at) < now() - interval '24 hours'))::integer as stale,
           (count(*) filter (where od.status = 'open' and od.payment_status = 'paid'
                               and od.requires_shipping and od.fulfillment_status = 'unfulfilled'
                               and od.paid_at < now() - interval '3 days'))::integer as unshipped,
           (count(*) filter (where od.needs_attention and od.status in ('pending_payment', 'open')))::integer as attention
      from public.orders od
      join sel on sel.id = od.store_id
     group by od.store_id
  ),
  dead as (
    select j.store_id, count(*)::integer as n
      from system.jobs j
      join sel on sel.id = j.store_id
     where j.status = 'dead' and j.updated_at >= now() - interval '7 days'
     group by j.store_id
  ),
  vis as (
    select v.store_id, sum(v.visitors)::integer as n
      from public.store_visits_daily v
      join sel on sel.id = v.store_id
     where v.day > (now() at time zone sel.timezone)::date - 7
     group by v.store_id
  ),
  owners as (
    select distinct on (m.organization_id) m.organization_id, u.email::text as email
      from public.organization_members m
      join auth.users u on u.id = m.user_id
     where m.role = 'org_owner'
       and m.organization_id in (select sel.org_id from sel)
     order by m.organization_id, m.created_at, m.user_id
  ),
  signin as (
    select team.store_id, max(u.last_sign_in_at) as last_sign_in
      from (select sel.id as store_id, m.user_id
              from sel
              join public.organization_members m on m.organization_id = sel.org_id and m.status = 'active'
            union
            select sm.store_id, sm.user_id
              from public.store_members sm
              join sel on sel.id = sm.store_id
             where sm.status = 'active') team
      join auth.users u on u.id = team.user_id
     group by team.store_id
  ),
  base as (
    select sel.id as s_id, sel.name as s_name, sel.handle as s_handle, sel.status as s_status,
           sel.created_at as s_created, sel.launched_at as s_launched,
           sel.org_id as o_id, sel.org_name as o_name, sel.org_status as o_status,
           owners.email as owner,
           p.key as p_key, s.status as sub_status, s.trial_ends_at as trial_end, s.grace_ends_at as grace_end,
           coalesce(prod.n, 0) as products,
           coalesce(ord.paid30, 0) as paid30,
           ord.last_paid as last_paid,
           coalesce(ord.stale, 0) as stale,
           coalesce(ord.unshipped, 0) as unshipped,
           coalesce(ord.attention, 0) as attention,
           coalesce(dead.n, 0) as dead,
           signin.last_sign_in as last_sign_in,
           vis.n as visitors7
      from sel
      left join public.subscriptions s on s.organization_id = sel.org_id and s.status <> 'cancelled'
      left join public.plans p on p.id = s.plan_id
      left join owners on owners.organization_id = sel.org_id
      left join prod on prod.store_id = sel.id
      left join ord on ord.store_id = sel.id
      left join dead on dead.store_id = sel.id
      left join vis on vis.store_id = sel.id
      left join signin on signin.store_id = sel.id
  )
  select b.s_id, b.s_name, b.s_handle, b.s_status, b.s_created, b.s_launched,
         b.o_id, b.o_name, b.o_status, b.owner, b.p_key, b.sub_status, b.trial_end, b.grace_end,
         b.products, b.paid30, b.last_paid, b.stale, b.unshipped, b.attention, b.dead, b.last_sign_in, b.visitors7,
         (count(*) over ())::integer
    from base b
   -- Urgencia primero (los mismos motivos «rojos» de client-health.ts), luego por nombre.
   order by ((b.o_status = 'suspended')::int + coalesce(b.sub_status = 'past_due', false)::int + (b.stale > 0)::int
             + (b.unshipped > 0)::int + (b.attention > 0)::int + (b.dead > 0)::int
             + (b.s_status = 'active' and b.products = 0)::int) desc,
            b.o_name, b.s_name
   limit least(greatest(coalesce(p_limit, 300), 1), 500);
end
$$;

revoke all on function public.platform_store_overview(text, integer) from public;
grant execute on function public.platform_store_overview(text, integer) to authenticated;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261127000100'::text
$$;
