-- =============================================================================
-- Gestión de productos: foto por presentación (solo fotos listas del mismo
-- producto, permisos, aislamiento) y datos extra del listado del panel
-- (miniatura, marca, existencias solo con inventory.read).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

-- La auditoría no es legible por los usuarios: se consulta como dueño de la base.
create function pg_temp.price_audits(p_product uuid, p_before text) returns integer
language sql security definer as $$
  select count(*)::int from audit.audit_logs where action = 'product.prices_updated'
     and entity_id = p_product and before -> 'variants' -> 0 ->> 'price' = p_before
$$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'viewer', 'viewer');

select tests.login('owner');
select tests.set_fx('brand', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Atlas"}'));
select tests.set_fx('prod', (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object(
  'title', 'Proteína', 'brand_id', tests.fx('brand'), 'options', '[{"name":"Sabor","values":["Vainilla","Chocolate"]}]'::jsonb,
  'variants', '[{"price":69900,"sku":"PM-1","options":{"Sabor":"Vainilla"}},
                {"price":69900,"sku":"PM-2","options":{"Sabor":"Chocolate"}}]'::jsonb)) ->> 'id')::uuid);
select tests.set_fx('other', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Creatina","variants":[{"price":49900,"sku":"PM-3"}]}') ->> 'id')::uuid);
select public.inventory_adjust(tests.fx('store_a'), (select id from public.product_variants where sku = 'PM-1'),
                               'adjustment', 7, 'Inicial');
select tests.logout();

insert into public.media (store_id, owner_type, product_id, status, storage_path, position) values
  (tests.fx('store_a'), 'product', tests.fx('prod'), 'ready', 'a/p/vainilla.webp', 0),
  (tests.fx('store_a'), 'product', tests.fx('prod'), 'ready', 'a/p/chocolate.webp', 1),
  (tests.fx('store_a'), 'product', tests.fx('prod'), 'pending', 'a/p/subiendo.webp', 2),
  (tests.fx('store_a'), 'product', tests.fx('other'), 'ready', 'a/o/creatina.webp', 0);
select tests.set_fx('choco', (select id from public.media where storage_path = 'a/p/chocolate.webp'));
select tests.set_fx('pending', (select id from public.media where storage_path = 'a/p/subiendo.webp'));
select tests.set_fx('foreign', (select id from public.media where storage_path = 'a/o/creatina.webp'));
select tests.set_fx('v2', (select id from public.product_variants where sku = 'PM-2'));
select tests.set_fx('v1', (select id from public.product_variants where sku = 'PM-1'));

-- ============================================================================ Foto por presentación
select tests.login('owner');
select is(pg_temp.err(format($$select public.catalog_set_variant_image(%L, %L, %L)$$,
            tests.fx('store_a'), tests.fx('v2'), tests.fx('choco'))), 'ok', 'Chocolate usa su propia foto');
select is((select image_id from public.product_variants where id = tests.fx('v2')), tests.fx('choco'), 'queda guardada');
select lives_ok('set constraints all immediate',
  'sin validaciones diferidas pendientes: al confirmar no se ejecutan con los privilegios del usuario');
select is(pg_temp.err(format($$select public.catalog_set_variant_image(%L, %L, %L)$$,
            tests.fx('store_a'), tests.fx('v2'), tests.fx('pending'))), 'validation_failed/media_id',
          'una foto que aún se procesa no se asigna');
select is(pg_temp.err(format($$select public.catalog_set_variant_image(%L, %L, %L)$$,
            tests.fx('store_a'), tests.fx('v2'), tests.fx('foreign'))), 'validation_failed/media_id',
          'ni la foto de otro producto');
select is(pg_temp.err(format($$select public.catalog_set_variant_image(%L, %L, null)$$,
            tests.fx('store_a'), tests.fx('v2'))), 'ok', 'sin foto propia: vuelve a la del producto');
select is((select image_id from public.product_variants where id = tests.fx('v2')), null::uuid, 'se quita');

-- ============================================================================ Datos del listado
select is((public.catalog_list_extras(tests.fx('store_a'), array[tests.fx('prod')]) -> tests.fx('prod')::text) - 'variants',
          '{"image": "a/p/vainilla.webp", "brand": "Atlas", "available": 7, "sold_out_variants": 1}'::jsonb,
          'miniatura (la primera lista), marca, existencias y presentaciones agotadas');

-- ============================================================================ Filtros del listado
select is((select string_agg(title, ',' order by title) from public.catalog_search_products(tests.fx('store_a'),
            p_brand_id => tests.fx('brand'))), 'Proteína', 'por marca');
select is((select string_agg(title, ',' order by title) from public.catalog_search_products(tests.fx('store_a'),
            p_issue => 'agotados')), 'Creatina,Proteína', 'con alguna presentación agotada');
select is((select count(*)::int from public.catalog_search_products(tests.fx('store_a'), p_issue => 'sin_foto')), 0,
          'sin foto: ninguno (ambos tienen una lista)');
select throws_ok(format($$select * from public.catalog_search_products(%L, p_issue => 'raro')$$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'filtro desconocido: rechazado');

-- ============================================================================ Orden del listado
select is((select array_agg(title) from public.catalog_search_products(tests.fx('store_a'), p_sort => 'nombre')),
          array['Creatina', 'Proteína'], 'por nombre');
select is((select array_agg(title) from public.catalog_search_products(tests.fx('store_a'), p_sort => 'precio_desc')),
          array['Proteína', 'Creatina'], 'por precio, de mayor a menor');
select is((select array_agg(title) from public.catalog_search_products(tests.fx('store_a'), p_sort => 'precio_asc')),
          array['Creatina', 'Proteína'], 'por precio, de menor a mayor');
-- Paginación: la clave del cursor la da la propia función.
select is((select array_agg(n.title) from public.catalog_search_products(tests.fx('store_a'), p_sort => 'nombre', p_limit => 1) f,
                  public.catalog_search_products(tests.fx('store_a'), p_sort => 'nombre',
                    p_cursor => jsonb_build_object('k', f.sort_key, 'id', f.id)) n),
          array['Proteína'], 'la página siguiente por nombre empieza después del último');
select throws_ok(format($$select * from public.catalog_search_products(%L, p_sort => 'azar')$$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'orden desconocido: rechazado');
select throws_ok(format($$select * from public.catalog_search_products(%L, p_sort => 'precio_asc',
                          p_cursor => '{"k":"Creatina","id":"%s"}')$$, tests.fx('store_a'), tests.fx('other')),
  'P0001', 'validation_failed', 'un cursor de otro orden: rechazado, nunca una página mezclada');

-- ============================================================================ Cambio rápido de precios
select is(jsonb_array_length(public.catalog_list_extras(tests.fx('store_a'), array[tests.fx('prod')])
                             -> tests.fx('prod')::text -> 'variants'), 2, 'el listado trae las presentaciones');
select is(public.catalog_set_variant_prices(tests.fx('store_a'), tests.fx('prod'), jsonb_build_array(
            jsonb_build_object('id', tests.fx('v1'), 'price', 64900, 'compare_at_price', 69900),
            jsonb_build_object('id', tests.fx('v2'), 'price', 69900, 'compare_at_price', null))) ->> 'changed',
          '1', 'cambia solo lo que cambió');
select is((select array[price, compare_at_price] from public.product_variants where id = tests.fx('v1')),
          array[64900::bigint, 69900::bigint], 'precio y precio de comparación guardados');
select is((select array[min_price, max_price] from public.products where id = tests.fx('prod')),
          array[64900::bigint, 69900::bigint], 'el rango del producto se recalcula');
select is(pg_temp.price_audits(tests.fx('prod'), '69900'), 1,
          'se audita con el precio anterior');
select lives_ok('set constraints all immediate', 'las validaciones diferidas pasan dentro de la función');
select is(pg_temp.err(format($$select public.catalog_set_variant_prices(%L, %L, '[{"id":"%s","price":500,"compare_at_price":500}]')$$,
            tests.fx('store_a'), tests.fx('prod'), tests.fx('v1'))), 'validation_failed/compare_at_price',
          'la comparación debe ser mayor que el precio');
select is(pg_temp.err(format($$select public.catalog_set_variant_prices(%L, %L, '[{"id":"%s","price":-1}]')$$,
            tests.fx('store_a'), tests.fx('prod'), tests.fx('v1'))), 'validation_failed/prices',
          'precio negativo o no entero: rechazado');
select is(pg_temp.err(format($$select public.catalog_set_variant_prices(%L, %L, '[{"id":"%s","price":100}]')$$,
            tests.fx('store_a'), tests.fx('other'), tests.fx('v1'))), 'not_found/variant',
          'una presentación de otro producto: rechazada');
select tests.logout();

select tests.login('viewer');
select is(pg_temp.err(format($$select public.catalog_set_variant_image(%L, %L, %L)$$,
            tests.fx('store_a'), tests.fx('v2'), tests.fx('choco'))), 'forbidden', 'sin products.update no se cambia');
select tests.logout();

select tests.login('owner_b');
select is(pg_temp.err(format($$select public.catalog_set_variant_image(%L, %L, %L)$$,
            tests.fx('store_b'), tests.fx('v2'), tests.fx('choco'))), 'not_found/variant',
          'otra tienda no toca la presentación de esta');
select is(pg_temp.err(format($$select public.catalog_set_variant_prices(%L, %L, '[{"id":"%s","price":1}]')$$,
            tests.fx('store_a'), tests.fx('prod'), tests.fx('v1'))), 'forbidden', 'otra tienda no cambia precios de esta');
select is(pg_temp.err(format($$select public.catalog_list_extras(%L, %L)$$, tests.fx('store_a'),
            array[tests.fx('prod')])), 'forbidden', 'ni ve sus datos');
select is(public.catalog_list_extras(tests.fx('store_b'), array[tests.fx('prod')]), '{}'::jsonb,
          'y pedirlos con su tienda no devuelve nada de A');
select tests.logout();

select * from finish();
rollback;
