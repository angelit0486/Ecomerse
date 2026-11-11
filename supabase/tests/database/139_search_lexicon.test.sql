-- =============================================================================
-- Búsqueda a escala (2026-11-11, CAP-01): el texto de búsqueda se guarda en
-- `products.search_lexicon`, se mantiene solo y la búsqueda devuelve lo mismo
-- que el cálculo anterior (por producto), sin ver nada de otra tienda.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now() where id in (tests.fx('store_a'), tests.fx('store_b'));

create function tests.gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'storefront_gateway', true);
  execute format('select to_jsonb(t.x) from (%s) t(x)', p_sql) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
-- Productos con el texto guardado distinto del recién calculado (debe ser 0).
create function tests.stale() returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer from public.products p
   where p.search_lexicon is distinct from app.product_lexicon_of(p) $$;
create function tests.lexicon(p_slug text) returns text language sql security definer set search_path = '' as $$
  select p.search_lexicon from public.products p where p.slug = p_slug and p.store_id = tests.fx('store_a') $$;
-- La regla ANTERIOR, producto por producto, con el texto calculado al momento.
create function tests.old_matches(p_store uuid, p_q text) returns text[] language sql security definer set search_path = '' as $$
  select coalesce(array_agg(p.slug order by p.slug), '{}')
    from public.products p
   where p.store_id = p_store
     and (p.search_vector @@ websearch_to_tsquery('spanish', extensions.unaccent(left(p_q, 200)))
          or extensions.similarity(p.title, p_q) > 0.3
          or exists (select 1 from public.product_variants sv
                      where sv.product_id = p.id and sv.deleted_at is null and sv.status = 'active'
                        and (sv.sku = upper(p_q) or sv.barcode = p_q))
          or app.search_fuzzy_match(app.product_lexicon(p_store, p.id), p_q)) $$;
create function tests.new_matches(p_store uuid, p_q text) returns text[] language sql security definer set search_path = '' as $$
  select coalesce(array_agg(p.slug order by p.slug), '{}')
    from app.search_matches(p_store, p_q) m join public.products p on p.id = m.product_id $$;
grant execute on all functions in schema tests to authenticated, storefront_gateway;

create function pg_temp.search(p_store text, p_q text) returns text[] language sql as $$
  select coalesce(array_agg(x ->> 'title' order by x ->> 'title'), '{}')
    from jsonb_array_elements(tests.gw(format('select storefront.list_products(%L, p_query => %L) -> ''items''',
                                              tests.fx('store_' || p_store), p_q))) x
$$;
create function pg_temp.suggest(p_q text) returns text[] language sql as $$
  select coalesce(array_agg(x ->> 'title' order by x ->> 'title'), '{}')
    from jsonb_array_elements(tests.gw(format('select storefront.search_suggestions(%L, %L) -> ''products''',
                                              tests.fx('store_a'), p_q))) x
$$;

