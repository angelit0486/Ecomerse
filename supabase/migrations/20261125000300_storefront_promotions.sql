-- =============================================================================
-- Promociones en la tienda pública (ADR-070, fase 3).
--
-- * storefront.product_promotions: para las tarjetas y la ficha, las promociones
--   activas y vigentes de cada producto publicado (mismo alcance que el cobro:
--   app.cart_promotions; las categorías incluyen sus subcategorías). Un producto
--   cuyas presentaciones activas están TODAS en oferta no muestra promociones que
--   no aplican a piezas en oferta (el cobro tampoco las aplicaría). Solo describe:
--   el ahorro real lo decide app.calculate_cart al armar el carrito.
-- * app.order_promotion_summary / app.order_item_promotion_labels: lo que el
--   pedido guardó (order_promotions, copia de la regla), nunca la promoción de hoy.
-- * storefront.get_order_for_guest y system.order_notification: misma definición
--   que la anterior más el ahorro por promociones (incluido en discount_total).
--
-- Sin tablas, columnas ni datos nuevos. `create or replace` conserva los permisos.
-- Reversa: scripts/ops/reversa/20261125000300_storefront_promotions.reversa.sql.
-- =============================================================================

-- 1. Tarjetas y ficha: {product_id: [{id, label, type, rules}]} (máx. 100 productos).
create or replace function storefront.product_promotions(p_store_id uuid, p_product_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select p.id,
           exists (select 1 from public.product_variants v
                    where v.store_id = p.store_id and v.product_id = p.id
                      and v.status = 'active' and v.deleted_at is null
                      and not (v.compare_at_price is not null and v.compare_at_price > v.price)) as has_regular
      from public.products p
     where p.store_id = p_store_id
       and p.id = any (p_product_ids[1:100])
       and p.status = 'active' and p.deleted_at is null
       and app.store_publicly_readable(p_store_id)
  ), promos as (
    select e.promo, e.n
      from jsonb_array_elements(
             app.cart_promotions(p_store_id, (select coalesce(array_agg(id), '{}'::uuid[]) from visible)))
           with ordinality e(promo, n)
  )
  select coalesce(jsonb_object_agg(x.id, x.list), '{}'::jsonb)
    from (
      select vis.id,
             jsonb_agg(jsonb_build_object('id', pr.promo -> 'id', 'label', pr.promo -> 'label',
                                          'type', pr.promo -> 'type', 'rules', pr.promo -> 'rules')
                       order by (pr.promo ->> 'specificity')::integer desc, pr.n) as list
        from visible vis
        join promos pr
          on (jsonb_typeof(pr.promo -> 'product_ids') = 'null'
              or pr.promo -> 'product_ids' ? vis.id::text)
         and (vis.has_regular or (pr.promo ->> 'applies_to_sale_items')::boolean)
       group by vis.id) x
$$;
revoke all on function storefront.product_promotions(uuid, uuid[]) from public;
grant execute on function storefront.product_promotions(uuid, uuid[]) to storefront_gateway;

-- 2. Lo que el pedido guardó: por promoción [{label, type, units, amount}] en el
--    orden de las partidas, y las leyendas de una partida.
create or replace function app.order_promotion_summary(p_store_id uuid, p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', g.label, 'type', g.type, 'units', g.units,
                                               'amount', g.amount) order by g.pos, g.label), '[]'::jsonb)
    from (
      select op.snapshot ->> 'label' as label, op.snapshot ->> 'type' as type,
             sum(op.units)::integer as units, sum(op.amount)::bigint as amount, min(i.position) as pos
        from public.order_promotions op
        join public.order_items i on i.store_id = op.store_id and i.id = op.order_item_id
       where op.store_id = p_store_id and op.order_id = p_order_id
       group by coalesce(op.promotion_id::text, op.snapshot::text), op.snapshot ->> 'label', op.snapshot ->> 'type') g
$$;
revoke all on function app.order_promotion_summary(uuid, uuid) from public;

create or replace function app.order_item_promotion_labels(p_store_id uuid, p_order_item_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(op.snapshot ->> 'label' order by op.amount desc, op.id), '[]'::jsonb)
    from public.order_promotions op
   where op.store_id = p_store_id and op.order_item_id = p_order_item_id
$$;
revoke all on function app.order_item_promotion_labels(uuid, uuid) from public;

