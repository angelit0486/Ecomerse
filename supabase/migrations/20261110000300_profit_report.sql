-- =============================================================================
-- Reporte de rentabilidad («¿cuánto gané?»), diferenciador 1 del diagnóstico
-- del 2026-11-10. Detrás del interruptor por tienda `profit_report` (apagado;
-- la tienda lo enciende en Ajustes → Funciones). Solo lee.
--
-- Cálculo (determinista, en centavos, sin flotantes; regla 14):
--   * Pedidos pagados en el rango (por `paid_at`, zona horaria de la tienda),
--     sin los cancelados.
--   * Unidades que cuentan = pedidas − reembolsadas − canceladas.
--   * Venta del producto = total de la línea (ya con su descuento), sin el
--     impuesto cuando el precio lo incluye, prorrateada a esas unidades.
--     No entran el envío cobrado ni el impuesto: no son ganancia.
--   * Costo = costo de la variante AL MOMENTO de la venta (foto nueva en
--     `order_item_costs`); en ventas anteriores a esta migración, el costo
--     actual, y se avisa cuántas unidades usan ese costo.
--   * Otros reembolsos = reembolsos sin producto ligado, menos el valor de las
--     unidades canceladas (ya descontadas de la venta).
--   * Utilidad = venta con costo conocido − costo − otros reembolsos. Lo
--     vendido sin costo capturado se muestra aparte y no entra en la utilidad.
--   * NO incluye comisiones del medio de pago ni costo de envío: no se guardan
--     todavía (llegan con los pagos reales).
--
-- El pedido no se toca: la foto del costo vive en su propia tabla, solo de
-- alta (regla 9). Reversa: `kill_switch = true` en `profit_report` oculta el
-- reporte; quitar el trigger `order_items_snapshot_cost` deja de guardar fotos.
-- =============================================================================

insert into public.feature_flags (key, description, default_enabled, owner, store_toggle) values
  ('profit_report', 'Panel: reporte de rentabilidad por pedido y por producto', false, 'plataforma', true)
on conflict (key) do nothing;

-- ---------------------------------------------- Foto del costo al vender
create table public.order_item_costs (
  store_id      uuid not null references public.stores (id) on delete restrict,
  order_item_id uuid not null,
  unit_cost     bigint not null check (unit_cost >= 0),
  created_at    timestamptz not null default now(),
  primary key (store_id, order_item_id),
  foreign key (store_id, order_item_id) references public.order_items (store_id, id) on delete restrict
);
create trigger order_item_costs_prevent_tenant_change before update on public.order_item_costs
  for each row execute function app.prevent_tenant_change();
create trigger order_item_costs_no_update before update on public.order_item_costs
  for each row execute function app.forbid_mutation();
create trigger order_item_costs_no_delete before delete on public.order_item_costs
  for each row execute function app.forbid_mutation();

alter table public.order_item_costs enable row level security;
alter table public.order_item_costs force row level security;
revoke all on table public.order_item_costs from public, anon, authenticated, service_role;
grant select on table public.order_item_costs to authenticated;
create policy order_item_costs_select on public.order_item_costs for select to authenticated
  using (app.has_store_permission(store_id, 'products.cost.read'));

create function app.snapshot_order_item_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.variant_id is not null then
    insert into public.order_item_costs (store_id, order_item_id, unit_cost)
    select new.store_id, new.id, c.cost
      from public.variant_costs c
     where c.store_id = new.store_id and c.variant_id = new.variant_id
    on conflict do nothing;
  end if;
  return null;
end
$$;
revoke all on function app.snapshot_order_item_cost() from public;
create trigger order_items_snapshot_cost after insert on public.order_items
  for each row execute function app.snapshot_order_item_cost();

