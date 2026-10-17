-- =============================================================================
-- Panel de productos, tanda 5: duplicar un producto completo (contenido y
-- porciones, ficha, atributos y fotos con su job de copia) y pocas existencias.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'viewer', 'marketing_manager');

select tests.login('owner');
select tests.set_fx('src', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Whey","options":[{"name":"Tamaño","values":["1 kg","2 kg"]}],
    "variants":[{"price":59900,"sku":"DP-1","options":{"Tamaño":"1 kg"},"net_content":"1 kg","servings_per_container":33},
                {"price":99900,"sku":"DP-2","options":{"Tamaño":"2 kg"},"net_content":"2 kg","servings_per_container":66}]}') ->> 'id')::uuid);
select tests.logout();

-- Fotos listas, ficha y atributos (como superusuario: cada RPC tiene su propio pgTAP).
insert into public.media (id, store_id, owner_type, product_id, status, storage_path, mime_type, bytes, alt_text, position)
values (gen_random_uuid(), tests.fx('store_a'), 'product', tests.fx('src'), 'ready', tests.fx('store_a')::text || '/product/x/frente.webp', 'image/webp', 2048, 'Frente', 0),
       (gen_random_uuid(), tests.fx('store_a'), 'product', tests.fx('src'), 'ready', tests.fx('store_a')::text || '/product/x/grande.webp', 'image/webp', 4096, 'Grande', 1),
       (gen_random_uuid(), tests.fx('store_a'), 'product', tests.fx('src'), 'rejected', tests.fx('store_a')::text || '/product/x/mala.webp', 'image/webp', 10, 'Mala', 2);
update public.product_variants set image_id = (select id from public.media where alt_text = 'Grande')
 where sku = 'DP-2';
insert into public.product_regulatory_info (store_id, product_id, category_key, data)
values (tests.fx('store_a'), tests.fx('src'), null, '{}');
insert into public.attributes (id, store_id, key, name) values (gen_random_uuid(), tests.fx('store_a'), 'objetivo', 'Objetivo');
insert into public.attribute_values (id, store_id, attribute_id, key, label)
select gen_random_uuid(), tests.fx('store_a'), a.id, 'fuerza', 'Fuerza' from public.attributes a where a.key = 'objetivo' and a.store_id = tests.fx('store_a');
insert into public.product_attribute_values (store_id, product_id, value_id)
select tests.fx('store_a'), tests.fx('src'), v.id from public.attribute_values v where v.key = 'fuerza' and v.store_id = tests.fx('store_a');

-- ============================================================================ Duplicar
select tests.login('owner');
select tests.set_fx('copy', (public.catalog_duplicate_product(tests.fx('store_a'), tests.fx('src')) ->> 'id')::uuid);
select is((select count(*)::int from public.media where product_id = tests.fx('copy')), 2,
          'copia las fotos listas (no las rechazadas)');
select lives_ok('set constraints all immediate', 'las validaciones diferidas de las variantes pasan');
select tests.logout();

select is((select string_agg(v.option_signature || '=' || v.net_content || '/' || v.servings_per_container, ',' order by v.position)
             from public.product_variants v where v.product_id = tests.fx('copy')),
          'Tamaño=1 kg=1 kg/33,Tamaño=2 kg=2 kg/66', 'contenido y porciones de cada presentación');
select is((select count(*)::int from public.product_variants v where v.product_id = tests.fx('copy') and v.sku is not null),
          0, 'los SKU no se copian (son únicos)');
select is((select count(*)::int from public.product_regulatory_info where product_id = tests.fx('copy')), 1, 'la ficha sanitaria');
select is((select count(*)::int from public.product_attribute_values where product_id = tests.fx('copy')), 1, 'los atributos');
select is((select string_agg(m.alt_text || ':' || m.status || ':' || m.position, ',' order by m.position)
             from public.media m where m.product_id = tests.fx('copy')),
          'Frente:pending:0,Grande:pending:1', 'fotos nuevas pendientes, con su texto alternativo y orden');
