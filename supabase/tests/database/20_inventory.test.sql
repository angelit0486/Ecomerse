-- =============================================================================
-- Fase 4 · Inventario (F4-T01, F4-T02): estructura, ledger, ajustes y reservas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('cat', 'cat@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'cat', 'catalog_manager');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function tests.variant(p_sku text) returns uuid
language sql security definer set search_path = '' as
  $$ select id from public.product_variants where sku = p_sku and deleted_at is null $$;
create function tests.level(p_sku text) returns public.inventory_levels
language sql security definer set search_path = '' as
  $$ select l.* from public.inventory_levels l where l.variant_id = tests.variant(p_sku) $$;
create function tests.adjust(p_sku text, p_type text, p_qty int, p_reason text default 'Conteo físico',
                             p_mode text default 'delta', p_key text default null) returns jsonb
language sql as $$
  select public.inventory_adjust(tests.fx('store_a'), tests.variant(p_sku), p_type, p_qty, p_reason, p_mode, p_key) $$;
grant execute on all functions in schema tests to authenticated;

-- ============================================================================ Estructura
select is((select count(*)::int from public.inventory_locations where store_id = tests.fx('store_a') and is_default), 1,
  'toda tienda nace con su ubicación por defecto');
select tests.login('owner');
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Gorra","variants":[{"price":100,"sku":"DENY-1"}]}');
select public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Preventa","variants":[{"price":100,"sku":"CONT-1","inventory_policy":"continue"}]}');
select public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Servicio","variants":[{"price":100,"sku":"FREE-1","track_inventory":false}]}');
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Bolsa","variants":[{"price":100,"sku":"BAG-1"}]}');
select tests.logout();
select is((tests.level('DENY-1')).on_hand, 0, 'cada variante nueva tiene su nivel en 0');
select throws_ok($$ update public.inventory_levels set on_hand = 99 where variant_id = tests.variant('DENY-1') $$,
  '42501', 'inventory_direct_write', 'nadie cambia on_hand fuera de apply_inventory_movement (ni el dueño de la base)');
select throws_ok($$ insert into public.inventory_levels (store_id, variant_id, location_id, on_hand)
  select store_id, variant_id, location_id, 5 from public.inventory_levels where variant_id = tests.variant('DENY-1') $$,
  '42501', 'inventory_direct_write', 'un nivel no nace con existencias');
select lives_ok($$ update public.inventory_levels set low_stock_threshold = 2 where variant_id = tests.variant('DENY-1') $$,
  'el umbral sí se puede cambiar');
select is(tests.sqlstate_as('authenticated', format(
  'select app.apply_inventory_movement(%L, %L, ''purchase'', 5, 0)', tests.fx('store_a'), (tests.level('DENY-1')).id)),
  '42501', 'apply_inventory_movement no es ejecutable por roles de aplicación');

-- ============================================================================ Ajustes
select tests.login('owner');
select is((tests.adjust('DENY-1', 'adjustment', 10) ->> 'on_hand')::int, 10, 'ajuste +10');
select is((tests.adjust('DENY-1', 'damage', 3, 'Llegó roto') ->> 'on_hand')::int, 7, 'daño resta aunque venga positivo');
select is((tests.adjust('DENY-1', 'adjustment', 4, 'Conteo', 'set') ->> 'on_hand')::int, 4, 'fijar on_hand en 4');
select throws_ok($$ select tests.adjust('DENY-1', 'adjustment', 4, 'Conteo', 'set') $$, 'P0001', 'validation_failed',
  'fijar la misma cantidad no crea un movimiento vacío');
select throws_ok($$ select tests.adjust('DENY-1', 'adjustment', 5, '') $$, 'P0001', 'validation_failed',
  'el motivo es obligatorio');
select throws_ok($$ select tests.adjust('DENY-1', 'loss', 3, 'x', 'set') $$, 'P0001', 'validation_failed',
  'fijar solo vale para ajustes');
select throws_ok($$ select tests.adjust('DENY-1', 'adjustment', -100) $$, 'P0001', 'insufficient_stock',
  'no se puede dejar on_hand negativo');
select is((tests.adjust('BAG-1', 'adjustment', 5, 'Inicial', 'delta', 'clave-ajuste-1') ->> 'on_hand')::int, 5,
  'ajuste con clave de idempotencia');
select is((tests.adjust('BAG-1', 'adjustment', 5, 'Inicial', 'delta', 'clave-ajuste-1') ->> 'on_hand')::int, 5,
  'repetir la misma clave no vuelve a sumar');
select throws_ok($$ select tests.adjust('BAG-1', 'adjustment', 6, 'Inicial', 'delta', 'clave-ajuste-1') $$,
  'P0001', 'conflict', 'la misma clave con otra cantidad es un conflicto');
select tests.logout();
select is((select count(*)::int from public.inventory_movements where level_id = (tests.level('BAG-1')).id), 1,
  'un solo movimiento por clave');
select is((select actor_type || ':' || (actor_user_id = tests.fx('owner')) from public.inventory_movements
            where level_id = (tests.level('DENY-1')).id and type = 'damage'), 'user:true', 'el ledger registra al actor');
select is((select count(*)::int from audit.audit_logs where action = 'inventory.adjusted'
            and store_id = tests.fx('store_a')), 4, 'ajustes auditados');
select throws_ok($$ update public.inventory_movements set on_hand_delta = 1000 where store_id = tests.fx('store_a') $$,
  '42501', 'append_only', 'el ledger no se modifica');
select throws_ok($$ delete from public.inventory_movements where store_id = tests.fx('store_a') $$,
  '42501', 'append_only', 'el ledger no se borra');

select tests.login('cat');
select throws_ok($$ select tests.adjust('DENY-1', 'adjustment', 1) $$, '42501', 'forbidden',
  'catalog_manager (solo inventory.read) no ajusta');
select is((select count(*)::int from public.inventory_levels where store_id = tests.fx('store_a')), 4,
  'catalog_manager ve el inventario');
select tests.logout(); select tests.login('owner', 'aal1');
select throws_ok($$ select tests.adjust('DENY-1', 'adjustment', 1) $$, '42501', 'mfa_required', 'sin 2FA no se ajusta');
select tests.logout(); select tests.login('owner_b');
select throws_ok($$ select tests.adjust('DENY-1', 'adjustment', 1) $$, '42501', 'forbidden', 'otro tenant no ajusta');
select throws_ok(format($$ select public.inventory_adjust(%L, %L, 'adjustment', 1, 'Robo') $$,
  tests.fx('store_b'), tests.variant('DENY-1')), 'P0001', 'not_found', 'una variante de A no existe para B');
select is((select count(*)::int from public.inventory_movements where store_id = tests.fx('store_a')), 0,
  'RLS: otro tenant no ve el ledger de A');
select tests.logout();

-- ============================================================================ Reservas
-- DENY-1: on_hand 4. Pedido 1 reserva 3.
select tests.set_fx('r1', app.inventory_reserve(tests.fx('store_a'), '0190a0d0-0000-7000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('variant_id', tests.variant('DENY-1'), 'quantity', 2),
                    jsonb_build_object('variant_id', tests.variant('DENY-1'), 'quantity', 1),
                    jsonb_build_object('variant_id', tests.variant('FREE-1'), 'quantity', 9)), now() + interval '15 minutes'));
