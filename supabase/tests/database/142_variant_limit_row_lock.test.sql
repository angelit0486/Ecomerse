-- =============================================================================
-- Candados de la importación (2026-11-12, CAP-11): crear muchos productos en
-- una transacción ya no ocupa un candado de aviso por producto, y el límite de
-- variantes por producto se sigue respetando.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');

create function tests.advisory_locks() returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer from pg_catalog.pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid() $$;
create function tests.set_variant_limit(p_limit integer) returns void language sql security definer set search_path = '' as $$
  insert into public.organization_entitlement_overrides (organization_id, key, value_int, reason)
  values (tests.fx('org_a'), 'max_variants_per_product', p_limit, 'prueba')
  on conflict (organization_id, key) do update set value_int = excluded.value_int $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin
  execute p_sql; return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text; return v_msg;
end $$;
grant execute on all functions in schema tests to authenticated;

select tests.login('owner');
select public.catalog_upsert_product(tests.fx('store_a'),
         jsonb_build_object('title', 'Producto ' || g, 'variants', jsonb_build_array(jsonb_build_object('price', 100, 'sku', 'P-' || g))))
  from generate_series(1, 40) g;
select tests.logout();
select cmp_ok(tests.advisory_locks(), '<', 10, '40 productos en una transacción: sin un candado de aviso por producto');
select is((select count(*)::integer from public.product_variants where store_id = tests.fx('store_a')), 40, 'las 40 variantes existen');

-- El límite sigue contando.
select tests.set_variant_limit(2);
select tests.login('owner');
select is(pg_temp.err(format($f$select public.catalog_upsert_product(%L, '{"title":"Dos tallas","options":[{"name":"Talla","values":["CH","G"]}],"variants":[{"options":{"Talla":"CH"},"price":100},{"options":{"Talla":"G"},"price":100}]}')$f$,
                             tests.fx('store_a'))), 'ok', 'dos variantes con límite 2: pasa');
select is(pg_temp.err(format($f$select public.catalog_upsert_product(%L, '{"title":"Tres tallas","options":[{"name":"Talla","values":["CH","M","G"]}],"variants":[{"options":{"Talla":"CH"},"price":100},{"options":{"Talla":"M"},"price":100},{"options":{"Talla":"G"},"price":100}]}')$f$,
                             tests.fx('store_a'))), 'limit_reached', 'tres variantes con límite 2: se rechaza');
select tests.logout();
select is(public.app_schema_version(), '20261112000100', 'versión de la base');

select * from finish();
rollback;
