-- =============================================================================
-- Gate F5 · regresiones de la revisión adversarial (PHASE-05-REPORT §5).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

create function tests.gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'storefront_gateway', true);
  execute format('select to_jsonb(t.x) from (%s) t(x)', p_sql) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
grant execute on all functions in schema tests to authenticated, storefront_gateway;

-- ============================================================================ Ancestro intermedio oculto
select tests.login('owner');
select tests.set_fx('ropa', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Ropa"}'));
select tests.set_fx('oculta', public.catalog_upsert_category(tests.fx('store_a'),
  jsonb_build_object('name', 'Oculta', 'parent_id', tests.fx('ropa'), 'is_visible', false)));
select tests.set_fx('x', public.catalog_upsert_category(tests.fx('store_a'),
  jsonb_build_object('name', 'Interior', 'parent_id', tests.fx('oculta'))));
select tests.set_fx('p', (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object(
  'title', 'Camisa escondida',
  'categories', jsonb_build_array(jsonb_build_object('id', tests.fx('x'), 'is_primary', true)),
  'variants', jsonb_build_array(jsonb_build_object('price', 10000, 'sku', 'ESC-1')))) ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('p'));
select lives_ok(format($$ select public.menu_set_items(%L, 'main', jsonb_build_array(
  jsonb_build_object('label', 'Interior', 'link_type', 'category', 'target_id', %L))) $$,
  tests.fx('store_a'), tests.fx('x')), 'el menú acepta la categoría (existe en la tienda)');
select tests.logout();

select is(jsonb_array_length(tests.gw(format('select storefront.list_products(%L, ''ropa'') -> ''items''',
  tests.fx('store_a')))), 0, 'la categoría visible no muestra productos de una subcategoría bajo un ancestro oculto');
select is(tests.gw(format('select storefront.get_product(%L, ''camisa-escondida'') -> ''breadcrumb''',
  tests.fx('store_a'))), '[]'::jsonb, 'sin migas hacia una categoría no pública');
select ok(tests.gw(format('select storefront.get_menus(%L) -> ''main''', tests.fx('store_a')))::text !~ 'Interior',
  'el menú omite el enlace a una categoría no pública');
select ok(tests.gw(format('select array_agg(path) from storefront.sitemap_entries(%L)', tests.fx('store_a')))::text
  !~ 'ropa/oculta', 'el sitemap no lista categorías bajo un ancestro oculto');
select is(tests.gw(format('select storefront.get_category(%L, ''ropa/oculta/interior'')', tests.fx('store_a'))),
  null, 'ni get_category');

-- ============================================================================ Path reutilizado tras borrar
select tests.login('owner');
select tests.set_fx('moda_old', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Moda"}'));
select public.catalog_delete_category(tests.fx('store_a'), tests.fx('moda_old'));
select tests.set_fx('moda', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Moda"}'));
select tests.set_fx('vestidos', public.catalog_upsert_category(tests.fx('store_a'),
  jsonb_build_object('name', 'Vestidos', 'parent_id', tests.fx('moda'))));
select tests.logout();
select isnt(tests.gw(format('select storefront.get_category(%L, ''moda/vestidos'')', tests.fx('store_a'))), null,
  'un ancestro borrado con el mismo path no oculta a la categoría viva');

-- ============================================================================ Dominio canónico
update public.store_domains set is_primary = false where store_id = tests.fx('store_a');
select is(tests.gw(format('select storefront.get_store_public(%L) ->> ''primary_hostname''', tests.fx('store_a'))),
  to_jsonb('tienda-a.tiendas.test'::text), 'sin primario activo: el subdominio de plataforma');

-- ============================================================================ Entradas inválidas por la Data API
select tests.login('owner');
select tests.set_fx('pg', (public.content_upsert_page(tests.fx('store_a'),
  '{"title":"Nosotros","body_html":"<p>Hola</p>"}') ->> 'id')::uuid);
select public.content_set_page_published(tests.fx('store_a'), tests.fx('pg'), true);
select throws_ok(format($$ select public.content_upsert_page(%L, '{"id":"%s","title":"Nosotros","body_html":"<p> </p>"}') $$,
  tests.fx('store_a'), tests.fx('pg')), 'P0001', 'validation_failed', 'una página publicada no se vacía');
select lives_ok(format($$ select public.content_upsert_page(%L, '{"id":"%s","title":"Nosotros","body_html":"<p>Otro</p>"}') $$,
  tests.fx('store_a'), tests.fx('pg')), 'sí se edita con contenido');
select throws_ok(format($$ select public.content_upsert_page(%L, '{"id":"no-es-uuid","title":"X"}') $$,
  tests.fx('store_a')), 'P0001', 'validation_failed', 'id inválido → validation_failed');
select throws_ok(format($$ select public.menu_set_items(%L, 'main',
  '[{"label":"X","link_type":"category","target_id":"no-es-uuid"}]') $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'target_id inválido → validation_failed');
select throws_ok(format($$ select public.menu_set_items(%L, 'main',
  '[{"label":"X","link_type":"home","children":"no"}]') $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'children que no es arreglo → validation_failed');
select throws_ok(format($$ select public.menu_set_items(%L, 'main', '[1]') $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'ítem que no es objeto → validation_failed');
select is((select count(*)::int from public.menu_items where store_id = tests.fx('store_a')), 1,
  'un payload rechazado no toca el menú guardado');
select tests.logout();

-- ============================================================================ Orden por precio
select tests.login('owner');
select tests.set_fx('cara', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Cara","variants":[{"price":90000,"sku":"CARA-1"}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('cara'));
select tests.logout();
select is(tests.gw(format('select storefront.list_products(%L, p_sort => ''price_asc'') -> ''items'' -> 0 ->> ''title''',
  tests.fx('store_a'))), to_jsonb('Camisa escondida'::text), 'precio ascendente: el más barato primero');

select * from finish();
rollback;
