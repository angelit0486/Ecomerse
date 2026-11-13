-- =============================================================================
-- Búsqueda del panel acotada a la tienda (2026-11-11, CAP-08): las subconsultas
-- de `catalog_search_products` filtran por tienda (antes recorrían las
-- variantes de toda la plataforma) y los resultados no cambian.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function pg_temp.titles(p_store uuid, p_q text, p_issue text default null) returns text[] language sql as $$
  select coalesce(array_agg(r.title order by r.title), '{}')
    from public.catalog_search_products(p_store, p_q, null, null, false, null, 50, null, p_issue) r $$;
create function tests.variant_of(p_store uuid, p_sku text) returns uuid language sql security definer set search_path = '' as $$
  select v.id from public.product_variants v where v.store_id = p_store and v.sku = p_sku $$;
grant execute on all functions in schema tests to authenticated;

select tests.login('owner');
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Playera azul","variants":[{"price":100,"sku":"IGUAL-1"}]}');
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Gorra roja","variants":[{"price":100,"sku":"GORRA-1"}]}');
select public.inventory_adjust(tests.fx('store_a'), tests.variant_of(tests.fx('store_a'), 'GORRA-1'), 'adjustment', 5, 'conteo', 'set');
select tests.logout();
select tests.login('owner_b');
-- La otra tienda tiene el MISMO SKU en otro producto.
select public.catalog_upsert_product(tests.fx('store_b'), '{"title":"Producto ajeno","variants":[{"price":100,"sku":"IGUAL-1"}]}');
select tests.logout();

select tests.login('owner');
select is(pg_temp.titles(tests.fx('store_a'), 'igual-1'), array['Playera azul'], 'por SKU exacto: solo el de esta tienda');
select is(pg_temp.titles(tests.fx('store_a'), 'gorra'), array['Gorra roja'], 'por palabra');
select is(pg_temp.titles(tests.fx('store_a'), null), array['Gorra roja', 'Playera azul'], 'sin búsqueda: todos');
select is(pg_temp.titles(tests.fx('store_a'), null, 'agotados'), array['Playera azul'], '«agotados»: el que no tiene existencias');
select is((select r.variant_count from public.catalog_search_products(tests.fx('store_a'), 'gorra') r), 1, 'cuenta sus variantes');
select throws_ok(format('select * from public.catalog_search_products(%L)', tests.fx('store_b')), 'forbidden',
                 'la tienda ajena sigue negada');
select tests.logout();

-- Guardia: ninguna subconsulta de variantes o ubicaciones sin tienda.
select ok((select p.prosrc !~ 'where pv\.product_id = p\.id' and p.prosrc !~ 'where v\.product_id = p\.id'
                  and p.prosrc !~ 'on loc\.id = l\.location_id'
             from pg_proc p where p.oid = 'public.catalog_search_products(uuid,text,text,uuid,boolean,jsonb,integer,uuid,text,text)'::regprocedure),
          'las subconsultas dicen de qué tienda son');
select is(public.app_schema_version(), '20261113000100', 'versión de la base');

select * from finish();
rollback;
