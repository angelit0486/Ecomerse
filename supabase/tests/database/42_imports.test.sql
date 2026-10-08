-- =============================================================================
-- Fase 8 · Importación de productos (F8-T04b + Gate F8, §26.1): permisos por fila,
-- validaciones contra la base (modo, SKU ajeno, categoría), confirmación por el
-- worker TODO o NADA, repetición segura, aislamiento y auditoría.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_user('catalog', 'catalog@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.add_store_member('a', 'catalog', 'catalog_manager');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

-- Columnas de la plantilla y fila del plan como las arma el servidor (src/server/imports/products.ts).
create function pg_temp.cols() returns text[] language sql as $$
  select array['handle', 'title', 'status', 'description', 'brand', 'categories', 'tags',
    'option1_name', 'option1_value', 'option2_name', 'option2_value', 'option3_name', 'option3_value',
    'sku', 'barcode', 'price', 'compare_at_price', 'inventory_quantity', 'inventory_policy',
    'requires_shipping', 'weight_g', 'length_mm', 'width_mm', 'height_mm', 'variant_status',
    'seo_title', 'seo_description']
$$;
create function pg_temp.prow(p_row integer, p_handle text, p_sku text, p_price bigint, p_extra jsonb default '{}',
                             p_var jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle, 'sku', p_sku),
    'errors', '[]'::jsonb,
    'normalized', jsonb_build_object('handle', p_handle, 'product', jsonb_build_object('title', initcap(p_handle)),
      'option_names', null,
      'variants', jsonb_build_array(jsonb_build_object('row_number', p_row, 'sku', p_sku, 'price', p_price) || p_var))
      || p_extra)
$$;
-- El worker (job import.commit) ejecuta system.import_commit como system_worker.
create function pg_temp.work(p_job uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_role('system_worker');
  v := system.import_commit(p_job);
  perform tests.logout();
  return v;
end $$;

select tests.login('owner');
select tests.set_fx('cat_ropa', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Ropa"}'));
select public.catalog_upsert_category(tests.fx('store_a'), jsonb_build_object('name', 'Camisas', 'parent_id', tests.fx('cat_ropa')));
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Gorra","slug":"gorra","variants":[{"price":9900,"sku":"GOR-1","options":{}}]}');
select tests.logout();

select tests.login('viewer');
select throws_ok(format($$ select public.imports_create(%L, 'upsert', 'a.csv', %L, '{}', %L) $$, tests.fx('store_a'),
  pg_temp.cols(), jsonb_build_array(pg_temp.prow(2, 'taza', 'TAZ-1', 15000))), '42501', 'forbidden',
  'sin imports.run no se importa');
select tests.logout();

select tests.login('owner');
select throws_ok(format($$ select public.imports_create(%L, 'upsert', 'a.csv', %L, '{}', %L) $$, tests.fx('store_a'),
  array['handle', 'store_id'], jsonb_build_array(pg_temp.prow(2, 'taza', 'TAZ-1', 15000))), 'P0001', 'validation_failed',
  'columnas fuera de la plantilla: rechazadas por la base (el servidor las ignora antes)');
select tests.set_fx('job1', public.imports_create(tests.fx('store_a'), 'create_only', 'catalogo.csv', pg_temp.cols(),
  array['store_id'], jsonb_build_array(
  pg_temp.prow(2, 'taza', 'TAZ-1', 15000, jsonb_build_object('status', 'active', 'brand', 'Barro Fino',
                                                              'categories', '["Ropa"]'::jsonb), '{"quantity": 7}'),
  pg_temp.prow(3, 'plato', null, 22000, '{"categories":["ropa > camisas"]}'),
  -- Fila de variante: el plan del servidor la manda con normalized = JSON null.
  jsonb_build_object('row_number', 4, 'raw', '{"handle":"plato","store_id":"otra"}'::jsonb, 'errors', '[]'::jsonb,
                     'normalized', null))));
select is((select totals from public.import_jobs where id = tests.fx('job1')),
  '{"rows": 3, "create": 2, "update": 0, "errors": 0, "products": 2}'::jsonb, 'plan validado: 2 por crear, sin errores');
select is((select ignored_columns from public.import_jobs where id = tests.fx('job1')), array['store_id'],
  'columnas ignoradas registradas para avisarlas');
select is((select raw from public.import_job_rows where import_job_id = tests.fx('job1') and row_number = 4),
  '{"handle": "plato"}'::jsonb, 'lo ignorado (store_id) no se guarda');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug in ('taza', 'plato')), 0,
  'validar no escribe en el catálogo');
