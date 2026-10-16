-- =============================================================================
-- Revisión de conversión: fecha de apertura pública (M8, 20261017000700), total
-- del listado (M6, 20261017000800) y portada sin productos repetidos (M9,
-- 20261017000900).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');

create function pg_temp.gw(p_fn text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'storefront_gateway', true);
  execute format('select storefront.%I(%L)', p_fn, tests.fx('store_a')) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function pg_temp.sec(p_n integer, p_props jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', '00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'),
                            'type', 'featured_products', 'enabled', true, 'props', p_props)
$$;
grant execute on all functions in schema tests to authenticated;

-- M8
select is(pg_temp.gw('get_store_preview') -> 'launched_at', 'null'::jsonb,
          'sin abrir, la fecha de apertura es null');
update public.stores set status = 'active', launched_at = '2026-10-01T12:00:00Z' where id = tests.fx('store_a');
select is((pg_temp.gw('get_store_public') ->> 'launched_at')::timestamptz, '2026-10-01T12:00:00Z'::timestamptz,
          'la tienda pública expone su fecha de apertura');
select is((pg_temp.gw('get_store_preview') ->> 'launched_at')::timestamptz, '2026-10-01T12:00:00Z'::timestamptz,
          'la vista previa también');
select is(pg_temp.gw('get_store_public') ->> 'timezone', (select timezone from public.stores where id = tests.fx('store_a')),
          'y su zona horaria (B4, 20261017001000)');

-- Cinco productos publicados, con existencias.
select tests.login('owner');
create function pg_temp.product(p_n integer) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object('title', 'Producto ' || p_n,
          'slug', 'producto-' || p_n, 'variants', '[{"price":19900}]'::jsonb)) ->> 'id')::uuid;
  perform public.catalog_publish_product(tests.fx('store_a'), v);
  return v;
end $$;
select pg_temp.product(n) from generate_series(1, 5) n;
select tests.logout();
update public.product_variants set track_inventory = false where store_id = tests.fx('store_a');

-- M6
create function pg_temp.list(p_cursor jsonb, p_limit integer) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'storefront_gateway', true);
  v := storefront.list_products(tests.fx('store_a'), p_cursor => p_cursor, p_limit => p_limit);
  perform set_config('role', 'none', true);
  return v;
end $$;
select is((pg_temp.list(null, 2) ->> 'total')::integer, 5, 'la primera página trae el total de resultados');
select is(jsonb_array_length(pg_temp.list(null, 2) -> 'items'), 2, 'y solo los productos de la página');
select is(pg_temp.list(pg_temp.list(null, 2) -> 'next_cursor', 2) -> 'total', 'null'::jsonb,
          'las páginas siguientes no pagan el conteo');

-- M9
create function pg_temp.ids(p_section jsonb) returns text[] language sql as $$
  select array(select e ->> 'id' from jsonb_array_elements(p_section -> 'items') e)
$$;
select is(cardinality(pg_temp.ids(app.home_resolve(tests.fx('store_a'), jsonb_build_array(
            pg_temp.sec(1, '{"title":"A","limit":4,"show_view_all":false,"source":{"type":"newest"}}'),
            pg_temp.sec(2, '{"title":"B","limit":4,"show_view_all":false,"source":{"type":"best_selling"}}'))) -> 1)),
          1, 'la segunda sección omite los 4 que ya mostró la primera');
select ok(not (pg_temp.ids(app.home_resolve(tests.fx('store_a'), jsonb_build_array(
            pg_temp.sec(1, '{"title":"A","limit":4,"show_view_all":false,"source":{"type":"newest"}}'),
            pg_temp.sec(2, '{"title":"B","limit":4,"show_view_all":false,"source":{"type":"best_selling"}}'))) -> 1)
          && pg_temp.ids(app.home_resolve(tests.fx('store_a'), jsonb_build_array(
            pg_temp.sec(1, '{"title":"A","limit":4,"show_view_all":false,"source":{"type":"newest"}}'))) -> 0)),
          'sin productos en común entre secciones');
select is(jsonb_array_length(app.home_resolve(tests.fx('store_a'), jsonb_build_array(
            pg_temp.sec(1, '{"title":"A","limit":5,"show_view_all":false,"source":{"type":"newest"}}'),
            pg_temp.sec(2, '{"title":"B","limit":4,"show_view_all":false,"source":{"type":"best_selling"}}')))),
          1, 'una sección que se quedaría vacía no se muestra');

select * from finish();
rollback;
