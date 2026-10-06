-- =============================================================================
-- Fase 7 · Notificaciones de pedidos (F7-T04). Contrato: GATE0 §27.2-27.3.
--
-- * Destinatarios de staff configurables por tienda (notifications.manage);
--   sin configuración, el email de contacto de la tienda.
-- * system.order_notification: datos de UN pedido para las plantillas (marca de
--   la tienda, totales, partidas, pago, envío, reembolso). Solo system_worker.
-- * El enlace del pedido se reconstruye en el servidor desde la clave de
--   idempotencia (la base solo tiene el hash del token, D-F6-05).
-- =============================================================================

create table public.store_notification_settings (
  store_id         uuid primary key references public.stores (id) on delete cascade,
  staff_emails     text[] not null default '{}'::text[]
                   check (cardinality(staff_emails) <= 5 and array_position(staff_emails, null) is null),
  notify_new_order boolean not null default true,
  notify_paid      boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger store_notification_settings_set_updated_at before update on public.store_notification_settings
  for each row execute function app.set_updated_at();
create trigger store_notification_settings_prevent_tenant_change before update on public.store_notification_settings
  for each row execute function app.prevent_tenant_change();

alter table public.store_notification_settings enable row level security;
alter table public.store_notification_settings force row level security;
revoke all on table public.store_notification_settings from public, anon, authenticated, service_role;
grant select on table public.store_notification_settings to authenticated;
create policy store_notification_settings_select on public.store_notification_settings for select to authenticated
  using (app.has_store_permission(store_id, 'notifications.manage'));

create or replace function public.notifications_update(p_store_id uuid, p_staff_emails text[], p_notify_new_order boolean,
                                                       p_notify_paid boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emails text[];
begin
  perform app.require_store_permission(p_store_id, 'notifications.manage');
  select coalesce(array_agg(distinct lower(btrim(e))) filter (where btrim(e) <> ''), '{}') into v_emails
    from unnest(coalesce(p_staff_emails, '{}')) e;
  if cardinality(v_emails) > 5
     or exists (select 1 from unnest(v_emails) e where char_length(e) > 254 or e !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'staff_emails';
  end if;
  insert into public.store_notification_settings (store_id, staff_emails, notify_new_order, notify_paid)
  values (p_store_id, v_emails, coalesce(p_notify_new_order, true), coalesce(p_notify_paid, true))
  on conflict (store_id) do update
     set staff_emails = excluded.staff_emails, notify_new_order = excluded.notify_new_order,
         notify_paid = excluded.notify_paid;
  perform audit.record('store.notifications_updated', 'store', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('staff_emails', cardinality(v_emails),
                                                'notify_new_order', p_notify_new_order, 'notify_paid', p_notify_paid));
end
$$;

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
      'shipping_name', o.shipping_snapshot ->> 'name', 'cancel_reason', o.cancel_reason),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('title', i.product_title, 'variant', i.variant_title,
                                                           'quantity', i.quantity, 'line_total', i.line_total)
                                        order by i.position), '[]'::jsonb)
                from public.order_items i where i.store_id = o.store_id and i.order_id = o.id),
    'payment', (select jsonb_build_object('provider', p.provider, 'status', p.status, 'display_name', a.display_name,
                                          'instructions', a.public_config ->> 'instructions')
                  from public.payments p
                  join public.payment_accounts a on a.store_id = p.store_id and a.id = p.payment_account_id
                 where p.store_id = o.store_id and p.order_id = o.id order by p.created_at desc limit 1),
    'shipment', (select jsonb_build_object('carrier', sh.carrier, 'tracking_number', sh.tracking_number,
                                           'tracking_url', sh.tracking_url)
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

revoke all on function public.notifications_update(uuid, text[], boolean, boolean) from public;
revoke all on function system.order_notification(uuid, uuid, uuid) from public;
grant execute on function public.notifications_update(uuid, text[], boolean, boolean) to authenticated;
grant execute on function system.order_notification(uuid, uuid, uuid) to system_worker;
