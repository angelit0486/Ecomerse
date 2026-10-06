-- =============================================================================
-- Gate F4 · regresiones de la revisión (20261011000400).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
create function tests.variant(p_sku text) returns uuid
language sql security definer set search_path = '' as
  $$ select id from public.product_variants where sku = p_sku and deleted_at is null $$;
create function tests.level(p_sku text) returns public.inventory_levels
language sql security definer set search_path = '' as
  $$ select l.* from public.inventory_levels l where l.variant_id = tests.variant(p_sku) $$;
grant execute on all functions in schema tests to authenticated;

select tests.login('owner');
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Gorra","variants":[{"price":100,"sku":"G-1"}]}');
select public.inventory_adjust(tests.fx('store_a'), tests.variant('G-1'), 'adjustment', 9, 'Conteo');
-- Tienda sin pedidos para la purga controlada (§2): desde la F6 una tienda con
-- pedidos nunca se purga (los pedidos no se borran).
select tests.create_store('p', 'org_a');
select public.catalog_upsert_product(tests.fx('store_p'), '{"title":"Taza","variants":[{"price":100,"sku":"P-1"}]}');
select public.inventory_adjust(tests.fx('store_p'), tests.variant('P-1'), 'adjustment', 2, 'Conteo');
select tests.logout();
select app.inventory_reserve(tests.fx('store_a'), tests.order(tests.fx('store_a')),
  jsonb_build_array(jsonb_build_object('variant_id', tests.variant('G-1'), 'quantity', 6)), now() + interval '1 hour');

-- 3. Con 'deny', un ajuste no deja lo disponible negativo.
select tests.login('owner');
select throws_ok(format($$ select public.inventory_adjust(%L, %L, 'adjustment', 1, 'Conteo', 'set') $$,
  tests.fx('store_a'), tests.variant('G-1')), 'P0001', 'insufficient_stock',
  'fijar por debajo de lo reservado: rechazado con deny');
select throws_ok(format($$ select public.inventory_adjust(%L, %L, 'loss', 4, 'Robo') $$,
  tests.fx('store_a'), tests.variant('G-1')), 'P0001', 'insufficient_stock',
  'una pérdida tampoco deja disponible negativo');
select lives_ok(format($$ select public.inventory_adjust(%L, %L, 'loss', 3, 'Robo') $$,
  tests.fx('store_a'), tests.variant('G-1')), 'pérdida que deja disponible 0: permitida');

-- 4. Repetir un 'set' con la misma clave devuelve lo aplicado.
select is((public.inventory_adjust(tests.fx('store_a'), tests.variant('G-1'), 'adjustment', 8, 'Conteo', 'set',
  'clave-set-0001') ->> 'on_hand')::int, 8, 'fijar en 8');
select is(public.inventory_adjust(tests.fx('store_a'), tests.variant('G-1'), 'adjustment', 8, 'Conteo', 'set',
  'clave-set-0001') ->> 'replayed', 'true', 'la repetición devuelve lo ya aplicado');
select tests.logout();

-- 6. Reservas con items incompletos: error de validación, no un error crudo.
select throws_ok(format($$ select app.inventory_reserve(%L, tests.order(%1$L),
  jsonb_build_array(jsonb_build_object('variant_id', %L)), now() + interval '1 hour') $$,
  tests.fx('store_a'), tests.variant('G-1')), 'P0001', 'validation_failed', 'item sin cantidad');

-- 7. Búsqueda con barra invertida.
select tests.login('owner');
select lives_ok(format($$ select * from public.inventory_search(%L, 'a\b') $$, tests.fx('store_a')),
  'la barra invertida se escapa');
select tests.logout();

-- 1. Borrar a un usuario que movió inventario ya no choca con el ledger.
select lives_ok($$ delete from public.organization_members where user_id = tests.fx('owner');
                   delete from auth.users where id = tests.fx('owner') $$,
  'borrar el usuario de Auth de quien ajustó inventario');

-- 2. Purga controlada: sin la marca, el ledger no se borra; con ella, la tienda se purga.
select throws_ok(format($$ delete from public.stores where id = %L $$, tests.fx('store_p')),
  '42501', 'append_only', 'sin purga controlada el ledger no se borra');
select lives_ok(format($$ select set_config('app.inventory_purge', 'on', true);
                          delete from public.stores where id = %L $$, tests.fx('store_p')),
  'la purga controlada borra la tienda con su ledger');
select throws_ok(format($$ select set_config('app.inventory_purge', 'on', true);
                           delete from public.stores where id = %L $$, tests.fx('store_a')),
  '23503', null, 'una tienda con pedidos no se purga ni con la marca (los pedidos no se borran)');

select * from finish();
rollback;
