-- =============================================================================
-- Reversa de 20261117000400_order_email_pickup.sql (retiro en tienda en los
-- correos del pedido). 2026-11-17.
--
-- SIN PÉRDIDA: la migración no agregó tablas, columnas ni datos; solo reemplazó
-- system.order_notification (dos campos más en 'order': shipping_type y pickup)
-- y subió la versión. Esto restaura la definición EXACTA de
-- 20261110000100_guest_link_expiry.sql y deja public.app_schema_version() EXACTA
-- a la de 20261113000400. `create or replace` conserva los permisos (solo
-- system_worker). El esquema queda idéntico (pg_dump -s, con permisos) al de una
-- base con las migraciones hasta 20261113000400; lo prueba
-- scripts/ops/reversa/comprobar-0400.sh (paso 0).
--
-- El código de esta rama espera su versión (EXPECTED_SCHEMA_VERSION
-- 20261117000400, D-POR-06): con la base en 0400 el panel mostraría
-- «mantenimiento». Los correos no fallan sin los campos nuevos (son opcionales:
-- sin ellos salen como antes). Orden:
--   1. desplegar el código que espera 20261113000400 (sin este cambio);
--   2. correr esto.
--
-- ORDEN DE REVERSA: de la migración más nueva a la más vieja, cada una con su
-- candado de versión. La reversa de 0400 se rechaza mientras la base esté en
-- esta versión.
--
-- Uso (SOLO con autorización y en la ventana): psql -X -1 -v ON_ERROR_STOP=1 -f <este archivo>
-- =============================================================================

-- Candado: solo sobre una base exactamente en 20261117000400.
do $$
begin
  if coalesce(public.app_schema_version(), '') <> '20261117000400' then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = format('La base está en %s; esta reversa solo aplica a 20261117000400.',
                      coalesce(public.app_schema_version(), 'desconocida'));
  end if;
end
$$;

-- 1. system.order_notification: idéntica a la de 20261110000100_guest_link_expiry.sql.
-- El correo del pedido lleva el enlace de la generación vigente.
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
        'country', o.shipping_address ->> 'country') end),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('title', i.product_title, 'variant', i.variant_title,
                                                           'quantity', i.quantity, 'line_total', i.line_total,
                                                           'unit_price', i.unit_price, 'image_path', i.image_path)
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

-- 2. Versión del esquema (D-POR-06): idéntica a la de 20261113000400_import_batches.sql.
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261117000300'::text
$$;
