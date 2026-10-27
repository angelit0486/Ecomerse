-- =============================================================================
-- Fase 6 · Pagos manual/fake, reintento y expiración (F6-T04).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now(), prices_include_tax = true, tax_rate_bps = 0
 where id in (tests.fx('store_a'), tests.fx('store_b'));

create function tests.gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'storefront_gateway', true);
  execute format('select to_jsonb(t.x) from (%s) t(x)', p_sql) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function tests.tok(p text) returns text language sql as $$ select rpad(p, 43, 'x') $$;
create function tests.variant(p_sku text) returns uuid language sql as
  $$ select id from public.product_variants where sku = p_sku and deleted_at is null $$;
-- Carrito con 1 taza + pedido con la cuenta indicada; devuelve {order_id, payment}.
create function tests.order_with(p_cart text, p_account uuid, p_code text default null) returns jsonb
language plpgsql as $f$
begin
  perform tests.gw(format('select storefront.cart_add_item(%L, %L, %L, 1)', tests.fx('store_a'), p_cart,
                          tests.variant('TAZA-1')));
  return tests.gw(format('select storefront.place_order(%L, %L, %L, %s, %L, %L)', tests.fx('store_a'), p_cart,
    jsonb_build_object('email', 'ana@x.io', 'customer_name', 'Ana', 'payment_account_id', p_account,
                       'discount_code', p_code,
                       'shipping_address', '{"recipient_name":"Ana","line1":"C 1","city":"Puebla","region":"Puebla","postal_code":"72000","country":"MX"}'::jsonb,
                       'shipping_rate_id', tests.fx('rate')),
    case when p_code is null then 10000 else 9000 end, 'idem-' || p_cart, sha256(convert_to('g-' || p_cart, 'UTF8'))));
end $f$;
create function tests.level_reserved() returns int language sql as
  $$ select reserved from public.inventory_levels where variant_id = tests.variant('TAZA-1') $$;
grant execute on all functions in schema tests to storefront_gateway, authenticated;

select tests.login('owner');
select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Taza","variants":[{"price":10000,"sku":"TAZA-1"}]}') ->> 'id')::uuid);
select public.inventory_adjust(tests.fx('store_a'), tests.variant('TAZA-1'), 'adjustment', 10, 'Inicial');
select tests.logout();
insert into public.shipping_zones (store_id, name, countries) values (tests.fx('store_a'), 'MX', '{MX}')
returning tests.set_fx('zone', id);
insert into public.shipping_rates (store_id, zone_id, name, type, price) values
  (tests.fx('store_a'), tests.fx('zone'), 'Gratis', 'flat', 0) returning tests.set_fx('rate', id);
insert into public.payment_accounts (store_id, provider, status, display_name) values
  (tests.fx('store_a'), 'fake', 'active', 'Pago de prueba') returning tests.set_fx('fake', id);
insert into public.payment_accounts (store_id, provider, status, display_name) values
  (tests.fx('store_a'), 'manual', 'active', 'Transferencia') returning tests.set_fx('manual', id);
insert into public.discounts (store_id, code, type, value, usage_limit) values
  (tests.fx('store_a'), 'MIL', 'fixed_amount', 1000, 5);

-- ============================================================================ Fake
-- Punto de partida fijo: otras pruebas (integración, E2E) pueden haber dejado
-- el pago simulado activado en esta base; aquí se prueba el valor por omisión.
delete from public.platform_settings where key = 'payments.allow_fake';
select tests.set_fx('o1', (tests.order_with(tests.tok('f1'), tests.fx('fake'), 'MIL') ->> 'order_id')::uuid);
select tests.set_fx('p1', (select id from public.payments where order_id = tests.fx('o1')));
select throws_ok(format($$ select tests.gw(%L) $$, format('select storefront.fake_payment_result(%L, %L, ''succeeded'')',
  tests.fx('store_a'), tests.fx('p1'))), '42501', 'forbidden', 'fake desactivado por defecto (nunca en producción)');
insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
on conflict (key) do update set value = excluded.value;
select is(tests.gw(format('select storefront.payment_for_checkout(%L, %L) -> ''order'' ->> ''display_number''',
  tests.fx('store_a'), tests.fx('p1'))), to_jsonb('#1001'::text), 'datos para createCheckout');
select lives_ok(format($$ select tests.gw(%L) $$, format('select storefront.record_checkout_result(%L, %L, true, ''fake_cs_1'')',
  tests.fx('store_a'), tests.fx('p1'))), 'createCheckout correcto → pago pendiente');
select is((select status || '/' || provider_checkout_id from public.payments where id = tests.fx('p1')),
  'pending/fake_cs_1', 'pago pending con la referencia del proveedor');
select is((select payment_status from public.orders where id = tests.fx('o1')), 'pending', 'pedido: pago pendiente');
select is((tests.gw(format('select storefront.fake_payment_result(%L, %L, ''succeeded'')', tests.fx('store_a'),
  tests.fx('p1'))) ->> 'replayed')::boolean, false, 'pago simulado aprobado');
select is((select status || '/' || payment_status || '/' || paid_total from public.orders where id = tests.fx('o1')),
  'open/paid/9000', 'pedido abierto y pagado por el total');
select is((select status from public.inventory_reservations where order_id = tests.fx('o1')), 'committed',
  'reserva confirmada');
