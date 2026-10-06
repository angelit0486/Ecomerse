-- =============================================================================
-- Fase 6 · Carrito público y place_order (F6-T03), como storefront_gateway.
-- Cada error de §17.6, rollback total, idempotencia y aislamiento.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now(), prices_include_tax = true, tax_rate_bps = 1600,
                         tax_applies_to_shipping = false
 where id in (tests.fx('store_a'), tests.fx('store_b'));

-- SQL como storefront_gateway (el rol de la tienda pública).
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
create function tests.counter() returns bigint language sql as
  $$ select coalesce((select value from public.store_counters where store_id = tests.fx('store_a')), 0) $$;
create function tests.addr() returns jsonb language sql as $$ select
  '{"recipient_name":"Ana Ruiz","line1":"Calle 1 #2","city":"Puebla","region":"Puebla","postal_code":"72000","country":"MX"}'::jsonb $$;
-- Orden con los datos estándar; p_extra se mezcla con la entrada.
create function tests.place(p_token text, p_expected bigint, p_idem text, p_extra jsonb default '{}') returns jsonb
language sql as $$
  select tests.gw(format('select storefront.place_order(%L, %L, %L, %s, %L, %L)', tests.fx('store_a'), p_token,
    jsonb_build_object('email', 'Ana@Example.io', 'customer_name', 'Ana Ruiz', 'shipping_address', tests.addr(),
                       'shipping_rate_id', tests.fx('rate'), 'payment_account_id', tests.fx('acct')) || p_extra,
    p_expected, p_idem, sha256(convert_to('guest-' || p_idem, 'UTF8'))))
$$;
grant execute on all functions in schema tests to storefront_gateway;

