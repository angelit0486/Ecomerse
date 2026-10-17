-- =============================================================================
-- Panel de productos, tanda 4: marca, categoría y precios en bloque.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
create function pg_temp.audits(p_action text) returns integer language sql security definer as $$
  select count(*)::int from audit.audit_logs where action = p_action and metadata ->> 'bulk' = 'true'
$$;
create function pg_temp.prices(p_product uuid) returns text language sql security definer as $$
  select string_agg(v.sku || '=' || v.price || coalesce('/' || v.compare_at_price, ''), ',' order by v.sku)
    from public.product_variants v where v.product_id = p_product and v.deleted_at is null
$$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'viewer', 'viewer');

select tests.login('owner');
select tests.set_fx('atlas', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Atlas"}'));
select tests.set_fx('cat', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Proteínas"}'));
select tests.set_fx('cat2', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Ofertas"}'));
select tests.set_fx('p1', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Whey","options":[{"name":"Tamaño","values":["1 kg","2 kg"]}],
    "variants":[{"price":69900,"sku":"BK-1","compare_at_price":79900,"options":{"Tamaño":"1 kg"}},
                {"price":10050,"sku":"BK-2","options":{"Tamaño":"2 kg"}}]}') ->> 'id')::uuid);
select tests.set_fx('p2', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Creatina","variants":[{"price":49900,"sku":"BK-3"}]}') ->> 'id')::uuid);
select tests.logout();
select tests.login('owner_b');
select tests.set_fx('pb', (public.catalog_upsert_product(tests.fx('store_b'),
  '{"title":"Ajeno","variants":[{"price":100,"sku":"BK-B"}]}') ->> 'id')::uuid);
select tests.set_fx('brand_b', public.catalog_upsert_brand(tests.fx('store_b'), '{"name":"Ajena"}'));
select tests.logout();

select tests.login('owner');
-- ============================================================================ Marca
select is(public.catalog_bulk_set_brand(tests.fx('store_a'), array[tests.fx('p1'), tests.fx('p2')], tests.fx('atlas')) ->> 'changed',
          '2', 'misma marca para dos productos');
select is((select count(*)::int from public.products where brand_id = tests.fx('atlas')), 2, 'ambos quedan con la marca');
select is(public.catalog_bulk_set_brand(tests.fx('store_a'), array[tests.fx('p1')], tests.fx('atlas')) ->> 'changed',
          '0', 'repetir no cambia nada');
select is(public.catalog_bulk_set_brand(tests.fx('store_a'), array[tests.fx('p2')], null) ->> 'changed',
          '1', 'quitar la marca');
select is(pg_temp.err(format($$select public.catalog_bulk_set_brand(%L, array[%L]::uuid[], %L)$$,
            tests.fx('store_a'), tests.fx('p1'), tests.fx('brand_b'))), 'validation_failed/brand_id',
          'una marca de otra tienda: rechazada');
select is(pg_temp.err(format($$select public.catalog_bulk_set_brand(%L, array[%L, %L]::uuid[], %L)$$,
            tests.fx('store_a'), tests.fx('p1'), tests.fx('pb'), tests.fx('atlas'))), 'not_found/product',
          'un producto de otra tienda en la selección: nada se aplica');

-- ============================================================================ Categoría
select is(public.catalog_bulk_category(tests.fx('store_a'), array[tests.fx('p1'), tests.fx('p2')], tests.fx('cat'), 'add') ->> 'changed',
          '2', 'agregar una categoría a dos productos');
select is((select count(*)::int from public.product_categories where category_id = tests.fx('cat') and is_primary), 2,
          'sin categorías previas, queda como principal');
select is(public.catalog_bulk_category(tests.fx('store_a'), array[tests.fx('p1')], tests.fx('cat2'), 'add') ->> 'changed',
          '1', 'una segunda categoría');
select is((select is_primary from public.product_categories where product_id = tests.fx('p1') and category_id = tests.fx('cat2')),
          false, 'la segunda no reemplaza a la principal');
select is(public.catalog_bulk_category(tests.fx('store_a'), array[tests.fx('p1'), tests.fx('p2')], tests.fx('cat2'), 'remove') ->> 'changed',
          '1', 'quitar solo cambia a quien la tenía');
select is(pg_temp.err(format($$select public.catalog_bulk_category(%L, array[%L]::uuid[], %L, 'mover')$$,
            tests.fx('store_a'), tests.fx('p1'), tests.fx('cat'))), 'validation_failed/mode', 'modo desconocido: rechazado');

-- ============================================================================ Precios por porcentaje
select is((public.catalog_bulk_adjust_prices(tests.fx('store_a'), array[tests.fx('p1')], 10, 'centavo', false) -> 'rows' -> 0
           ->> 'new_price'), '76890', 'vista previa: +10 % al centavo');
select is(pg_temp.prices(tests.fx('p1')), 'BK-1=69900/79900,BK-2=10050', 'la vista previa no escribe nada');
select is((select jsonb_agg(r ->> 'new_price' order by r ->> 'sku') from jsonb_array_elements(
             public.catalog_bulk_adjust_prices(tests.fx('store_a'), array[tests.fx('p1')], 10, 'peso', false) -> 'rows') r),
          '["76900", "11100"]'::jsonb, 'redondeo al peso');
select is((select r -> 'new_compare_at_price' from jsonb_array_elements(
             public.catalog_bulk_adjust_prices(tests.fx('store_a'), array[tests.fx('p1')], 20, 'centavo', false) -> 'rows') r
            where r ->> 'sku' = 'BK-1'), 'null'::jsonb, 'si el precio antes deja de ser mayor, se quita');
select is((public.catalog_bulk_adjust_prices(tests.fx('store_a'), array[tests.fx('p1'), tests.fx('p2')], -10, 'centavo', true)
           ->> 'applied'), 'true', 'aplicar −10 %');
select is(pg_temp.prices(tests.fx('p1')) || ';' || pg_temp.prices(tests.fx('p2')), 'BK-1=62910/79900,BK-2=9045;BK-3=44910',
          'precios guardados (el precio antes se conserva)');
select lives_ok('set constraints all immediate', 'las validaciones diferidas pasan');
select is(pg_temp.err(format($$select public.catalog_bulk_adjust_prices(%L, array[%L]::uuid[], -95, 'centavo', true)$$,
            tests.fx('store_a'), tests.fx('p1'))), 'validation_failed/percent', 'más de −90 %: rechazado');
select is(pg_temp.err(format($$select public.catalog_bulk_adjust_prices(%L, array[%L]::uuid[], 10.123, 'centavo', true)$$,
            tests.fx('store_a'), tests.fx('p1'))), 'validation_failed/percent', 'más de dos decimales: rechazado');
select is(pg_temp.audits('product.prices_updated') || '/' || pg_temp.audits('product.updated'), '2/7',
          'cada producto cambiado queda auditado');
select tests.logout();

select tests.login('viewer');
select is(pg_temp.err(format($$select public.catalog_bulk_adjust_prices(%L, array[%L]::uuid[], 10, 'centavo', false)$$,
            tests.fx('store_a'), tests.fx('p1'))), 'forbidden', 'sin products.update ni siquiera la vista previa');
select tests.logout();

select tests.login('owner_b');
select is(pg_temp.err(format($$select public.catalog_bulk_adjust_prices(%L, array[%L]::uuid[], 10, 'centavo', false)$$,
            tests.fx('store_b'), tests.fx('p1'))) || ':' ||
          jsonb_array_length(public.catalog_bulk_adjust_prices(tests.fx('store_b'), array[tests.fx('p1')], 10, 'centavo', false) -> 'rows'),
          'ok:0', 'con su tienda no ve los productos de A');
select tests.logout();

select * from finish();
rollback;