select ok((select bool_and(m.storage_path like tests.fx('store_a')::text || '/product/' || tests.fx('copy')::text || '/%')
             from public.media m where m.product_id = tests.fx('copy')),
          'cada copia tiene su propia ruta en la tienda');
select is((select count(*)::int from system.jobs j
            where j.type = 'media.copy' and j.store_id = tests.fx('store_a')
              and (j.payload ->> 'media_id')::uuid in (select id from public.media where product_id = tests.fx('copy'))
              and (j.payload ->> 'source_media_id')::uuid in (select id from public.media where product_id = tests.fx('src'))),
          2, 'un job media.copy por foto, con su origen');
select is((select m.alt_text from public.product_variants v join public.media m on m.id = v.image_id
            where v.product_id = tests.fx('copy') and v.option_signature = 'Tamaño=2 kg'),
          'Grande', 'la foto de la presentación apunta a su copia');
select is((select m.product_id from public.product_variants v join public.media m on m.id = v.image_id
            where v.product_id = tests.fx('copy') and v.option_signature = 'Tamaño=2 kg'),
          tests.fx('copy'), 'y no a la foto del original');

-- Worker: origen y destino solo de la misma tienda (con el rol system_worker).
create function pg_temp.copy_sources(p_target text, p_source_path text) returns integer language plpgsql as $$
declare
  v        integer;
  v_target uuid := (select id from public.media where product_id = tests.fx('copy') and alt_text = p_target);
  v_source uuid := (select id from public.media where storage_path like '%/' || p_source_path);
begin
  perform tests.as_role('system_worker');
  select count(*)::int into v from system.media_copy_source(v_target, v_source);
  perform tests.logout();
  return v;
end $$;
select is(pg_temp.copy_sources('Frente', 'x/frente.webp'), 1, 'el worker obtiene el origen de su copia');
insert into public.media (id, store_id, owner_type, status, storage_path, mime_type, bytes)
values (gen_random_uuid(), tests.fx('store_b'), 'banner', 'ready', tests.fx('store_b')::text || '/banner/y/ajena.webp', 'image/webp', 10);
select is(pg_temp.copy_sources('Frente', 'y/ajena.webp'), 0, 'nunca una foto de otra tienda');

-- ============================================================================ Pocas existencias
select tests.login('owner');
select public.inventory_adjust(tests.fx('store_a'), (select id from public.product_variants where sku = 'DP-1'),
                               'adjustment', 3, 'Inicial');
select public.inventory_adjust(tests.fx('store_a'), (select id from public.product_variants where sku = 'DP-2'),
                               'adjustment', 50, 'Inicial');
select public.inventory_set_threshold(tests.fx('store_a'), (select id from public.product_variants where sku = 'DP-1'), 5);
select is((public.catalog_list_extras(tests.fx('store_a'), array[tests.fx('src')]) -> tests.fx('src')::text
           ->> 'low_stock_variants'), '1', 'una presentación en o bajo su mínimo');
select is((select array_agg(title) from public.catalog_search_products(tests.fx('store_a'), p_issue => 'pocas_existencias')),
          array['Whey'], 'filtro «pocas existencias»');
select public.inventory_adjust(tests.fx('store_a'), (select id from public.product_variants where sku = 'DP-1'),
                               'adjustment', -3, 'Venta en mostrador');
select is((public.catalog_list_extras(tests.fx('store_a'), array[tests.fx('src')]) -> tests.fx('src')::text
           ->> 'low_stock_variants'), '0', 'agotada ya no cuenta como «pocas» (va en agotadas)');
select tests.logout();

select tests.login('viewer');
select throws_ok(format($$select * from public.catalog_search_products(%L, p_issue => 'pocas_existencias')$$, tests.fx('store_a')),
  '42501', 'forbidden', 'sin inventory.read no se filtra por existencias');
select tests.logout();

select tests.login('owner_b');
select throws_ok(format($$select public.catalog_duplicate_product(%L, %L)$$, tests.fx('store_b'), tests.fx('src')),
  'P0001', 'not_found', 'otra tienda no duplica productos de esta');
select tests.logout();

select * from finish();
rollback;
