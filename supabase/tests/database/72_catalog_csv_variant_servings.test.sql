-- =============================================================================
-- ADR-026 punto 2 · Contenido neto y porciones por presentación en el CSV:
-- importar, vacía = vale el del producto, ausente = sin cambios, validación por
-- fila, sin exigir permisos de costo y exportación simétrica.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');

create function pg_temp.n(p_row integer, p_handle text, p_normalized jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle), 'errors', '[]'::jsonb,
                            'normalized', jsonb_build_object('handle', p_handle, 'product', '{}'::jsonb, 'option_names', null)
                                          || p_normalized)
$$;
create function pg_temp.job(p_columns text[], p_rows jsonb) returns uuid language sql as $$
  select public.imports_create(tests.fx('store_a'), 'upsert', 'v.csv', p_columns, '{}', p_rows)
$$;
create function pg_temp.errors(p_job uuid) returns text[] language sql as $$
  select coalesce(array_agg(e order by r.row_number), '{}') from public.import_job_rows r,
         jsonb_array_elements_text(r.errors) e where r.import_job_id = p_job
$$;
create function pg_temp.run(p_job uuid, p_user text) returns text language plpgsql as $$
declare v jsonb;
begin
  perform public.imports_commit(tests.fx('store_a'), p_job);
  perform tests.as_role('system_worker');
  v := system.import_commit(p_job);
  perform tests.logout();
  perform tests.login(p_user);
  return coalesce(v ->> 'status', '') || coalesce(':' || (select error from public.import_jobs where id = p_job), '');
end $$;
create function pg_temp.sizes() returns text language sql security definer as $$
  select coalesce(string_agg(v.sku || '=' || coalesce(v.net_content, '-') || '/' || coalesce(v.servings_per_container::text, '-'),
                             ',' order by v.sku), '')
    from public.product_variants v
   where v.store_id = tests.fx('store_a') and v.deleted_at is null
$$;

select tests.login('owner');
select tests.set_fx('j1', pg_temp.job(
  array['handle', 'title', 'option1_name', 'option1_value', 'sku', 'price', 'variant_net_content', 'variant_servings'],
  jsonb_build_array(
    pg_temp.n(2, 'proteina', '{"product":{"title":"Proteína"},"option_names":["Tamaño"],
       "variants":[{"row_number":2,"options":{"Tamaño":"1 kg"},"sku":"PRO-1K","price":59900,
                    "net_content":"1 kg","servings_per_container":33},
                   {"row_number":3,"options":{"Tamaño":"2 kg"},"sku":"PRO-2K","price":99900,
                    "net_content":"2 kg","servings_per_container":66}]}'))));
select is(pg_temp.errors(tests.fx('j1')), '{}'::text[], 'contenido y porciones se validan sin errores');
select ok((select not ('products.cost.read' = any (needs)) from public.import_jobs where id = tests.fx('j1')),
          'y no exigen el permiso de costos');
select is(pg_temp.run(tests.fx('j1'), 'owner'), 'completed', 'se confirma');
select is(pg_temp.sizes(), 'PRO-1K=1 kg/33,PRO-2K=2 kg/66', 'cada presentación queda con su contenido y porciones');
select lives_ok('set constraints all immediate', 'las validaciones diferidas de las variantes pasan');

-- Vacía (null) = vale el del producto; columna ausente = sin cambios.
select tests.set_fx('j2', pg_temp.job(array['handle', 'sku', 'variant_net_content', 'variant_servings'],
  jsonb_build_array(pg_temp.n(2, 'proteina',
    '{"variants":[{"row_number":2,"sku":"PRO-1K","net_content":null,"servings_per_container":null}]}'))));
select is(pg_temp.run(tests.fx('j2'), 'owner'), 'completed', 'vaciar los datos de una presentación');
select is(pg_temp.sizes(), 'PRO-1K=-/-,PRO-2K=2 kg/66', 'la otra conserva los suyos');
select tests.set_fx('j3', pg_temp.job(array['handle', 'sku', 'price', 'variant_servings'],
  jsonb_build_array(pg_temp.n(2, 'proteina',
    '{"variants":[{"row_number":2,"sku":"PRO-2K","price":95900,"servings_per_container":70}]}'))));
select is(pg_temp.run(tests.fx('j3'), 'owner'), 'completed', 'cambiar solo las porciones');
select is(pg_temp.sizes(), 'PRO-1K=-/-,PRO-2K=2 kg/70', 'el contenido, sin su columna, no cambia');

-- La base no confía en el plan: vuelve a validar.
select is(pg_temp.errors(pg_temp.job(array['handle', 'sku', 'variant_servings'],
  jsonb_build_array(pg_temp.n(2, 'proteina', '{"variants":[{"row_number":2,"sku":"PRO-2K","servings_per_container":0}]}')))),
  array['variant_servings: escribe un número entero entre 1 y 10000'], 'porciones fuera de rango: error de la fila');
select is(pg_temp.errors(pg_temp.job(array['handle', 'sku', 'variant_net_content'],
  jsonb_build_array(pg_temp.n(2, 'proteina',
    jsonb_build_object('variants', jsonb_build_array(jsonb_build_object('row_number', 2, 'sku', 'PRO-2K',
                                                                         'net_content', repeat('x', 101)))))))),
  array['variant_net_content: máximo 100 caracteres'], 'contenido demasiado largo: error de la fila');

select is((select string_agg((r ->> 'sku') || '=' || coalesce(r ->> 'net_content', '-') || '/'
                             || coalesce(r ->> 'servings_per_container', '-'), ',' order by r ->> 'sku')
             from jsonb_array_elements(public.exports_rows(tests.fx('store_a'), 'products') -> 'rows') r),
          'PRO-1K=-/-,PRO-2K=2 kg/70', 'la exportación trae contenido y porciones de cada presentación');
select throws_ok($$ select public.imports_create(tests.fx('store_a'), 'upsert', 'v.csv',
                     array['handle', 'variant_servings', 'variant_servings'], '{}',
                     '[{"row_number":2,"raw":{},"errors":[],"normalized":null}]') $$,
                 'P0001', 'validation_failed', 'columnas repetidas se rechazan');
select tests.logout();

select * from finish();
rollback;
