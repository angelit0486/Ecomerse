-- =============================================================================
-- Disponibilidad en lote (2026-11-11, CAP-02): `app.product_states` da el mismo
-- estado que `app.product_state` producto por producto; «solo disponibles» y
-- «relacionados» devuelven lo mismo que antes y no mezclan tiendas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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
create function tests.variant(p_sku text) returns uuid language sql security definer set search_path = '' as $$
  select v.id from public.product_variants v where v.sku = p_sku and v.store_id = tests.fx('store_a') $$;
-- Estados por lote y uno por uno, para todos los productos de la tienda A.
create function tests.states_batch() returns text[] language sql security definer set search_path = '' as $$
  select coalesce(array_agg(p.slug || '=' || coalesce(s.state, 'out_of_stock') order by p.slug), '{}')
    from public.products p
    left join app.product_states(tests.fx('store_a'),
                                 (select array_agg(x.id) from public.products x)) s on s.product_id = p.id
   where p.store_id = tests.fx('store_a') $$;
create function tests.states_single() returns text[] language sql security definer set search_path = '' as $$
  select coalesce(array_agg(p.slug || '=' || app.product_state(p.store_id, p.id) order by p.slug), '{}')
    from public.products p where p.store_id = tests.fx('store_a') $$;
create function tests.foreign_states() returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer
    from app.product_states(tests.fx('store_a'), (select array_agg(x.id) from public.products x
                                                   where x.store_id = tests.fx('store_b'))) $$;
grant execute on all functions in schema tests to authenticated, storefront_gateway;

create function pg_temp.titles(p_sql text) returns text[] language sql as $$
  select coalesce(array_agg(x ->> 'title' order by x ->> 'title'), '{}') from jsonb_array_elements(tests.gw(p_sql)) x $$;
create function pg_temp.product(p_title text, p_slug text, p_variants jsonb) returns void language sql as $$
  select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
    jsonb_build_object('title', p_title, 'slug', p_slug,
                       'categories', jsonb_build_array(jsonb_build_object('id', tests.fx('cat'), 'is_primary', true)),
                       'options', case when jsonb_array_length(p_variants) > 1
                                       then '[{"name":"Talla","values":["CH","G"]}]'::jsonb else '[]'::jsonb end,
                       'variants', p_variants)) ->> 'id')::uuid) $$;

select tests.login('owner');
select tests.set_fx('cat', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Ropa"}'));
select pg_temp.product('Con existencias', 'con', '[{"price":100,"sku":"CON-1"}]');
select pg_temp.product('Agotado', 'agotado', '[{"price":100,"sku":"AGO-1"}]');
select pg_temp.product('Bajo pedido', 'pedido', '[{"price":100,"sku":"PED-1","inventory_policy":"continue"}]');
select pg_temp.product('Sin control', 'libre', '[{"price":100,"sku":"LIB-1","track_inventory":false}]');
select pg_temp.product('Pocas piezas', 'pocas', '[{"price":100,"sku":"POC-1"}]');
select pg_temp.product('Una talla sí', 'mixto',
  '[{"options":{"Talla":"CH"},"price":100,"sku":"MIX-CH"},{"options":{"Talla":"G"},"price":100,"sku":"MIX-G"}]');
select public.inventory_adjust(tests.fx('store_a'), tests.variant('CON-1'), 'adjustment', 20, 'conteo', 'set');
select public.inventory_adjust(tests.fx('store_a'), tests.variant('POC-1'), 'adjustment', 2, 'conteo', 'set');
select public.inventory_set_threshold(tests.fx('store_a'), tests.variant('POC-1'), 5);
select public.inventory_adjust(tests.fx('store_a'), tests.variant('MIX-G'), 'adjustment', 3, 'conteo', 'set');
select tests.logout();
select tests.login('owner_b');
select public.catalog_publish_product(tests.fx('store_b'), (public.catalog_upsert_product(tests.fx('store_b'),
  '{"title":"De otra tienda","slug":"ajeno","variants":[{"price":100,"sku":"AJE-1","track_inventory":false}]}') ->> 'id')::uuid);
select tests.logout();

-- ------------------------------------------------- 1. Mismo estado que uno por uno
select is(tests.states_batch(), tests.states_single(), 'por lote = producto por producto');
select is(tests.states_batch(),
          array['agotado=out_of_stock', 'con=in_stock', 'libre=in_stock', 'mixto=in_stock', 'pedido=backorder',
                'pocas=low_stock'],
          'y son los estados esperados');
select is(tests.foreign_states(), 0, 'ids de otra tienda no devuelven nada');
select is((select count(*)::integer from app.product_states(tests.fx('store_a'), null)), 0, 'sin lista: nada');

-- ------------------------------------------------- 2. «Solo disponibles»
select is(pg_temp.titles(format('select storefront.list_products(%L, p_available => true) -> ''items''', tests.fx('store_a'))),
          array['Bajo pedido', 'Con existencias', 'Pocas piezas', 'Sin control', 'Una talla sí'],
          'el agotado no sale; bajo pedido y pocas piezas sí');
select is((tests.gw(format('select storefront.list_products(%L, p_available => true) -> ''total''', tests.fx('store_a'))))::text,
          '5', 'y el total coincide');
select is(pg_temp.titles(format('select storefront.list_products(%L) -> ''items''', tests.fx('store_a'))),
          array['Agotado', 'Bajo pedido', 'Con existencias', 'Pocas piezas', 'Sin control', 'Una talla sí'],
          'sin el filtro salen todos');
select is(pg_temp.titles(format('select storefront.list_products(%L, p_available => true, p_limit => 2) -> ''items''',
                                tests.fx('store_a'))) <@ array['Bajo pedido', 'Con existencias', 'Pocas piezas', 'Sin control', 'Una talla sí']
          and jsonb_array_length(tests.gw(format('select storefront.list_products(%L, p_available => true, p_limit => 2) -> ''items''',
                                tests.fx('store_a')))) = 2,
          true, 'con páginas de 2 sigue sin salir el agotado');

-- ------------------------------------------------- 3. Relacionados
select is(pg_temp.titles(format('select storefront.related_products(%L, %L)', tests.fx('store_a'), 'con')),
          array['Bajo pedido', 'Pocas piezas', 'Sin control', 'Una talla sí'],
          'misma categoría, sin el agotado ni el propio producto');
select is(pg_temp.titles(format('select storefront.related_products(%L, %L)', tests.fx('store_b'), 'ajeno')),
          '{}'::text[], 'la otra tienda no recibe productos de A');

-- ------------------------------------------------- 4. Quién ejecuta qué
select ok(not has_function_privilege('authenticated', 'app.product_states(uuid, uuid[])', 'execute')
          and not has_function_privilege('anon', 'app.product_states(uuid, uuid[])', 'execute')
          and not has_function_privilege('storefront_gateway', 'app.product_states(uuid, uuid[])', 'execute'),
          'la función de lote no se expone');

select * from finish();
rollback;