-- 3. Página del pedido (invitado y cuenta, vía account_get_order): MISMA definición
--    de 20261110000100_guest_link_expiry.sql más promotion_total, el detalle de
--    promociones y, por partida, promotion_allocation y sus leyendas.
create or replace function storefront.get_order_for_guest(p_store_id uuid, p_order_id uuid, p_token_hash bytea)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'display_number', o.display_number, 'status', o.status, 'payment_status', o.payment_status,
    'fulfillment_status', o.fulfillment_status, 'placed_at', o.placed_at, 'paid_at', o.paid_at,
    'cancelled_at', o.cancelled_at, 'cancel_reason', o.cancel_reason,
    'email', o.email, 'customer_name', o.customer_name, 'shipping_address', o.shipping_address,
    'currency', o.currency, 'prices_include_tax', o.prices_include_tax,
    'subtotal', o.subtotal, 'discount_total', o.discount_total, 'promotion_total', o.promotion_total, 'shipping_total', o.shipping_total,
    'tax_total', o.tax_total, 'total', o.total, 'shipping', o.shipping_snapshot,
    'discount', o.discount_snapshot - 'value',
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'product_title', i.product_title, 'variant_title', i.variant_title, 'quantity', i.quantity,
                'unit_price', i.unit_price, 'line_total', i.line_total, 'image_path', i.image_path,
                'promotion_allocation', i.promotion_allocation,
                'promotion_labels', app.order_item_promotion_labels(i.store_id, i.id))
                order by i.position), '[]'::jsonb)
                from public.order_items i where i.store_id = o.store_id and i.order_id = o.id),
    'promotions', app.order_promotion_summary(o.store_id, o.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('type', e.type, 'to_value', e.to_value,
                                                            'message', e.message, 'created_at', e.created_at)
                                         order by e.created_at), '[]'::jsonb)
                 from public.order_events e
                where e.store_id = o.store_id and e.order_id = o.id and e.customer_visible),
    'payment', (select jsonb_build_object('id', p.id, 'provider', p.provider, 'status', p.status,
                                          'expires_at', p.expires_at, 'display_name', a.display_name,
                                          'instructions', a.public_config ->> 'instructions')
                  from public.payments p
                  join public.payment_accounts a on a.store_id = p.store_id and a.id = p.payment_account_id
                 where p.store_id = o.store_id and p.order_id = o.id
                 order by p.created_at desc limit 1))
    from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id
     and app.guest_order_access(o.store_id, o.id, p_token_hash) = 'ok'
$$;