select is(public.imports_commit(tests.fx('store_a'), tests.fx('job1')) ->> 'status', 'committing',
  'confirmar encola el trabajo');
select is(public.imports_commit(tests.fx('store_a'), tests.fx('job1')) ->> 'replayed', 'true', 'confirmar dos veces no encola dos');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug in ('taza', 'plato')), 0,
  'la petición no escribe el catálogo (lo hace el worker)');
select tests.logout();
select is((select count(*)::int from system.jobs where type = 'import.commit'
            and dedupe_key = 'import.commit:' || tests.fx('job1')), 1, 'job import.commit en la cola');

select is(pg_temp.work(tests.fx('job1')) ->> 'status', 'completed', 'el worker aplica la importación');
select is((select status from public.products where store_id = tests.fx('store_a') and slug = 'taza'), 'active',
  'status active: publicado');
select is((select b.name from public.products p join public.brands b on b.id = p.brand_id
            where p.store_id = tests.fx('store_a') and p.slug = 'taza'), 'Barro Fino', 'marca creada y asignada');
select is((select count(*)::int from public.product_categories pc join public.products p on p.id = pc.product_id
            where p.store_id = tests.fx('store_a') and p.slug = 'taza'), 1, 'categoría por nombre');
select is((select sum(l.on_hand)::int from public.inventory_levels l join public.product_variants v on v.id = l.variant_id
            where v.store_id = tests.fx('store_a') and v.sku = 'TAZ-1'), 7, 'existencias fijadas');
select is((select m.reference_type || ' ' || m.idempotency_key from public.inventory_movements m
             join public.inventory_levels l on l.id = m.level_id join public.product_variants v on v.id = l.variant_id
            where v.store_id = tests.fx('store_a') and v.sku = 'TAZ-1'),
  'import import:' || tests.fx('job1') || ':2', 'movimiento con reference_type import y clave job:fila (§26.1)');
select is((select m.actor_user_id from public.inventory_movements m
             join public.inventory_levels l on l.id = m.level_id join public.product_variants v on v.id = l.variant_id
            where v.store_id = tests.fx('store_a') and v.sku = 'TAZ-1'), tests.fx('owner'),
  'el autor es quien confirmó');
select is((select status from public.products where store_id = tests.fx('store_a') and slug = 'plato'), 'draft',
  'sin status: borrador');
select is(pg_temp.work(tests.fx('job1')) ->> 'replayed', 'true', 'repetir el job no duplica');

select tests.login('owner');
select is((select r ->> 'categories' from jsonb_array_elements(public.exports_rows(tests.fx('store_a'), 'products') -> 'rows') r
            where r ->> 'handle' = 'plato'), 'Ropa > Camisas', 'subcategoría por ruta, también al exportar');
select is((select r ->> 'on_hand' from jsonb_array_elements(public.exports_rows(tests.fx('store_a'), 'products') -> 'rows') r
            where r ->> 'sku' = 'TAZ-1'), '7', 'la exportación da las existencias físicas que fija la importación');

-- Validaciones contra la base.
select tests.set_fx('job2', public.imports_create(tests.fx('store_a'), 'create_only', 'b.csv', pg_temp.cols(), '{}',
  jsonb_build_array(
  pg_temp.prow(2, 'gorra', 'GOR-2', 9900),
  pg_temp.prow(3, 'bufanda', 'GOR-1', 9900),
  pg_temp.prow(4, 'calcetin', null, 9900, '{"categories":["Zapatos"]}'))));
select is((select array_agg(errors ->> 0 order by row_number) from public.import_job_rows where import_job_id = tests.fx('job2')),
  array['handle: ya existe un producto con ese handle', 'sku: GOR-1 ya pertenece a otro producto',
        'categories: no existe la categoría Zapatos'], 'modo, SKU de otro producto y categoría desconocida');
