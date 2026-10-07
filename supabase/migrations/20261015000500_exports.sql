-- =============================================================================
-- Fase 8 · Exportación CSV (F8-T04a). Contrato: GATE0 §26.2.
--
-- * exports.run + el permiso de lectura de la entidad (+ customers.pii.read para
--   PII completa: sin él, los clientes salen enmascarados y los pedidos sin
--   datos de contacto).
-- * ≤ 5 000 filas por exportación síncrona (con el JWT del usuario). Más filas:
--   validation_failed/too_many_rows (la exportación asíncrona por job llega con
--   la importación, F8-T04b).
-- * Auditoría export.requested (entidad, filas, si incluyó PII) — acción sensible.
-- * Las filas salen como JSON; el CSV (con neutralización de fórmulas) se arma
--   en el servidor (src/lib/csv.ts).
-- =============================================================================

create or replace function public.exports_rows(p_store_id uuid, p_entity text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pii   boolean;
  v_inv   boolean;
  v_count integer;
  v_rows  jsonb;
  v_max   constant integer := 5000;
begin
  perform app.require_store_permission(p_store_id, 'exports.run');
  if p_entity is null or p_entity not in ('products', 'inventory', 'orders', 'customers') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'entity';
  end if;
  perform app.require_store_permission(p_store_id, case p_entity
    when 'products' then 'products.read' when 'inventory' then 'inventory.read'
    when 'orders' then 'orders.read' else 'customers.read' end);
  v_pii := app.has_store_permission(p_store_id, 'customers.pii.read');
  v_inv := app.has_store_permission(p_store_id, 'inventory.read');

  if p_entity = 'products' then
    select count(*) into v_count from public.product_variants v
      join public.products p on p.store_id = v.store_id and p.id = v.product_id and p.deleted_at is null
     where v.store_id = p_store_id and v.deleted_at is null;
  elsif p_entity = 'inventory' then
    select count(*) into v_count from public.inventory_levels l where l.store_id = p_store_id;
  elsif p_entity = 'orders' then
    select count(*) into v_count from public.orders o where o.store_id = p_store_id;
  else
    select count(*) into v_count from public.customers c where c.store_id = p_store_id and c.deleted_at is null;
  end if;
  if v_count > v_max then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'too_many_rows';
  end if;

  if p_entity = 'products' then
    -- Una fila por variante, con el formato de la futura plantilla de importación.
    select coalesce(jsonb_agg(r order by r ->> 'handle', (r ->> 'position')::integer), '[]'::jsonb) into v_rows
      from (select jsonb_build_object(
              'handle', p.slug, 'title', p.title, 'status', p.status, 'description', p.description_html,
              'brand', b.name,
              'categories', (select string_agg(c.name, '|' order by pc.position) from public.product_categories pc
                               join public.categories c on c.store_id = pc.store_id and c.id = pc.category_id
                              where pc.store_id = p.store_id and pc.product_id = p.id),
              'tags', array_to_string(p.tags, '|'),
              'options', (select coalesce(jsonb_agg(jsonb_build_object('name', split_part(kv, '=', 1),
                                                                       'value', split_part(kv, '=', 2))
                                                    order by coalesce(o.position, 99), split_part(kv, '=', 1)), '[]'::jsonb)
                            from regexp_split_to_table(nullif(v.option_signature, ''), '\|') kv
                            left join public.product_options o
                              on o.store_id = p.store_id and o.product_id = p.id and o.name = split_part(kv, '=', 1)),
              'sku', v.sku, 'barcode', v.barcode, 'price', v.price, 'compare_at_price', v.compare_at_price,
              'weight_g', v.weight_g, 'length_mm', v.length_mm, 'width_mm', v.width_mm, 'height_mm', v.height_mm,
              'requires_shipping', v.requires_shipping, 'inventory_policy', v.inventory_policy,
              'variant_status', v.status, 'position', v.position,
              'available', case when v_inv then (select sum(l.available) from public.inventory_levels l
                                                 where l.store_id = v.store_id and l.variant_id = v.id) end,
              'seo_title', p.seo_title, 'seo_description', p.seo_description) as r
              from public.product_variants v
              join public.products p on p.store_id = v.store_id and p.id = v.product_id and p.deleted_at is null
              left join public.brands b on b.store_id = p.store_id and b.id = p.brand_id
             where v.store_id = p_store_id and v.deleted_at is null) q;
  elsif p_entity = 'inventory' then
    select coalesce(jsonb_agg(r order by r ->> 'title', r ->> 'sku'), '[]'::jsonb) into v_rows
      from (select jsonb_build_object('title', p.title, 'variant', v.option_signature, 'sku', v.sku,
                                      'location', loc.name, 'on_hand', l.on_hand, 'reserved', l.reserved,
                                      'available', l.available, 'low_stock_threshold', l.low_stock_threshold) as r
              from public.inventory_levels l
              join public.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
              join public.products p on p.store_id = v.store_id and p.id = v.product_id
              join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id
             where l.store_id = p_store_id) q;
  elsif p_entity = 'orders' then
    select coalesce(jsonb_agg(r order by r ->> 'placed_at' desc), '[]'::jsonb) into v_rows
      from (select jsonb_build_object(
              'number', o.display_number, 'placed_at', o.placed_at, 'status', o.status,
              'payment_status', o.payment_status, 'fulfillment_status', o.fulfillment_status,
              'items', (select sum(i.quantity) from public.order_items i where i.store_id = o.store_id and i.order_id = o.id),
              'subtotal', o.subtotal, 'discount', o.discount_total, 'shipping', o.shipping_total, 'tax', o.tax_total,
              'total', o.total, 'paid', o.paid_total, 'refunded', o.refunded_total, 'currency', o.currency,
              'discount_code', o.discount_snapshot ->> 'code', 'shipping_method', o.shipping_snapshot ->> 'name')
              || case when v_pii then jsonb_build_object(
                   'email', o.email, 'customer_name', o.customer_name, 'phone', o.phone,
                   'city', o.shipping_address ->> 'city', 'region', o.shipping_address ->> 'region',
                   'postal_code', o.shipping_address ->> 'postal_code', 'country', o.shipping_address ->> 'country')
                 else '{}'::jsonb end as r
              from public.orders o where o.store_id = p_store_id) q;
  else
    select coalesce(jsonb_agg(app.customer_admin_view(c, v_pii) - 'id' - 'masked' order by c.created_at desc), '[]'::jsonb)
      into v_rows
      from public.customers c where c.store_id = p_store_id and c.deleted_at is null;
  end if;

  perform audit.record('export.requested', 'store', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('entity', p_entity, 'rows', v_count,
                                                'pii', v_pii and p_entity in ('orders', 'customers')));
  return jsonb_build_object('entity', p_entity, 'pii', v_pii, 'rows', v_rows);
end
$$;

revoke all on function public.exports_rows(uuid, text) from public;
grant execute on function public.exports_rows(uuid, text) to authenticated;
