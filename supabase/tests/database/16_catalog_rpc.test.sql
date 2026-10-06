-- =============================================================================
-- Fase 3 · RPC del catálogo (F3-T02).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('cat', 'cat@a.io');
select tests.create_user('view', 'view@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'cat', 'catalog_manager');
select tests.add_store_member('a', 'view', 'viewer');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function tests.upsert(p_store text, p_json jsonb) returns jsonb language sql as
  $$ select public.catalog_upsert_product(tests.fx('store_' || p_store), p_json) $$;
create function tests.pid(p_slug text, p_store text default 'a') returns uuid
language sql security definer set search_path = '' as
  $$ select id from public.products where slug = p_slug and store_id = tests.fx('store_' || p_store) $$;
create function tests.live_variants(p_slug text) returns integer
language sql security definer set search_path = '' as
  $$ select count(*)::int from public.product_variants where product_id = tests.pid(p_slug) and deleted_at is null $$;
create function tests.playera_json(p_title text default 'Playera Básica', p_price int default 19900) returns jsonb
language sql as $$
  select jsonb_build_object(
    'title', p_title,
    'options', jsonb_build_array(
      jsonb_build_object('name', 'Color', 'values', jsonb_build_array('Negro', 'Blanco')),
      jsonb_build_object('name', 'Talla', 'values', jsonb_build_array('CH', 'M', 'G'))),
    'variants', (select jsonb_agg(jsonb_build_object(
        'options', jsonb_build_object('Color', c, 'Talla', t), 'price', p_price,
        'sku', 'PLY-' || left(c, 1) || '-' || t, 'cost', 8000))
      from unnest(array['Negro', 'Blanco']) c, unnest(array['CH', 'M', 'G']) t))
$$;
grant execute on all functions in schema tests to authenticated;

-- ============================================================================ Alta
select tests.logout(); select tests.login('owner');
select is((tests.upsert('a', '{"title":"Café de Olla","variants":[{"price":5000}]}') ->> 'slug'), 'cafe-de-olla',
  'producto simple: slug derivado del título');
select is(tests.live_variants('cafe-de-olla'), 1, 'producto simple = una variante');
select lives_ok($$ select tests.upsert('a', tests.playera_json()) $$, 'la Playera de 6 variantes se crea en una transacción');
select is(tests.live_variants('playera-basica'), 6, '6 combinaciones');
select is((select string_agg(option_signature, ';' order by option_signature) from public.product_variants
            where product_id = tests.pid('playera-basica') and option_signature like 'Color=Negro%'),
  'Color=Negro|Talla=CH;Color=Negro|Talla=G;Color=Negro|Talla=M', 'firmas por posición de opción');
select tests.logout();
select is((select count(*)::int from public.variant_costs c join public.product_variants v on v.id = c.variant_id
            where v.product_id = tests.pid('playera-basica')), 6, 'costos guardados');
select is((select count(*)::int from audit.audit_logs where action = 'product.created' and store_id = tests.fx('store_a')),
  2, 'altas auditadas');

-- ============================================================================ Permisos y aislamiento
select tests.logout(); select tests.login('view');
select throws_ok($$ select tests.upsert('a', '{"title":"X","variants":[{"price":1}]}') $$, '42501', 'forbidden',
  'viewer no crea productos');
select tests.logout(); select tests.login('owner', 'aal1');
select throws_ok($$ select tests.upsert('a', '{"title":"X","variants":[{"price":1}]}') $$, '42501', 'mfa_required',
  'sin 2FA no se edita el catálogo');
select tests.logout(); select tests.login('owner_b');
select throws_ok($$ select tests.upsert('a', '{"title":"X","variants":[{"price":1}]}') $$, '42501', 'forbidden',
  'otro tenant no crea productos en A');
select throws_ok(format($$ select tests.upsert('b', '{"id":"%s","title":"Robada","variants":[{"price":1}]}') $$,
  tests.pid('playera-basica')), 'P0001', 'not_found', 'editar un producto de A pasando la tienda B: not_found');
select tests.logout(); select tests.login('cat');
select lives_ok($$ select tests.upsert('a', '{"title":"Gorra","variants":[{"price":9900,"sku":"gor-1"}]}') $$,
  'catalog_manager crea productos');

-- ============================================================================ Validaciones
select throws_ok($$ select tests.upsert('a', '{"title":"Otra","variants":[{"price":100,"sku":"GOR-1"}]}') $$,
  'P0001', 'validation_failed', 'SKU repetido en la tienda: error de campo');
select throws_like($$ select tests.upsert('a', '{"title":"Sin variantes","variants":[]}') $$, '%validation_failed%',
  'al menos una variante');
select throws_ok($$ select tests.upsert('a', '{"title":"Mal","options":[{"name":"Color","values":["Rojo"]}],
  "variants":[{"options":{"Color":"Verde"},"price":100}]}') $$, 'P0001', 'validation_failed',
  'valor de opción inexistente: rechazado');
select throws_ok($$ select tests.upsert('a', '{"title":"Muchas","options":[{"name":"A","values":["1"]},{"name":"B","values":["1"]},
  {"name":"C","values":["1"]},{"name":"D","values":["1"]}],"variants":[{"options":{"A":"1","B":"1","C":"1","D":"1"},"price":1}]}') $$,
  'P0001', 'validation_failed', 'máximo 3 opciones');
