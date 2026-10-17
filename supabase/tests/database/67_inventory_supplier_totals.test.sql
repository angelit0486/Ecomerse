-- =============================================================================
-- ADR-025 · Totales de proveedor en Inventario: solo ubicaciones de proveedor
-- activas, permiso inventory.read, aislamiento y límite de variantes.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

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
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');

select tests.login('owner');
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Proteína","variants":[{"price":89900,"sku":"PRO-1"}]}');
select tests.set_fx('var', (select id from public.product_variants where sku = 'PRO-1'));
select public.inventory_adjust(tests.fx('store_a'), tests.fx('var'), 'adjustment', 3, 'Inventario inicial');
select tests.set_fx('sup', public.suppliers_save(tests.fx('store_a'), '{"name":"Norte"}'));
select public.suppliers_set_variant(tests.fx('store_a'), tests.fx('sup'), tests.fx('var'),
  '{"availability":"available","quantity":8}');

select is((select available || '/' || reserved from public.inventory_supplier_totals(tests.fx('store_a'),
             array[tests.fx('var')])), '8/0', 'suma solo lo del proveedor (no las 3 propias)');
select is((select count(*)::integer from public.inventory_supplier_totals(tests.fx('store_a'), array[]::uuid[])), 0,
          'sin variantes, nada');
select is(pg_temp.err(format('select * from public.inventory_supplier_totals(%L, array_fill(gen_random_uuid(), array[201]))',
            tests.fx('store_a'))), 'validation_failed/variant_ids', 'máximo 200 variantes por llamada');
select public.suppliers_save(tests.fx('store_a'), jsonb_build_object('id', tests.fx('sup'), 'name', 'Norte', 'status', 'inactive'));
select is((select count(*)::integer from public.inventory_supplier_totals(tests.fx('store_a'), array[tests.fx('var')])), 0,
          'un proveedor inactivo no cuenta');
select tests.logout();

select tests.login('owner_b');
select is(pg_temp.err(format('select * from public.inventory_supplier_totals(%L, array[%L]::uuid[])',
            tests.fx('store_a'), tests.fx('var'))), 'forbidden', 'otra tienda no consulta');
select is((select count(*)::integer from public.inventory_supplier_totals(tests.fx('store_b'), array[tests.fx('var')])), 0,
          'ni la ve desde la suya');
select tests.logout();

select * from finish();
rollback;
