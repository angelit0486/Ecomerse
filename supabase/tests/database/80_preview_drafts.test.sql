-- =============================================================================
-- ADR-032 · Vista previa privada de los borradores. Con la marca transaccional
-- `pruva.preview_store` de UNA tienda, su catálogo incluye sus borradores
-- marcados `unpublished`; sin la marca, todo sigue igual. Nunca se compran,
-- nunca cruzan de tienda y nunca incluyen archivados ni borrados.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now() where id in (tests.fx('store_a'), tests.fx('store_b'));

create function pg_temp.gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'storefront_gateway', true);
  execute format('select to_jsonb(t.x) from (%s) t(x)', p_sql) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function pg_temp.tok(p text) returns text language sql as $$ select rpad(p, 43, 'x') $$;
-- La marca que pone el servidor en la transacción de la vista previa.
create function pg_temp.preview(p_value text) returns text language sql as $$
  select set_config('pruva.preview_store', p_value, true) $$;
create function pg_temp.slugs(p_items jsonb) returns text[] language sql as $$
  select coalesce(array_agg(e ->> 'slug' order by n), '{}')
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality x(e, n) $$;

select tests.login('owner');
-- Tienda de suplementos: cada producto se clasifica antes de publicarse.
select public.compliance_set_store_category(tests.fx('store_a'), 'dietary_supplement', true);
select tests.set_fx('brand', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Pruva"}'));
select tests.set_fx('brand_draft', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Solo Borrador"}'));
select tests.set_fx('cat', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Proteínas"}'));
select tests.set_fx('activo', (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object(
  'title', 'Creatina', 'slug', 'creatina', 'brand_id', tests.fx('brand'),
  'categories', jsonb_build_array(jsonb_build_object('id', tests.fx('cat'), 'is_primary', true)),
  'variants', jsonb_build_array(jsonb_build_object('sku', 'CRE-1', 'price', 49900, 'track_inventory', false))))
  ->> 'id')::uuid);
select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('activo'), null, null);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('activo'));
select tests.set_fx('archivado', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Archivado","slug":"archivado","variants":[{"sku":"ARC-1","price":10000}]}') ->> 'id')::uuid);
select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('archivado'), null, null);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('archivado'));
select public.catalog_set_product_status(tests.fx('store_a'), tests.fx('archivado'), 'archived');
select tests.set_fx('borrado', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Borrado","slug":"borrado","variants":[{"sku":"BOD-1","price":10000}]}') ->> 'id')::uuid);
select public.catalog_soft_delete_product(tests.fx('store_a'), tests.fx('borrado'));
-- El borrador: otra marca, misma categoría, «precio antes» (oferta), ficha sanitaria y objetivo.
select tests.set_fx('borrador', (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object(
  'title', 'Proteína borrador', 'slug', 'proteina-borrador', 'brand_id', tests.fx('brand_draft'),
  'categories', jsonb_build_array(jsonb_build_object('id', tests.fx('cat'), 'is_primary', true)),
  'variants', jsonb_build_array(jsonb_build_object('sku', 'PRO-1', 'price', 79900, 'compare_at_price', 99900,
                                                 'track_inventory', false))))
  ->> 'id')::uuid);
select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('borrador'), 'dietary_supplement',
  '{"ingredients":"Proteína de suero"}');
select tests.set_fx('objetivo', public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Objetivo","values":[{"label":"Fuerza"}]}'));
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('borrador'),
  array[(select id from public.attribute_values where attribute_id = tests.fx('objetivo') and key = 'fuerza')]);
select tests.logout();
select tests.login('owner_b');
select tests.set_fx('borrador_b', (public.catalog_upsert_product(tests.fx('store_b'),
  '{"title":"Borrador B","slug":"borrador-b","variants":[{"sku":"BB-1","price":100}]}') ->> 'id')::uuid);