select throws_ok($$ select tests.upsert('a', '{"title":"Digital","product_type":"digital","variants":[{"price":1}]}') $$,
  'P0001', 'validation_failed', 'solo productos físicos en el MVP');
select throws_ok($$ select tests.upsert('a', '{"title":"Precio","variants":[{"price":-5}]}') $$,
  'P0001', 'validation_failed', 'precio negativo: error de campo');
select throws_ok($$ select tests.upsert('a', '{"title":"Gorra","variants":[{"price":1}]}') $$,
  'P0001', 'validation_failed', 'slug repetido: error de campo');
select throws_ok($$ select tests.upsert('a', '{"title":"Dup","options":[{"name":"Color","values":["Rojo"]}],
  "variants":[{"options":{"Color":"Rojo"},"price":1},{"options":{"Color":"Rojo"},"price":2}]}') $$,
  'P0001', 'validation_failed', 'la misma combinación dos veces: rechazada');

-- ============================================================================ Edición
select tests.logout(); select tests.login('owner');
select tests.set_fx('v_negro_m', (select id from public.product_variants where sku = 'PLY-N-M'));
select lives_ok(format($$ select tests.upsert('a', jsonb_build_object('id', %L, 'title', 'Playera Básica',
  'options', jsonb_build_array(jsonb_build_object('name','Color','values',jsonb_build_array('Negro','Blanco')),
                               jsonb_build_object('name','Talla','values',jsonb_build_array('CH','M'))),
  'variants', (select jsonb_agg(jsonb_build_object('options', jsonb_build_object('Color', c, 'Talla', t),
       'price', case when c = 'Negro' and t = 'M' then 21900 else 19900 end, 'sku', 'PLY-' || left(c,1) || '-' || t))
     from unnest(array['Negro','Blanco']) c, unnest(array['CH','M']) t))) $$, tests.pid('playera-basica')),
  'quitar la talla G y cambiar un precio');
select is(tests.live_variants('playera-basica'), 4, 'las variantes de la talla G se retiran');
select is((select count(*)::int from public.product_variants where product_id = tests.pid('playera-basica')
            and deleted_at is not null), 2, 'retiradas con borrado lógico (no se pierden)');
select is((select price from public.product_variants where id = tests.fx('v_negro_m') and deleted_at is null), 21900::bigint,
  'la variante existente conserva su id y actualiza el precio');
select is((select min_price || '-' || max_price from public.products where id = tests.pid('playera-basica')),
  '19900-21900', 'rango de precios recalculado');
select is((select count(*)::int from public.variant_costs c join public.product_variants v on v.id = c.variant_id
            where v.id = tests.fx('v_negro_m')), 1, 'sin la clave cost, el costo existente se conserva');

-- ============================================================================ Publicar y ciclo de vida
select lives_ok($$ select tests.upsert('a', '{"title":"Gratis","variants":[{"price":0}]}') $$, 'borrador con precio 0');
select throws_ok(format($$ select public.catalog_publish_product(%L, %L) $$, tests.fx('store_a'), tests.pid('gratis')),
  'P0001', 'validation_failed', 'no se publica con precio 0');
select is((select array_agg(code) from public.catalog_validate_product(tests.fx('store_a'), tests.pid('gratis'))
            where level = 'error'), array['price_zero'], 'la validación explica por qué');
select lives_ok(format($$ select public.catalog_publish_product(%L, %L) $$, tests.fx('store_a'), tests.pid('playera-basica')),
  'publicar la Playera');
select ok((select status = 'active' and published_at is not null from public.products where id = tests.pid('playera-basica')),
  'activa con fecha de publicación');
select tests.logout(); select tests.login('view');
select throws_ok(format($$ select public.catalog_publish_product(%L, %L) $$, tests.fx('store_a'), tests.pid('gorra')),
  '42501', 'forbidden', 'viewer no publica');
select tests.logout(); select tests.login('owner');
select lives_ok(format($$ select public.catalog_set_product_status(%L, %L, 'archived') $$, tests.fx('store_a'),
  tests.pid('playera-basica')), 'archivar');
select is((select status from public.products where id = tests.pid('playera-basica')), 'archived', 'archivada');
select throws_ok(format($$ select public.catalog_set_product_status(%L, %L, 'active') $$, tests.fx('store_a'),
  tests.pid('playera-basica')), 'P0001', 'validation_failed', 'activar solo se hace publicando (con validación)');
