-- =============================================================================
-- Gate F3 · regresiones de la revisión de código (20261010000100).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
create function tests.up(p jsonb) returns jsonb language sql as
  $$ select public.catalog_upsert_product(tests.fx('store_a'), p) $$;
grant execute on all functions in schema tests to authenticated;

select tests.login('owner');

-- Un SKU pasa de la variante retirada a la nueva en el mismo guardado.
select tests.set_fx('p1', (tests.up('{"title":"Gorra","variants":[{"price":100,"sku":"GOR-1"}]}') ->> 'id')::uuid);
select lives_ok(format($$ select tests.up('{"id":"%s","title":"Gorra","options":[{"name":"Color","values":["Rojo","Azul"]}],
  "variants":[{"options":{"Color":"Rojo"},"price":100,"sku":"GOR-1"},{"options":{"Color":"Azul"},"price":100}]}') $$,
  tests.fx('p1')), 'agregar opciones reutilizando el SKU de la variante única');
select is((select count(*)::int from public.product_variants where product_id = tests.fx('p1') and deleted_at is null), 2,
  'quedan las dos variantes nuevas');
select is((select option_signature from public.product_variants where sku = 'GOR-1' and deleted_at is null
            and store_id = tests.fx('store_a')), 'Color=Rojo', 'el SKU quedó en la variante nueva');

-- Lo que el payload no trae se conserva.
select tests.logout();
update public.product_variants set weight_g = 250, inventory_policy = 'continue'
 where product_id = tests.fx('p1') and deleted_at is null;
update public.products set specs = '{"material":"algodón"}' where id = tests.fx('p1');
select tests.login('owner');
select tests.up(format('{"id":"%s","title":"Gorra roja","options":[{"name":"Color","values":["Rojo","Azul"]}],
  "variants":[{"options":{"Color":"Rojo"},"price":150,"sku":"GOR-1"},{"options":{"Color":"Azul"},"price":150}]}',
  tests.fx('p1'))::jsonb);
select is((select count(*)::int from public.product_variants where product_id = tests.fx('p1') and deleted_at is null
            and weight_g = 250 and inventory_policy = 'continue' and price = 150), 2,
  'peso e inventario se conservan; el precio se actualiza');
select is((select specs ->> 'material' from public.products where id = tests.fx('p1')), 'algodón', 'specs se conserva');

-- Categorías: renombrar conserva slug, visibilidad y descripción.
select tests.set_fx('c1', public.catalog_upsert_category(tests.fx('store_a'),
  '{"name":"Ropa","is_visible":false,"description":"Todo"}'));
select public.catalog_upsert_category(tests.fx('store_a'), format('{"id":"%s","name":"Ropa y más"}', tests.fx('c1'))::jsonb);
select is((select slug || ':' || is_visible || ':' || description from public.categories where id = tests.fx('c1')),
  'ropa:false:Todo', 'renombrar no cambia la dirección ni la visibilidad ni la descripción');
select public.catalog_upsert_category(tests.fx('store_a'),
  format('{"id":"%s","name":"Ropa y más","is_visible":true}', tests.fx('c1'))::jsonb);
select is((select is_visible from public.categories where id = tests.fx('c1')), true, 'is_visible enviado se aplica');

-- Cursor: el producto del SKU exacto no se repite en la página siguiente.
select tests.up('{"title":"Camisa vieja","variants":[{"price":100,"sku":"CAMISA"}]}');
select tests.logout();
update public.products set updated_at = now() - interval '1 hour' where title = 'Camisa vieja';
select tests.login('owner');
select tests.up('{"title":"Camisa uno","variants":[{"price":100}]}');
select tests.up('{"title":"Camisa dos","variants":[{"price":100}]}');
select tests.up('{"title":"Camisa tres","variants":[{"price":100}]}');
create temp table page1 as
  select * from public.catalog_search_products(tests.fx('store_a'), 'camisa', null, null, false, null, 2);
select is((select title from page1 limit 1), 'Camisa vieja', 'el SKU exacto encabeza la primera página');
select is((select string_agg(title, ',' order by updated_at desc, id desc)
             from public.catalog_search_products(tests.fx('store_a'), 'camisa', null, null, false,
               (select jsonb_build_object('updated_at', updated_at, 'id', id) from page1 offset 1 limit 1), 10)
            where title = 'Camisa vieja'), null, 'y no se repite en la segunda');

-- Revisión de seguridad: un producto publicado no se edita a no publicable.
select tests.logout();
update public.products set status = 'active', published_at = now() where id = tests.fx('p1');
select tests.login('owner');
select throws_ok(format($$ select tests.up('{"id":"%s","title":"Gorra roja","options":[{"name":"Color","values":["Rojo","Azul"]}],
  "variants":[{"options":{"Color":"Rojo"},"price":0,"sku":"GOR-1"},{"options":{"Color":"Azul"},"price":150}]}') $$,
  tests.fx('p1')), 'P0001', 'validation_failed', 'publicado con precio 0: rechazado');
select throws_ok(format($$ select tests.up('{"id":"%s","title":"Gorra roja","options":[{"name":"Color","values":["Rojo","Azul"]}],
  "variants":[{"options":{"Color":"Rojo"},"price":150,"status":"inactive"},{"options":{"Color":"Azul"},"price":150,"status":"inactive"}]}') $$,
  tests.fx('p1')), 'P0001', 'validation_failed', 'publicado sin variantes activas: rechazado');
select throws_ok(format($$ select tests.up('{"title":"Etiquetas","tags":["%s"],"variants":[{"price":1}]}') $$, repeat('x', 61)),
  'P0001', 'validation_failed', 'etiqueta de más de 60 caracteres: rechazada en la base');
select throws_ok($$ select tests.up(jsonb_build_object('title', 'Specs', 'specs', jsonb_build_object('x', repeat('y', 20000)),
  'variants', jsonb_build_array(jsonb_build_object('price', 1)))) $$,
  'P0001', 'validation_failed', 'specs de más de 16 KB: rechazado en la base');
select lives_ok($$ select tests.up('{"title":"Lote 1","variants":[{"price":1}]}'), tests.up('{"title":"Lote 2","options":[{"name":"T","values":["A","B"]}],"variants":[{"options":{"T":"A"},"price":1},{"options":{"T":"B"},"price":1}]}') $$,
  'dos altas en la misma transacción (importación por lotes)');
select tests.logout();
insert into public.media (id, store_id, owner_type, status, storage_path, mime_type, bytes)
values ('0190a0d0-0000-7000-8000-0000000000aa', tests.fx('store_a'), 'banner', 'pending',
        tests.fx('store_a') || '/banner/x/0190a0d0-0000-7000-8000-0000000000aa/original.png', 'image/png', 1234);
select is((select declared_bytes from system.media_for_processing('0190a0d0-0000-7000-8000-0000000000aa')), 1234::bigint,
  'el worker recibe el tamaño declarado');

select * from finish();
rollback;
