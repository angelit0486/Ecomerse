-- =============================================================================
-- ADR-025 paso 2 · Disponibilidad del proveedor por CSV: todo o nada, mismas
-- existencias que la captura manual (por movimientos), origen `csv`, clave
-- ausente conserva el SKU y costo guardados, permisos y aislamiento.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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

select tests.login('owner');
select public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Proteína","variants":[{"price":89900,"sku":"PRO-1","options":{"Sabor":"Vainilla"}},
                                   {"price":89900,"sku":"PRO-2","options":{"Sabor":"Chocolate"}}],
    "options":[{"name":"Sabor","values":["Vainilla","Chocolate"]}]}');
select tests.set_fx('v1', (select id from public.product_variants where sku = 'PRO-1'));
select tests.set_fx('v2', (select id from public.product_variants where sku = 'PRO-2'));
select tests.set_fx('sup', public.suppliers_save(tests.fx('store_a'), '{"name":"Distribuidora Norte"}'));
select public.suppliers_set_variant(tests.fx('store_a'), tests.fx('sup'), tests.fx('v1'),
  '{"supplier_sku":"DN-1","unit_cost":45000,"availability":"available","quantity":3}');

-- ============================================================================ Todo o nada
select is(public.suppliers_import_variants(tests.fx('store_a'), tests.fx('sup'),
            '[{"row":2,"sku":"pro-1","availability":"available","quantity":8},
              {"row":3,"sku":"NOPE","availability":"available","quantity":1},
              {"row":4,"sku":"PRO-2","availability":"available"},
              {"row":5,"sku":"PRO-1","availability":"unavailable"},
              {"row":6,"sku":"PRO-2","availability":"maybe"}]'),
          '{"applied": false, "errors": [{"row": 3, "field": "sku"}, {"row": 4, "field": "quantity"},
            {"row": 5, "field": "duplicate"}, {"row": 6, "field": "availability"},
            {"row": 6, "field": "duplicate"}], "updated": 0, "clamped": 0}'::jsonb,
          'cada fila con su error (SKU inexistente, cantidad faltante, repetido, disponibilidad)');
select is((select reported_quantity from public.supplier_variants where variant_id = tests.fx('v1')), 3,
          'con errores no se aplica nada');
select is(pg_temp.err(format($$select public.suppliers_import_variants(%L, %L, '[]')$$,
            tests.fx('store_a'), tests.fx('sup'))), 'validation_failed/rows', 'un archivo vacío no se procesa');
select is(pg_temp.err(format($$select public.suppliers_import_variants(%L, %L, '[{"sku":"PRO-1","availability":"unknown","unit_cost":"x"}]')$$,
            tests.fx('store_a'), tests.fx('sup'))) , 'ok', 'la llamada con error de costo no lanza');
select is(public.suppliers_import_variants(tests.fx('store_a'), tests.fx('sup'),
            '[{"row":2,"sku":"PRO-1","availability":"unknown","unit_cost":"x"}]') -> 'errors',
          '[{"row": 2, "field": "unit_cost"}]'::jsonb, 'y lo reporta en su fila');

-- ============================================================================ Aplicar
select is(public.suppliers_import_variants(tests.fx('store_a'), tests.fx('sup'),
            '[{"row":2,"sku":"pro-1","availability":"limited","quantity":8},
              {"row":3,"sku":"PRO-2","availability":"available","quantity":4,"supplier_sku":"DN-2","unit_cost":47000}]'),
          '{"applied": true, "errors": [], "updated": 2, "clamped": 0}'::jsonb, 'aplica todas las filas');
select is((select string_agg(sv.supplier_sku || ':' || sv.unit_cost || ':' || sv.availability || ':' || sv.sync_source
                             || ':' || l.on_hand, ',' order by sv.supplier_sku)
             from public.supplier_variants sv
             join public.suppliers s on s.id = sv.supplier_id
             join public.inventory_levels l on l.variant_id = sv.variant_id and l.location_id = s.location_id
            where sv.supplier_id = tests.fx('sup')),
          'DN-1:45000:limited:csv:8,DN-2:47000:available:csv:4',
          'existencias del proveedor actualizadas; sin columna de SKU o costo se conservan los guardados');
select is((select count(*)::integer from public.inventory_movements m
             join public.inventory_levels l on l.id = m.level_id
             join public.suppliers s on s.location_id = l.location_id
            where s.id = tests.fx('sup')), 3, 'cada cambio por un movimiento del ledger (§44.10)');
select is(public.suppliers_import_variants(tests.fx('store_a'), tests.fx('sup'),
            '[{"row":2,"sku":"PRO-2","availability":"available","quantity":4,"unit_cost":null}]') ->> 'updated', '1',
          'repetir la misma cantidad no crea movimiento');
select is((select count(*)::integer from public.inventory_movements m
             join public.inventory_levels l on l.id = m.level_id
             join public.suppliers s on s.location_id = l.location_id
            where s.id = tests.fx('sup')), 3, 'sigue habiendo 3 movimientos');
select is((select unit_cost from public.supplier_variants where variant_id = tests.fx('v2')), null::bigint,
          'un costo vacío explícito (null) lo borra');
select tests.logout();

-- ============================================================================ Permisos y aislamiento
select tests.login('viewer');
select is(pg_temp.err(format($$select public.suppliers_import_variants(%L, %L, '[{"sku":"PRO-1","availability":"unknown"}]')$$,
            tests.fx('store_a'), tests.fx('sup'))), 'forbidden', 'sin permisos de costos e inventario no se importa');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.err(format($$select public.suppliers_import_variants(%L, %L, '[{"sku":"PRO-1","availability":"unknown"}]')$$,
            tests.fx('store_a'), tests.fx('sup'))), 'forbidden', 'otra tienda no importa en esta');
select is(pg_temp.err(format($$select public.suppliers_import_variants(%L, %L, '[{"sku":"PRO-1","availability":"unknown"}]')$$,
            tests.fx('store_b'), tests.fx('sup'))), 'not_found/supplier', 'ni con el proveedor de otra tienda en la suya');
select tests.logout();

select * from finish();
rollback;
