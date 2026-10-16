-- =============================================================================
-- Descubrimiento (super prompt §5, §7 y §8): rango de precio y ofertas reales en
-- el listado y en los conteos de los filtros, directorio de marcas y resumen
-- del menú. Como storefront_gateway; nada de borradores ni de otra tienda.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

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

create function pg_temp.product(p_title text, p_brand uuid, p_variants jsonb, p_publish boolean default true)
returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object(
          'title', p_title, 'brand_id', p_brand, 'variants', p_variants)) ->> 'id')::uuid;
  if p_publish then perform public.catalog_publish_product(tests.fx('store_a'), v); end if;
  return v;
end $$;
-- Títulos del listado, en orden alfabético (el orden del listado no importa aquí).
create function pg_temp.titles(p_args text) returns text[] language sql as $$
  select coalesce(array_agg(x ->> 'title' order by x ->> 'title'), '{}')
    from jsonb_array_elements(tests.gw(format('select storefront.list_products(%L, %s) -> ''items''',
                                              tests.fx('store_a'), p_args))) x
$$;

select tests.login('owner');
select tests.set_fx('acme', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Acme"}'));
select tests.set_fx('zeta', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Zeta"}'));
select tests.set_fx('vacia', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Sin productos"}'));
select tests.set_fx('borr', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Solo borrador"}'));
select pg_temp.product('Barata', tests.fx('acme'), '[{"price":15000,"sku":"BAR-1"}]');
select pg_temp.product('Media en oferta', tests.fx('acme'), '[{"price":45000,"compare_at_price":52000,"sku":"MED-1"}]');
select pg_temp.product('Cara', tests.fx('zeta'), '[{"price":99900,"sku":"CAR-1"}]');
-- Oferta solo en una variante inactiva: no cuenta.
select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
  jsonb_build_object('title', 'Oferta inactiva', 'brand_id', tests.fx('zeta'),
    'options', '[{"name":"Tamaño","values":["1 kg","2 kg"]}]'::jsonb,
    'variants', '[{"options":{"Tamaño":"1 kg"},"price":30000,"sku":"INA-1"},
                  {"options":{"Tamaño":"2 kg"},"price":20000,"compare_at_price":40000,"sku":"INA-2","status":"inactive"}]'::jsonb))
  ->> 'id')::uuid);
select pg_temp.product('Borrador en oferta', tests.fx('borr'), '[{"price":10000,"compare_at_price":20000,"sku":"BOR-1"}]', false);
select tests.logout();

-- ============================================================================ Ofertas
select ok(app.product_on_sale(tests.fx('store_a'), (select id from public.products where title = 'Media en oferta')),
          'un precio de comparación mayor que el precio es una oferta');
select ok(not app.product_on_sale(tests.fx('store_a'), (select id from public.products where title = 'Oferta inactiva')),
          'una variante inactiva con descuento no hace oferta al producto');
select is(pg_temp.titles('p_on_sale => true'), array['Media en oferta'],
          'el listado de ofertas solo trae descuentos reales y publicados');
select is(pg_temp.titles('null'), array['Barata', 'Cara', 'Media en oferta', 'Oferta inactiva'],
          'sin el filtro el listado no cambia (los llamadores anteriores siguen igual)');

-- ============================================================================ Precio
select is(pg_temp.titles('p_min_price => 20000, p_max_price => 50099'), array['Media en oferta', 'Oferta inactiva'],
          'el rango de precio filtra por el precio desde');
select is(pg_temp.titles('p_min_price => 90000'), array['Cara'], 'solo mínimo');
select is(pg_temp.titles('p_max_price => 15000'), array['Barata'], 'solo máximo, con el tope incluido');
select is(pg_temp.titles(format('p_max_price => 50099, p_brands => array[%L]', 'acme')), array['Barata', 'Media en oferta'],
          'precio y marca se combinan');
select is((tests.gw(format('select storefront.list_products(%L, p_min_price => 20000) ->> ''total''', tests.fx('store_a'))) #>> '{}')::integer,
          3, 'el total respeta el precio');

-- ============================================================================ Conteos de filtros
select is((select x ->> 'count' from jsonb_array_elements(
             tests.gw(format('select storefront.list_facets(%L, p_max_price => 50099) -> 0 -> ''values''',
                             tests.fx('store_a')))) x where x ->> 'key' = 'zeta'), '1',
          'la faceta de marca cuenta con el rango de precio');
select is(tests.gw(format('select storefront.list_facets(%L, p_on_sale => true)', tests.fx('store_a'))), '[]'::jsonb,
          'y con las ofertas: solo queda una marca, así que su filtro no se muestra');

-- ============================================================================ Marcas
select is((select array_agg(x ->> 'name' order by x ->> 'name')
             from jsonb_array_elements(tests.gw(format('select storefront.list_brands(%L)', tests.fx('store_a')))) x),
          array['Acme', 'Zeta'], 'el directorio solo trae marcas con productos publicados');
select is((select x ->> 'count' from jsonb_array_elements(tests.gw(format('select storefront.list_brands(%L)',
             tests.fx('store_a')))) x where x ->> 'slug' = 'zeta'), '2', 'con cuántos productos publicados');
select is(tests.gw(format('select storefront.list_brands(%L)', tests.fx('store_b'))), '[]'::jsonb,
          'otra tienda no ve las marcas de A');
select is(tests.gw(format('select storefront.discovery_summary(%L)', tests.fx('store_a'))),
          '{"brands":2,"offers":1}'::jsonb, 'resumen del menú: marcas con productos y ofertas reales');

-- ============================================================================ Permisos y tienda no pública
select is(tests.sqlstate_as('authenticated', format('select storefront.list_brands(%L)', tests.fx('store_a'))), '42501',
          'authenticated no ejecuta el directorio');
select is(tests.sqlstate_as('anon', format('select storefront.discovery_summary(%L)', tests.fx('store_a'))), '42501',
          'anon tampoco');
update public.stores set status = 'suspended' where id = tests.fx('store_a');
select is(tests.gw(format('select storefront.list_brands(%L)', tests.fx('store_a'))), '[]'::jsonb,
          'una tienda suspendida no expone su directorio');

select * from finish();
rollback;
