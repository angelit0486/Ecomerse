-- =============================================================================
-- Fase 9 · F9-T04 — Navegación y listados (F9-DESIGN §10): `published_at` en
-- las tarjetas, filtro y faceta de marca (OR entre marcas, AND con atributos) y
-- sugerencias del buscador (solo lo publicado, sin acentos, acotadas, sin otra
-- tienda, sin comodines del comprador).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.create_user('owner_c', 'owner@c.io');
select tests.create_tenant('c', 'owner_c');
update public.stores set status = 'active', launched_at = now()
 where id in (tests.fx('store_a'), tests.fx('store_b'), tests.fx('store_c'));

create function pg_temp.gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'storefront_gateway', true);
  execute p_sql into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function pg_temp.list(p_brands text[], p_attributes jsonb default null) returns text[] language sql as $$
  select coalesce(array_agg(i ->> 'slug' order by i ->> 'slug'), '{}')
    from jsonb_array_elements(pg_temp.gw(format(
      'select storefront.list_products(%L, p_attributes => %L::jsonb, p_brands => %L::text[])',
      tests.fx('store_a'), p_attributes, p_brands)) -> 'items') i
$$;
create function pg_temp.brand_facet(p_brands text[], p_attributes jsonb default null) returns jsonb language sql as $$
  select f from jsonb_array_elements(pg_temp.gw(format(
      'select storefront.list_facets(%L, p_attributes => %L::jsonb, p_brands => %L::text[])',
      tests.fx('store_a'), p_attributes, p_brands))) f
   where f ->> 'key' = 'marca'
$$;
create function pg_temp.suggest(p_store uuid, p_q text) returns jsonb language sql as $$
  select pg_temp.gw(format('select storefront.search_suggestions(%L, %L)', p_store, p_q))
$$;
grant execute on all functions in schema tests to authenticated;

insert into public.brands (store_id, name, slug) values
  (tests.fx('store_a'), 'Nutri Uno', 'nutri-uno'),
  (tests.fx('store_a'), 'Ñandú Labs', 'nandu-labs'),
  (tests.fx('store_a'), 'Sin Productos', 'sin-productos'),
  (tests.fx('store_b'), 'Nutri Uno', 'nutri-uno');
select tests.login('owner');
select tests.set_fx('objetivo', public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Objetivo","values":[{"label":"Energía"},{"label":"Recuperación"}]}'));
create function pg_temp.product(p_store uuid, p_slug text, p_title text, p_brand text, p_publish boolean default true)
returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.catalog_upsert_product(p_store, jsonb_build_object('title', p_title, 'slug', p_slug,
          'brand_id', (select id from public.brands where store_id = p_store and slug = p_brand),
          'variants', '[{"price":19900}]'::jsonb)) ->> 'id')::uuid;
  if p_publish then perform public.catalog_publish_product(p_store, v); end if;
  return v;
end $$;
select tests.set_fx('creatina', pg_temp.product(tests.fx('store_a'), 'creatina', 'Creatina monohidratada', 'nutri-uno'));
select tests.set_fx('cafeina', pg_temp.product(tests.fx('store_a'), 'cafeina', 'Cafeína anhidra', 'nandu-labs'));
select tests.set_fx('proteina', pg_temp.product(tests.fx('store_a'), 'proteina', 'Proteína whey', 'nandu-labs'));
select tests.set_fx('borrador', pg_temp.product(tests.fx('store_a'), 'borrador', 'Creatina secreta', 'nutri-uno', false));
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('cafeina'),
  array[(select id from public.attribute_values where attribute_id = tests.fx('objetivo') and key = 'energia')]);
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('creatina'),
  array[(select id from public.attribute_values where attribute_id = tests.fx('objetivo') and key = 'energia')]);
select tests.logout();
select tests.login('owner_b');
select pg_temp.product(tests.fx('store_b'), 'creatina-b', 'Creatina de otra tienda', 'nutri-uno');
select tests.logout();
select tests.login('owner_c');
select pg_temp.product(tests.fx('store_c'), 'sin-marca', 'Producto sin marca', 'ninguna');
select tests.logout();
insert into public.categories (store_id, name, slug, path) values
  (tests.fx('store_a'), 'Creatinas', 'creatinas', 'creatinas'),
  (tests.fx('store_a'), 'Creatinas ocultas', 'creatinas-ocultas', 'creatinas-ocultas');
update public.categories set is_visible = false where store_id = tests.fx('store_a') and slug = 'creatinas-ocultas';