select is((tests.level('DENY-1')).reserved || '/' || (tests.level('DENY-1')).available, '3/1',
  'checkout reserva 3 (líneas de la misma variante sumadas): disponible 1');
select is((select count(*)::int from public.inventory_reservation_items where reservation_id = tests.fx('r1')), 1,
  'las variantes sin seguimiento no se reservan');
select throws_ok($$ select app.inventory_reserve(tests.fx('store_a'), '0190a0d0-0000-7000-8000-000000000002',
  jsonb_build_array(jsonb_build_object('variant_id', tests.variant('BAG-1'), 'quantity', 1),
                    jsonb_build_object('variant_id', tests.variant('DENY-1'), 'quantity', 2)), now() + interval '15 minutes') $$,
  'P0001', 'insufficient_stock', 'un item sin stock hace fallar todo el pedido');
select is((tests.level('BAG-1')).reserved, 0, 'atómico: nada del pedido fallido quedó reservado');
select throws_ok($$ select app.inventory_reserve(tests.fx('store_a'), '0190a0d0-0000-7000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('variant_id', tests.variant('BAG-1'), 'quantity', 1)), now() + interval '15 minutes') $$,
  'P0001', 'conflict', 'un pedido no tiene dos reservas vivas');
select lives_ok($$ select app.inventory_reserve(tests.fx('store_a'), '0190a0d0-0000-7000-8000-000000000003',
  jsonb_build_array(jsonb_build_object('variant_id', tests.variant('CONT-1'), 'quantity', 5)), now() + interval '15 minutes') $$,
  'con política continue se reserva sin existencias');
select is((tests.level('CONT-1')).available, -5, 'disponible negativo solo con continue');

select lives_ok(format($$ select app.inventory_commit(%L, %L) $$, tests.fx('store_a'), tests.fx('r1')), 'pago aprobado');
select throws_ok(format($$ select app.inventory_release(%L, %L, 'expired') $$, tests.fx('store_a'), tests.fx('r1')),
  'P0001', 'conflict', 'una reserva pagada no expira');
select lives_ok(format($$ select app.inventory_fulfill(%L, %L, '0190a0d0-0000-7000-8000-0000000000f1',
  jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 2))) $$,
  tests.fx('store_a'), tests.fx('r1'), tests.variant('DENY-1')), 'envío parcial de 2');
