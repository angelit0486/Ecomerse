-- =============================================================================
-- Gate F8 · Importación: semántica de columnas (ausente = sin cambios, vacía =
-- borrar), variantes que se conservan, revalidación de permisos en el worker
-- (CF-10), límite del plan por lote, existencias, estado y mantenimiento.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('catalog', 'catalog@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'catalog', 'catalog_manager');

create function pg_temp.job(p_mode text, p_columns text[], p_rows jsonb) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := public.imports_create(tests.fx('store_a'), p_mode, 'gate.csv', p_columns, '{}', p_rows);
  return v;
end $$;
create function pg_temp.n(p_row integer, p_handle text, p_normalized jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle), 'errors', '[]'::jsonb,
                            'normalized', jsonb_build_object('handle', p_handle, 'product', '{}'::jsonb, 'option_names', null)
                                          || p_normalized)
$$;
create function pg_temp.errors(p_job uuid) returns text[] language sql as $$
  select coalesce(array_agg(e order by r.row_number), '{}') from public.import_job_rows r,
         jsonb_array_elements_text(r.errors) e where r.import_job_id = p_job
$$;
create function pg_temp.work(p_job uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_role('system_worker');
  v := system.import_commit(p_job);
  perform tests.logout();
  return v;
end $$;
create function pg_temp.run(p_job uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform public.imports_commit(tests.fx('store_a'), p_job);
  perform tests.as_role('system_worker');
  v := system.import_commit(p_job);
  perform tests.logout();
  perform tests.login('owner');
  return v;
end $$;

select tests.login('owner');
select tests.set_fx('camisa', (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object(
  'title', 'Camisa', 'slug', 'camisa', 'description_html', '<p>Desc</p>', 'tags', '["verano"]'::jsonb, 'seo_title', 'SEO',
  'brand_id', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Marca"}'),
  'options', '[{"name":"Talla","values":["S","M"]}]'::jsonb,
  'variants', '[{"sku":"CAM-S","price":10000,"weight_g":200,"options":{"Talla":"S"}},
                {"sku":"CAM-M","price":10000,"weight_g":200,"options":{"Talla":"M"}}]'::jsonb)) ->> 'id')::uuid);
select tests.set_fx('cam_s', (select id from public.product_variants where sku = 'CAM-S'));

-- 1. Archivo parcial (handle, sku, price): solo cambia el precio de CAM-M.
select tests.set_fx('j1', pg_temp.job('update_existing', array['handle', 'sku', 'price'], jsonb_build_array(
  pg_temp.n(2, 'camisa', '{"variants":[{"row_number":2,"sku":"CAM-M","price":12500}]}'))));
select is(pg_temp.errors(tests.fx('j1')), '{}'::text[], 'archivo parcial: sin errores');
select is(pg_temp.run(tests.fx('j1')) ->> 'status', 'completed', 'aplicado');
select is((select price from public.product_variants where sku = 'CAM-M' and deleted_at is null), 12500::bigint,
  'precio nuevo');
select is((select deleted_at is null from public.product_variants where id = tests.fx('cam_s')), true,
  'la variante que no viene en el archivo se conserva');
select is((select array_agg(weight_g order by sku) from public.product_variants where product_id = tests.fx('camisa')
            and deleted_at is null), array[200, 200], 'pesos sin cambios (columna ausente)');
select is((select description_html || ' ' || array_to_string(tags, ',') || ' ' || seo_title
             from public.products where id = tests.fx('camisa')), '<p>Desc</p> verano SEO',
  'descripción, etiquetas y SEO sin cambios (columnas ausentes)');
select is((select b.name from public.products p join public.brands b on b.id = p.brand_id where p.id = tests.fx('camisa')),
  'Marca', 'marca sin cambios (columna ausente)');

-- 2. Celda vacía en una columna presente = borrar ese dato.
select tests.set_fx('j2', pg_temp.job('update_existing', array['handle', 'description', 'brand'], jsonb_build_array(
  pg_temp.n(2, 'camisa', '{"product":{"description_html":null},"brand":null,"variants":[{"row_number":2}]}'))));
select matches((pg_temp.errors(tests.fx('j2')))[1], '^sku: no coincide con ninguna variante',
  'una fila sin SKU ni opciones no identifica la variante de un producto con opciones');
select throws_ok(format($$ select public.imports_commit(%L, %L) $$, tests.fx('store_a'), tests.fx('j2')), 'P0001',
  'conflict', 'y no se puede confirmar');

select tests.set_fx('j2b', pg_temp.job('update_existing', array['handle', 'sku', 'description', 'brand'], jsonb_build_array(
  pg_temp.n(2, 'camisa', '{"product":{"description_html":null},"brand":null,"variants":[{"row_number":2,"sku":"CAM-S"}]}'))));
select is(pg_temp.run(tests.fx('j2b')) ->> 'status', 'completed', 'borrado explícito aplicado');
select is((select description_html is null and brand_id is null from public.products where id = tests.fx('camisa')), true,
  'descripción y marca borradas (celdas vacías)');

-- 3. Variante nueva por opciones; los valores de opción existentes se conservan.
select tests.set_fx('j3', pg_temp.job('update_existing', array['handle', 'option1_name', 'option1_value', 'price'],
  jsonb_build_array(pg_temp.n(2, 'camisa',
    '{"option_names":["talla"],"variants":[{"row_number":2,"options":{"talla":"L"},"price":13000}]}'))));
select is(pg_temp.run(tests.fx('j3')) ->> 'status', 'completed', 'variante nueva');
select is((select count(*)::int from public.product_variants where product_id = tests.fx('camisa') and deleted_at is null), 3,
  'S, M y L');
select is((select array_agg(ov.value order by ov.position) from public.product_option_values ov
             join public.product_options o on o.id = ov.option_id where o.product_id = tests.fx('camisa')),
  array['S', 'M', 'L'], 'valores de opción: los de antes + el nuevo');

-- 4. Errores de identificación de variantes.
select tests.set_fx('j4', pg_temp.job('update_existing', array['handle', 'option1_name', 'option1_value'], jsonb_build_array(
  pg_temp.n(2, 'camisa', '{"option_names":["Color"],"variants":[{"row_number":2,"options":{"Color":"Rojo"}}]}'))));
select is((pg_temp.errors(tests.fx('j4')))[1], 'option1_name: usa las opciones del producto (Talla)',
  'otras opciones: rechazado');
select tests.set_fx('j5', pg_temp.job('update_existing', array['handle', 'sku', 'price'], jsonb_build_array(
  pg_temp.n(2, 'camisa', '{"variants":[{"row_number":2,"sku":"NO-EXISTE","price":100}]}'))));
select matches((pg_temp.errors(tests.fx('j5')))[1], '^sku: no coincide con ninguna variante',
  'SKU desconocido sin columnas de opciones: rechazado');
select tests.set_fx('j6', pg_temp.job('create_only', array['handle', 'title', 'sku', 'price'], jsonb_build_array(
  pg_temp.n(2, 'nuevo', '{"product":{"title":"Nuevo"},"variants":[{"row_number":2,"sku":"N-1","price":100},
                                                                  {"row_number":3,"sku":"N-2","price":100}]}'))));
select matches((pg_temp.errors(tests.fx('j6')))[1], 'varias variantes incluye las columnas de opciones',
  'crear varias variantes sin opciones: rechazado');
select tests.set_fx('j7', pg_temp.job('create_only', array['handle', 'price'], jsonb_build_array(
  pg_temp.n(2, 'sin-titulo', '{"variants":[{"row_number":2,"price":100}]}'))));
select is((pg_temp.errors(tests.fx('j7')))[1], 'title: es obligatorio para crear el producto', 'crear exige título');

-- 5. Estado: draft despublica (catalog_set_product_status).
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('camisa'));
select tests.set_fx('j8', pg_temp.job('update_existing', array['handle', 'sku', 'status'], jsonb_build_array(
  pg_temp.n(2, 'camisa', '{"status":"draft","variants":[{"row_number":2,"sku":"CAM-S"}]}'))));
select is(pg_temp.run(tests.fx('j8')) ->> 'status', 'completed', 'cambio de estado aplicado');
select is((select status from public.products where id = tests.fx('camisa')), 'draft', 'status draft: despublicado');

-- 6. Existencias por debajo de lo reservado: falla sin cambios y con motivo claro.
select tests.logout();
select tests.set_fx('lvl', app.default_level(tests.fx('store_a'), tests.fx('cam_s')));
select app.apply_inventory_movement(tests.fx('store_a'), tests.fx('lvl'), 'adjustment', 5, 0, 'Inicial');
select app.apply_inventory_movement(tests.fx('store_a'), tests.fx('lvl'), 'reservation', 0, 3, 'Pedido');
select tests.login('owner');
select tests.set_fx('j9', pg_temp.job('update_existing', array['handle', 'sku', 'inventory_quantity'], jsonb_build_array(
  pg_temp.n(2, 'camisa', '{"variants":[{"row_number":2,"sku":"CAM-S","quantity":1}]}'))));
select is(pg_temp.run(tests.fx('j9')) ->> 'status', 'failed', 'existencias por debajo de lo reservado: rechazado');
select is((select error from public.import_jobs where id = tests.fx('j9')),
  'Fila 2: no puedes dejar menos existencias que las reservadas por pedidos', 'con el motivo');

-- 7. CF-10: el permiso se revalida en el worker (rol cambiado entre la confirmación y el job).
select tests.logout();
select tests.login('catalog');
select tests.set_fx('j10', public.imports_create(tests.fx('store_a'), 'create_only', 'rol.csv', array['handle', 'title', 'price'],
  '{}', jsonb_build_array(pg_temp.n(2, 'rol', '{"product":{"title":"Rol"},"variants":[{"row_number":2,"price":100}]}'))));
select public.imports_commit(tests.fx('store_a'), tests.fx('j10'));
select tests.logout();
update public.store_members set role_id = (select id from public.roles where key = 'viewer' and organization_id is null)
 where store_id = tests.fx('store_a') and user_id = tests.fx('catalog');
select is(pg_temp.work(tests.fx('j10')) ->> 'status', 'failed', 'sin el permiso al ejecutarse: no se aplica');
select is((select error from public.import_jobs where id = tests.fx('j10')),
  'Quien confirmó ya no tiene el permiso necesario (imports.run).', 'motivo del rechazo');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug = 'rol'), 0, 'nada creado');

-- 8. Límite de productos del plan: se comprueba por el lote completo.
update public.plan_entitlements set value_int = (select count(*) from public.products where store_id = tests.fx('store_a')
                                                    and deleted_at is null) + 1
 where key = 'max_products' and plan_id = (select plan_id from public.subscriptions where organization_id = tests.fx('org_a'));
select tests.login('owner');
select tests.set_fx('j11', pg_temp.job('create_only', array['handle', 'title', 'price'], jsonb_build_array(
  pg_temp.n(2, 'uno', '{"product":{"title":"Uno"},"variants":[{"row_number":2,"price":100}]}'),
  pg_temp.n(3, 'dos', '{"product":{"title":"Dos"},"variants":[{"row_number":3,"price":100}]}'))));
select is(pg_temp.run(tests.fx('j11')) ->> 'status', 'failed', 'dos productos con lugar para uno: rechazado');
select is((select error from public.import_jobs where id = tests.fx('j11')),
  'Se alcanzaría el límite de productos de tu plan', 'motivo del límite');
-- La marca del lote solo vale para su tienda (y nunca para otra tienda u otra transacción).
select set_config('app.bulk_product_limit_store', gen_random_uuid()::text, true);
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Cabe","variants":[{"price":100,"options":{}}]}');
select throws_ok($$ select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"No cabe","variants":[{"price":100,"options":{}}]}') $$,
  'P0001', 'limit_reached', 'el límite sigue vigente fuera del lote');
select tests.logout();

-- 9. Mantenimiento: una confirmación sin job vivo tras 30 min queda fallida.
update public.import_jobs set status = 'committing', commit_requested_at = now() - interval '1 hour',
                              commit_requested_by = tests.fx('owner')
 where id = tests.fx('j7');
select is(system.fail_stuck_imports(), 1, 'importación atascada marcada como fallida');
select is((select status from public.import_jobs where id = tests.fx('j7')), 'failed', 'y no vuelve a quedar colgada');

select * from finish();
rollback;
