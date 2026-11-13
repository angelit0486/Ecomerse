-- =============================================================================
-- Alertas de Inicio (Orden 10, O10-02): cada conteo de `store_alerts` es el
-- número de filas que muestra la lista de productos con el mismo pendiente
-- (`catalog_search_products`, estado activo); el pendiente nuevo
-- `sin_categoria`; permisos por rol y aislamiento entre tiendas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
select tests.create_user('designer', 'designer@a.io');
select tests.add_store_member('a', 'designer', 'designer');

create function tests.variant_of(p_store uuid, p_sku text) returns uuid language sql security definer set search_path = '' as $$
  select v.id from public.product_variants v where v.store_id = p_store and v.sku = p_sku $$;
create function tests.ready_photo(p_store uuid, p_slug text) returns void language sql security definer set search_path = '' as $$
  insert into public.media (store_id, owner_type, product_id, status, storage_path, mime_type, bytes, position, width, height)
  select p.store_id, 'product', p.id, 'ready', p.store_id || '/product/' || p.id || '/' || gen_random_uuid() || '/original.jpg',
         'image/jpeg', 1000, 0, 800, 800
    from public.products p where p.store_id = p_store and p.slug = p_slug $$;
grant execute on all functions in schema tests to authenticated;

create function pg_temp.alerts(p_store uuid) returns jsonb language sql as $$ select public.store_alerts(p_store) $$;
create function pg_temp.listed(p_store uuid, p_issue text) returns integer language sql as $$
  select count(*)::integer from public.catalog_search_products(p_store, null, 'active', null, false, null, 100, null, p_issue) $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics v_msg = message_text; return v_msg; end $$;
create function pg_temp.product(p_title text, p_slug text, p_sku text, p_categorized boolean) returns void language sql as $$
  select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
    jsonb_build_object('title', p_title, 'slug', p_slug,
      'categories', case when p_categorized then jsonb_build_array(jsonb_build_object('id', tests.fx('cat'), 'is_primary', true)) else '[]'::jsonb end,
      'variants', jsonb_build_array(jsonb_build_object('price', 100, 'sku', p_sku)))) ->> 'id')::uuid) $$;

