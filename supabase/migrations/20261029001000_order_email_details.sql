-- Correo de confirmación completo (misión «comprar y pagar sin errores», 2026-10-29):
-- miniatura y precio unitario de cada producto, método de pago (sin datos de la
-- tarjeta), tiempo estimado de entrega y, en los envíos, qué va en el paquete y si
-- es parcial. Más la lista de correos que rebotaron o se quejaron: a esos ya no se
-- les escribe (protege la reputación del dominio remitente).

-- -----------------------------------------------------------------------------
-- 1. Datos del aviso (misma función, con campos nuevos).
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 2. Correos suprimidos (rebote permanente o queja de spam). Solo el hash.
-- -----------------------------------------------------------------------------
create table system.email_suppressions (
  email_hash  bytea primary key check (octet_length(email_hash) = 32),
  reason      text not null check (reason in ('bounce', 'complaint')),
  source      text not null check (source in ('provider_webhook', 'send_rejected')),
  event_id    text check (event_id is null or char_length(event_id) between 3 and 255),
  created_at  timestamptz not null default now()
);
alter table system.email_suppressions enable row level security;
alter table system.email_suppressions force row level security;
revoke all on table system.email_suppressions from public, anon, authenticated, service_role, storefront_gateway, system_worker;

create function system.email_suppress(p_email text, p_reason text, p_source text, p_event_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_email is null or char_length(btrim(p_email)) > 254 or btrim(p_email) !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'email';
  end if;
  insert into system.email_suppressions (email_hash, reason, source, event_id)
  values (sha256(convert_to(lower(btrim(p_email)), 'UTF8')), p_reason, p_source, p_event_id)
  on conflict (email_hash) do update
     set reason = case when excluded.reason = 'complaint' then 'complaint' else system.email_suppressions.reason end;
end
$$;
revoke all on function system.email_suppress(text, text, text, text) from public;
grant execute on function system.email_suppress(text, text, text, text) to system_worker;

create function system.email_suppressed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from system.email_suppressions s
                  where s.email_hash = sha256(convert_to(lower(btrim(coalesce(p_email, ''))), 'UTF8')))
$$;
revoke all on function system.email_suppressed(text) from public;
grant execute on function system.email_suppressed(text) to system_worker;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029001000'::text
$$;
