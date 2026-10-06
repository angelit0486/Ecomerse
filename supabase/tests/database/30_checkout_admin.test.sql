-- =============================================================================
-- Fase 6 · Panel de envíos, impuestos, descuentos y pedidos; rate limits (F6-T05).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function tests.gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'storefront_gateway', true);
  execute format('select to_jsonb(t.x) from (%s) t(x)', p_sql) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
grant execute on all functions in schema tests to storefront_gateway, authenticated;

-- ============================================================================ Envíos
select tests.login('owner');
select tests.set_fx('zone', public.shipping_upsert_zone(tests.fx('store_a'),
  '{"name":"Centro","countries":["mx"," MX "],"regions":["CDMX","Puebla",""]}'));
select is((select countries::text || regions::text from public.shipping_zones where id = tests.fx('zone')),
  '{MX}{CDMX,Puebla}', 'países normalizados y sin duplicados; regiones vacías fuera');
select throws_ok(format($$ select public.shipping_upsert_zone(%L, '{"name":"X","countries":["Mexico"]}') $$,
  tests.fx('store_a')), 'P0001', 'validation_failed', 'país ISO de dos letras');
select tests.set_fx('rate', public.shipping_upsert_rate(tests.fx('store_a'), jsonb_build_object(
  'zone_id', tests.fx('zone'), 'name', 'Gratis desde $500', 'type', 'free_over', 'price', 9900,
  'free_over_subtotal', 50000)));
select is((select type || ':' || free_over_subtotal from public.shipping_rates where id = tests.fx('rate')),
  'free_over:50000', 'tarifa con envío gratis desde');
select throws_ok(format($$ select public.shipping_upsert_rate(%L, %L) $$, tests.fx('store_a'),
  jsonb_build_object('zone_id', tests.fx('zone'), 'name', 'Mal', 'type', 'free_over', 'price', 100)),
  'P0001', 'validation_failed', 'free_over exige el monto mínimo');
select throws_ok(format($$ select public.shipping_upsert_rate(%L, %L) $$, tests.fx('store_a'),
  jsonb_build_object('zone_id', tests.fx('zone'), 'name', 'Negativo', 'type', 'flat', 'price', -1)),
  'P0001', 'validation_failed', 'precio negativo');
select tests.logout();
select tests.login('owner_b');
select throws_ok(format($$ select public.shipping_upsert_rate(%L, %L) $$, tests.fx('store_b'),
  jsonb_build_object('zone_id', tests.fx('zone'), 'name', 'Robada', 'type', 'flat', 'price', 1)),
  'P0001', 'not_found', 'una tarifa de B no cuelga de una zona de A');
select throws_ok(format($$ select public.shipping_delete_zone(%L, %L) $$, tests.fx('store_b'), tests.fx('zone')),
  'P0001', 'not_found', 'B no borra zonas de A');
select tests.logout();
select tests.login('viewer');
select throws_ok(format($$ select public.shipping_upsert_zone(%L, '{"name":"X","countries":["MX"]}') $$,
  tests.fx('store_a')), '42501', 'forbidden', 'viewer no gestiona envíos');
select tests.logout();

-- ============================================================================ Impuestos
select tests.login('owner');
select lives_ok(format($$ select public.taxes_update(%L, false, 1600, true) $$, tests.fx('store_a')),
  'IVA 16 % aparte y sobre el envío');
select is((select prices_include_tax::text || tax_rate_bps || tax_applies_to_shipping::text from public.stores
            where id = tests.fx('store_a')), 'false1600true', 'impuestos guardados');
select throws_ok(format($$ select public.taxes_update(%L, true, 10001, false) $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'tasa fuera de rango');

-- ============================================================================ Descuentos
select tests.set_fx('d1', public.discounts_upsert(tests.fx('store_a'),
  '{"code":" bienvenida10 ","type":"percentage","value":1000,"usage_limit":100}'));
select is((select code from public.discounts where id = tests.fx('d1')), 'BIENVENIDA10', 'código normalizado');
select throws_ok(format($$ select public.discounts_upsert(%L, '{"code":"bienvenida10","type":"fixed_amount","value":100}') $$,
  tests.fx('store_a')), 'P0001', 'validation_failed', 'código repetido');
select throws_ok(format($$ select public.discounts_upsert(%L, '{"code":"MAL","type":"percentage","value":20000}') $$,
  tests.fx('store_a')), 'P0001', 'validation_failed', 'porcentaje mayor que 100 %');
select tests.logout();
update public.discounts set times_used = 1 where id = tests.fx('d1');
select tests.login('owner');
select throws_ok(format($$ select public.discounts_upsert(%L, %L) $$, tests.fx('store_a'),
  jsonb_build_object('id', tests.fx('d1'), 'code', 'OTRO', 'type', 'percentage', 'value', 1000)),
  'P0001', 'validation_failed', 'el código usado no cambia');
select lives_ok(format($$ select public.discounts_set_status(%L, %L, 'disabled') $$, tests.fx('store_a'),
  tests.fx('d1')), 'desactivar un descuento');
select tests.logout();

-- ============================================================================ Pedidos (PII)
select tests.set_fx('o1', tests.order(tests.fx('store_a')));
select tests.login('viewer');
select throws_ok(format($$ select public.orders_get_contact(%L, %L) $$, tests.fx('store_a'), tests.fx('o1')),
  '42501', 'forbidden', 'viewer no ve el contacto del pedido');
select tests.logout();
select tests.login('owner');
select is(public.orders_get_contact(tests.fx('store_a'), tests.fx('o1')) ->> 'email', 'test@example.test',
  'el dueño ve el contacto por RPC');
select lives_ok(format($$ select public.orders_set_staff_note(%L, %L, 'Llamar') $$, tests.fx('store_a'),
  tests.fx('o1')), 'nota interna');
select tests.logout();
select tests.login('owner_b');
select throws_ok(format($$ select public.orders_get_contact(%L, %L) $$, tests.fx('store_b'), tests.fx('o1')),
  'P0001', 'not_found', 'B no lee pedidos de A');
select tests.logout();

-- ============================================================================ Rate limits
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');
select is((select count(*)::int from generate_series(1, 11) i
            where (tests.gw(format('select storefront.checkout_guard(%L, %L, ''a@b.io'')', tests.fx('store_a'),
                                    repeat('a', 64))))::boolean), 10,
  'checkout: 10 intentos por IP y tienda cada 10 minutos');
select ok(exists (select 1 from audit.security_events where type = 'checkout.rate_limited'),
  'el exceso deja un evento de seguridad');
select is((tests.gw(format('select storefront.checkout_guard(%L, %L, ''a@b.io'')', tests.fx('store_a'),
  repeat('b', 64))))::boolean, true, 'otra IP no comparte el límite');
insert into public.carts (store_id, token_hash) values (tests.fx('store_a'), sha256(convert_to(rpad('rl', 43, 'x'), 'UTF8')));
select is((select count(*)::int from generate_series(1, 10) i
            where tests.gw(format('select storefront.cart_set_details(%L, %L, ''{"discount_code":"PRUEBA%s"}'')',
                                  tests.fx('store_a'), rpad('rl', 43, 'x'), i)) is not null), 10,
  'diez códigos por carrito y hora');
select throws_ok(format('select tests.gw(%L)', format($i$select storefront.cart_set_details(%L, %L, '{"discount_code":"PRUEBA11"}')$i$,
  tests.fx('store_a'), rpad('rl', 43, 'x'))), 'P0001', 'rate_limited', 'el undécimo código se bloquea (A20)');

select * from finish();
rollback;
