-- =============================================================================
-- Fase 8 · Dashboard de KPIs (F8-T03). Contrato: GATE0 §38 (PHASE 8: consultas
-- agregadas sobre orders y order_items).
--
-- * Rango por días en la zona horaria de la TIENDA (inclusive). Máximo 366 días.
-- * Ventas = total de los pedidos pagados en el rango (paid_at); reembolsos =
--   reembolsos confirmados en el rango; netas = ventas − reembolsos. Un pedido
--   cancelado que llegó a pagarse cuenta en ventas y su reembolso en reembolsos.
-- * Ticket promedio = ventas / pedidos pagados, redondeado al centavo.
-- * Existencias bajas solo con inventory.read (umbral por nivel).
-- =============================================================================

create or replace function public.dashboard_kpis(p_store_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz     text;
  v_to     date;
  v_from   date;
  v_start  timestamptz;
  v_end    timestamptz;
  v_gross  bigint;
  v_count  integer;
  v_refund bigint;
begin
  perform app.require_store_permission(p_store_id, 'analytics.read');
  select s.timezone into v_tz from public.stores s where s.id = p_store_id;
  v_to := coalesce(p_to, (now() at time zone v_tz)::date);
  v_from := coalesce(p_from, v_to - 29);
  if v_to < v_from or v_to - v_from > 366 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'range';
  end if;
  v_start := v_from::timestamp at time zone v_tz;
  v_end := (v_to + 1)::timestamp at time zone v_tz;

  select coalesce(sum(o.total), 0)::bigint, count(*)::integer into v_gross, v_count
    from public.orders o
   where o.store_id = p_store_id and o.paid_at >= v_start and o.paid_at < v_end;
  select coalesce(sum(r.amount), 0)::bigint into v_refund
    from public.refunds r
   where r.store_id = p_store_id and r.status = 'succeeded' and r.updated_at >= v_start and r.updated_at < v_end;

  return jsonb_build_object(
    'from', v_from, 'to', v_to, 'timezone', v_tz,
    'gross_sales', v_gross,
    'refunds', v_refund,
    'net_sales', v_gross - v_refund,
    'orders', v_count,
    'average_ticket', case when v_count > 0 then round(v_gross::numeric / v_count)::bigint else 0 end,
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day::date, 'sales', coalesce(x.sales, 0),
                                                            'orders', coalesce(x.orders, 0)) order by d.day), '[]'::jsonb)
                 from generate_series(v_from, v_to, interval '1 day') as d(day)
                 left join (select (o.paid_at at time zone v_tz)::date as day, sum(o.total)::bigint as sales,
                                   count(*)::integer as orders
                              from public.orders o
                             where o.store_id = p_store_id and o.paid_at >= v_start and o.paid_at < v_end
                             group by 1) x on x.day = d.day::date),
    'top_products', (select coalesce(jsonb_agg(t order by (t ->> 'quantity')::integer desc, t ->> 'title'), '[]'::jsonb)
                       from (select jsonb_build_object('product_id', i.product_id, 'title', min(i.product_title),
                                                       'quantity', sum(i.quantity)::integer,
                                                       'revenue', sum(i.line_total)::bigint) as t
                               from public.order_items i
                               join public.orders o on o.store_id = i.store_id and o.id = i.order_id
                              where o.store_id = p_store_id and o.paid_at >= v_start and o.paid_at < v_end
                              -- Producto borrado después de la venta: se agrupa por el título del snapshot.
                              group by i.product_id, case when i.product_id is null then i.product_title end
                              order by sum(i.quantity) desc, min(i.product_title)
                              limit 5) q),
    'pending_payment', (select count(*)::integer from public.orders o
                         where o.store_id = p_store_id and o.status = 'pending_payment'),
    'needs_attention', (select count(*)::integer from public.orders o
                         where o.store_id = p_store_id and o.needs_attention),
    'to_fulfill', (select count(*)::integer from public.orders o
                    where o.store_id = p_store_id and o.status = 'open'
                      and o.fulfillment_status in ('unfulfilled', 'partially_fulfilled')),
    'low_stock', case when app.has_store_permission(p_store_id, 'inventory.read') then (
        select coalesce(jsonb_agg(jsonb_build_object('variant_id', l.variant_id, 'title', p.title,
                                                     'variant', v.option_signature, 'sku', v.sku,
                                                     'available', l.available, 'threshold', l.low_stock_threshold)
                                  order by l.available, p.title), '[]'::jsonb)
          from (select * from public.inventory_levels l
                 where l.store_id = p_store_id and l.low_stock_threshold is not null
                   and l.available <= l.low_stock_threshold
                 order by l.available limit 10) l
          join public.product_variants v on v.store_id = l.store_id and v.id = l.variant_id and v.deleted_at is null
          join public.products p on p.store_id = v.store_id and p.id = v.product_id and p.deleted_at is null)
      end);
end
$$;

revoke all on function public.dashboard_kpis(uuid, date, date) from public;
grant execute on function public.dashboard_kpis(uuid, date, date) to authenticated;