select tests.logout();
select tests.set_fx('borrador_variant', (select id from public.product_variants
                                           where store_id = tests.fx('store_a') and sku = 'PRO-1'));

-- -----------------------------------------------------------------------------
-- Sin la marca: la tienda pública de siempre.
-- -----------------------------------------------------------------------------
select is(pg_temp.slugs(pg_temp.gw(format('select storefront.list_products(%L) -> ''items''', tests.fx('store_a')))),
          array['creatina'], 'sin vista previa: solo el producto publicado');
select ok(pg_temp.gw(format('select storefront.get_product(%L, ''proteina-borrador'')', tests.fx('store_a'))) is null,
          'sin vista previa: la ficha del borrador no existe');
select is(pg_temp.gw(format('select storefront.discovery_summary(%L)', tests.fx('store_a'))),
          '{"brands": 1, "offers": 0}'::jsonb, 'sin vista previa: el menú no cuenta la marca ni la oferta del borrador');
select is(pg_temp.slugs(pg_temp.gw(format('select storefront.list_brands(%L)', tests.fx('store_a')))),
          array['pruva'], 'sin vista previa: el directorio solo tiene marcas con productos publicados');
select ok(not pg_temp.slugs(pg_temp.gw(format('select storefront.search_suggestions(%L, ''proteina'') -> ''products''',
                                              tests.fx('store_a')))) @> array['proteina-borrador'],
          'sin vista previa: el buscador no sugiere el borrador');

-- -----------------------------------------------------------------------------
-- Con la marca de la tienda A: sus borradores, marcados.
-- -----------------------------------------------------------------------------
select pg_temp.preview(tests.fx('store_a')::text);

select is(pg_temp.slugs(pg_temp.gw(format('select storefront.list_products(%L) -> ''items''', tests.fx('store_a')))),
          array['proteina-borrador', 'creatina'],
          'vista previa: el borrador aparece (primero en «Más recientes», por su fecha de creación)');
select is((select jsonb_object_agg(e ->> 'slug', e -> 'unpublished')
             from jsonb_array_elements(pg_temp.gw(format('select storefront.list_products(%L) -> ''items''',
                                                         tests.fx('store_a')))) e),
          '{"creatina": false, "proteina-borrador": true}'::jsonb, 'cada tarjeta dice si está sin publicar');
select is(pg_temp.gw(format('select storefront.list_products(%L, p_limit => 1, p_cursor => %L)', tests.fx('store_a'),
            pg_temp.gw(format('select storefront.list_products(%L, p_limit => 1)', tests.fx('store_a'))) -> 'next_cursor'))
            -> 'items' -> 0 ->> 'slug',
          'creatina', 'la segunda página sigue después del borrador (el cursor no se rompe sin fecha de publicación)');
select is(pg_temp.slugs(pg_temp.gw(format('select storefront.list_products(%L, p_on_sale => true) -> ''items''',
                                          tests.fx('store_a')))),
          array['proteina-borrador'], 'el filtro «Ofertas» también lo incluye');
select is(pg_temp.gw(format('select storefront.get_product(%L, ''proteina-borrador'')', tests.fx('store_a')))
            -> 'unpublished', 'true'::jsonb, 'la ficha del borrador existe y está marcada');
select is(pg_temp.gw(format('select storefront.get_product(%L, ''creatina'')', tests.fx('store_a'))) -> 'unpublished',
          'false'::jsonb, 'la ficha de un publicado no lleva la marca');
select is(pg_temp.gw(format('select storefront.get_product_regulatory(%L, ''proteina-borrador'')', tests.fx('store_a')))
            -> 'data' ->> 'ingredients', 'Proteína de suero', 'la ficha sanitaria del borrador');
select is(pg_temp.gw(format('select storefront.get_product_attributes(%L, ''proteina-borrador'')', tests.fx('store_a')))
            -> 0 ->> 'key', 'objetivo', 'los atributos del borrador');
