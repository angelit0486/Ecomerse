-- =============================================================================
-- Datos del correo de confirmación completo y supresión de correos que rebotan.
-- =============================================================================
begin;
select plan(13);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_tenant('a', 'owner_a');

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text;
  return v_msg;
end $$;

insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                           requires_shipping, shipping_address, shipping_snapshot, currency, prices_include_tax,
                           tax_rate_bps, tax_applies_to_shipping, subtotal, total)
values (tests.fx('store_a'), 7001, '#7001', 'idem-' || gen_random_uuid(), 'ana@cliente.test', 'Ana', true,
        '{"recipient_name":"Ana","line1":"Calle 1","city":"Mazatlán","country":"MX","phone":"6690000000"}',
        '{"name":"Estándar","est_days_min":2,"est_days_max":5}', 'MXN', true, 0, false, 135000, 135000)
returning tests.set_fx('o', id);
insert into public.products (store_id, title, slug, status) values (tests.fx('store_a'), 'Proteína', 'proteina', 'draft');
insert into public.product_variants (store_id, product_id, sku, price, option_signature)
select tests.fx('store_a'), id, 'PROT-1', 45000, '' from public.products where store_id = tests.fx('store_a');
insert into public.order_items (store_id, order_id, variant_id, product_id, product_title, variant_title, sku,
                                image_path, product_type, requires_shipping, unit_price, quantity, line_total, position)
select tests.fx('store_a'), tests.fx('o'), v.id, v.product_id, 'Proteína', 'Vainilla', 'PROT-1',
       'store/a/p.webp', 'physical', true, 45000, 3, 135000, 1
  from public.product_variants v where v.store_id = tests.fx('store_a');
insert into public.payment_accounts (store_id, provider, status, display_name)
values (tests.fx('store_a'), 'manual', 'active', 'Transferencia');
insert into public.payments (store_id, order_id, payment_account_id, provider, amount, currency, status, method,
                             idempotency_key)
select tests.fx('store_a'), tests.fx('o'), a.id, 'manual', 135000, 'MXN', 'pending', 'bank_transfer',
       'idem-' || gen_random_uuid()
  from public.payment_accounts a where a.store_id = tests.fx('store_a');

create temp table n as select system.order_notification(tests.fx('o')) as v;
select is((select v -> 'items' -> 0 ->> 'image_path' from n), 'store/a/p.webp', 'miniatura del producto');
select is((select v -> 'items' -> 0 ->> 'unit_price' from n), '45000', 'precio unitario');
select is((select v -> 'order' -> 'estimated_days' from n), '{"min":2,"max":5}'::jsonb, 'entrega estimada de la tarifa');
select is((select v -> 'payment' ->> 'method' from n), 'bank_transfer', 'método de pago (sin datos de tarjeta)');
select ok((select not (v -> 'order' -> 'shipping_address' ? 'phone') from n), 'la dirección del correo no lleva teléfono');

-- Envío parcial: 1 de 3 unidades.
insert into public.shipments (id, store_id, order_id, idempotency_key)
values (gen_random_uuid(), tests.fx('store_a'), tests.fx('o'), 'ship-' || gen_random_uuid())
returning tests.set_fx('sh', id);
insert into public.shipment_items (store_id, shipment_id, order_item_id, quantity)
select tests.fx('store_a'), tests.fx('sh'), i.id, 1 from public.order_items i where i.order_id = tests.fx('o');
update public.order_items set fulfilled_quantity = 1 where order_id = tests.fx('o');
select is((system.order_notification(tests.fx('o'), tests.fx('sh')) -> 'shipment' ->> 'partial')::boolean, true,
          'un envío con parte del pedido es parcial');
select is(system.order_notification(tests.fx('o'), tests.fx('sh')) -> 'shipment' -> 'items',
          '[{"title":"Proteína","variant":"Vainilla","quantity":1}]'::jsonb, 'con lo que va en el paquete');
update public.order_items set fulfilled_quantity = 3 where order_id = tests.fx('o');
select is((system.order_notification(tests.fx('o'), tests.fx('sh')) -> 'shipment' ->> 'partial')::boolean, false,
          'cuando ya salió todo, no es parcial');

-- Supresión de correos.
create function pg_temp.worker(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform tests.as_role('system_worker');
  execute p_sql into v;
  perform tests.logout();
  return v;
exception when others then
  perform tests.logout();
  raise;
end $$;
select is(pg_temp.worker($$ select system.email_suppressed('Ana@Cliente.test')::text $$), 'false', 'al inicio nadie está suprimido');
select pg_temp.worker($$ select system.email_suppress(' ana@cliente.test ', 'bounce', 'send_rejected')::text $$);
select is(pg_temp.worker($$ select system.email_suppressed('ANA@cliente.test')::text $$), 'true',
          'un rebote suprime el correo sin importar mayúsculas ni espacios');
select pg_temp.worker($$ select system.email_suppress('ana@cliente.test', 'complaint', 'provider_webhook', 'msg_1')::text $$);
select is((select reason from system.email_suppressions), 'complaint', 'una queja pesa más que un rebote');
select is((select count(*)::int from system.email_suppressions), 1, 'y no se duplica');

select tests.login('owner_a');
select is(pg_temp.err($$ select system.email_suppressed('ana@cliente.test') $$), 'permission denied for schema system',
          'una persona no consulta ni toca la lista');
select tests.logout();

select * from finish();
rollback;
