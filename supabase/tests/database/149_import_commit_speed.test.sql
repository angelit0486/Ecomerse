-- =============================================================================
-- 20261117000100: aplicar una importación más rápido sin cambiar qué hace.
--  * El texto de búsqueda (search_vector, search_lexicon) y los precios mínimo y
--    máximo quedan como si se hubieran calculado fila por fila.
--  * La marca app.import_defer_search no sobrevive a la confirmación (ni a una
--    confirmación que falla) y solo vale para el txid que la puso.
--  * Los productos con alguna fila con error se siguen excluyendo enteros.
--  * Un lote de más de 100 productos nuevos (ANALYZE dentro de la transacción)
--    se aplica igual.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');

create function pg_temp.cols() returns text[] language sql as $$
  select array['handle', 'title', 'sku', 'price', 'option1_name', 'option1_value', 'inventory_quantity', 'brand',
               'categories', 'status']
$$;
-- Un producto con 3 tallas: la primera fila lleva el producto normalizado, las otras dos solo su texto.
create function pg_temp.product(p_first integer, p_handle text, p_sku text, p_price integer, p_errors jsonb default '[]')
returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('row_number', p_first, 'errors', '[]'::jsonb,
      'raw', jsonb_build_object('handle', p_handle, 'sku', p_sku || '-CH'),
      'normalized', jsonb_build_object('handle', p_handle, 'status', 'draft', 'brand', 'Marca Norte',
        'categories', '["Ropa"]'::jsonb, 'product', jsonb_build_object('title', initcap(p_handle)),
        'option_names', '["Talla"]'::jsonb,
        'variants', jsonb_build_array(
          jsonb_build_object('row_number', p_first, 'sku', p_sku || '-CH', 'price', p_price, 'options', '{"Talla":"CH"}'::jsonb, 'quantity', 3),
          jsonb_build_object('row_number', p_first + 1, 'sku', p_sku || '-M', 'price', p_price + 100, 'options', '{"Talla":"M"}'::jsonb, 'quantity', 2),
          jsonb_build_object('row_number', p_first + 2, 'sku', p_sku || '-G', 'price', p_price + 200, 'options', '{"Talla":"G"}'::jsonb, 'quantity', 1)))),
    jsonb_build_object('row_number', p_first + 1, 'errors', '[]'::jsonb, 'normalized', null,
      'raw', jsonb_build_object('handle', p_handle, 'sku', p_sku || '-M')),
    jsonb_build_object('row_number', p_first + 2, 'errors', p_errors, 'normalized', null,
      'raw', jsonb_build_object('handle', p_handle, 'sku', p_sku || '-G')))
$$;
create function pg_temp.work(p_job uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_role('system_worker');
  v := system.import_commit(p_job);
  perform tests.logout();
  return v;
end $$;
-- Sin depender del orden: string_agg del texto de búsqueda no lleva ORDER BY y
-- el plan (que cambia tras ANALYZE) puede listar tallas o SKU en otro orden.
create function pg_temp.lexemes(p tsvector) returns text[] language sql immutable as $$
  select array_agg(u.lexeme || ':' || array_to_string(u.weights, '') order by u.lexeme) from unnest(p) u
$$;
create function pg_temp.words(p text) returns text[] language sql immutable as $$
  select array_agg(w order by w) from regexp_split_to_table(p, '\s+') w
$$;
grant execute on function pg_temp.lexemes(tsvector), pg_temp.words(text) to public;
create function pg_temp.stale(p_store uuid) returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer from public.products p
   where p.store_id = p_store and p.deleted_at is null
     and (pg_temp.lexemes(p.search_vector) is distinct from pg_temp.lexemes(app.product_search_vector(p))
          or pg_temp.words(p.search_lexicon) is distinct from pg_temp.words(app.product_lexicon_of(p))
          or p.min_price is distinct from (select min(v.price) from public.product_variants v
                                            where v.product_id = p.id and v.status = 'active' and v.deleted_at is null)
          or p.max_price is distinct from (select max(v.price) from public.product_variants v
                                            where v.product_id = p.id and v.status = 'active' and v.deleted_at is null))
$$;
create function pg_temp.flag() returns text language sql as $$
  select coalesce(current_setting('app.import_defer_search', true), '')
$$;

select tests.login('owner');
select public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Ropa"}');

-- ------------------------------------------------ 1. Alta con tallas, marca y categoría
select tests.set_fx('job1', public.imports_create(tests.fx('store_a'), 'create_only', 'ropa.csv', pg_temp.cols(), '{}',
  pg_temp.product(2, 'playera-uno', 'PU', 24900)
  || pg_temp.product(5, 'playera-dos', 'PD', 19900)
  || pg_temp.product(8, 'playera-tres', 'PT', 9900)
  || pg_temp.product(11, 'playera-mala', 'PM', 9900, '[{"row": 13, "field": "price", "message": "precio no válido"}]'::jsonb)));
select is((select (totals ->> 'errors')::int from public.import_jobs where id = tests.fx('job1')), 1,
          'la vista previa cuenta la fila con error');
select is(public.imports_commit(tests.fx('store_a'), tests.fx('job1'), true) ->> 'status', 'committing',
          'se confirma saltando las filas con error');
select tests.logout();
select is(pg_temp.work(tests.fx('job1')) - 'categories_created',
          '{"status": "completed", "created": 3, "updated": 0}'::jsonb, 'crea los 3 productos sin error');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug = 'playera-mala'), 0,
          'un producto con una fila con error se excluye entero (también su fila buena)');
