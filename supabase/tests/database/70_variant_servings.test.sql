-- =============================================================================
-- ADR-026 · Contenido neto y porciones por variante: opcionales, ausente =
-- sin cambios, vacío = se borra, validación, y la tienda los publica por variante.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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
select tests.create_tenant('a', 'owner');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

select tests.login('owner');
select tests.set_fx('prod', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Proteína","slug":"proteina","options":[{"name":"Tamaño","values":["1 kg","2 kg"]}],
    "variants":[{"price":69900,"sku":"P-1","options":{"Tamaño":"1 kg"},"net_content":"1 kg","servings_per_container":33},
                {"price":119900,"sku":"P-2","options":{"Tamaño":"2 kg"}}]}') ->> 'id')::uuid);
select is((select net_content || '|' || servings_per_container from public.product_variants where sku = 'P-1'),
          '1 kg|33', 'se guardan por variante');
select is((select count(*)::int from public.product_variants where sku = 'P-2' and net_content is null
            and servings_per_container is null), 1, 'son opcionales');

-- Editar sin las claves conserva; con null o vacío las borra.
select public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object('id', tests.fx('prod'), 'title', 'Proteína',
  'options', '[{"name":"Tamaño","values":["1 kg","2 kg"]}]'::jsonb,
  'variants', jsonb_build_array(
    jsonb_build_object('id', (select id from public.product_variants where sku = 'P-1'), 'price', 69900, 'sku', 'P-1',
                       'options', '{"Tamaño":"1 kg"}'::jsonb),
    jsonb_build_object('id', (select id from public.product_variants where sku = 'P-2'), 'price', 119900, 'sku', 'P-2',
                       'options', '{"Tamaño":"2 kg"}'::jsonb, 'net_content', '2 kg', 'servings_per_container', 66))));
select is((select string_agg(sku || '=' || coalesce(net_content, '-') || '/' || coalesce(servings_per_container::text, '-'),
                             ',' order by sku) from public.product_variants where product_id = tests.fx('prod')),
          'P-1=1 kg/33,P-2=2 kg/66', 'ausente = sin cambios; presente = se guarda');
select public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object('id', tests.fx('prod'), 'title', 'Proteína',
  'options', '[{"name":"Tamaño","values":["1 kg","2 kg"]}]'::jsonb,
  'variants', jsonb_build_array(
    jsonb_build_object('id', (select id from public.product_variants where sku = 'P-1'), 'price', 69900, 'sku', 'P-1',
                       'options', '{"Tamaño":"1 kg"}'::jsonb, 'net_content', '', 'servings_per_container', null),
    jsonb_build_object('id', (select id from public.product_variants where sku = 'P-2'), 'price', 119900, 'sku', 'P-2',
                       'options', '{"Tamaño":"2 kg"}'::jsonb))));
select is((select net_content is null and servings_per_container is null from public.product_variants where sku = 'P-1'),
          true, 'vacío o null las borra');

select is(pg_temp.err(format($$select public.catalog_upsert_product(%L, %L)$$, tests.fx('store_a'),
  '{"title":"Creatina","variants":[{"price":49900,"sku":"C-1","servings_per_container":0}]}')),
  'validation_failed/variants', 'porciones de 1 a 10000');
select is(pg_temp.err(format($$select public.catalog_upsert_product(%L, %L)$$, tests.fx('store_a'),
  '{"title":"Creatina","variants":[{"price":49900,"sku":"C-1","servings_per_container":"muchas"}]}')),
  'validation_failed/variants', 'porciones numéricas');

select public.catalog_publish_product(tests.fx('store_a'), tests.fx('prod'));
select tests.logout();
select is((select v ->> 'net_content' || '|' || (v ->> 'servings_per_container')
             from jsonb_array_elements(storefront.get_product(tests.fx('store_a'), 'proteina') -> 'variants') v
            where v ->> 'sku' = 'P-2'), '2 kg|66', 'la tienda publica el contenido y las porciones de la variante');
select is((select v -> 'net_content' from jsonb_array_elements(storefront.get_product(tests.fx('store_a'), 'proteina') -> 'variants') v
            where v ->> 'sku' = 'P-1'), 'null'::jsonb, 'sin dato en la variante: null (vale el del producto)');

select * from finish();
rollback;
