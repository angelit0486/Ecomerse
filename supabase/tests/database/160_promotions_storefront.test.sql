-- =============================================================================
-- Promociones en la tienda pública (ADR-070, fase 3): qué promociones ve cada
-- tarjeta o ficha (solo publicadas, vigentes, sin piezas en oferta salvo que la
-- regla lo permita) con aislamiento entre dos tiendas; y la página y los correos
-- del pedido con su ahorro por promociones, leído de la copia del pedido.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

select tests.create_user('owner_a', 'owner-a@a.io');
select tests.create_user('owner_b', 'owner-b@b.io');
select tests.create_user('viewer_a', 'viewer-a@a.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'viewer_a', 'viewer');
update public.stores set status = 'active', launched_at = now(), prices_include_tax = true, tax_rate_bps = 1600,
                         tax_applies_to_shipping = false
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
create function tests.addr() returns jsonb language sql as $$ select
  '{"recipient_name":"Ana Ruiz","line1":"Calle 1 #2","city":"Puebla","region":"Puebla","postal_code":"72000","country":"MX"}'::jsonb $$;
create function tests.vid(p_sku text) returns uuid language sql as $$
  select id from public.product_variants where sku = p_sku $$;
create function tests.add(p_sku text, p_qty int) returns jsonb language sql as $$
  select tests.gw(format('select storefront.cart_add_item(%L, %L, %L, %s)', tests.fx('store_a'), tests.tok('c1'),
                         tests.vid(p_sku), p_qty)) $$;
create function tests.input(p_code text) returns jsonb language sql as $$
  select jsonb_build_object('email', 'ana@example.io', 'customer_name', 'Ana Ruiz', 'shipping_address', tests.addr(),
                            'shipping_rate_id', tests.fx('flat'), 'payment_account_id', tests.fx('acct'),
                            'discount_code', p_code) $$;
create function tests.details(p_code text) returns jsonb language sql as $$
  select tests.gw(format('select storefront.cart_set_details(%L, %L, %L)', tests.fx('store_a'), tests.tok('c1'),
    jsonb_build_object('email', 'ana@example.io', 'shipping_address', tests.addr(), 'shipping_rate_id', tests.fx('flat'),
                       'discount_code', p_code)))
$$;
create function tests.place(p_expected bigint, p_idem text, p_code text) returns jsonb language sql as $$
  select tests.gw(format('select storefront.place_order(%L, %L, %L, %s, %L, %L)', tests.fx('store_a'), tests.tok('c1'),
    tests.input(p_code), p_expected, p_idem, sha256(convert_to('guest-' || p_idem, 'UTF8'))))
$$;
create function tests.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;
create function tests.detail(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v = pg_exception_detail;
  return sqlerrm || '/' || coalesce(v, '');
end $$;
create function tests.audits(p_action text, p_id uuid) returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from audit.audit_logs where action = p_action and entity_id = p_id $$;
grant execute on all functions in schema tests to storefront_gateway, authenticated;

-- ---------------------------------------------------------------- catálogo
select tests.login('owner_a');
select tests.set_fx('p1', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Playera","options":[{"name":"Talla","values":["CH","G"]}],
    "variants":[{"options":{"Talla":"CH"},"price":10000,"sku":"P1-CH"},
                {"options":{"Talla":"G"},"price":12000,"sku":"P1-G"}]}') ->> 'id')::uuid);
select tests.set_fx('p2', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Gorra","variants":[{"price":5000,"sku":"P2"}]}') ->> 'id')::uuid);
select tests.set_fx('p3', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Calcetas en oferta","variants":[{"price":5000,"compare_at_price":8000,"sku":"P3"}]}') ->> 'id')::uuid);
select tests.set_fx('p4', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Borrador","variants":[{"price":5000,"sku":"P4"}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), p)
  from unnest(array[tests.fx('p1'), tests.fx('p2'), tests.fx('p3')]) p;
select public.inventory_adjust(tests.fx('store_a'), tests.vid(s), 'adjustment', 50, 'Inicial')
  from unnest(array['P1-CH', 'P1-G', 'P2', 'P3']) s;
select tests.logout();
select tests.login('owner_b');
select tests.set_fx('pb', (public.catalog_upsert_product(tests.fx('store_b'),
  '{"title":"Otra","variants":[{"price":100,"sku":"PB"}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_b'), tests.fx('pb'));
select tests.logout();

insert into public.shipping_zones (store_id, name, countries) values (tests.fx('store_a'), 'México', '{MX}')
returning tests.set_fx('zone', id);
insert into public.shipping_rates (store_id, zone_id, name, type, price) values
  (tests.fx('store_a'), tests.fx('zone'), 'Estándar', 'flat', 9900) returning tests.set_fx('flat', id);
insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
values (tests.fx('store_a'), 'manual', 'active', 'Transferencia', '{"instructions":"CLABE 0123"}')
returning tests.set_fx('acct', id);
insert into public.plan_entitlements (plan_id, key, value_int)
values ((select id from public.plans where key = 'test_plan'), 'max_active_promotions', 5);

-- ---------------------------------------------------------------- promociones
-- A: 3×2 en la playera (activa). S: la segunda al 50% en toda la tienda (activa).
-- P: 2×1 en la gorra (pausada). B: la de la otra tienda (activa, toda su tienda).
select tests.login('owner_a');
select tests.set_fx('A', public.promotions_upsert(tests.fx('store_a'), jsonb_build_object(
  'name', 'Playeras 3x2', 'label', '3×2 en playeras', 'type', 'buy_n_pay_m', 'rules', '{"buy":3,"pay":2}'::jsonb,
  'scope', 'products', 'product_ids', jsonb_build_array(tests.fx('p1')))));
select tests.set_fx('S', public.promotions_upsert(tests.fx('store_a'),
  '{"name":"Segunda","label":"2a al 50%","type":"nth_percent","rules":{"nth":2,"percent_bps":5000}}'));
select tests.set_fx('P', public.promotions_upsert(tests.fx('store_a'), jsonb_build_object(
  'name', 'Gorras', 'label', '2×1 gorras', 'type', 'buy_n_pay_m', 'rules', '{"buy":2,"pay":1}'::jsonb,
  'scope', 'products', 'product_ids', jsonb_build_array(tests.fx('p2')))));
select public.promotions_set_status(tests.fx('store_a'), tests.fx(k), 'active') from unnest(array['A', 'S']) k;
select tests.logout();
select tests.login('owner_b');
select tests.set_fx('B', public.promotions_upsert(tests.fx('store_b'),
  '{"name":"b","label":"Promo B","type":"buy_n_pay_m","rules":{"buy":3,"pay":2}}'));
select public.promotions_set_status(tests.fx('store_b'), tests.fx('B'), 'active');
select tests.logout();

create function tests.pp(p_store text, p_ids uuid[]) returns jsonb language sql as $$
  select tests.gw(format('select storefront.product_promotions(%L, %L)', tests.fx(p_store), p_ids)) $$;
grant execute on function tests.pp(text, uuid[]) to storefront_gateway, authenticated;

select is((select jsonb_agg(e ->> 'label') from jsonb_array_elements(
             tests.pp('store_a', array[tests.fx('p1')]) -> tests.fx('p1')::text) e),
          '["3×2 en playeras", "2a al 50%"]'::jsonb, 'la playera: su promoción y la de toda la tienda (la más específica primero)');
select is(tests.pp('store_a', array[tests.fx('p1')]) -> tests.fx('p1')::text -> 0 -> 'rules',
          '{"buy":3,"pay":2}'::jsonb, 'con su regla para describirla');
select is((select jsonb_agg(e ->> 'label') from jsonb_array_elements(
             tests.pp('store_a', array[tests.fx('p2')]) -> tests.fx('p2')::text) e),
          '["2a al 50%"]'::jsonb, 'la gorra: la pausada no se anuncia');
select is(tests.pp('store_a', array[tests.fx('p3')]) ? tests.fx('p3')::text, false,
          'un producto en oferta no anuncia promociones que no aplican a ofertas');
select is(tests.pp('store_a', array[tests.fx('p4')]) ? tests.fx('p4')::text, false, 'un borrador no se anuncia');
select is(tests.pp('store_a', array[tests.fx('pb')]), '{}'::jsonb,
          'un producto de otra tienda no recibe las promociones de esta');
select is(tests.pp('store_b', array[tests.fx('p1'), tests.fx('p2')]), '{}'::jsonb,
          'ni la otra tienda ve las promociones de esta');
select is((select jsonb_agg(e ->> 'label') from jsonb_array_elements(
             tests.pp('store_b', array[tests.fx('pb')]) -> tests.fx('pb')::text) e),
          '["Promo B"]'::jsonb, 'la otra tienda ve solo las suyas');

-- Una regla que sí aplica a ofertas aparece también en la pieza en oferta.
select tests.login('owner_a');
select public.promotions_set_status(tests.fx('store_a'), tests.fx('S'), 'paused');
select public.promotions_upsert(tests.fx('store_a'), jsonb_build_object('id', tests.fx('S'), 'name', 'Segunda',
  'label', '2a al 50%', 'type', 'nth_percent', 'rules', '{"nth":2,"percent_bps":5000}'::jsonb, 'scope', 'store',
  'applies_to_sale_items', true));
select public.promotions_set_status(tests.fx('store_a'), tests.fx('S'), 'active');
select tests.logout();
select is((select jsonb_agg(e ->> 'label') from jsonb_array_elements(
             tests.pp('store_a', array[tests.fx('p3')]) -> tests.fx('p3')::text) e),
          '["2a al 50%"]'::jsonb, 'si la regla incluye ofertas, sí se anuncia');

select is(has_function_privilege('storefront_gateway', 'storefront.product_promotions(uuid, uuid[])', 'execute'),
          true, 'la tienda pública puede leerlas');
select is(has_function_privilege('anon', 'storefront.product_promotions(uuid, uuid[])', 'execute'),
          false, 'pero no directo sin la puerta de la tienda');
select is(has_function_privilege('storefront_gateway', 'app.order_promotion_summary(uuid, uuid)', 'execute')
          or has_function_privilege('authenticated', 'app.order_promotion_summary(uuid, uuid)', 'execute'),
          false, 'el resumen del pedido no se llama directo');

-- ---------------------------------------------------------------- pedido
-- Playera CH ×2 + G ×1: 3×2 regala la de $100 (gana a la segunda al 50%).
select tests.add('P1-CH', 2);
select tests.add('P1-G', 1);
select tests.set_fx('o', (tests.place((tests.details(null) ->> 'total')::bigint, 'idem-promo-sf-0001', null)
                          ->> 'order_id')::uuid);
create function tests.guest_order() returns jsonb language sql as $$
  select tests.gw(format('select storefront.get_order_for_guest(%L, %L, %L)', tests.fx('store_a'), tests.fx('o'),
                         sha256(convert_to('guest-idem-promo-sf-0001', 'UTF8')))) $$;
grant execute on function tests.guest_order() to storefront_gateway;

select is((tests.guest_order() ->> 'promotion_total')::bigint, 10000::bigint, 'la página del pedido dice cuánto ahorró');
select is(tests.guest_order() -> 'promotions',
          '[{"label":"3×2 en playeras","type":"buy_n_pay_m","units":1,"amount":10000}]'::jsonb,
          'y con qué promoción (de la copia del pedido)');
select is((select jsonb_agg(jsonb_build_array(i -> 'promotion_allocation', i -> 'promotion_labels'))
             from jsonb_array_elements(tests.guest_order() -> 'items') i),
          '[[10000, ["3×2 en playeras"]], [0, []]]'::jsonb, 'y en qué partida');
select is((tests.guest_order() ->> 'discount_total')::bigint, 10000::bigint, 'el descuento total la incluye');

-- La copia manda: cambiar la leyenda hoy no cambia lo que dice el pedido.
select tests.login('owner_a');
select public.promotions_upsert(tests.fx('store_a'), jsonb_build_object('id', tests.fx('A'), 'name', 'Playeras 3x2',
  'label', 'Otra leyenda', 'type', 'buy_n_pay_m', 'rules', '{"buy":3,"pay":2}'::jsonb, 'scope', 'products',
  'product_ids', jsonb_build_array(tests.fx('p1'))));
select tests.logout();
select is(tests.guest_order() -> 'promotions' -> 0 ->> 'label', '3×2 en playeras', 'el pedido conserva la leyenda de su día');

select is((system.order_notification(tests.fx('o')) -> 'order' ->> 'promotion_total')::bigint, 10000::bigint,
          'el correo del pedido lleva el ahorro');
select is(system.order_notification(tests.fx('o')) -> 'order' -> 'promotions' -> 0 ->> 'label', '3×2 en playeras',
          'y la promoción');
select is((select jsonb_agg(i -> 'promotion_allocation') from jsonb_array_elements(
             system.order_notification(tests.fx('o')) -> 'items') i), '[10000, 0]'::jsonb, 'y el ahorro por partida');
select is(coalesce(tests.gw(format('select storefront.get_order_for_guest(%L, %L, %L)', tests.fx('store_b'), tests.fx('o'),
                          sha256(convert_to('guest-idem-promo-sf-0001', 'UTF8')))), 'null'::jsonb), 'null'::jsonb,
          'desde otra tienda el pedido no existe');

select is(public.app_schema_version(), '20261125000400', 'versión de la base');

select * from finish();
rollback;