-- ---------------------------------------------- El reporte
create function public.profit_report(p_store_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz    text;
  v_to    date;
  v_from  date;
  v_start timestamptz;
  v_end   timestamptz;
  v_out   jsonb;
begin
  perform app.require_store_permission(p_store_id, 'analytics.read');
  -- El costo es dato reservado: sin ese permiso no hay reporte.
  perform app.require_store_permission(p_store_id, 'products.cost.read');
  if not app.flag_enabled('profit_report', p_store_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'feature';
  end if;
  select s.timezone into v_tz from public.stores s where s.id = p_store_id;
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

  with ords as (
    select o.id, o.display_number, o.paid_at, o.prices_include_tax, o.shipping_total, o.tax_total
      from public.orders o
     where o.store_id = p_store_id and o.paid_at >= v_start and o.paid_at < v_end
       and o.status <> 'cancelled'
  ), lines as (
    select o.id as order_id, i.product_id, i.product_title,
           greatest(i.quantity - i.refunded_quantity - i.cancelled_quantity, 0) as kept,
           ((i.line_total - case when o.prices_include_tax then i.tax_amount else 0 end)::bigint
              * greatest(i.quantity - i.refunded_quantity - i.cancelled_quantity, 0)) / i.quantity as revenue,
           (i.line_total::bigint * i.cancelled_quantity) / i.quantity as cancelled_value,
           coalesce(s.unit_cost, c.cost) as unit_cost,
           (s.unit_cost is null and c.cost is not null) as cost_is_current
      from ords o
      join public.order_items i on i.store_id = p_store_id and i.order_id = o.id
      left join public.order_item_costs s on s.store_id = i.store_id and s.order_item_id = i.id
      left join public.variant_costs c on c.store_id = i.store_id and c.variant_id = i.variant_id
  ), per_order as (
    select o.id, o.display_number, o.paid_at, o.shipping_total, o.tax_total,
           coalesce(sum(l.revenue), 0)::bigint as revenue,
           coalesce(sum(l.revenue) filter (where l.unit_cost is not null), 0)::bigint as revenue_with_cost,
           coalesce(sum(l.unit_cost * l.kept), 0)::bigint as cost,
           coalesce(sum(l.kept) filter (where l.unit_cost is null), 0)::integer as units_without_cost,
           coalesce(sum(l.kept) filter (where l.cost_is_current), 0)::integer as units_current_cost,
           greatest(
             (select coalesce(sum(r.amount), 0) from public.refunds r
               where r.store_id = p_store_id and r.order_id = o.id and r.status = 'succeeded'
                 and jsonb_array_length(r.items) = 0)
             - coalesce(sum(l.cancelled_value), 0), 0)::bigint as other_refunds
      from ords o
      left join lines l on l.order_id = o.id
     group by o.id, o.display_number, o.paid_at, o.shipping_total, o.tax_total
  ), per_product as (
    select l.product_id, min(l.product_title) as title,
           sum(l.kept)::integer as units,
           sum(l.revenue)::bigint as revenue,
           -- Costo solo si TODAS sus unidades lo tienen; si no, no se inventa.
           case when bool_and(l.unit_cost is not null) then sum(l.unit_cost * l.kept)::bigint end as cost
      from lines l
     where l.kept > 0
     group by l.product_id, case when l.product_id is null then l.product_title end
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'timezone', v_tz,
    'orders', (select count(*)::integer from per_order),
    'cancelled_orders', (select count(*)::integer from public.orders o
                          where o.store_id = p_store_id and o.paid_at >= v_start and o.paid_at < v_end
                            and o.status = 'cancelled'),
    'revenue', (select coalesce(sum(p.revenue), 0)::bigint from per_order p),
    'revenue_without_cost', (select coalesce(sum(p.revenue - p.revenue_with_cost), 0)::bigint from per_order p),
    'cost', (select coalesce(sum(p.cost), 0)::bigint from per_order p),
    'other_refunds', (select coalesce(sum(p.other_refunds), 0)::bigint from per_order p),
    'profit', (select coalesce(sum(p.revenue_with_cost - p.cost - p.other_refunds), 0)::bigint from per_order p),
    'units_without_cost', (select coalesce(sum(p.units_without_cost), 0)::integer from per_order p),
    'units_current_cost', (select coalesce(sum(p.units_current_cost), 0)::integer from per_order p),
    'shipping_charged', (select coalesce(sum(p.shipping_total), 0)::bigint from per_order p),
    'tax', (select coalesce(sum(p.tax_total), 0)::bigint from per_order p),
    'products', (select coalesce(jsonb_agg(jsonb_build_object(
                            'product_id', q.product_id, 'title', q.title, 'units', q.units,
                            'revenue', q.revenue, 'cost', q.cost,
                            'profit', q.revenue - q.cost)
                          order by (q.revenue - q.cost) desc nulls last, q.revenue desc, q.title), '[]'::jsonb)
                   from (select * from per_product pp
                          order by (pp.revenue - pp.cost) desc nulls last, pp.revenue desc, pp.title
                          limit 50) q),
    'order_rows', (select coalesce(jsonb_agg(jsonb_build_object(
                              'order_id', q.id, 'number', q.display_number, 'paid_at', q.paid_at,
                              'revenue', q.revenue, 'cost', q.cost, 'other_refunds', q.other_refunds,
                              'profit', case when q.units_without_cost = 0
                                             then q.revenue - q.cost - q.other_refunds end)
                            order by q.paid_at desc, q.id), '[]'::jsonb)
                     from (select * from per_order po order by po.paid_at desc, po.id limit 50) q)
  ) into v_out;
  return v_out;
end
$$;
revoke all on function public.profit_report(uuid, date, date) from public;
grant execute on function public.profit_report(uuid, date, date) to authenticated;

-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261110000300'::text
$$;
