-- =============================================================================
-- Reversa de 20261127000100_platform_overview_set_based.sql («Mis clientes» más
-- rápido). 2026-11-27.
--
-- SIN PÉRDIDA: solo cambia cómo se calcula una función de lectura. Devuelve
-- platform_store_overview a la definición de 20261126000200 (subconsultas por
-- tienda) y deja public.app_schema_version() EXACTA a 20261126000200 (lo prueba
-- scripts/ops/reversa/comprobar-0400.sh).
--
-- El código de esta rama espera 20261127000100: con la base en 0200 el panel
-- avisaría que faltan migraciones. Orden:
--   1. desplegar el código que espera 20261126000200 (sin este cambio);
--   2. correr esto.
--
-- Uso (SOLO con autorización y en la ventana): psql -X -1 -v ON_ERROR_STOP=1 -f <este archivo>
-- =============================================================================

do $$
begin
  if coalesce(public.app_schema_version(), '') <> '20261127000100' then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = format('La base está en %s; esta reversa solo aplica a 20261127000100.',
                      coalesce(public.app_schema_version(), 'desconocida'));
  end if;
end
$$;

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
  -- Transferencias sin confirmar por la tienda después de 24 h.
  stale_pending_payments  integer,
  -- Pedidos pagados sin enviar después de 3 días.
  unshipped_paid          integer,
  -- Pedidos que el sistema marcó para revisión (abiertos).
  orders_need_attention   integer,
  -- Trabajos en segundo plano agotados en los últimos 7 días.
  dead_jobs_7d            integer,
  -- Último acceso de cualquier persona del equipo de la tienda.
  last_staff_sign_in_at   timestamptz,
  -- Visitantes de los últimos 7 días (uno por persona al día; null = aún sin conteo).
  visitors_7d             integer,
  -- Tiendas que coinciden con la búsqueda (antes del límite).
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
  with base as (
    select st.id as s_id, st.name as s_name, st.handle as s_handle, st.status as s_status,
           st.created_at as s_created, st.launched_at as s_launched,
           o.id as o_id, o.name as o_name, o.status as o_status,
           (select u.email::text from public.organization_members m join auth.users u on u.id = m.user_id
             where m.organization_id = o.id and m.role = 'org_owner' limit 1) as owner,
           p.key as p_key, s.status as sub_status, s.trial_ends_at as trial_end, s.grace_ends_at as grace_end,
           (select count(*)::integer from public.products pr
             where pr.store_id = st.id and pr.status = 'active' and pr.deleted_at is null) as products,
           (select count(*)::integer from public.orders od
             where od.store_id = st.id and od.paid_at >= now() - interval '30 days' and od.paid_total > 0) as paid30,
           (select max(od.paid_at) from public.orders od where od.store_id = st.id and od.paid_total > 0) as last_paid,
           (select count(*)::integer from public.orders od
             where od.store_id = st.id and od.status = 'pending_payment'
               and od.payment_status in ('unpaid', 'pending')
               and coalesce(od.placed_at, od.created_at) < now() - interval '24 hours') as stale,
           (select count(*)::integer from public.orders od
             where od.store_id = st.id and od.status = 'open' and od.payment_status = 'paid'
               and od.requires_shipping and od.fulfillment_status = 'unfulfilled'
               and od.paid_at < now() - interval '3 days') as unshipped,
           (select count(*)::integer from public.orders od
             where od.store_id = st.id and od.needs_attention and od.status in ('pending_payment', 'open')) as attention,
           (select count(*)::integer from system.jobs j
             where j.store_id = st.id and j.status = 'dead' and j.updated_at >= now() - interval '7 days') as dead,
           (select max(u.last_sign_in_at) from auth.users u
             where u.id in (select m.user_id from public.organization_members m
                             where m.organization_id = o.id and m.status = 'active'
                            union
                            select sm.user_id from public.store_members sm
                             where sm.store_id = st.id and sm.status = 'active')) as last_sign_in,
           (select sum(v.visitors)::integer from public.store_visits_daily v
             where v.store_id = st.id and v.day > (now() at time zone st.timezone)::date - 7) as visitors7
      from public.stores st
      join public.organizations o on o.id = st.organization_id
      left join public.subscriptions s on s.organization_id = o.id and s.status <> 'cancelled'
      left join public.plans p on p.id = s.plan_id
     where st.status <> 'closed'
       and (v_search is null or st.name ilike v_like or st.handle ilike v_like or o.name ilike v_like)
  )
  select b.s_id, b.s_name, b.s_handle, b.s_status, b.s_created, b.s_launched,
         b.o_id, b.o_name, b.o_status, b.owner, b.p_key, b.sub_status, b.trial_end, b.grace_end,
         b.products, b.paid30, b.last_paid, b.stale, b.unshipped, b.attention, b.dead, b.last_sign_in, b.visitors7,
         (count(*) over ())::integer
    from base b
   -- Urgencia primero (los mismos motivos «rojos» de client-health.ts), luego por nombre.
   -- (coalesce: sin suscripción, `= 'past_due'` sería NULL y la suma NULL iría primero.)
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
  select '20261126000200'::text
$$;
