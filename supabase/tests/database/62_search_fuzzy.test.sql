-- =============================================================================
-- Búsqueda tolerante (super prompt §9 y §18.7-8): marca, sabor y errores de
-- escritura razonables; acentos y mayúsculas; las características solo salen
-- del texto de la tienda; nada de borradores ni de otra tienda.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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
grant execute on all functions in schema tests to authenticated, storefront_gateway;

create function pg_temp.search(p_store text, p_q text) returns text[] language sql as $$
  select coalesce(array_agg(x ->> 'title' order by x ->> 'title'), '{}')
    from jsonb_array_elements(tests.gw(format('select storefront.list_products(%L, p_query => %L) -> ''items''',
                                              tests.fx('store_' || p_store), p_q))) x
$$;

select tests.login('owner');
select tests.set_fx('atlas', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Atlas Nutrición"}'));
select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
  jsonb_build_object('title', 'Proteína Whey Isolate', 'brand_id', tests.fx('atlas'),
    'options', '[{"name":"Sabor","values":["Chocolate","Vainilla"]}]'::jsonb,
    'variants', '[{"options":{"Sabor":"Chocolate"},"price":89900,"sku":"WHEY-CHO"},
                  {"options":{"Sabor":"Vainilla"},"price":89900,"sku":"WHEY-VAI"}]'::jsonb)) ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Creatina monohidratada","variants":[{"price":49900,"sku":"CREA-1"}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Pre-entreno Ignite","variants":[{"price":59900,"sku":"PRE-1"}]}') ->> 'id')::uuid);
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Proteína borrador","variants":[{"price":100,"sku":"BOR-1"}]}');
select tests.logout();
select tests.login('owner_b');
select public.catalog_publish_product(tests.fx('store_b'), (public.catalog_upsert_product(tests.fx('store_b'),
  '{"title":"Proteína de otra tienda","variants":[{"price":100}]}') ->> 'id')::uuid);
select tests.logout();

select ok(app.search_fuzzy_match('proteina whey chocolate', 'choclate'), 'un error de escritura razonable coincide');
select ok(not app.search_fuzzy_match('proteina whey chocolate', 'cafeina'), 'una palabra ausente no coincide');
select ok(not app.search_fuzzy_match('proteina whey', 'lb'), 'palabras de menos de 3 letras no bastan para coincidir');

select is(pg_temp.search('a', 'PROTEINA'), array['Proteína Whey Isolate'], 'sin acentos ni mayúsculas');
select is(pg_temp.search('a', 'proteína chocolate'), array['Proteína Whey Isolate'],
          'nombre y sabor (opción de la variante)');
select is(pg_temp.search('a', 'proteina choclate'), array['Proteína Whey Isolate'], 'con un error en el sabor');
select is(pg_temp.search('a', 'atlaz'), array['Proteína Whey Isolate'], 'por marca, con un error');
select is(pg_temp.search('a', 'creatna'), array['Creatina monohidratada'], 'por tipo, con una letra de menos');
select is(pg_temp.search('a', 'preentreno sin cafeina'), '{}'::text[],
          '«sin cafeína» solo devuelve productos cuyo texto lo dice (ninguno aquí)');
select is(pg_temp.search('b', 'proteina'), array['Proteína de otra tienda'], 'cada tienda busca solo lo suyo');

select is((select array_agg(x ->> 'name') from jsonb_array_elements(
             tests.gw(format('select storefront.search_suggestions(%L, %L) -> ''brands''', tests.fx('store_a'), 'atlaz'))) x),
          array['Atlas Nutrición'], 'las sugerencias toleran el error en la marca');
select is((select array_agg(x ->> 'title') from jsonb_array_elements(
             tests.gw(format('select storefront.search_suggestions(%L, %L) -> ''products''', tests.fx('store_a'), 'choclate'))) x),
          array['Proteína Whey Isolate'], 'y en el sabor');

select * from finish();
rollback;
