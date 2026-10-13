-- =============================================================================
-- Fase R · R-T05 — La ficha y los atributos en el CSV de productos. `|` y `;`
-- separan celdas y renglones de la tabla nutrimental compacta: no se aceptan
-- dentro de ella (lo exportado se vuelve a importar igual).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '') || coalesce('/' || nullif(v_hint, ''), '');
end $$;

select is(pg_temp.err($$select app.regulatory_normalize('dietary_supplement',
            '{"nutrition":[{"name":"Omega 3|EPA","amount":"1000"}]}')$$),
          'validation_failed/regulatory/nutrition', '"|" no va dentro de la tabla nutrimental');
select is(pg_temp.err($$select app.regulatory_normalize('dietary_supplement',
            '{"nutrition":[{"name":"Omega 3","amount":"1000","unit":"mg; EPA"}]}')$$),
          'validation_failed/regulatory/nutrition', 'ni ";"');
select is(app.regulatory_normalize('dietary_supplement',
            '{"ingredients":"Aceite de pescado; gelatina | glicerina","nutrition":[{"name":"Omega 3","amount":"1000","unit":"mg"}]}'),
          '{"ingredients":"Aceite de pescado; gelatina | glicerina","nutrition":[{"name":"Omega 3","amount":"1000","unit":"mg"}]}'::jsonb,
          'los textos de la ficha sí pueden llevarlos (van en su propia columna)');


-- -----------------------------------------------------------------------------
-- Importación y exportación de la ficha y los atributos
-- -----------------------------------------------------------------------------
select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');

create function pg_temp.n(p_row integer, p_handle text, p_normalized jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle), 'errors', '[]'::jsonb,
                            'normalized', jsonb_build_object('handle', p_handle, 'product', '{}'::jsonb, 'option_names', null)
                                          || p_normalized)
$$;
create function pg_temp.job(p_store text, p_columns text[], p_rows jsonb) returns uuid language sql as $$
  select public.imports_create(tests.fx('store_' || p_store), 'upsert', 'r.csv', p_columns, '{}', p_rows)
$$;
create function pg_temp.errors(p_job uuid) returns text[] language sql as $$
  select coalesce(array_agg(e order by r.row_number), '{}') from public.import_job_rows r,
         jsonb_array_elements_text(r.errors) e where r.import_job_id = p_job
$$;
create function pg_temp.run(p_job uuid) returns text language plpgsql as $$
declare v jsonb;
begin
  perform public.imports_commit(tests.fx('store_a'), p_job);
  perform tests.as_role('system_worker');
  v := system.import_commit(p_job);
  perform tests.logout();
  perform tests.login('owner');
  return coalesce(v ->> 'status', '') || coalesce(':' || (select error from public.import_jobs where id = p_job), '');
end $$;

select tests.login('owner');
select public.compliance_set_store_category(tests.fx('store_a'), 'dietary_supplement', true);
select public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Objetivo","values":[{"label":"Energía"},{"label":"Corazón"}]}');