select is((tests.level('DENY-1')).on_hand || '/' || (tests.level('DENY-1')).reserved, '2/1', 'sale: −2 en on_hand y en reserved');
select lives_ok(format($$ select app.inventory_fulfill(%L, %L, '0190a0d0-0000-7000-8000-0000000000f1',
  jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 2))) $$,
  tests.fx('store_a'), tests.fx('r1'), tests.variant('DENY-1')), 'el mismo envío otra vez');
select is((tests.level('DENY-1')).on_hand, 2, 'idempotente: no se descuenta dos veces');
select lives_ok(format($$ select app.inventory_release(%L, %L, 'released') $$, tests.fx('store_a'), tests.fx('r1')),
  'cancelar lo no enviado');
select is((tests.level('DENY-1')).reserved || ':' || (select status from public.inventory_reservations where id = tests.fx('r1')),
  '0:released', 'se libera solo lo pendiente');
select lives_ok(format($$ select app.inventory_release(%L, %L, 'released') $$, tests.fx('store_a'), tests.fx('r1')),
  'liberar dos veces es un no-op');

-- ============================================================================ Búsqueda del panel
select tests.login('cat');
select is((select count(*)::int from public.inventory_search(tests.fx('store_a'))), 4, 'tabla de inventario');
select is((select sku from public.inventory_search(tests.fx('store_a'), 'bag-1')), 'BAG-1', 'búsqueda por SKU exacto');
select is((select string_agg(sku, ',') from public.inventory_search(tests.fx('store_a'), null, true)), 'DENY-1',
  'stock bajo: disponible ≤ umbral (DENY-1: 2 ≤ 2)');
select is((select count(*)::int from public.inventory_search(tests.fx('store_a'), '%')), 0,
  'los comodines de la búsqueda se escapan');
select tests.logout(); select tests.login('owner_b');
select throws_ok($$ select * from public.inventory_search(tests.fx('store_a')) $$, '42501', 'forbidden',
  'otro tenant no lee el inventario de A');
select tests.logout();

select is_empty($$ select * from system.inventory_ledger_mismatches() $$,
  'invariante del ledger: cada nivel es la suma de sus movimientos');

select * from finish();
rollback;