select throws_ok(format($$ select public.imports_commit(%L, %L) $$, tests.fx('store_a'), tests.fx('job2')), 'P0001',
  'conflict', 'con errores no se confirma');
select tests.set_fx('job3', public.imports_create(tests.fx('store_a'), 'update_existing', 'c.csv', pg_temp.cols(), '{}',
  jsonb_build_array(pg_temp.prow(2, 'mantel', null, 9900))));
select is((select errors ->> 0 from public.import_job_rows where import_job_id = tests.fx('job3')),
  'handle: no existe un producto con ese handle', 'update_existing exige que exista');

-- Actualización: conserva la variante por SKU.
select tests.set_fx('var_gorra', (select id from public.product_variants where store_id = tests.fx('store_a') and sku = 'GOR-1'));
select tests.set_fx('job4', public.imports_create(tests.fx('store_a'), 'upsert', 'd.csv', pg_temp.cols(), '{}',
  jsonb_build_array(pg_temp.prow(2, 'gorra', 'gor-1', 12900))));
select is((select totals ->> 'update' from public.import_jobs where id = tests.fx('job4')), '1', 'upsert: 1 por actualizar');
select public.imports_commit(tests.fx('store_a'), tests.fx('job4'));
select tests.logout();
select is(pg_temp.work(tests.fx('job4')) ->> 'updated', '1', 'actualizado');
select is((select price from public.product_variants where id = tests.fx('var_gorra') and deleted_at is null), 12900::bigint,
  'misma variante (por SKU), precio nuevo');

-- Todo o nada: la fila 3 falla al aplicarse y la 2 no queda escrita.
select tests.login('owner');
select tests.set_fx('job5', public.imports_create(tests.fx('store_a'), 'upsert', 'e.csv', pg_temp.cols(), '{}',
  jsonb_build_array(
  pg_temp.prow(2, 'jarra', 'JAR-1', 30000),
  pg_temp.prow(3, 'vaso', 'VAS-1', 0, '{"status":"active"}'))));
select public.imports_commit(tests.fx('store_a'), tests.fx('job5'));
select tests.logout();
select is(pg_temp.work(tests.fx('job5')) ->> 'status', 'failed', 'falla en la fila 3');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug in ('jarra', 'vaso')), 0,
  'nada escrito: todo o nada');
select is((select error from public.import_jobs where id = tests.fx('job5')),
  'Fila 3: no se puede publicar (price_zero)', 'el error dice la fila y el motivo en español');
select ok(exists (select 1 from audit.audit_logs where action = 'import.failed' and entity_id = tests.fx('job5')
                                                 and actor_user_id = tests.fx('owner')),
  'import.failed auditado con quien confirmó');

select tests.login('catalog');
select tests.set_fx('job6', public.imports_create(tests.fx('store_a'), 'upsert', 'f.csv', pg_temp.cols(), '{}',
  jsonb_build_array(pg_temp.prow(2, 'olla', null, 9900, '{}', '{"quantity": 3}'))));
select is((select errors ->> 0 from public.import_job_rows where import_job_id = tests.fx('job6')),
  'inventory_quantity: tu rol no puede ajustar existencias', 'permisos de la confirmación avisados por fila');
select throws_ok(format($$ insert into public.import_jobs (store_id, type, mode, file_name) values (%L, 'products', 'upsert', 'x') $$,
  tests.fx('store_a')), '42501', null, 'sin escritura directa en import_jobs');
select tests.logout();

select ok(exists (select 1 from audit.audit_logs where action = 'import.committed' and store_id = tests.fx('store_a')
                                                 and actor_user_id = tests.fx('owner')),
  'confirmación auditada con su autor');

select tests.login('owner_b');
select is((select count(*)::int from public.import_jobs), 0, 'B no ve los jobs de A');
select throws_ok(format($$ select public.imports_commit(%L, %L) $$, tests.fx('store_a'), tests.fx('job2')), '42501',
  'forbidden', 'B no confirma un job de A');
select throws_ok(format($$ select public.imports_commit(%L, %L) $$, tests.fx('store_b'), tests.fx('job2')), 'P0001',
  'not_found', 'ni pasándolo por su tienda');
select tests.logout();

select * from finish();
rollback;
