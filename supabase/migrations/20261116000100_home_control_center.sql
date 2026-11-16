-- =============================================================================
-- Inicio como centro de control (Orden 1, rama feat/inicio-centro-control).
--
-- Dos lecturas nuevas para Inicio; el comparativo de ventas reutiliza
-- `public.dashboard_kpis` con las fechas del periodo anterior (sin SQL nuevo).
--
-- 1. `public.dashboard_recoverable_carts(p_store_id)`: carritos que el
--    recordatorio de ADR-048 puede recuperar. Usa los MISMOS criterios que
--    `system.cart_recovery_due` (20261029000700): activo, con correo, con
--    artículos, sin pedido, sin baja del correo y sin vencer, con 3 horas o más
--    sin actividad; y, como el enlace del correo sigue sirviendo mientras el
--    carrito esté activo (`storefront.cart_recover`), cuenta también los que ya
--    recibieron el recordatorio sin usarlo. Los que nunca lo recibieron solo
--    cuentan dentro de la ventana de 48 h en la que se envía.
--    El carrito no guarda precios (§17.1): el monto es una ESTIMACIÓN con el
--    precio actual de cada presentación (centavos, bigint; regla 14).
--    Devuelve `enabled` = si la tienda tiene encendido el recordatorio.
-- 2. `public.dashboard_customer_mix(p_store_id, p_from, p_to)`: clientes con
--    pedido pagado en el periodo, separados en nuevos (su primer pedido pagado
--    cae en el periodo) y recurrentes (ya tenían uno pagado antes). Fechas en la
--    zona de la tienda, igual que `dashboard_kpis`. Exige `analytics.read` y
--    `customers.read`. Solo conteos: ningún dato personal.
--
-- 3. Índices: `dashboard_kpis` (2–3 llamadas por carga de Inicio) y
--    `dashboard_customer_mix` filtran pedidos por (store_id, paid_at); eso ya
--    lo cubre `orders_store_paid_idx` (20261104000500, parcial `paid_at is not
--    null`, con `include (total)`), así que no se duplica. Nuevo: carritos
--    candidatos por tienda y última actividad (`carts_recovery_due_idx`
--    de 20261029000700 no lleva store_id).
--
-- Solo lee; ninguna tabla nueva. Aditiva (regla 17). Reversa: `drop function`
-- de ambas y `drop index public.carts_store_recoverable_idx`; ningún dato cambia.
-- =============================================================================

create index carts_store_recoverable_idx on public.carts (store_id, last_activity_at)
  where status = 'active' and email is not null;

create function public.dashboard_recoverable_carts(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_count   integer;
  v_amount  bigint;
begin
  perform app.require_store_permission(p_store_id, 'analytics.read');
  select coalesce((select n.cart_recovery from public.store_notification_settings n
                    where n.store_id = p_store_id), false)
    into v_enabled;

  select count(*)::integer, coalesce(sum(x.amount), 0)::bigint
    into v_count, v_amount
    from (select (select coalesce(sum(i.quantity::bigint * v.price), 0)
                    from public.cart_items i
                    join public.product_variants v on v.store_id = i.store_id and v.id = i.variant_id
                                                  and v.deleted_at is null
                   where i.store_id = c.store_id and i.cart_id = c.id) as amount
            from public.carts c
           where c.store_id = p_store_id
             and c.status = 'active' and c.email is not null
             and c.expires_at > now()
             and c.last_activity_at <= now() - interval '3 hours'
             and (c.last_activity_at >= now() - interval '48 hours' or c.recovery_token_hash is not null)
             and exists (select 1 from public.cart_items i where i.store_id = c.store_id and i.cart_id = c.id)
             and not exists (select 1 from public.orders od where od.store_id = c.store_id and od.cart_id = c.id)
             and not exists (select 1 from public.cart_recovery_optouts x
                              where x.store_id = c.store_id and x.email_hash = app.email_hash(c.email))) x;

  return jsonb_build_object('enabled', v_enabled, 'count', v_count, 'amount', v_amount);
end
$$;
revoke all on function public.dashboard_recoverable_carts(uuid) from public;
grant execute on function public.dashboard_recoverable_carts(uuid) to authenticated;

create function public.dashboard_customer_mix(p_store_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz        text;
  v_to        date;
  v_from      date;
  v_start     timestamptz;
  v_end       timestamptz;
  v_new       integer;
  v_returning integer;
begin
  perform app.require_store_permission(p_store_id, 'analytics.read');
  perform app.require_store_permission(p_store_id, 'customers.read');
  select s.timezone into v_tz from public.stores s where s.id = p_store_id;
  -- Mismas reglas de rango que dashboard_kpis (DB-L4).
  if not isfinite(coalesce(p_from, current_date)) or not isfinite(coalesce(p_to, current_date)) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'range';
  end if;
  v_to := coalesce(p_to, (now() at time zone v_tz)::date);
  v_from := coalesce(p_from, v_to - 29);
  if v_to < v_from or v_to - v_from > 365 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'range';
  end if;
  v_start := v_from::timestamp at time zone v_tz;
  v_end := (v_to + 1)::timestamp at time zone v_tz;

  select count(*) filter (where not b.before)::integer, count(*) filter (where b.before)::integer
    into v_new, v_returning
    from (select exists (select 1 from public.orders p
                          where p.store_id = p_store_id and p.customer_id = o.customer_id
                            and p.paid_at < v_start) as before
            from public.orders o
           where o.store_id = p_store_id and o.customer_id is not null
             and o.paid_at >= v_start and o.paid_at < v_end
           group by o.customer_id) b;

  return jsonb_build_object('from', v_from, 'to', v_to, 'new', v_new, 'returning', v_returning);
end
$$;
revoke all on function public.dashboard_customer_mix(uuid, date, date) from public;
grant execute on function public.dashboard_customer_mix(uuid, date, date) to authenticated;

-- Versión del esquema (D-POR-06): Inicio necesita las dos funciones de arriba.
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261116000100'::text
$$;
