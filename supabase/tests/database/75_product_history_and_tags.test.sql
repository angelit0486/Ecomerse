-- =============================================================================
-- Panel de productos, tanda 6: historial del producto y etiquetas en bloque.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

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
select tests.create_user('mkt', 'mkt@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'mkt', 'marketing_manager');

select tests.login('owner');
select tests.set_fx('p1', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Whey","tags":["proteína"],"variants":[{"price":69900,"sku":"HT-1"}]}') ->> 'id')::uuid);
select tests.set_fx('p2', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Creatina","variants":[{"price":49900,"sku":"HT-2"}]}') ->> 'id')::uuid);
select public.catalog_set_variant_prices(tests.fx('store_a'), tests.fx('p1'),
  jsonb_build_array(jsonb_build_object('id', (select id from public.product_variants where sku = 'HT-1'), 'price', 64900)));

-- ============================================================================ Etiquetas en bloque
select is(public.catalog_bulk_tags(tests.fx('store_a'), array[tests.fx('p1'), tests.fx('p2')], ' Oferta ', 'add') ->> 'changed',
          '2', 'agregar una etiqueta a dos productos');
select is((select array_agg(array_to_string(tags, ',') order by title) from public.products where store_id = tests.fx('store_a')),
          array['Oferta', 'proteína,Oferta'], 'se agrega recortada y al final');
select is(public.catalog_bulk_tags(tests.fx('store_a'), array[tests.fx('p1')], 'oferta', 'add') ->> 'changed',
          '0', 'sin duplicar (no distingue mayúsculas)');
select is(public.catalog_bulk_tags(tests.fx('store_a'), array[tests.fx('p1'), tests.fx('p2')], 'OFERTA', 'remove') ->> 'changed',
          '2', 'quitar la etiqueta');
select is((select tags from public.products where id = tests.fx('p1')), array['proteína'], 'las demás se conservan');
select is(pg_temp.err(format($$select public.catalog_bulk_tags(%L, array[%L]::uuid[], %L, 'add')$$,
            tests.fx('store_a'), tests.fx('p1'), repeat('x', 61))), 'validation_failed/tags', 'más de 60 caracteres: rechazada');
select is(pg_temp.err(format($$select public.catalog_bulk_tags(%L, array[%L]::uuid[], '   ', 'add')$$,
            tests.fx('store_a'), tests.fx('p1'))), 'validation_failed/tags', 'vacía: rechazada');

-- ============================================================================ Historial
-- En una transacción todo comparte now(): se comparan los eventos, no su orden.
select is((select array_agg(e ->> 'action' order by e ->> 'action') from jsonb_array_elements(
             public.catalog_product_history(tests.fx('store_a'), tests.fx('p1'), 10)) e),
          array['product.created', 'product.prices_updated', 'product.updated', 'product.updated'],
          'los cambios del producto');
select is((select e -> 'before' -> 'variants' -> 0 ->> 'price' from jsonb_array_elements(
             public.catalog_product_history(tests.fx('store_a'), tests.fx('p1'), 10)) e
            where e ->> 'action' = 'product.prices_updated'), '69900', 'con el precio anterior');
select is((select array_agg(distinct e ->> 'actor_label') from jsonb_array_elements(
             public.catalog_product_history(tests.fx('store_a'), tests.fx('p1'), 10)) e),
          array['owner@a.io'], 'y quién lo hizo');
select is(jsonb_array_length(public.catalog_product_history(tests.fx('store_a'), tests.fx('p1'), 1)), 1, 'respeta el límite');
select tests.logout();

select tests.login('mkt');
select is(pg_temp.err(format($$select public.catalog_product_history(%L, %L, 10)$$, tests.fx('store_a'), tests.fx('p1'))),
          'forbidden', 'sin audit.read no se ve el historial');
select tests.logout();

select tests.login('owner_b');
select is(pg_temp.err(format($$select public.catalog_product_history(%L, %L, 10)$$, tests.fx('store_b'), tests.fx('p1'))),
          'not_found/product', 'otra tienda no ve el historial de este producto');
select tests.logout();

select * from finish();
rollback;
