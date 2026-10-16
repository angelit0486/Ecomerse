-- =============================================================================
-- ADR-025 · Proveedores: alta con su ubicación, disponibilidad informada como
-- inventario (solo por movimientos), reserva repartida (principal primero, luego
-- proveedor), envío desde los renglones correctos, proveedor inactivo fuera de
-- la disponibilidad, permisos (costos sensibles) y aislamiento.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'viewer', 'viewer');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

select tests.login('owner');
select tests.set_fx('prod', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Proteína","variants":[{"price":89900,"sku":"PRO-1"}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('prod'));
select tests.set_fx('var', (select id from public.product_variants where sku = 'PRO-1'));
select public.inventory_adjust(tests.fx('store_a'), tests.fx('var'), 'adjustment', 2, 'Inventario inicial');

select tests.set_fx('sup', public.suppliers_save(tests.fx('store_a'),
  '{"name":"Distribuidora Norte","lead_time_min_days":2,"lead_time_max_days":4,"shipping_terms":"Envío directo al cliente"}'));
select tests.logout();

-- ============================================================================ Alta
select is((select s.code || '|' || loc.kind || '|' || loc.is_active || '|' || loc.is_default
             from public.suppliers s join public.inventory_locations loc on loc.id = s.location_id
            where s.id = tests.fx('sup')), 'distribuidora-norte|supplier|true|false',
          'el proveedor nace con su clave y su ubicación de inventario (no principal)');
select tests.login('owner');
select is(pg_temp.err(format($$select public.suppliers_save(%L, '{"name":"X","lead_time_min_days":5,"lead_time_max_days":2}')$$,
            tests.fx('store_a'))), 'validation_failed/lead_time', 'el plazo mínimo no puede pasar del máximo');
select tests.logout();
select throws_ok($$ update public.inventory_locations set is_default = true, kind = 'supplier'
                      where id = (select location_id from public.suppliers where id = tests.fx('sup')) $$,
                 '23514', null, 'la ubicación principal siempre es propia');

-- ============================================================================ Disponibilidad
select tests.login('owner');
select is(public.suppliers_set_variant(tests.fx('store_a'), tests.fx('sup'), tests.fx('var'),
            '{"supplier_sku":"DN-778","unit_cost":45000,"availability":"available","quantity":5}') ->> 'on_hand', '5',
          'la cantidad informada queda como existencias del proveedor');
select is((select count(*)::integer from public.inventory_movements m
             join public.inventory_levels l on l.id = m.level_id
             join public.suppliers s on s.location_id = l.location_id
            where s.id = tests.fx('sup') and m.type = 'adjustment'), 1, 'por un movimiento del ledger (§44.10)');
select is(pg_temp.err(format($$select public.suppliers_set_variant(%L, %L, %L, '{"availability":"available"}')$$,
            tests.fx('store_a'), tests.fx('sup'), tests.fx('var'))), 'validation_failed/quantity',
          'disponible exige la cantidad informada');
select tests.logout();
select is(app.product_state(tests.fx('store_a'), tests.fx('prod')), 'in_stock', 'la tienda lo ve disponible');

-- ============================================================================ Reserva repartida
-- 2 propias + 5 del proveedor: un pedido de 4 toma 2 de la principal y 2 del proveedor.
select tests.set_fx('o1', tests.order(tests.fx('store_a')));
select tests.set_fx('r1', app.inventory_reserve(tests.fx('store_a'), tests.fx('o1'),
  jsonb_build_array(jsonb_build_object('variant_id', tests.fx('var'), 'quantity', 4)), now() + interval '30 minutes'));
select is((select string_agg(loc.kind || ':' || i.quantity, ',' order by loc.is_default desc)
             from public.inventory_reservation_items i
             join public.inventory_levels l on l.id = i.level_id
             join public.inventory_locations loc on loc.id = l.location_id
            where i.reservation_id = tests.fx('r1')), 'own:2,supplier:2',
          'la reserva usa primero la principal y completa con el proveedor');
select is((select sum(l.available)::integer from public.inventory_levels l where l.variant_id = tests.fx('var')), 3,
          'quedan 3 disponibles en total');
select tests.set_fx('o2', tests.order(tests.fx('store_a')));
select is(pg_temp.err(format($$select app.inventory_reserve(%L, %L, '[{"variant_id":"%s","quantity":4}]'::jsonb, now() + interval '30 minutes')$$,
            tests.fx('store_a'), tests.fx('o2'), tests.fx('var'))), 'insufficient_stock/' || tests.fx('var'),
          'sin existencias suficientes entre todas las ubicaciones: no se sobrevende');
select is((select sum(l.reserved)::integer from public.inventory_levels l where l.variant_id = tests.fx('var')), 4,
          'y el intento fallido no dejó nada reservado');

-- El proveedor informa menos de lo reservado: se respeta lo reservado.
select tests.login('owner');
select is(public.suppliers_set_variant(tests.fx('store_a'), tests.fx('sup'), tests.fx('var'),
            '{"availability":"unavailable"}'),
          '{"on_hand": 2, "clamped_to_reserved": true}'::jsonb,
          '«no disponible» deja en 0 lo libre pero conserva lo ya reservado');
select tests.logout();
select is((select sum(l.available)::integer from public.inventory_levels l where l.variant_id = tests.fx('var')), 0,
          'nada más se puede vender');

-- ============================================================================ Envío
select app.inventory_commit(tests.fx('store_a'), tests.fx('r1'));
select lives_ok(format($$select app.inventory_fulfill(%L, %L, '0190a0d0-0000-7000-8000-00000000aa01',
  jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 3)))$$,
  tests.fx('store_a'), tests.fx('r1'), tests.fx('var')), 'envío de 3 de una variante repartida en 2 ubicaciones');
