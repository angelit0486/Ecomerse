-- =============================================================================
-- Reporte de promociones (ADR-070, fase 4). Solo lectura.
--
-- public.promotions_report(store, from, to): por promoción, en pedidos PAGADOS
-- del periodo (zona horaria de la tienda, máx. 366 días, sin cancelados):
--   orders        pedidos en que se aplicó;
--   units         piezas de las partidas con la promoción;
--   discount      ahorro que dio (copia del pedido, order_promotions.amount);
--   sales         lo cobrado por esas partidas (line_total: ya con descuentos).
-- Más los totales del periodo (pedidos con alguna promoción, ahorro, venta).
-- No resta devoluciones (como el reporte de ventas del panel).
--
-- Permiso `discounts.read` (el mismo del panel de promociones) y función de plan
-- `promotion_reports` (Tienda Plus): sin ella responde not_found/feature y el
-- panel muestra la invitación a subir de plan. Lee la copia guardada en cada
-- pedido: nombre y leyenda de la promoción de hoy si aún existe; si no, los de
-- la copia.
--
-- Sin tablas, columnas, permisos nuevos ni escrituras. Reversa:
-- scripts/ops/reversa/20261125000400_promotions_report.reversa.sql.
-- =============================================================================

create or replace function public.promotions_report(p_store_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
  v_to    date;
  v_from  date;
  v_start timestamptz;
  v_end   timestamptz;
  v_out   jsonb;
begin
  perform app.require_store_permission(p_store_id, 'discounts.read');
  select * into v_store from public.stores s where s.id = p_store_id;
  if not app.entitlement_enabled(v_store.organization_id, 'promotion_reports') then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'feature';
  end if;
  if not isfinite(coalesce(p_from, current_date)) or not isfinite(coalesce(p_to, current_date)) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'range';
  end if;
  v_to := coalesce(p_to, (now() at time zone v_store.timezone)::date);
  v_from := coalesce(p_from, v_to - 29);
  if v_to < v_from or v_to - v_from > 365 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'range';
  end if;
  v_start := v_from::timestamp at time zone v_store.timezone;
  v_end := (v_to + 1)::timestamp at time zone v_store.timezone;

  with ords as (
    select o.id from public.orders o
     where o.store_id = p_store_id and o.paid_at >= v_start and o.paid_at < v_end and o.status <> 'cancelled'
  ), applied as (
    -- Una fila por promoción y partida (la misma partida no se cuenta dos veces).
    select coalesce(op.promotion_id::text, 'copia:' || md5(op.snapshot::text)) as k,
           op.promotion_id, op.snapshot, op.order_id, op.order_item_id,
           sum(op.amount)::bigint as discount
      from public.order_promotions op
      join ords o on o.id = op.order_id
     where op.store_id = p_store_id
     group by 1, op.promotion_id, op.snapshot, op.order_id, op.order_item_id
  ), per_promo as (
    select a.k, a.promotion_id, (array_agg(a.snapshot order by a.order_id desc))[1] as snapshot,
           count(distinct a.order_id)::integer as orders,
           coalesce(sum(i.quantity), 0)::integer as units,
           sum(a.discount)::bigint as discount,
           coalesce(sum(i.line_total), 0)::bigint as sales
      from applied a
      join public.order_items i on i.store_id = p_store_id and i.id = a.order_item_id
     group by a.k, a.promotion_id
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'currency', v_store.currency,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'promotion_id', pp.promotion_id,
               'name', coalesce(pr.name, pp.snapshot ->> 'name'),
               'label', coalesce(pr.label, pp.snapshot ->> 'label'),
               'type', pp.snapshot ->> 'type',
               'status', pr.status,
               'orders', pp.orders, 'units', pp.units, 'discount', pp.discount, 'sales', pp.sales)
             order by pp.discount desc, coalesce(pr.name, pp.snapshot ->> 'name'))
        from per_promo pp
        left join public.promotions pr on pr.store_id = p_store_id and pr.id = pp.promotion_id), '[]'::jsonb),
    'totals', jsonb_build_object(
      'orders', (select count(distinct a.order_id) from applied a)::integer,
      'discount', (select coalesce(sum(a.discount), 0) from applied a)::bigint,
      'sales', (select coalesce(sum(i.line_total), 0) from public.order_items i
                 where i.store_id = p_store_id and i.id in (select a.order_item_id from applied a))::bigint,
      'paid_orders', (select count(*) from ords)::integer))
    into v_out;
  return v_out;
end
$$;
revoke all on function public.promotions_report(uuid, date, date) from public;
grant execute on function public.promotions_report(uuid, date, date) to authenticated;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261125000400'::text
$$;