select tests.login('owner');
select tests.set_fx('cat', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Ropa"}'));
-- Con existencias, foto y categoría: ninguna alerta.
select pg_temp.product('Completo', 'completo', 'COM-1', true);
select public.inventory_adjust(tests.fx('store_a'), tests.variant_of(tests.fx('store_a'), 'COM-1'), 'adjustment', 20, 'conteo', 'set');
-- Agotado, sin foto y sin categoría.
select pg_temp.product('Agotado', 'agotado', 'AGO-1', false);
-- Pocas existencias, con categoría.
select pg_temp.product('Pocas', 'pocas', 'POC-1', true);
select public.inventory_adjust(tests.fx('store_a'), tests.variant_of(tests.fx('store_a'), 'POC-1'), 'adjustment', 2, 'conteo', 'set');
select public.inventory_set_threshold(tests.fx('store_a'), tests.variant_of(tests.fx('store_a'), 'POC-1'), 5);
-- Borrador agotado y sin nada: no cuenta (solo productos publicados).
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Borrador","slug":"borrador","variants":[{"price":100,"sku":"BOR-1"}]}');
select tests.logout();
select tests.ready_photo(tests.fx('store_a'), 'completo');
select tests.ready_photo(tests.fx('store_a'), 'pocas');

-- La otra tienda tiene sus propios pendientes, que A nunca debe contar.
select tests.login('owner_b');
select public.catalog_publish_product(tests.fx('store_b'), (public.catalog_upsert_product(tests.fx('store_b'),
  '{"title":"Ajeno","slug":"ajeno","variants":[{"price":100,"sku":"AJE-1"}]}') ->> 'id')::uuid);
select tests.logout();

-- ------------------------------------------------- 0. Interruptor (D6, Orden 10 M4)
-- Apagado (como nace toda tienda): la función responde not_found también por la API.
select tests.login('owner');
select is(pg_temp.err(format('select public.store_alerts(%L)', tests.fx('store_a'))), 'not_found',
          'con «Salud de tu tienda» apagada no hay alertas, ni llamando a la API');
select tests.logout();
insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
values ('store_health', 'store', tests.fx('store_a'), true, 'pgTAP alertas'),
       ('store_health', 'store', tests.fx('store_b'), true, 'pgTAP alertas');

select ok(app.flag_enabled('store_health', tests.fx('store_a')), 'el interruptor queda encendido para la tienda');

-- ------------------------------------------------- 1. Conteos
select tests.login('owner');
select is(pg_temp.alerts(tests.fx('store_a')),
          '{"out_of_stock": 1, "low_stock": 1, "without_photo": 1, "without_category": 1}'::jsonb,
          'cuenta solo los productos publicados de la tienda');

-- ------------------------------------------------- 2. Cada conteo = filas de su lista
select is(pg_temp.listed(tests.fx('store_a'), 'agotados'), (pg_temp.alerts(tests.fx('store_a')) ->> 'out_of_stock')::integer,
          'agotados: el conteo es lo que muestra la lista');
select is(pg_temp.listed(tests.fx('store_a'), 'sin_foto'), (pg_temp.alerts(tests.fx('store_a')) ->> 'without_photo')::integer,
          'sin foto: el conteo es lo que muestra la lista');
select is(pg_temp.listed(tests.fx('store_a'), 'pocas_existencias'), (pg_temp.alerts(tests.fx('store_a')) ->> 'low_stock')::integer,
          'pocas existencias: el conteo es lo que muestra la lista');
select is(pg_temp.listed(tests.fx('store_a'), 'sin_categoria'), (pg_temp.alerts(tests.fx('store_a')) ->> 'without_category')::integer,
          'sin categoría: el conteo es lo que muestra la lista');
select is((select array_agg(r.slug order by r.slug) from public.catalog_search_products(tests.fx('store_a'), null, 'active', null, false, null, 100, null, 'sin_categoria') r),
          array['agotado'], 'el pendiente nuevo «sin_categoria» filtra lo correcto');

-- ------------------------------------------------- 3. Al resolverlo, la alerta baja
select public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object('id', (select id from public.products where slug = 'agotado' and store_id = tests.fx('store_a')),
  'title', 'Agotado', 'slug', 'agotado',
  'categories', jsonb_build_array(jsonb_build_object('id', tests.fx('cat'), 'is_primary', true)),
  'variants', jsonb_build_array(jsonb_build_object('id', tests.variant_of(tests.fx('store_a'), 'AGO-1'), 'price', 100, 'sku', 'AGO-1'))));
select is((pg_temp.alerts(tests.fx('store_a')) ->> 'without_category')::integer, 0, 'con categoría deja de contar');
select public.inventory_adjust(tests.fx('store_a'), tests.variant_of(tests.fx('store_a'), 'AGO-1'), 'adjustment', 9, 'conteo', 'set');
select is((pg_temp.alerts(tests.fx('store_a')) ->> 'out_of_stock')::integer, 0, 'con existencias deja de contar');
select tests.logout();

-- ------------------------------------------------- 4. Permisos y aislamiento
select tests.login('designer');
select is(pg_temp.alerts(tests.fx('store_a')) -> 'out_of_stock', 'null'::jsonb,
          'sin permiso de inventario: no hay conteo de existencias');
select is((pg_temp.alerts(tests.fx('store_a')) ->> 'without_photo')::integer, 1, 'pero sí de fotos');
select tests.logout();

select tests.login('owner_b');
select is(pg_temp.err(format('select public.store_alerts(%L)', tests.fx('store_a'))), 'forbidden',
          'otra tienda no puede pedir las alertas de A');
select is(pg_temp.err(format('select * from public.catalog_search_products(%L, null, null, null, false, null, 10, null, %L)', tests.fx('store_a'), 'sin_categoria')),
          'forbidden', 'ni su lista sin categoría');
select is((pg_temp.alerts(tests.fx('store_b')) ->> 'without_photo')::integer, 1, 'B solo ve lo suyo');
select tests.logout();

select tests.login('owner');
select is(pg_temp.err(format('select * from public.catalog_search_products(%L, null, null, null, false, null, 10, null, %L)', tests.fx('store_a'), 'otro')),
          'validation_failed', 'un pendiente desconocido se rechaza');
select tests.logout();
select ok(not has_function_privilege('anon', 'public.store_alerts(uuid)', 'execute')
          and not has_function_privilege('storefront_gateway', 'public.store_alerts(uuid)', 'execute'),
          'ni anon ni la tienda pública ejecutan la función');
select is(public.app_schema_version(), '20261113000300', 'versión de la base');

select * from finish();
rollback;
