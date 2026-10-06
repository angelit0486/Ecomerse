-- =============================================================================
-- Fase 6 · app.calculate_cart sobre datos reales (F6-T02). La aritmética pura
-- la cubren los casos dorados (tests/integration/golden-cart.test.ts).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set prices_include_tax = true, tax_rate_bps = 1600, tax_applies_to_shipping = false
 where id = tests.fx('store_a');

create function tests.variant(p_sku text) returns uuid language sql as
  $$ select id from public.product_variants where sku = p_sku and deleted_at is null $$;
create function tests.calc(p_rate uuid default null, p_code text default null) returns jsonb language sql as
  $$ select app.calculate_cart(tests.fx('store_a'), tests.fx('cart'), p_rate, p_code) $$;

select tests.login('owner');
select tests.set_fx('p_taza', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Taza","variants":[{"price":11600,"sku":"TAZA-1","weight_g":400}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('p_taza'));
select public.inventory_adjust(tests.fx('store_a'), tests.variant('TAZA-1'), 'adjustment', 3, 'Inicial');
select tests.set_fx('p_plato', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Plato","variants":[{"price":20000,"sku":"PLATO-1","weight_g":900,"inventory_policy":"continue"}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('p_plato'));
select tests.set_fx('p_borrador', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Borrador","variants":[{"price":100,"sku":"DRAFT-1"}]}') ->> 'id')::uuid);
select tests.logout();

insert into public.carts (store_id, token_hash, email) values (tests.fx('store_a'), sha256('c1'::bytea), 'ana@x.io')
returning tests.set_fx('cart', id);
insert into public.cart_items (store_id, cart_id, variant_id, quantity) values
  (tests.fx('store_a'), tests.fx('cart'), tests.variant('TAZA-1'), 2),
  (tests.fx('store_a'), tests.fx('cart'), tests.variant('PLATO-1'), 1),
  (tests.fx('store_a'), tests.fx('cart'), tests.variant('DRAFT-1'), 5);

-- ============================================================================ Líneas
select is((tests.calc() ->> 'subtotal')::bigint, 43200::bigint, 'subtotal con precios vigentes (2 × 116 + 200)');
select is((select l ->> 'state' from jsonb_array_elements(tests.calc() -> 'lines') l
            where l ->> 'sku' = 'DRAFT-1'), 'unavailable', 'un producto en borrador se marca no disponible');
select ok((tests.calc() ->> 'has_unavailable')::boolean, 'el carrito avisa de líneas no disponibles');
select is((tests.calc() ->> 'item_count')::int, 3, 'las no disponibles no cuentan');
select is((tests.calc() ->> 'tax_total')::bigint, 5959::bigint,
  'IVA incluido por línea: 3200 (23200) + 2759 (20000 → 2758.62)');
update public.product_variants set price = 12000 where id = tests.variant('TAZA-1');
select is((tests.calc() ->> 'subtotal')::bigint, 44000::bigint, 'un cambio de precio se refleja al instante');
update public.cart_items set quantity = 5 where variant_id = tests.variant('TAZA-1');
select is((select l ->> 'state' from jsonb_array_elements(tests.calc() -> 'lines') l where l ->> 'sku' = 'TAZA-1'),
  'insufficient_stock', 'pedir 5 con 3 disponibles (deny): insuficiente');
select is((select l ->> 'state' from jsonb_array_elements(tests.calc() -> 'lines') l where l ->> 'sku' = 'PLATO-1'),
  'ok', 'continue: se vende sin existencias');
update public.cart_items set quantity = 2 where variant_id = tests.variant('TAZA-1');
update public.product_variants set price = 11600 where id = tests.variant('TAZA-1');

-- ============================================================================ Envío
select is(tests.calc() -> 'shipping' ->> 'status', 'address_required', 'sin dirección: se pide');
insert into public.shipping_zones (store_id, name, countries, regions) values
  (tests.fx('store_a'), 'Centro', '{MX}', '{CDMX,Puebla}') returning tests.set_fx('z_centro', id);
insert into public.shipping_zones (store_id, name, countries) values
  (tests.fx('store_a'), 'Nacional', '{MX}') returning tests.set_fx('z_nac', id);
insert into public.shipping_rates (store_id, zone_id, name, type, price, free_over_subtotal, max_weight_g) values
  (tests.fx('store_a'), tests.fx('z_centro'), 'Local', 'free_over', 9900, 30000, null),
  (tests.fx('store_a'), tests.fx('z_nac'), 'Nacional ligero', 'flat', 15000, null, 1000),
  (tests.fx('store_a'), tests.fx('z_nac'), 'Nacional', 'flat', 25000, null, null);
update public.carts set shipping_address = '{"recipient_name":"Ana","line1":"Calle 1","city":"CDMX","region":"cdmx",
  "postal_code":"01000","country":"MX"}' where id = tests.fx('cart');
select is((select array_agg(o ->> 'name' order by o ->> 'name') from jsonb_array_elements(tests.calc() -> 'shipping_options') o),
  array['Local', 'Nacional'], 'opciones por zona y región (sin distinguir mayúsculas) y peso: el ligero no cubre 1.7 kg');
select is(tests.calc() -> 'shipping' ->> 'status', 'rate_required', 'falta elegir tarifa');
select is((tests.calc((select id from public.shipping_rates where name = 'Local')) ->> 'shipping_total')::bigint,
  0::bigint, 'gratis desde $300: el subtotal lo alcanza');
select is(tests.calc((select id from public.shipping_rates where name = 'Nacional ligero')) -> 'shipping' ->> 'status',
  'unavailable', 'una tarifa que no aplica a la dirección o al peso no se acepta');
select is(app.calculate_cart(tests.fx('store_a'), tests.fx('cart'),
  (select id from public.shipping_rates where name = 'Nacional')) ->> 'total',
  (43200 + 25000)::text, 'total = mercancía + envío (IVA incluido)');

-- ============================================================================ Descuentos
insert into public.discounts (store_id, code, type, value, min_subtotal) values
  (tests.fx('store_a'), 'DIEZ', 'percentage', 1000, 0),
  (tests.fx('store_a'), 'MINIMO', 'fixed_amount', 5000, 100000),
  (tests.fx('store_a'), 'PASADO', 'fixed_amount', 100, 0);
update public.discounts set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where code = 'PASADO';
insert into public.discounts (store_id, code, type, value, usage_limit, times_used) values
  (tests.fx('store_a'), 'AGOTADO', 'fixed_amount', 100, 1, 1);
insert into public.discounts (store_id, code, type, value, usage_limit_per_customer) values
  (tests.fx('store_a'), 'UNAVEZ', 'fixed_amount', 100, 1);
select is((tests.calc(null, ' diez ') -> 'discount' ->> 'amount')::bigint, 4320::bigint,
  'código sin distinguir mayúsculas ni espacios: 10 % de 43200');
select is(tests.calc(null, 'NOEXISTE') -> 'discount' ->> 'status', 'not_found', 'código inexistente');
select is(tests.calc(null, 'MINIMO') -> 'discount' ->> 'status', 'min_subtotal', 'compra mínima no alcanzada');
select is((tests.calc(null, 'MINIMO') ->> 'discount_total')::bigint, 0::bigint, 'un código no válido no descuenta');
select is(tests.calc(null, 'PASADO') -> 'discount' ->> 'status', 'expired', 'vigencia terminada');
select is(tests.calc(null, 'AGOTADO') -> 'discount' ->> 'status', 'exhausted', 'usos agotados');
-- Límite por cliente: cuenta las redenciones vivas de pedidos con el mismo email.
insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                           requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                           subtotal, total)
values (tests.fx('store_a'), 9001, '#9001', 'idem-otra-0000000001', 'otra@x.io', 'Otra', false, 'MXN', true, 0, false, 0, 0),
       (tests.fx('store_a'), 9002, '#9002', 'idem-ana-00000000001', 'ana@x.io', 'Ana', false, 'MXN', true, 0, false, 0, 0);
insert into public.discount_redemptions (store_id, discount_id, order_id, amount)
select tests.fx('store_a'), (select id from public.discounts where code = 'UNAVEZ'), id, 100
  from public.orders where number = 9001 and store_id = tests.fx('store_a');
select is(tests.calc(null, 'UNAVEZ') -> 'discount' ->> 'status', 'ok',
  'límite por cliente: la redención de otro email no cuenta');
insert into public.discount_redemptions (store_id, discount_id, order_id, amount)
select tests.fx('store_a'), (select id from public.discounts where code = 'UNAVEZ'), id, 100
  from public.orders where number = 9002 and store_id = tests.fx('store_a');
select is(tests.calc(null, 'UNAVEZ') -> 'discount' ->> 'status', 'customer_limit',
  'límite por cliente: el mismo email ya lo usó');

-- ============================================================================ Aislamiento
insert into public.carts (store_id, token_hash) values (tests.fx('store_b'), sha256('cb'::bytea))
returning tests.set_fx('cart_b', id);
select throws_ok($$ select app.calculate_cart(tests.fx('store_a'), tests.fx('cart_b')) $$, 'P0001', 'not_found',
  'un carrito de B no se calcula como de A');
select throws_ok($$ insert into public.cart_items (store_id, cart_id, variant_id, quantity)
                    values (tests.fx('store_b'), tests.fx('cart_b'), tests.variant('TAZA-1'), 1) $$, '23503', null,
  'una variante de A no entra en un carrito de B (FK compuesta)');

select * from finish();
rollback;