select tests.login('owner');
select tests.set_fx('p_taza', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Taza","variants":[{"price":11600,"sku":"TAZA-1","weight_g":400}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('p_taza'));
select public.inventory_adjust(tests.fx('store_a'), tests.variant('TAZA-1'), 'adjustment', 1, 'Inicial');
select tests.set_fx('p_plato', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Plato","variants":[{"price":20000,"sku":"PLATO-1","weight_g":900}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('p_plato'));
select public.inventory_adjust(tests.fx('store_a'), tests.variant('PLATO-1'), 'adjustment', 10, 'Inicial');
select tests.set_fx('p_draft', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Borrador","variants":[{"price":100,"sku":"DRAFT-1"}]}') ->> 'id')::uuid);
select tests.logout();
select tests.login('owner_b');
select public.catalog_publish_product(tests.fx('store_b'), (public.catalog_upsert_product(tests.fx('store_b'),
  '{"title":"De B","variants":[{"price":100,"sku":"B-1"}]}') ->> 'id')::uuid);
select tests.logout();

insert into public.shipping_zones (store_id, name, countries) values (tests.fx('store_a'), 'México', '{MX}')
returning tests.set_fx('zone', id);
insert into public.shipping_rates (store_id, zone_id, name, type, price) values
  (tests.fx('store_a'), tests.fx('zone'), 'Estándar', 'flat', 9900) returning tests.set_fx('rate', id);
insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
values (tests.fx('store_a'), 'manual', 'active', 'Transferencia', '{"instructions":"CLABE 0123"}')
returning tests.set_fx('acct', id);
insert into public.payment_accounts (store_id, provider, status, display_name)
values (tests.fx('store_b'), 'manual', 'active', 'Efectivo') returning tests.set_fx('acct_b', id);
insert into public.discounts (store_id, code, type, value, usage_limit) values
  (tests.fx('store_a'), 'ULTIMO', 'fixed_amount', 1000, 1);

-- ============================================================================ Carrito
select is(jsonb_array_length(tests.gw(format('select storefront.cart_add_item(%L, %L, %L, 1) -> ''lines''',
  tests.fx('store_a'), tests.tok('c1'), tests.variant('TAZA-1')))), 1, 'agregar crea el carrito del token');
select is((tests.gw(format('select storefront.cart_add_item(%L, %L, %L, 2)', tests.fx('store_a'), tests.tok('c1'),
  tests.variant('PLATO-1'))) ->> 'subtotal')::bigint, 51600::bigint, 'subtotal con precios de la base');
select is((select encode(token_hash, 'hex') from public.carts where store_id = tests.fx('store_a') limit 1),
  encode(sha256(convert_to(tests.tok('c1'), 'UTF8')), 'hex'), 'solo se guarda el hash del token');
select throws_ok(format('select tests.gw(%L)', format($i$select storefront.cart_add_item(%L, %L, %L, 1)$i$,
  tests.fx('store_a'), tests.tok('c1'), tests.variant('B-1'))), 'P0001', 'not_found',
  'una variante de otra tienda no entra');
select throws_ok(format('select tests.gw(%L)', format($i$select storefront.cart_add_item(%L, %L, %L, 1)$i$,
  tests.fx('store_a'), tests.tok('c1'), tests.variant('DRAFT-1'))), 'P0001', 'not_found',
  'un borrador no se vende');
select throws_ok(format('select tests.gw(%L)', format($i$select storefront.cart_add_item(%L, %L, %L, 0)$i$,
  tests.fx('store_a'), tests.tok('c1'), tests.variant('TAZA-1'))), 'P0001', 'validation_failed', 'cantidad 0');
select throws_ok(format('select tests.gw(%L)', format($i$select storefront.cart_add_item(%L, 'corto', %L, 1)$i$,
  tests.fx('store_a'), tests.variant('TAZA-1'))), 'P0001', 'validation_failed', 'token con formato inválido');
select throws_ok(format('select tests.gw(%L)', format($i$select storefront.cart_set_details(%L, %L, '{"email":"no-es"}')$i$,
  tests.fx('store_a'), tests.tok('c1'))), 'P0001', 'validation_failed', 'email inválido');
select is(tests.gw(format('select storefront.cart_set_details(%L, %L, %L) -> ''shipping'' ->> ''status''',
  tests.fx('store_a'), tests.tok('c1'), jsonb_build_object('shipping_address', tests.addr(),
  'shipping_rate_id', tests.fx('rate')))), to_jsonb('ok'::text), 'dirección y tarifa: envío resuelto');
select is((tests.gw(format('select storefront.cart_set_quantity(%L, %L, %L, 1)', tests.fx('store_a'), tests.tok('c1'),
  tests.variant('PLATO-1'))) ->> 'total')::bigint, 41500::bigint, 'total = 11600 + 20000 + 9900');
select is(tests.gw(format('select storefront.cart_get(%L, %L)', tests.fx('store_b'), tests.tok('c1'))), null,
  'el carrito de A no existe para B');
select is(jsonb_array_length(tests.gw(format('select storefront.payment_methods(%L)', tests.fx('store_a')))), 1,
  'métodos de pago activos (sin secretos)');

-- ============================================================================ Errores sin efectos
select throws_ok(format($$ select tests.place(%L, 1, 'idem-a-000000000001') $$, tests.tok('c1')), 'P0001',
  'price_changed', 'price_changed: el total esperado no coincide');
select is(tests.counter(), 0::bigint, 'price_changed no consume número de pedido');
select throws_ok(format($$ select tests.place(%L, 41500, 'idem-a-000000000001', %L) $$,
  tests.tok('c1'), jsonb_build_object('payment_account_id', tests.fx('acct_b'))), 'P0001', 'validation_failed',
  'una cuenta de pago de otra tienda se rechaza');
select throws_ok(format($$ select tests.place(%L, 40500, 'idem-a-000000000001', '{"discount_code":"NOEXISTE"}') $$,
  tests.tok('c1')), 'P0001', 'discount_invalid', 'discount_invalid: código inexistente');
select throws_ok(format($$ select tests.place(%L, 41500, 'idem-a-000000000001', '{"email":"x"}') $$,
  tests.tok('c1')), 'P0001', 'validation_failed', 'email inválido en el checkout');

-- ============================================================================ Pedido
select tests.set_fx('o1', (tests.place(tests.tok('c1'), 40500, 'idem-a-000000000001',
  '{"discount_code":"ultimo","unit_price":1,"total":1}') ->> 'order_id')::uuid);
select isnt(tests.fx('o1'), null, 'pedido creado (el precio del cliente se ignora)');
select is((select array[subtotal, discount_total, shipping_total, tax_total, total] from public.orders
            where id = tests.fx('o1')), array[31600, 1000, 9900, 4220, 40500]::bigint[],
  'totales del snapshot calculados por la base (IVA incluido por línea: 1549 + 2671)');
select is((select status || '/' || payment_status || '/' || email from public.orders where id = tests.fx('o1')),
  'pending_payment/unpaid/ana@example.io', 'pending_payment, sin pagar, email normalizado');
select is((select count(*)::int from public.order_items where order_id = tests.fx('o1')), 2, 'dos partidas');
select is((select sum(discount_allocation)::bigint from public.order_items where order_id = tests.fx('o1')),
  1000::bigint, 'el descuento repartido suma exacto');
select is((select display_number from public.orders where id = tests.fx('o1')), '#1001', 'número desde 1001');
select is((select status from public.inventory_reservations where order_id = tests.fx('o1')), 'active',
  'reserva activa');
select is((select reserved from public.inventory_levels where variant_id = tests.variant('TAZA-1')), 1,
  'la última taza quedó reservada');
select is((select status || ':' || amount from public.payments where order_id = tests.fx('o1')),
  'created:40500', 'intento de pago creado por el total');
select is((select times_reserved from public.discounts where code = 'ULTIMO'), 1, 'cupón reservado');
select is((select status from public.carts where token_hash = sha256(convert_to(tests.tok('c1'), 'UTF8'))),
  'converted', 'carrito convertido');
select ok(exists (select 1 from system.jobs where dedupe_key = 'order.created:' || tests.fx('o1')),
  'job order.created encolado');

-- ============================================================================ Idempotencia
select is((tests.place(tests.tok('c1'), 40500, 'idem-a-000000000001') ->> 'order_id')::uuid, tests.fx('o1'),
  'doble clic: devuelve el mismo pedido');
select tests.gw(format('select storefront.cart_add_item(%L, %L, %L, 1)', tests.fx('store_a'), tests.tok('c2'),
  tests.variant('PLATO-1')));
select throws_ok(format($$ select tests.place(%L, 1, 'idem-a-000000000001') $$, tests.tok('c2')), 'P0001', 'conflict',
  'la clave de otro carrito no revela su pedido');

-- ============================================================================ Rollback total
select tests.gw(format('select storefront.cart_add_item(%L, %L, %L, 1)', tests.fx('store_a'), tests.tok('c2'),
  tests.variant('TAZA-1')));
insert into public.discounts (store_id, code, type, value) values (tests.fx('store_a'), 'LIBRE', 'fixed_amount', 500);
select throws_ok(format($$ select tests.place(%L, 41000, 'idem-a-000000000002', '{"discount_code":"LIBRE"}') $$,
  tests.tok('c2')), 'P0001', 'insufficient_stock', 'insufficient_stock: la taza ya está reservada');
select is(tests.counter(), 1001::bigint, 'rollback total: el contador no avanzó');
select is((select times_reserved from public.discounts where code = 'LIBRE'), 0, 'rollback total: el cupón no se consumió');
select is((select count(*)::int from public.orders where store_id = tests.fx('store_a')), 1,
  'rollback total: no quedó pedido');
select throws_ok(format($$ select tests.place(%L, 40400, 'idem-a-000000000003', '{"discount_code":"ULTIMO"}') $$,
  tests.tok('c2')), 'P0001', 'discount_invalid', 'discount_invalid: el último uso ya está reservado');

-- cart_invalid: un producto deja de venderse después de agregarlo.
update public.products set status = 'archived' where id = tests.fx('p_taza');
select throws_ok(format($$ select tests.place(%L, 1, 'idem-a-000000000004') $$, tests.tok('c2')), 'P0001',
  'cart_invalid', 'cart_invalid: una línea ya no está disponible');
update public.products set status = 'active' where id = tests.fx('p_taza');

-- Tienda pausada u organización suspendida: no se aceptan pedidos.
update public.stores set status = 'paused' where id = tests.fx('store_a');
select throws_ok(format($$ select tests.place(%L, 1, 'idem-a-000000000005') $$, tests.tok('c2')), 'P0001',
  'not_found', 'tienda pausada: sin pedidos');
update public.stores set status = 'active' where id = tests.fx('store_a');

-- ============================================================================ Pedido del invitado
select is(tests.gw(format('select storefront.get_order_for_guest(%L, %L, %L) ->> ''display_number''',
  tests.fx('store_a'), tests.fx('o1'), sha256(convert_to('guest-idem-a-000000000001', 'UTF8')))),
  to_jsonb('#1001'::text), 'el invitado ve su pedido con su token');
select is(tests.gw(format('select storefront.get_order_for_guest(%L, %L, %L)', tests.fx('store_a'), tests.fx('o1'),
  sha256('otro'::bytea))), null, 'otro token: nada');
select is(tests.gw(format('select storefront.get_order_for_guest(%L, %L, %L)', tests.fx('store_b'), tests.fx('o1'),
  sha256(convert_to('guest-idem-a-000000000001', 'UTF8')))), null, 'otra tienda: nada');

-- Solo storefront_gateway ejecuta place_order.
select is(tests.sqlstate_as('authenticated', format('select storefront.place_order(%L, %L, ''{}'', 1, ''x'', null)',
  tests.fx('store_a'), tests.tok('c2'))), '42501', 'authenticated no ejecuta place_order');

select * from finish();
rollback;
