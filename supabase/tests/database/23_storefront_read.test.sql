-- =============================================================================
-- Fase 5 · Lecturas públicas (F5-T02), ejecutadas como storefront_gateway.
-- Nada de borradores, costos ni cantidades; nada de otra tienda.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now() where id in (tests.fx('store_a'), tests.fx('store_b'));

-- Ejecuta SQL como storefront_gateway y devuelve su resultado jsonb.
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

select tests.login('owner');
select tests.set_fx('cat', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Ropa"}'));
select tests.set_fx('cat_hidden', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Oculta","is_visible":false}'));
select tests.set_fx('brand', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Pruva"}'));
select tests.set_fx('playera', (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object(
  'title', 'Playera de algodón', 'brand_id', tests.fx('brand'),
  'categories', jsonb_build_array(jsonb_build_object('id', tests.fx('cat'), 'is_primary', true)),
  'options', jsonb_build_array(jsonb_build_object('name', 'Talla', 'values', jsonb_build_array('CH', 'M', 'G'))),
  'variants', jsonb_build_array(
    jsonb_build_object('options', jsonb_build_object('Talla', 'CH'), 'price', 19900, 'sku', 'PLY-CH', 'cost', 7000),
    jsonb_build_object('options', jsonb_build_object('Talla', 'M'), 'price', 19900, 'sku', 'PLY-M', 'cost', 7000,
                       'inventory_policy', 'continue'),
    jsonb_build_object('options', jsonb_build_object('Talla', 'G'), 'price', 21900, 'sku', 'PLY-G', 'status', 'inactive'))
  )) ->> 'id')::uuid);
select public.inventory_adjust(tests.fx('store_a'), (select id from public.product_variants where sku = 'PLY-CH'),
  'adjustment', 3, 'Inicial');
select public.inventory_set_threshold(tests.fx('store_a'), (select id from public.product_variants where sku = 'PLY-CH'), 5);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('playera'));
select tests.set_fx('draft', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Borrador secreto","variants":[{"price":100,"sku":"DRAFT-1"}]}') ->> 'id')::uuid);
select tests.set_fx('gorra', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Gorra agotada","variants":[{"price":9900,"sku":"GOR-1"}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('gorra'));
select tests.logout();
-- Producto de B que no debe aparecer nunca en A.
select tests.login('owner_b');
select public.catalog_publish_product(tests.fx('store_b'), (public.catalog_upsert_product(tests.fx('store_b'),
  '{"title":"Playera de B","variants":[{"price":100}]}') ->> 'id')::uuid);
select tests.logout();
update public.store_pages set is_published = true, published_at = now()
 where store_id = tests.fx('store_a') and type = 'policy_shipping';

-- ============================================================================ Grants
select is(tests.sqlstate_as('storefront_gateway', format('select storefront.get_home(%L)', tests.fx('store_a'))), 'ok',
  'storefront_gateway ejecuta las lecturas públicas');
select is(tests.sqlstate_as('authenticated', format('select storefront.get_home(%L)', tests.fx('store_a'))), '42501',
  'authenticated no');
select is(tests.sqlstate_as('anon', format('select storefront.get_home(%L)', tests.fx('store_a'))), '42501', 'anon no');
select is(tests.sqlstate_as('storefront_gateway', 'select count(*) from public.products'), '42501',
  'el gateway no lee tablas');

-- ============================================================================ Listado
select is(jsonb_array_length(tests.gw(format('select storefront.list_products(%L) -> ''items''', tests.fx('store_a')))), 2,
  'solo los productos publicados de A (ni borradores ni los de B)');
select ok(tests.gw(format('select storefront.list_products(%L)', tests.fx('store_a')))::text !~ 'Borrador secreto',
  'el borrador no aparece');
select is(tests.gw(format('select storefront.list_products(%L, ''ropa'') -> ''items'' -> 0 ->> ''slug''',
  tests.fx('store_a'))) #>> '{}', 'playera-de-algodon', 'filtro por categoría');
select is(jsonb_array_length(tests.gw(format('select storefront.list_products(%L, ''oculta'') -> ''items''',
  tests.fx('store_a')))), 0, 'una categoría oculta no lista productos');
select is(tests.gw(format('select storefront.list_products(%L, null, ''pruva'') -> ''items'' -> 0 ->> ''title''',
  tests.fx('store_a'))) #>> '{}', 'Playera de algodón', 'filtro por marca');
select is(tests.gw(format('select storefront.list_products(%L, null, null, ''algodon'') -> ''items'' -> 0 ->> ''slug''',
  tests.fx('store_a'))) #>> '{}', 'playera-de-algodon', 'búsqueda sin acentos');
select is(tests.gw(format('select storefront.list_products(%L, null, null, ''ply-m'') -> ''items'' -> 0 ->> ''slug''',
  tests.fx('store_a'))) #>> '{}', 'playera-de-algodon', 'búsqueda por SKU exacto');
select ok(tests.gw(format('select storefront.list_products(%L, null, null, ''Playera de B'')',
  tests.fx('store_a')))::text !~ 'Playera de B', 'la búsqueda en A nunca devuelve productos de B');
select is(tests.gw(format('select storefront.list_products(%L, null, null, null, ''price_asc'') -> ''items'' -> 0 ->> ''slug''',
  tests.fx('store_a'))) #>> '{}', 'gorra-agotada', 'orden por precio ascendente');
select is(jsonb_array_length(tests.gw(format(
  'select storefront.list_products(%L, null, null, null, null, null, null, true) -> ''items''', tests.fx('store_a')))), 1,
  'solo disponibles: se omite el agotado');
select is(tests.gw(format('select storefront.list_products(%L, null, null, null, ''price_asc'', null, null, false, null, 1) -> ''items'' -> 0 ->> ''slug''',
  tests.fx('store_a'))) #>> '{}', 'gorra-agotada', 'página 1 de 1 producto');
select is(tests.gw(format('select storefront.list_products(%L, null, null, null, ''price_asc'', null, null, false,
  storefront.list_products(%L, null, null, null, ''price_asc'', null, null, false, null, 1) -> ''next_cursor'', 1)
  -> ''items'' -> 0 ->> ''slug''', tests.fx('store_a'), tests.fx('store_a'))) #>> '{}', 'playera-de-algodon',
  'el cursor lleva a la página 2 sin repetir');

-- ============================================================================ Producto
select is(tests.gw(format('select storefront.get_product(%L, ''borrador-secreto'')', tests.fx('store_a'))), null,
  'la ficha de un borrador no existe');
select is(tests.gw(format('select storefront.get_product(%L, ''playera-de-algodon'')', tests.fx('store_b'))), null,
  'la ficha de A no existe en B');
select is(jsonb_array_length(tests.gw(format('select storefront.get_product(%L, ''playera-de-algodon'') -> ''variants''',
  tests.fx('store_a')))), 2, 'solo variantes activas');
select is(tests.gw(format('select jsonb_object_agg(v ->> ''sku'', v ->> ''availability'')
  from jsonb_array_elements(storefront.get_product(%L, ''playera-de-algodon'') -> ''variants'') v', tests.fx('store_a'))),
  '{"PLY-CH": "low_stock", "PLY-M": "backorder"}'::jsonb, 'disponibilidad como estado (stock bajo, preventa)');
select ok(tests.gw(format('select storefront.get_product(%L, ''playera-de-algodon'')', tests.fx('store_a')))::text
  !~ '"(cost|on_hand|reserved|available|low_stock_threshold)"', 'sin costos ni cantidades');
select is(tests.gw(format('select storefront.get_product(%L, ''playera-de-algodon'') -> ''breadcrumb'' -> 0 ->> ''path''',
  tests.fx('store_a'))) #>> '{}', 'ropa', 'migas por la categoría principal');
select is(tests.gw(format('select storefront.get_product(%L, ''gorra-agotada'') ->> ''availability''', tests.fx('store_a')))
  #>> '{}', 'out_of_stock', 'agotado');

-- ============================================================================ Categoría, marca, páginas, menús, sitemap
select is(tests.gw(format('select storefront.get_category(%L, ''oculta'')', tests.fx('store_a'))), null,
  'una categoría oculta no existe');
select is(tests.gw(format('select storefront.get_brand(%L, ''pruva'') ->> ''name''', tests.fx('store_a'))) #>> '{}', 'Pruva',
  'marca');
select is(tests.gw(format('select storefront.get_page(%L, ''aviso-de-privacidad'')', tests.fx('store_a'))), null,
  'una política en borrador no se publica');
select is(tests.gw(format('select storefront.get_page(%L, ''envios'') ->> ''title''', tests.fx('store_a'))) #>> '{}', 'Envíos',
  'una política publicada sí');
select is(tests.gw(format('select storefront.get_menus(%L) -> ''main'' -> 0 ->> ''href''', tests.fx('store_a'))) #>> '{}',
  '/categoria/ropa', 'menú principal vacío: categorías de primer nivel');
select is((select array_agg(path order by path) from storefront.sitemap_entries(tests.fx('store_a'))),
  array['/categoria/ropa', '/marca/pruva', '/paginas/envios', '/productos/gorra-agotada', '/productos/playera-de-algodon'],
  'sitemap: solo lo publicado de A');
update public.stores set status = 'suspended' where id = tests.fx('store_a');
select is(tests.gw(format('select storefront.list_products(%L) -> ''items''', tests.fx('store_a'))), '[]'::jsonb,
  'una tienda suspendida no expone su catálogo');

select * from finish();
rollback;