select is(pg_temp.slugs(pg_temp.gw(format('select storefront.related_products(%L, ''proteina-borrador'')',
                                          tests.fx('store_a')))),
          array['creatina'], 'relacionados en la ficha del borrador');
select is(pg_temp.gw(format('select storefront.related_products(%L, ''creatina'')', tests.fx('store_a'))) -> 0
            -> 'unpublished', 'true'::jsonb, 'el borrador sale marcado entre los relacionados de un publicado');
select is(pg_temp.gw(format('select storefront.discovery_summary(%L)', tests.fx('store_a'))),
          '{"brands": 2, "offers": 1}'::jsonb, 'el menú cuenta su marca y su oferta');
select is(pg_temp.slugs(pg_temp.gw(format('select storefront.list_brands(%L)', tests.fx('store_a')))),
          array['pruva', 'solo-borrador'], 'el directorio de marcas incluye la del borrador');
select is(pg_temp.gw(format('select storefront.search_suggestions(%L, ''proteina'') -> ''products''', tests.fx('store_a')))
            -> 0 ->> 'slug', 'proteina-borrador', 'el buscador lo sugiere');
select ok(pg_temp.gw(format('select storefront.get_product(%L, ''archivado'')', tests.fx('store_a'))) is null
          and pg_temp.gw(format('select storefront.get_product(%L, ''borrado'')', tests.fx('store_a'))) is null,
          'archivados y borrados nunca se muestran');

-- -----------------------------------------------------------------------------
-- Lo que la marca nunca cambia.
-- -----------------------------------------------------------------------------
select ok(not pg_temp.gw(format('select storefront.card_variants(%L, %L)', tests.fx('store_a'),
                                array[tests.fx('borrador')]::uuid[])) ? tests.fx('borrador')::text,
          'sin «Agregar» en la tarjeta del borrador');
select throws_ok(format('select pg_temp.gw(%L)', format('select storefront.cart_add_item(%L, %L, %L, 1)',
                   tests.fx('store_a'), pg_temp.tok('c1'), tests.fx('borrador_variant'))),
                 'P0001', 'not_found', 'un borrador no entra al carrito ni en la vista previa');
select ok(not exists (select 1 from storefront.sitemap_entries(tests.fx('store_a')) s
                       where s.path like '%proteina-borrador%'),
          'el sitemap nunca incluye borradores');
select is(pg_temp.gw(format('select storefront.list_products(%L) -> ''items''', tests.fx('store_b'))), '[]'::jsonb,
          'la marca de la tienda A no muestra los borradores de la tienda B');
select ok(pg_temp.gw(format('select storefront.get_product(%L, ''borrador-b'')', tests.fx('store_b'))) is null,
          'ni su ficha');

update public.stores set status = 'suspended' where id = tests.fx('store_a');
select is(pg_temp.gw(format('select storefront.list_products(%L) -> ''items''', tests.fx('store_a'))), '[]'::jsonb,
          'una tienda suspendida no muestra nada, ni en la vista previa');
update public.stores set status = 'active' where id = tests.fx('store_a');

select pg_temp.preview('no-es-una-tienda');
select is(pg_temp.slugs(pg_temp.gw(format('select storefront.list_products(%L) -> ''items''', tests.fx('store_a')))),
          array['creatina'], 'una marca que no es esta tienda no muestra borradores');
select pg_temp.preview('');
select ok(pg_temp.gw(format('select storefront.get_product(%L, ''proteina-borrador'')', tests.fx('store_a'))) is null,
          'sin la marca, de vuelta a lo publicado');

select ok(not has_function_privilege('storefront_gateway', 'app.visible_product_statuses(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'app.visible_product_statuses(uuid)', 'execute')
          and not has_function_privilege('anon', 'app.visible_product_statuses(uuid)', 'execute'),
          'nadie más que las funciones de la tienda usa el helper');

select * from finish();
rollback;