select tests.login('owner');
select tests.set_fx('atlas', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Atlas Nutrición"}'));
select tests.set_fx('cat', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Suplementos"}'));
select tests.set_fx('whey', (public.catalog_upsert_product(tests.fx('store_a'),
  jsonb_build_object('title', 'Proteína Whey Isolate', 'slug', 'whey', 'brand_id', tests.fx('atlas'),
    'categories', jsonb_build_array(jsonb_build_object('id', tests.fx('cat'), 'is_primary', true)),
    'options', '[{"name":"Sabor","values":["Chocolate","Vainilla"]}]'::jsonb,
    'variants', '[{"options":{"Sabor":"Chocolate"},"price":89900,"sku":"WHEY-CHO","barcode":"7501000000017"},
                  {"options":{"Sabor":"Vainilla"},"price":89900,"sku":"WHEY-VAI"}]'::jsonb)) ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('whey'));
select tests.set_fx('crea', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Creatina monohidratada","slug":"crea","variants":[{"price":49900,"sku":"CREA-1"}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('crea'));
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Proteína borrador","slug":"borrador","variants":[{"price":100,"sku":"BOR-1"}]}');
select tests.logout();
select tests.login('owner_b');
select public.catalog_publish_product(tests.fx('store_b'), (public.catalog_upsert_product(tests.fx('store_b'),
  '{"title":"Proteína Whey de otra tienda","slug":"ajeno","variants":[{"price":100,"sku":"WHEY-CHO"}]}') ->> 'id')::uuid);
select tests.logout();

-- ------------------------------------------------- 1. El texto guardado
select has_column('public', 'products', 'search_lexicon', 'el texto de búsqueda se guarda');
select is(tests.lexicon('whey'), 'proteina whey isolate atlas nutricion suplementos chocolate vainilla',
          'título, marca, categoría y opciones, sin acentos ni mayúsculas');
select is(tests.stale(), 0, 'recién creado: igual al calculado');

-- ------------------------------------------------- 2. Se mantiene solo
select tests.login('owner');
select public.catalog_upsert_brand(tests.fx('store_a'), jsonb_build_object('id', tests.fx('atlas'), 'name', 'Titán Labs'));
select tests.logout();
select ok(tests.lexicon('whey') like '%titan labs%' and tests.stale() = 0, 'cambiar el nombre de la marca');
select tests.login('owner');
select public.catalog_upsert_category(tests.fx('store_a'), jsonb_build_object('id', tests.fx('cat'), 'name', 'Nutrición deportiva'));
select tests.logout();
select ok(tests.lexicon('whey') like '%nutricion deportiva%' and tests.stale() = 0, 'cambiar el nombre de la categoría');
select tests.login('owner');
select public.catalog_upsert_product(tests.fx('store_a'),
  jsonb_build_object('id', tests.fx('whey'), 'title', 'Proteína Whey Isolate', 'slug', 'whey', 'brand_id', tests.fx('atlas'),
    'categories', jsonb_build_array(jsonb_build_object('id', tests.fx('cat'), 'is_primary', true)),
    'options', '[{"name":"Sabor","values":["Chocolate","Vainilla","Fresa"]}]'::jsonb,
    'variants', '[{"options":{"Sabor":"Chocolate"},"price":89900,"sku":"WHEY-CHO","barcode":"7501000000017"},
                  {"options":{"Sabor":"Vainilla"},"price":89900,"sku":"WHEY-VAI"},
                  {"options":{"Sabor":"Fresa"},"price":89900,"sku":"WHEY-FRE"}]'::jsonb));
select tests.logout();
select ok(tests.lexicon('whey') like '%fresa%' and tests.stale() = 0, 'agregar un valor a una opción');
select tests.login('owner');
select public.catalog_delete_category(tests.fx('store_a'), tests.fx('cat'));
select tests.logout();
select ok(tests.lexicon('whey') not like '%nutricion deportiva%' and tests.stale() = 0, 'dar de baja la categoría');
select tests.login('owner');
select public.catalog_delete_brand(tests.fx('store_a'), tests.fx('atlas'));
select tests.logout();
select ok(tests.lexicon('whey') not like '%titan%' and tests.stale() = 0, 'dar de baja la marca');

-- ------------------------------------------------- 3. Mismos resultados que antes
select is(tests.new_matches(tests.fx('store_a'), q), tests.old_matches(tests.fx('store_a'), q), 'igual que antes: «' || q || '»')
  from unnest(array['proteina', 'PROTEÍNA', 'proteina choclate', 'creatna', 'whey-cho', '7501000000017',
                    'fresa', 'isolate vainilla', 'zzzqqq', 'lb', 'protena borador']) q;

-- ------------------------------------------------- 4. La tienda en línea
select is(pg_temp.search('a', 'proteina choclate'), array['Proteína Whey Isolate'], 'con un error de escritura');
select is(pg_temp.search('a', 'whey-cho'), array['Proteína Whey Isolate'], 'por SKU: solo el de esta tienda');
select is(pg_temp.search('a', 'borrador'), '{}'::text[], 'los borradores no salen');
select is(pg_temp.suggest('prot'), array['Proteína Whey Isolate'], 'sugerencias: por el inicio del título');
select is(pg_temp.suggest('creatna'), array['Creatina monohidratada'], 'sugerencias: con una letra de menos');

select * from finish();
rollback;