select tests.set_fx('j1', pg_temp.job('a',
  array['handle', 'title', 'price', 'regulatory_category', 'regulatory_ingredients', 'regulatory_nutrition', 'attributes'],
  jsonb_build_array(pg_temp.n(2, 'omega-3', '{"product":{"title":"Omega 3"},
     "variants":[{"row_number":2,"price":29900}],
     "regulatory":{"category":"dietary_supplement","data":{"ingredients":"Aceite de pescado",
                   "nutrition":[{"name":"Omega 3","amount":"1000","unit":"mg"}]}},
     "attributes":{"objetivo":["energia","corazon"]}}'))));
select is(pg_temp.errors(tests.fx('j1')), '{}'::text[], 'la ficha y los atributos se validan sin errores');
select is(pg_temp.run(tests.fx('j1')), 'completed', 'y se aplican al confirmar');
select is((select i.category_key || ' ' || (i.data ->> 'ingredients') from public.product_regulatory_info i
            join public.products p on p.id = i.product_id where p.slug = 'omega-3'),
          'dietary_supplement Aceite de pescado', 'el producto queda clasificado con su ficha');
select is((select array_agg(av.key order by av.key) from public.product_attribute_values pav
            join public.attribute_values av on av.id = pav.value_id
            join public.products p on p.id = pav.product_id where p.slug = 'omega-3'),
          array['corazon', 'energia'], 'con sus atributos');

-- Columna ausente = sin cambios; celda vacía = se borra.
select tests.set_fx('j2', pg_temp.job('a', array['handle', 'regulatory_category', 'regulatory_usage', 'regulatory_ingredients'],
  jsonb_build_array(pg_temp.n(2, 'omega-3', '{"variants":[{"row_number":2}],
     "regulatory":{"category":"dietary_supplement","data":{"usage":"Una cápsula al día","ingredients":null}}}'))));
select is(pg_temp.run(tests.fx('j2')), 'completed', 'actualizar solo parte de la ficha');
select is((select i.data from public.product_regulatory_info i join public.products p on p.id = i.product_id
            where p.slug = 'omega-3'),
          '{"usage":"Una cápsula al día","nutrition":[{"name":"Omega 3","amount":"1000","unit":"mg"}]}'::jsonb,
          'se conserva la tabla (columna ausente), se agrega el modo de uso y se borran los ingredientes');

select is(pg_temp.errors(pg_temp.job('a', array['handle', 'regulatory_category', 'regulatory_servings_per_container', 'attributes'],
  jsonb_build_array(pg_temp.n(2, 'omega-3', '{"variants":[{"row_number":2}],
     "regulatory":{"category":"dietary_supplement","data":{"servings_per_container":0}},
     "attributes":{"objetivo":["sueno"]}}')))),
  array['regulatory_servings_per_container: valor no válido',
        'attributes: no existe «objetivo:sueno» (créalo en Productos → Atributos)'],
  'errores por fila: dato de la ficha y valor de atributo inexistente');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.errors(public.imports_create(tests.fx('store_b'), 'upsert', 'b.csv', array['handle', 'title', 'price', 'regulatory_category'],
  '{}', jsonb_build_array(pg_temp.n(2, 'x', '{"product":{"title":"X"},"variants":[{"row_number":2,"price":100}],
     "regulatory":{"category":"dietary_supplement","data":{}}}')))),
  array['regulatory_category: tu tienda no declaró esa categoría (Ajustes → Cumplimiento)'],
  'una tienda que no declaró la categoría no la puede usar');
select is(pg_temp.errors(public.imports_create(tests.fx('store_b'), 'upsert', 'b.csv', array['handle', 'title', 'price', 'attributes'],
  '{}', jsonb_build_array(pg_temp.n(2, 'x', '{"product":{"title":"X"},"variants":[{"row_number":2,"price":100}],
     "attributes":{"objetivo":["energia"]}}')))),
  array['attributes: no existe «objetivo:energia» (créalo en Productos → Atributos)'],
  'ni los atributos de otra tienda');
select tests.logout();

-- Exportación.
select tests.login('owner');
select is((select r -> 'regulatory' ->> 'category' from jsonb_array_elements(
             public.exports_rows(tests.fx('store_a'), 'products') -> 'rows') r where r ->> 'handle' = 'omega-3'),
          'dietary_supplement', 'la exportación lleva la ficha');
select is((select r -> 'attributes' from jsonb_array_elements(
             public.exports_rows(tests.fx('store_a'), 'products') -> 'rows') r where r ->> 'handle' = 'omega-3'),
          '[{"key":"objetivo","values":["energia","corazon"]}]'::jsonb, 'y los atributos por clave, en orden');
select is((select jsonb_build_object('r', x -> 'regulated', 'a', x -> 'has_attributes')
             from public.exports_rows(tests.fx('store_a'), 'products') x),
          '{"r":true,"a":true}'::jsonb, 'con las columnas opcionales para esta tienda');
select tests.logout();
select tests.login('owner_b');
select is((select jsonb_build_object('r', x -> 'regulated', 'a', x -> 'has_attributes')
             from public.exports_rows(tests.fx('store_b'), 'products') x),
          '{"r":false,"a":false}'::jsonb, 'y sin ellas para una tienda que no las usa');
select tests.logout();

select * from finish();
rollback;
