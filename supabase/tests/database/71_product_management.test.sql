-- =============================================================================
-- Gestión de productos: foto por presentación (solo fotos listas del mismo
-- producto, permisos, aislamiento) y datos extra del listado del panel
-- (miniatura, marca, existencias solo con inventory.read).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
select is(public.catalog_list_extras(tests.fx('store_a'), array[tests.fx('prod')]) -> tests.fx('prod')::text,
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
select tests.logout();

select tests.login('viewer');
select is(pg_temp.err(format($$select public.catalog_set_variant_image(%L, %L, %L)$$,
            tests.fx('store_a'), tests.fx('v2'), tests.fx('choco'))), 'forbidden', 'sin products.update no se cambia');
select tests.logout();

select tests.login('owner_b');
select is(pg_temp.err(format($$select public.catalog_set_variant_image(%L, %L, %L)$$,
            tests.fx('store_b'), tests.fx('v2'), tests.fx('choco'))), 'not_found/variant',
          'otra tienda no toca la presentación de esta');
select is(pg_temp.err(format($$select public.catalog_list_extras(%L, %L)$$, tests.fx('store_a'),
            array[tests.fx('prod')])), 'forbidden', 'ni ve sus datos');
select is(public.catalog_list_extras(tests.fx('store_b'), array[tests.fx('prod')]), '{}'::jsonb,
          'y pedirlos con su tienda no devuelve nada de A');
select tests.logout();

select * from finish();
rollback;
