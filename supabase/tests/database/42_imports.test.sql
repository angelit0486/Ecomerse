-- =============================================================================
-- Fase 8 · Importación de productos (F8-T04b, §26.1): permisos por fila,
-- validaciones contra la base (modo, SKU ajeno, categoría), todo o nada,
-- repetición segura, aislamiento y auditoría.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_user('catalog', 'catalog@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.add_store_member('a', 'catalog', 'catalog_manager');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

-- Fila del plan como la arma el servidor (src/server/imports/products.ts).
create function pg_temp.prow(p_row integer, p_handle text, p_sku text, p_price bigint, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle), 'errors', '[]'::jsonb,
    'normalized', jsonb_build_object('handle', p_handle, 'publish', false, 'brand', null, 'categories', '[]'::jsonb,
      'inventory', '[]'::jsonb,
      'payload', jsonb_build_object('title', initcap(p_handle), 'slug', p_handle, 'tags', '[]'::jsonb, 'options', '[]'::jsonb,
        'variants', jsonb_build_array(jsonb_build_object('options', '{}'::jsonb, 'sku', p_sku, 'price', p_price,
                                                         'position', 0)))) || p_extra)
$$;

select tests.login('owner');
select tests.set_fx('cat_ropa', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Ropa"}'));
select public.catalog_upsert_category(tests.fx('store_a'), jsonb_build_object('name', 'Camisas', 'parent_id', tests.fx('cat_ropa')));
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Gorra","slug":"gorra","variants":[{"price":9900,"sku":"GOR-1","options":{}}]}');
select tests.logout();

select tests.login('viewer');
select throws_ok(format($$ select public.imports_create(%L, 'upsert', 'a.csv', %L) $$, tests.fx('store_a'),
  jsonb_build_array(pg_temp.prow(2, 'taza', 'TAZ-1', 15000))), '42501', 'forbidden', 'sin imports.run no se importa');
select tests.logout();

select tests.login('owner');
select tests.set_fx('job1', public.imports_create(tests.fx('store_a'), 'create_only', 'catalogo.csv', jsonb_build_array(
  pg_temp.prow(2, 'taza', 'TAZ-1', 15000, jsonb_build_object('publish', true, 'brand', 'Barro Fino', 'categories', '["Ropa"]'::jsonb,
                                                              'inventory', '[{"variant_index":0,"quantity":7,"row_number":2}]'::jsonb)),
  pg_temp.prow(3, 'plato', null, 22000, '{"categories":["ropa > camisas"]}'),
  -- Fila de variante: el plan del servidor la manda con normalized = JSON null.
  jsonb_build_object('row_number', 4, 'raw', '{"handle":"plato"}'::jsonb, 'errors', '[]'::jsonb, 'normalized', null))));
select is((select totals from public.import_jobs where id = tests.fx('job1')),
  '{"rows": 3, "create": 2, "update": 0, "errors": 0}'::jsonb, 'plan validado: 2 por crear, sin errores');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug in ('taza', 'plato')), 0,
  'validar no escribe en el catálogo');
select is(public.imports_commit(tests.fx('store_a'), tests.fx('job1')) ->> 'status', 'completed', 'confirmado');
select is((select status from public.products where store_id = tests.fx('store_a') and slug = 'taza'), 'active',
  'status active: publicado');
select is((select b.name from public.products p join public.brands b on b.id = p.brand_id
            where p.store_id = tests.fx('store_a') and p.slug = 'taza'), 'Barro Fino', 'marca creada y asignada');
select is((select count(*)::int from public.product_categories pc join public.products p on p.id = pc.product_id
            where p.store_id = tests.fx('store_a') and p.slug = 'taza'), 1, 'categoría por nombre');
select is((select sum(l.on_hand)::int from public.inventory_levels l join public.product_variants v on v.id = l.variant_id
            where v.store_id = tests.fx('store_a') and v.sku = 'TAZ-1'), 7, 'existencias fijadas');
select is((select status from public.products where store_id = tests.fx('store_a') and slug = 'plato'), 'draft',
  'sin status: borrador');
select is(public.imports_commit(tests.fx('store_a'), tests.fx('job1')) ->> 'replayed', 'true',
  'repetir la confirmación no duplica');
select is((select count(*)::int from public.inventory_movements m join public.inventory_levels l on l.id = m.level_id join public.product_variants v on v.id = l.variant_id
            where v.store_id = tests.fx('store_a') and v.sku = 'TAZ-1'), 1, 'un solo movimiento de inventario');
select is((select r ->> 'categories' from jsonb_array_elements(public.exports_rows(tests.fx('store_a'), 'products') -> 'rows') r
            where r ->> 'handle' = 'plato'), 'Ropa > Camisas', 'subcategoría por ruta, también al exportar');
-- Ida y vuelta: exportar y reimportar sin cambios no mueve existencias ni falla.
select is((select r ->> 'on_hand' from jsonb_array_elements(public.exports_rows(tests.fx('store_a'), 'products') -> 'rows') r
            where r ->> 'sku' = 'TAZ-1'), '7', 'la exportación da las existencias físicas que fija la importación');