select is((select string_agg(loc.kind || ':' || i.fulfilled_quantity, ',' order by loc.is_default desc)
             from public.inventory_reservation_items i
             join public.inventory_levels l on l.id = i.level_id
             join public.inventory_locations loc on loc.id = l.location_id
            where i.reservation_id = tests.fx('r1')), 'own:2,supplier:1',
          'descuenta primero de la principal y luego del proveedor');
select lives_ok(format($$select app.inventory_fulfill(%L, %L, '0190a0d0-0000-7000-8000-00000000aa01',
  jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 3)))$$,
  tests.fx('store_a'), tests.fx('r1'), tests.fx('var')), 'repetir el mismo envío');
select is((select sum(i.fulfilled_quantity)::integer from public.inventory_reservation_items i
            where i.reservation_id = tests.fx('r1')), 3, 'no descuenta dos veces');
select is(pg_temp.err(format($$select app.inventory_fulfill(%L, %L, '0190a0d0-0000-7000-8000-00000000aa02',
  jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 2)))$$,
  tests.fx('store_a'), tests.fx('r1'), tests.fx('var'))), 'validation_failed/quantity',
  'no se envía más de lo que queda reservado');

-- ============================================================================ Proveedor inactivo
select tests.login('owner');
select public.suppliers_set_variant(tests.fx('store_a'), tests.fx('sup'), tests.fx('var'),
  '{"availability":"available","quantity":10}');
select public.suppliers_save(tests.fx('store_a'), jsonb_build_object('id', tests.fx('sup'), 'name', 'Distribuidora Norte',
  'status', 'inactive'));
select tests.logout();
select is(app.product_state(tests.fx('store_a'), tests.fx('prod')), 'out_of_stock',
          'un proveedor inactivo no aporta disponibilidad');
select tests.set_fx('o3', tests.order(tests.fx('store_a')));
select is(pg_temp.err(format($$select app.inventory_reserve(%L, %L, '[{"variant_id":"%s","quantity":1}]'::jsonb, now() + interval '30 minutes')$$,
            tests.fx('store_a'), tests.fx('o3'), tests.fx('var'))), 'insufficient_stock/' || tests.fx('var'),
          'ni se reserva de él');

-- ============================================================================ Permisos y aislamiento
select tests.login('viewer');
select is(pg_temp.err(format('select public.suppliers_list(%L)', tests.fx('store_a'))), 'forbidden',
          'sin products.cost.read no se ven proveedores ni costos');
select is(tests.row_count('select * from public.supplier_variants'), 0::bigint, 'ni por RLS');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.err(format($$select public.suppliers_set_variant(%L, %L, %L, '{"availability":"available","quantity":99}')$$,
            tests.fx('store_a'), tests.fx('sup'), tests.fx('var'))), 'forbidden', 'otra tienda no los cambia');
select is(public.suppliers_list(tests.fx('store_b')), '[]'::jsonb, 'y no los ve en la suya');
select tests.logout();

select * from finish();
rollback;
