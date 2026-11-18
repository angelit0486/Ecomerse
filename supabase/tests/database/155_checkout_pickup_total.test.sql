-- =============================================================================
-- «Recoger en tienda» en el checkout: el total lo calcula la base y nunca cobra
-- el envío de otra tarifa. Si el navegador manda el total viejo (con $99 de
-- envío), place_order lo rechaza con price_changed y el total correcto.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
update public.stores set status = 'active', launched_at = now(), prices_include_tax = true, tax_rate_bps = 1600,
                         tax_applies_to_shipping = false
 where id = tests.fx('store_a');

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
create function tests.addr() returns jsonb language sql as $$ select
  '{"recipient_name":"Ana Ruiz","line1":"Calle 1 #2","city":"Puebla","region":"Puebla","postal_code":"72000","country":"MX"}'::jsonb $$;
create function tests.details(p_rate uuid) returns jsonb language sql as $$
  select tests.gw(format('select storefront.cart_set_details(%L, %L, %L)', tests.fx('store_a'), tests.tok('p1'),
    jsonb_build_object('email', 'ana@example.io', 'shipping_address', tests.addr(), 'shipping_rate_id', p_rate)))
$$;
create function tests.place(p_expected bigint, p_idem text) returns jsonb language sql as $$
  select tests.gw(format('select storefront.place_order(%L, %L, %L, %s, %L, %L)', tests.fx('store_a'), tests.tok('p1'),
    jsonb_build_object('email', 'ana@example.io', 'customer_name', 'Ana Ruiz', 'shipping_address', tests.addr(),
                       'shipping_rate_id', tests.fx('pickup'), 'payment_account_id', tests.fx('acct')),
    p_expected, p_idem, sha256(convert_to('guest-' || p_idem, 'UTF8'))))
$$;
grant execute on all functions in schema tests to storefront_gateway;

select tests.login('owner');
select tests.set_fx('p', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Proteína","variants":[{"price":49900,"sku":"PROT-1","weight_g":900}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('p'));
select public.inventory_adjust(tests.fx('store_a'),
  (select id from public.product_variants where sku = 'PROT-1'), 'adjustment', 5, 'Inicial');
select tests.logout();

insert into public.shipping_zones (store_id, name, countries) values (tests.fx('store_a'), 'México', '{MX}')
returning tests.set_fx('zone', id);
insert into public.shipping_rates (store_id, zone_id, name, type, price) values
  (tests.fx('store_a'), tests.fx('zone'), 'Estándar', 'flat', 9900) returning tests.set_fx('flat', id);
insert into public.shipping_rates (store_id, zone_id, name, type, price) values
  (tests.fx('store_a'), tests.fx('zone'), 'Recoger en tienda', 'pickup', 0) returning tests.set_fx('pickup', id);
insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
values (tests.fx('store_a'), 'manual', 'active', 'Transferencia', '{"instructions":"CLABE 0123"}')
returning tests.set_fx('acct', id);

select tests.gw(format('select storefront.cart_add_item(%L, %L, %L, 1)', tests.fx('store_a'), tests.tok('p1'),
  (select id from public.product_variants where sku = 'PROT-1')));

select is((tests.details(tests.fx('flat')) ->> 'total')::bigint, 59800::bigint,
          'con «Estándar» el total incluye $99 de envío');
select is((select (v ->> 'shipping_total')::bigint || '/' || (v ->> 'total')::bigint
             from (select tests.details(tests.fx('pickup')) as v) t),
          '0/49900', 'al guardar «Recoger en tienda» la base quita el envío del total al momento');

-- El navegador con el total viejo (botón «$598») no paga $598: se rechaza con el correcto.
select throws_ok($$ select tests.place(59800, 'idem-pickup-0000001') $$, 'P0001', 'price_changed',
                 'el total viejo con $99 se rechaza');
select is((select count(*)::int from public.orders where store_id = tests.fx('store_a')), 0,
          'y no se crea ningún pedido');

select tests.set_fx('o', (tests.place(49900, 'idem-pickup-0000002') ->> 'order_id')::uuid);
select is((select array[shipping_total, total] from public.orders where id = tests.fx('o')),
          array[0, 49900]::bigint[], 'el pedido de retiro se cobra sin envío');
select is((select shipping_snapshot ->> 'type' from public.orders where id = tests.fx('o')), 'pickup',
          'y guarda que es «Recoger en tienda»');

-- La base no admite una tarifa de retiro con precio.
select throws_ok($$ update public.shipping_rates set price = 9900 where id = tests.fx('pickup') $$, '23514', null,
                 'una tarifa de retiro no puede tener precio');

select * from finish();
rollback;