-- 1. Tarjetas.
select ok((pg_temp.gw(format('select storefront.list_products(%L)', tests.fx('store_a'))) #>> '{items,0,published_at}')
            is not null, 'cada tarjeta del listado trae su fecha de publicación');

-- 2. Marca.
select is(pg_temp.list(null), array['cafeina', 'creatina', 'proteina'], 'sin filtro de marca, todo lo publicado');
select is(pg_temp.list(array['nandu-labs']), array['cafeina', 'proteina'], 'una marca');
select is(pg_temp.list(array['nandu-labs', 'nutri-uno']), array['cafeina', 'creatina', 'proteina'], 'OR entre marcas');
select is(pg_temp.list(array['nandu-labs'], '{"objetivo":["energia"]}'), array['cafeina'], 'AND con los atributos');
select is(pg_temp.list(array['no-existe']), '{}'::text[], 'una marca desconocida no muestra nada');
select is((select array_agg(v ->> 'key' || ':' || (v ->> 'count') order by v ->> 'key')
             from jsonb_array_elements(pg_temp.brand_facet(null) -> 'values') v),
          array['nandu-labs:2', 'nutri-uno:1'],
          'faceta Marca con conteo; sin las marcas sin productos publicados');
select is((select array_agg(v ->> 'key' || ':' || (v ->> 'count') || ':' || (v ->> 'selected') order by v ->> 'key')
             from jsonb_array_elements(pg_temp.brand_facet(array['nutri-uno'], '{"objetivo":["energia"]}') -> 'values') v),
          array['nandu-labs:1:false', 'nutri-uno:1:true'],
          'el conteo de marca cumple los atributos pero no la propia marca (se puede sumar otra)');
select is((select (f -> 'values' -> 0 ->> 'count')::int
             from jsonb_array_elements(pg_temp.gw(format(
               'select storefront.list_facets(%L, p_attributes => %L::jsonb, p_brands => %L::text[])',
               tests.fx('store_a'), null, array['nandu-labs']))) f
            where f ->> 'key' = 'objetivo'),
          1, 'los atributos cuentan solo lo de la marca elegida');
select is((select count(*)::int from jsonb_array_elements(pg_temp.gw(format(
             'select storefront.list_facets(%L, p_brand_slug => %L)', tests.fx('store_a'), 'nandu-labs'))) f
            where f ->> 'key' = 'marca'), 0, 'en la página de una marca no hay faceta de marca');
select is((select count(*)::int from jsonb_array_elements(pg_temp.gw(format(
             'select storefront.list_facets(%L)', tests.fx('store_b')))) f where f ->> 'key' = 'marca'), 0,
          'una sola marca sin elegir no se muestra como filtro');
select is(pg_temp.gw(format('select storefront.list_facets(%L)', tests.fx('store_c'))), '[]'::jsonb,
          'una tienda sin marcas ni atributos no tiene filtros (y no falla)');

-- 3. Sugerencias.
select is((select array_agg(p ->> 'slug') from jsonb_array_elements(pg_temp.suggest(tests.fx('store_a'), 'crea') -> 'products') p),
          array['creatina'], 'productos que contienen lo escrito; nunca un borrador ni otra tienda');
select is((select array_agg(p ->> 'slug') from jsonb_array_elements(pg_temp.suggest(tests.fx('store_a'), 'CAFEINA') -> 'products') p),
          array['cafeina'], 'sin acentos ni mayúsculas');
select is((select array_agg(p ->> 'slug') from jsonb_array_elements(pg_temp.suggest(tests.fx('store_a'), 'monohid') -> 'products') p),
          array['creatina'], 'una palabra a la mitad del título también');
select is(pg_temp.suggest(tests.fx('store_a'), 'crea') -> 'categories', '[{"name":"Creatinas","path":"creatinas"}]'::jsonb,
          'categorías visibles (no las ocultas)');
select is(pg_temp.suggest(tests.fx('store_a'), 'nandu') -> 'brands', '[{"name":"Ñandú Labs","slug":"nandu-labs"}]'::jsonb,
          'marcas con productos publicados');
select is(pg_temp.suggest(tests.fx('store_a'), 'sin prod') -> 'brands', '[]'::jsonb, 'una marca sin productos no se sugiere');
select is(pg_temp.suggest(tests.fx('store_a'), 'energ') -> 'values',
          '[{"attribute":"objetivo","attribute_name":"Objetivo","key":"energia","label":"Energía"}]'::jsonb,
          'valores de atributos con productos (Recuperación no tiene)');
select is(pg_temp.suggest(tests.fx('store_a'), 'c'),
          '{"products":[],"categories":[],"brands":[],"values":[]}'::jsonb, 'menos de 2 caracteres: nada');
select is(jsonb_array_length(pg_temp.suggest(tests.fx('store_a'), '%%') -> 'products'), 0,
          'los comodines de LIKE se escapan');

select * from finish();
rollback;