select tests.set_fx('job7', public.imports_create(tests.fx('store_a'), 'upsert', 'otra-vez.csv', jsonb_build_array(
  pg_temp.prow(2, 'taza', 'TAZ-1', 15000, jsonb_build_object('publish', true, 'brand', 'Barro Fino', 'categories', '["Ropa"]'::jsonb,
                                                              'inventory', '[{"variant_index":0,"quantity":7,"row_number":2}]'::jsonb)))));
select is(public.imports_commit(tests.fx('store_a'), tests.fx('job7')) ->> 'status', 'completed', 'reimportar igual: sin errores');
select is((select count(*)::int from public.inventory_movements m join public.inventory_levels l on l.id = m.level_id
            join public.product_variants v on v.id = l.variant_id
            where v.store_id = tests.fx('store_a') and v.sku = 'TAZ-1'), 1, 'sin movimiento si la cantidad no cambia');

-- Validaciones contra la base.
select tests.set_fx('job2', public.imports_create(tests.fx('store_a'), 'create_only', 'b.csv', jsonb_build_array(
  pg_temp.prow(2, 'gorra', 'GOR-2', 9900),
  pg_temp.prow(3, 'bufanda', 'GOR-1', 9900),
  pg_temp.prow(4, 'calcetin', null, 9900, '{"categories":["Zapatos"]}'))));
select is((select array_agg(errors ->> 0 order by row_number) from public.import_job_rows where import_job_id = tests.fx('job2')),
  array['handle: ya existe un producto con ese handle', 'sku: GOR-1 ya pertenece a otro producto',
        'categories: no existe la categoría Zapatos'], 'modo, SKU de otro producto y categoría desconocida');
select throws_ok(format($$ select public.imports_commit(%L, %L) $$, tests.fx('store_a'), tests.fx('job2')), 'P0001',
  'conflict', 'con errores no se confirma');
select tests.set_fx('job3', public.imports_create(tests.fx('store_a'), 'update_existing', 'c.csv', jsonb_build_array(
  pg_temp.prow(2, 'mantel', null, 9900))));
select is((select errors ->> 0 from public.import_job_rows where import_job_id = tests.fx('job3')),
  'handle: no existe un producto con ese handle', 'update_existing exige que exista');

-- Actualización: conserva la variante por SKU.
select tests.set_fx('var_gorra', (select id from public.product_variants where store_id = tests.fx('store_a') and sku = 'GOR-1'));
select tests.set_fx('job4', public.imports_create(tests.fx('store_a'), 'upsert', 'd.csv', jsonb_build_array(
  pg_temp.prow(2, 'gorra', 'gor-1', 12900))));
select is((select totals ->> 'update' from public.import_jobs where id = tests.fx('job4')), '1', 'upsert: 1 por actualizar');
select is(public.imports_commit(tests.fx('store_a'), tests.fx('job4')) ->> 'updated', '1', 'actualizado');
select is((select price from public.product_variants where id = tests.fx('var_gorra') and deleted_at is null), 12900::bigint,
  'misma variante (por SKU), precio nuevo');

-- Todo o nada: la fila 3 falla en la confirmación y la 2 no queda escrita.
select tests.set_fx('job5', public.imports_create(tests.fx('store_a'), 'upsert', 'e.csv', jsonb_build_array(
  pg_temp.prow(2, 'jarra', 'JAR-1', 30000),
  pg_temp.prow(3, 'vaso', 'VAS-1', 0, '{"publish":true}'))));
select is(public.imports_commit(tests.fx('store_a'), tests.fx('job5')) ->> 'status', 'failed', 'falla en la fila 3');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug in ('jarra', 'vaso')), 0,
  'nada escrito: todo o nada');
select is((select error from public.import_jobs where id = tests.fx('job5')),
  'Fila 3: no se puede publicar (price_zero)', 'el error dice la fila y el motivo en español');
select tests.logout();

select tests.login('catalog');
select tests.set_fx('job6', public.imports_create(tests.fx('store_a'), 'upsert', 'f.csv', jsonb_build_array(
  pg_temp.prow(2, 'olla', null, 9900, '{"inventory":[{"variant_index":0,"quantity":3,"row_number":2}]}'))));
select is((select errors ->> 0 from public.import_job_rows where import_job_id = tests.fx('job6')),
  'inventory_quantity: tu rol no puede ajustar existencias', 'permisos de la confirmación avisados por fila');
select throws_ok(format($$ insert into public.import_jobs (store_id, type, mode, file_name) values (%L, 'products', 'upsert', 'x') $$,
  tests.fx('store_a')), '42501', null, 'sin escritura directa en import_jobs');
select tests.logout();

select ok(exists (select 1 from audit.audit_logs where action = 'import.committed' and store_id = tests.fx('store_a')),
  'confirmación auditada');

select tests.login('owner_b');
select is((select count(*)::int from public.import_jobs), 0, 'B no ve los jobs de A');
select throws_ok(format($$ select public.imports_commit(%L, %L) $$, tests.fx('store_a'), tests.fx('job1')), '42501',
  'forbidden', 'B no confirma un job de A');
select throws_ok(format($$ select public.imports_commit(%L, %L) $$, tests.fx('store_b'), tests.fx('job1')), 'P0001',
  'not_found', 'ni pasándolo por su tienda');
select tests.logout();

select * from finish();
rollback;