select is((select on_hand || '/' || reserved from public.inventory_levels where variant_id = tests.variant('TAZA-1')),
  '10/1', 'confirmado: la unidad sigue apartada hasta el envío (sale al surtir, F7)');
select is((select times_reserved || '/' || times_used from public.discounts where code = 'MIL'), '0/1',
  'cupón: de reservado a usado');
select is((select status from public.discount_redemptions where order_id = tests.fx('o1')), 'confirmed',
  'redención confirmada');
select is((select orders_count || '/' || total_spent from public.customers where store_id = tests.fx('store_a')
             and email = 'ana@x.io'), '1/9000', 'contadores del cliente');
select is((select sales_count from public.products where store_id = tests.fx('store_a')), 1, 'ventas del producto');
select ok(exists (select 1 from system.jobs where dedupe_key = 'order.paid:' || tests.fx('o1')), 'job order.paid');
select is((tests.gw(format('select storefront.fake_payment_result(%L, %L, ''succeeded'')', tests.fx('store_a'),
  tests.fx('p1'))) ->> 'replayed')::boolean, true, 'repetir la confirmación es idempotente');
select throws_ok(format($$ select tests.gw(%L) $$, format('select storefront.fake_payment_result(%L, %L, ''succeeded'')',
  tests.fx('store_b'), tests.fx('p1'))), 'P0001', 'not_found', 'un pago de A no se toca desde B');

-- ============================================================================ Fallo y reintento
select tests.set_fx('o2', (tests.order_with(tests.tok('f2'), tests.fx('fake')) ->> 'order_id')::uuid);
select tests.gw(format('select storefront.fake_payment_result(%L, %L, ''failed'')', tests.fx('store_a'),
  (select id from public.payments where order_id = tests.fx('o2'))));
select is((select status || '/' || payment_status from public.orders where id = tests.fx('o2')), 'pending_payment/failed',
  'pago rechazado: el pedido sigue pendiente con su reserva');
select is((tests.gw(format('select storefront.retry_payment(%L, %L, %L)', tests.fx('store_a'), tests.fx('o2'),
  sha256(convert_to('g-' || tests.tok('f2'), 'UTF8')))) ->> 'status'), 'created', 'reintento: nuevo intento de pago');
select is((tests.gw(format('select storefront.retry_payment(%L, %L, %L)', tests.fx('store_a'), tests.fx('o2'),
  sha256(convert_to('g-' || tests.tok('f2'), 'UTF8')))) ->> 'replayed')::boolean, true,
  'con un intento abierto se devuelve el mismo');
select throws_ok(format($$ select tests.gw(%L) $$, format('select storefront.retry_payment(%L, %L, %L)',
  tests.fx('store_a'), tests.fx('o2'), sha256('otro'::bytea))), 'P0001', 'not_found', 'sin el token no se reintenta');

-- ============================================================================ Manual (staff)
select tests.set_fx('o3', (tests.order_with(tests.tok('m1'), tests.fx('manual')) ->> 'order_id')::uuid);
select tests.login('viewer');
select throws_ok(format($$ select public.orders_mark_paid_manual(%L, %L) $$, tests.fx('store_a'), tests.fx('o3')),
  '42501', 'forbidden', 'viewer no confirma pagos');
select tests.logout();
select tests.login('owner_b');
select throws_ok(format($$ select public.orders_mark_paid_manual(%L, %L) $$, tests.fx('store_b'), tests.fx('o3')),
  'P0001', 'not_found', 'otra tienda no confirma pagos de A');
select tests.logout();
select tests.login('owner');
select lives_ok(format($$ select public.orders_mark_paid_manual(%L, %L, 'Transferencia recibida') $$,
  tests.fx('store_a'), tests.fx('o3')), 'el dueño confirma la transferencia');
select is((select status || '/' || payment_status from public.orders where id = tests.fx('o3')), 'open/paid',
  'pedido pagado manualmente');
select throws_ok(format($$ select public.orders_mark_paid_manual(%L, %L) $$, tests.fx('store_a'), tests.fx('o1')),
  'P0001', 'conflict', 'un pedido de pago fake no se confirma a mano');
select tests.logout();
select ok(exists (select 1 from audit.audit_logs where action = 'order.payment_confirmed_manually'
                   and entity_id = tests.fx('o3')), 'confirmación auditada');

-- ============================================================================ Expiración
select tests.set_fx('o4', (tests.order_with(tests.tok('e1'), tests.fx('manual'), 'MIL') ->> 'order_id')::uuid);
select is(tests.level_reserved(), 4, 'reservadas: 2 confirmadas (hasta el envío) + 2 pendientes');
update public.inventory_reservations set expires_at = now() - interval '1 minute' where order_id = tests.fx('o4');
select is(system.expire_orders(), 1, 'un pedido vencido');
select is((select status || '/' || cancel_reason || '/' || payment_status from public.orders where id = tests.fx('o4')),
  'cancelled/payment_expired/expired', 'cancelado por pago vencido');
select is(tests.level_reserved(), 3, 'la reserva del pedido vencido se liberó');
select is((select times_reserved from public.discounts where code = 'MIL'), 0, 'el cupón se liberó');
select tests.login('owner');
select throws_ok(format($$ select public.orders_mark_paid_manual(%L, %L) $$, tests.fx('store_a'), tests.fx('o4')),
  'P0001', 'conflict', 'un pedido vencido no se confirma (pago tardío: F7)');
select tests.logout();

select * from finish();
rollback;