select is((select count(*)::int from public.product_variants v join public.products p on p.id = v.product_id
            where p.store_id = tests.fx('store_a')), 9, 'con sus 9 variantes');
select is(pg_temp.stale(tests.fx('store_a')), 0,
          'texto de búsqueda (mismas palabras y pesos) y precios mínimo y máximo iguales a recalcularlos ahora');
select ok((select search_lexicon ~ 'playera-uno' and search_lexicon ~ 'marca norte' and search_lexicon ~ 'ropa'
                  and search_lexicon ~ '\mch\M' and search_lexicon ~ '\mg\M'
             from public.products where store_id = tests.fx('store_a') and slug = 'playera-uno'),
          'el texto de búsqueda incluye título, marca, categoría y tallas');
select ok((select search_vector @@ to_tsquery('spanish', 'norte') from public.products
            where store_id = tests.fx('store_a') and slug = 'playera-uno'), 'y el vector encuentra la marca');
select is((select array[min_price, max_price] from public.products where store_id = tests.fx('store_a') and slug = 'playera-dos'),
          array[19900, 20100]::bigint[], 'precio mínimo y máximo de sus tallas');
select is(pg_temp.flag(), '', 'la marca app.import_defer_search no sobrevive a la confirmación');

-- ------------------------------------------------ 2. Actualizar: el texto refleja el SKU nuevo
select tests.login('owner');
select tests.set_fx('job2', public.imports_create(tests.fx('store_a'), 'upsert', 'cambio.csv', pg_temp.cols(), '{}',
  pg_temp.product(2, 'playera-uno', 'ZAFIRO', 30000)));
select public.imports_commit(tests.fx('store_a'), tests.fx('job2'));
select tests.logout();
select is(pg_temp.work(tests.fx('job2')) ->> 'status', 'completed', 'la actualización se aplica');
select is(pg_temp.stale(tests.fx('store_a')), 0, 'el texto de búsqueda queda al día tras actualizar');
select ok((select search_vector @@ to_tsquery('spanish', 'zafiro') from public.products
            where store_id = tests.fx('store_a') and slug = 'playera-uno'), 'el vector encuentra el SKU nuevo');
select is((select min_price from public.products where store_id = tests.fx('store_a') and slug = 'playera-uno'),
          30000::bigint, 'con el precio nuevo');

-- ------------------------------------------------ 3. Si la confirmación falla, no queda nada (ni la marca)
select tests.login('owner');
select tests.set_fx('job3', public.imports_create(tests.fx('store_a'), 'create_only', 'choque.csv', pg_temp.cols(), '{}',
  pg_temp.product(2, 'gorra-uno', 'GU', 15000) || pg_temp.product(5, 'gorra-dos', 'GD', 15000)));
select public.imports_commit(tests.fx('store_a'), tests.fx('job3'));
-- Entre la vista previa y la aplicación, alguien usa el SKU de la última fila.
select public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Intrusa","slug":"intrusa","variants":[{"price":100,"sku":"GD-G"}]}');
select tests.logout();
select is(pg_temp.work(tests.fx('job3')) ->> 'status', 'failed', 'la confirmación falla en la última fila');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug like 'gorra-%'), 0,
          'todo o nada: no queda ninguna gorra');
select is(pg_temp.flag(), '', 'y la marca tampoco queda puesta');

-- ------------------------------------------------ 4. La marca solo vale para su propio txid
-- Con el txid de esta transacción, products_derive deja el texto para después…
select set_config('app.import_defer_search', pg_catalog.txid_current()::text, true);
update public.products set title = 'Intrusa Renombrada' where store_id = tests.fx('store_a') and slug = 'intrusa';
select is(pg_temp.stale(tests.fx('store_a')), 1, 'con la marca de su txid el texto se deja para el final');
-- …con cualquier otro valor lo recalcula como siempre.
select set_config('app.import_defer_search', '1', true);
update public.products set title = 'Intrusa Otra Vez' where store_id = tests.fx('store_a') and slug = 'intrusa';
select set_config('app.import_defer_search', '', true);
select is(pg_temp.stale(tests.fx('store_a')), 0, 'con la marca de otro txid el texto se recalcula como siempre');

-- ------------------------------------------------ 5. Lote de 120 productos nuevos (ANALYZE en la transacción)
select tests.login('owner');
select tests.set_fx('job4', public.imports_create(tests.fx('store_a'), 'create_only', 'grande.csv', pg_temp.cols(), '{}',
  (select jsonb_agg(r order by (r ->> 'row_number')::int)
     from generate_series(1, 120) g, jsonb_array_elements(pg_temp.product(2 + (g - 1) * 3, 'calcetin-' || g, 'CA' || g, 5000)) r)));
select public.imports_commit(tests.fx('store_a'), tests.fx('job4'));
select tests.logout();
select is(pg_temp.work(tests.fx('job4')) - 'categories_created',
          '{"status": "completed", "created": 120, "updated": 0}'::jsonb, '120 productos nuevos se aplican');
select is(pg_temp.stale(tests.fx('store_a')), 0, 'todos con su texto de búsqueda y precios al día');

select * from finish();
rollback;
