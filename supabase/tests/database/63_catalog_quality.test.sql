-- =============================================================================
-- Calidad del catálogo (super prompt §16): avisos por producto (marca,
-- categoría, imagen, descripción, SKU, código de barras, peso) más los
-- bloqueos de publicación; permisos y aislamiento.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text;
  return v_msg;
end $$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');

select tests.login('owner');
select tests.set_fx('brand', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Atlas"}'));
select tests.set_fx('cat', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Proteínas"}'));
select tests.set_fx('completo', (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object(
  'title', 'Completo', 'brand_id', tests.fx('brand'), 'description_html', '<p>Descripción real.</p>',
  'categories', jsonb_build_array(jsonb_build_object('id', tests.fx('cat'), 'is_primary', true)),
  'variants', '[{"price":10000,"sku":"COM-1","barcode":"7501234567890","weight_g":950}]'::jsonb)) ->> 'id')::uuid);
select tests.set_fx('pobre', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Incompleto","variants":[{"price":0}]}') ->> 'id')::uuid);
select tests.set_fx('archivado', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Archivado","variants":[{"price":100}]}') ->> 'id')::uuid);
select tests.logout();
update public.products set status = 'archived' where id = tests.fx('archivado');
insert into public.media (store_id, owner_type, product_id, status, storage_path, alt_text)
values (tests.fx('store_a'), 'product', tests.fx('completo'), 'ready', 'q/completo.webp', 'Frasco');

select tests.login('owner');
select is((public.catalog_quality_report(tests.fx('store_a')) ->> 'total')::integer, 1,
          'solo el producto incompleto tiene avisos (el archivado no se revisa)');
select is((select x -> 'codes' from jsonb_array_elements(public.catalog_quality_report(tests.fx('store_a')) -> 'products') x
            where x ->> 'title' = 'Incompleto'),
          '["brand_missing","category_missing","image_missing","description_missing","variant_sku_missing","variant_barcode_missing","variant_weight_missing","price_zero"]'::jsonb,
          'con cada dato que le falta y el bloqueo de publicación');
select is((public.catalog_quality_report(tests.fx('store_a')) -> 'by_code' ->> 'image_missing')::integer, 1,
          'resumen por tipo de aviso');
select is((public.catalog_quality_report(tests.fx('store_a')) ->> 'checked')::integer, 2, 'revisó los 2 no archivados');
select tests.logout();

-- Un producto que no se envía no necesita peso.
update public.product_variants set requires_shipping = false where product_id = tests.fx('pobre');
select tests.login('owner');
select ok(not ((select x -> 'codes' from jsonb_array_elements(public.catalog_quality_report(tests.fx('store_a')) -> 'products') x
                 where x ->> 'title' = 'Incompleto') ? 'variant_weight_missing'),
          'sin envío, el peso no se pide');
select tests.logout();

select tests.login('owner_b');
select is(pg_temp.err(format('select public.catalog_quality_report(%L)', tests.fx('store_a'))), 'forbidden',
          'otra tienda no lo lee');
select is((public.catalog_quality_report(tests.fx('store_b')) ->> 'checked')::integer, 0, 'y la suya está vacía');
select tests.logout();
select is(tests.sqlstate_as('anon', format('select public.catalog_quality_report(%L)', tests.fx('store_a'))), '42501',
          'anon no lo ejecuta');

select * from finish();
rollback;