-- 4. Correos del pedido: MISMA definición de 20261117000400_order_email_pickup.sql
--    más promotion_total, el detalle de promociones y, por partida, el ahorro.
create or replace function system.order_notification(p_order_id uuid, p_shipment_id uuid default null,
                                                     p_refund_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'store', jsonb_build_object(
      'id', s.id, 'handle', s.handle, 'name', s.name, 'locale', s.locale, 'currency', s.currency, 'contact_email', s.contact_email,
      'organization_id', s.organization_id,
      'hostname', coalesce(
        (select d.hostname from public.store_domains d where d.store_id = s.id and d.is_primary and d.status = 'active'),
        (select d.hostname from public.store_domains d where d.store_id = s.id and d.type = 'platform_subdomain'
                                                         and d.status = 'active' order by d.created_at limit 1)),
      'logo_path', (select m.storage_path from public.store_themes t
                      join public.media m on m.store_id = t.store_id and m.id = t.logo_media_id
                     where t.store_id = s.id and m.status = 'ready' and m.deleted_at is null),
      'primary_color', (select t.settings -> 'colors' ->> 'primary' from public.store_themes t where t.store_id = s.id)),
    'order', jsonb_build_object(
      'id', o.id, 'display_number', o.display_number, 'email', o.email, 'customer_name', o.customer_name,
      'status', o.status, 'payment_status', o.payment_status, 'checkout_idempotency_key', o.checkout_idempotency_key,
      -- ADR-062: generación del enlace (0 = el del checkout; sube con cada «enlace nuevo»).
      'guest_link_generation', coalesce((select l.generation from public.order_guest_links l
                                          where l.store_id = o.store_id and l.order_id = o.id), 0),
      'subtotal', o.subtotal, 'discount_total', o.discount_total, 'shipping_total', o.shipping_total,
      -- ADR-070: ahorro por promociones (incluido en discount_total) y su detalle.
      'promotion_total', o.promotion_total,
      'promotions', app.order_promotion_summary(o.store_id, o.id),
      'tax_total', o.tax_total, 'total', o.total, 'prices_include_tax', o.prices_include_tax,
      'shipping_name', o.shipping_snapshot ->> 'name', 'cancel_reason', o.cancel_reason,
      -- Tiempo estimado de la tarifa elegida (copia del pedido, no la tarifa de hoy).
      'estimated_days', case when o.shipping_snapshot ? 'est_days_max' then jsonb_build_object(
        'min', (o.shipping_snapshot ->> 'est_days_min')::integer,
        'max', (o.shipping_snapshot ->> 'est_days_max')::integer) end,
      -- Misión vendible F1.5: la confirmación lleva la dirección completa (sin teléfono).
      'shipping_address', case when o.shipping_address is not null then jsonb_build_object(
        'recipient_name', o.shipping_address ->> 'recipient_name', 'line1', o.shipping_address ->> 'line1',
        'line2', o.shipping_address ->> 'line2', 'postal_code', o.shipping_address ->> 'postal_code',
        'city', o.shipping_address ->> 'city', 'region', o.shipping_address ->> 'region',
        'country', o.shipping_address ->> 'country') end,
      -- Retiro en tienda: tipo de la forma de envío copiada al pedido.
      'shipping_type', o.shipping_snapshot ->> 'type',
      -- Dónde y cuándo recoger: el contacto del tema publicado, recortado
      -- ([[:space:]] como String.prototype.trim de pickupInfo). Solo si el pedido es
      -- de retiro y hay dirección (sin dirección no se dice nada, aunque haya horario).
      'pickup', (select case when c.address is not null
                               then jsonb_build_object('address', c.address, 'hours', c.hours) end
                   from public.store_themes t
                  cross join lateral (
                    select nullif(regexp_replace(t.settings -> 'contact' ->> 'address',
                                                 '^[[:space:]]+|[[:space:]]+$', '', 'g'), '') as address,
                           nullif(regexp_replace(t.settings -> 'contact' ->> 'hours',
                                                 '^[[:space:]]+|[[:space:]]+$', '', 'g'), '') as hours) c
                  where t.store_id = s.id and o.shipping_snapshot ->> 'type' = 'pickup')),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('title', i.product_title, 'variant', i.variant_title,
                                                           'quantity', i.quantity, 'line_total', i.line_total,
                                                           'unit_price', i.unit_price, 'image_path', i.image_path,
                                                           'promotion_allocation', i.promotion_allocation,
                                                           'promotion_labels',
                                                             app.order_item_promotion_labels(i.store_id, i.id))
                                        order by i.position), '[]'::jsonb)
                from public.order_items i where i.store_id = o.store_id and i.order_id = o.id),
    'payment', (select jsonb_build_object('provider', p.provider, 'status', p.status, 'method', p.method,
                                          'display_name', a.display_name,
                                          'instructions', a.public_config ->> 'instructions')
                  from public.payments p
                  join public.payment_accounts a on a.store_id = p.store_id and a.id = p.payment_account_id
                 where p.store_id = o.store_id and p.order_id = o.id order by p.created_at desc limit 1),
    'shipment', (select jsonb_build_object('carrier', sh.carrier, 'tracking_number', sh.tracking_number,
                                           'tracking_url', sh.tracking_url,
                                           -- Lo que va en este paquete y si queda algo por enviar.
                                           'items', (select coalesce(jsonb_agg(jsonb_build_object(
                                                       'title', i.product_title, 'variant', i.variant_title,
                                                       'quantity', si.quantity) order by i.position), '[]'::jsonb)
                                                       from public.shipment_items si
                                                       join public.order_items i on i.store_id = si.store_id
                                                                                and i.id = si.order_item_id
                                                      where si.store_id = sh.store_id and si.shipment_id = sh.id),
                                           'partial', exists (select 1 from public.order_items i
                                                               where i.store_id = o.store_id and i.order_id = o.id
                                                                 and i.requires_shipping
                                                                 and i.fulfilled_quantity < i.quantity - i.cancelled_quantity))
                   from public.shipments sh where sh.store_id = o.store_id and sh.id = p_shipment_id),
    'refund', (select jsonb_build_object('amount', r.amount) from public.refunds r
                where r.store_id = o.store_id and r.id = p_refund_id and r.status = 'succeeded'),
    'staff', jsonb_build_object(
      'emails', coalesce(nullif((select n.staff_emails from public.store_notification_settings n where n.store_id = s.id),
                                '{}'::text[]),
                         case when s.contact_email is not null then array[s.contact_email] else '{}'::text[] end),
      'notify_new_order', coalesce((select n.notify_new_order from public.store_notification_settings n
                                     where n.store_id = s.id), true),
      'notify_paid', coalesce((select n.notify_paid from public.store_notification_settings n where n.store_id = s.id), true)))
    from public.orders o
    join public.stores s on s.id = o.store_id
   where o.id = p_order_id
$$;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261125000300'::text
$$;