select lives_ok(format($$ select public.catalog_soft_delete_product(%L, %L) $$, tests.fx('store_a'), tests.pid('playera-basica')),
  'borrado lógico');
select is((select count(*)::int from public.catalog_search_products(tests.fx('store_a'), 'playera')), 0,
  'un producto borrado no aparece en la búsqueda');
select is((select count(*)::int from public.catalog_search_products(tests.fx('store_a'), null, null, null, true)), 1,
  'aparece en la papelera');
select lives_ok(format($$ select public.catalog_restore_product(%L, %L) $$, tests.fx('store_a'),
  (select id from public.products where slug = 'playera-basica')), 'restaurar');
select is((select status from public.products where slug = 'playera-basica' and deleted_at is null), 'draft',
  'vuelve como borrador');

-- ============================================================================ Duplicar
select is((public.catalog_duplicate_product(tests.fx('store_a'), tests.pid('playera-basica')) ->> 'slug'),
  'playera-basica-copia', 'duplicar: slug -copia');
select ok(tests.live_variants('playera-basica-copia') = 4
          and (select count(*) from public.product_variants where product_id = tests.pid('playera-basica-copia')
                and sku is not null) = 0,
  'mismas variantes, sin SKU (es único)');

-- ============================================================================ Categorías y marcas
select tests.set_fx('cat_ropa', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Ropa"}'));
select tests.set_fx('cat_hombre', public.catalog_upsert_category(tests.fx('store_a'),
  jsonb_build_object('name', 'Hombre', 'parent_id', tests.fx('cat_ropa'))));
select throws_ok(format($$ select public.catalog_move_category(%L, %L, %L) $$, tests.fx('store_a'),
  tests.fx('cat_ropa'), tests.fx('cat_hombre')), 'P0001', 'validation_failed', 'mover dentro de su descendiente: rechazado');
select lives_ok(format($$ select tests.upsert('a', jsonb_build_object('id', %L, 'title', 'Gorra',
  'variants', jsonb_build_array(jsonb_build_object('price', 9900, 'sku', 'GOR-1')),
  'categories', jsonb_build_array(jsonb_build_object('id', %L, 'is_primary', true)))) $$,
  tests.pid('gorra'), tests.fx('cat_hombre')), 'asignar categoría principal');
select throws_ok(format($$ select tests.upsert('a', jsonb_build_object('id', %L, 'title', 'Gorra',
  'variants', jsonb_build_array(jsonb_build_object('price', 9900, 'sku', 'GOR-1')),
  'categories', jsonb_build_array(jsonb_build_object('id', (select id from public.categories where store_id = %L limit 1))))) $$,
  tests.pid('gorra'), tests.fx('store_b')), 'P0001', 'validation_failed', 'categoría de otra tienda: rechazada');
select throws_ok(format($$ select public.catalog_delete_category(%L, %L) $$, tests.fx('store_a'), tests.fx('cat_ropa')),
  'P0001', 'conflict', 'no se borra una categoría con subcategorías');
select lives_ok(format($$ select public.catalog_delete_category(%L, %L) $$, tests.fx('store_a'), tests.fx('cat_hombre')),
  'borrar una hoja');
select is((select count(*)::int from public.product_categories where product_id = tests.pid('gorra')), 0,
  'sus productos dejan de estar en ella');
select tests.set_fx('brand_x', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Marca Ñandú"}'));
select is((select slug from public.brands where id = tests.fx('brand_x')), 'marca-nandu', 'slug de marca sin acentos');

-- ============================================================================ Búsqueda del panel
select is((select title from public.catalog_search_products(tests.fx('store_a'), 'cafe') limit 1), 'Café de Olla',
  'búsqueda sin acentos');
select is((select title from public.catalog_search_products(tests.fx('store_a'), 'gor-1') limit 1), 'Gorra',
  'SKU exacto primero');
select is((select count(*)::int from public.catalog_search_products(tests.fx('store_a'), null, 'draft')),
  (select count(*)::int from public.products where store_id = tests.fx('store_a') and status = 'draft' and deleted_at is null),
  'filtro por estado');
select is((select count(*)::int from public.catalog_search_products(tests.fx('store_a'), null, null, null, false,
  (select jsonb_build_object('updated_at', updated_at, 'id', id) from public.catalog_search_products(tests.fx('store_a'), null, null, null, false, null, 2)
    order by updated_at, id limit 1), 100))
  + 2, (select count(*)::int from public.products where store_id = tests.fx('store_a') and deleted_at is null),
  'paginación por cursor sin repetir ni saltar');
select tests.logout(); select tests.login('owner_b');
select throws_ok(format($$ select * from public.catalog_search_products(%L) $$, tests.fx('store_a')),
  '42501', 'forbidden', 'otro tenant no busca en A');
select tests.logout();

select * from finish();
rollback;
