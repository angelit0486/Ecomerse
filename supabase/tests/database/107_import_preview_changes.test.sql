-- =============================================================================
-- Misión vendible F3: la vista previa de una importación dice qué cambia
-- (precios y existencias de hoy contra los del archivo). Solo lectura, con
-- permiso imports.run y aislada por tienda.
-- =============================================================================
begin;
select plan(11);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'viewer', 'viewer');

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
create function pg_temp.ch() returns jsonb language sql as $$
  select public.import_preview_changes(tests.fx('store_a'), tests.fx('job'))
$$;
create function pg_temp.prow(p_row integer, p_handle text, p_sku text, p_price bigint, p_qty integer)
returns jsonb language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle, 'sku', p_sku),
    'errors', '[]'::jsonb,
    'normalized', jsonb_build_object('handle', p_handle, 'status', 'draft',
      'product', jsonb_build_object('title', initcap(p_handle)), 'option_names', null,
      -- Sin existencias en el archivo, el importador omite la llave (null = no tocar).
      'variants', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('row_number', p_row, 'sku', p_sku,
                                                       'price', p_price, 'quantity', p_qty)))))
$$;

select tests.login('owner');
select tests.set_fx('taza', (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object(
  'title', 'Taza', 'slug', 'taza',
  'variants', jsonb_build_array(jsonb_build_object('price', 10000, 'sku', 'TAZ-1')))) ->> 'id')::uuid);
select tests.set_fx('plato', (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object(
  'title', 'Plato', 'slug', 'plato',
  'variants', jsonb_build_array(jsonb_build_object('price', 20000, 'sku', 'PLA-1')))) ->> 'id')::uuid);
select public.inventory_adjust(tests.fx('store_a'),
  (select id from public.product_variants where store_id = tests.fx('store_a') and sku = 'TAZ-1'),
  'adjustment', 5, 'Inicial');
select public.inventory_adjust(tests.fx('store_a'),
  (select id from public.product_variants where store_id = tests.fx('store_a') and sku = 'PLA-1'),
  'adjustment', 8, 'Inicial');

-- taza: sube de precio y el archivo trae 2 piezas (hoy hay 5). plato: igual de precio,
-- existencias sin tocar (columna vacía).
select tests.set_fx('job', public.imports_create(tests.fx('store_a'), 'update_existing', 'precios.csv',
  array['handle', 'sku', 'price', 'inventory_quantity'], '{}', jsonb_build_array(
    pg_temp.prow(2, 'taza', 'TAZ-1', 12500, 2),
    pg_temp.prow(3, 'plato', 'PLA-1', 20000, null))));
select is((select (totals ->> 'update')::int from public.import_jobs where id = tests.fx('job')), 2,
          'el archivo actualiza dos productos que ya existen');

select is((pg_temp.ch() ->> 'price_changes')::int, 1, 'un precio cambia');
select is((pg_temp.ch() ->> 'price_up')::int, 1, 'y sube');
select is(pg_temp.ch() -> 'price_examples' -> 0,
          '{"title":"Taza","sku":"TAZ-1","from":10000,"to":12500}'::jsonb,
          'el ejemplo dice producto, SKU, precio de hoy y precio del archivo');
select is((pg_temp.ch() ->> 'stock_changes')::int, 1,
          'una existencia cambia; la columna vacía no cuenta');
select is(pg_temp.ch() -> 'stock_examples' -> 0,
          '{"title":"Taza","sku":"TAZ-1","from":5,"to":2}'::jsonb,
          'el archivo reemplaza 5 piezas de hoy por 2: se muestra antes de confirmar');
select is((pg_temp.ch() ->> 'unmatched_variants')::int, 0,
          'cada presentación del archivo se encontró por su SKU');

select is((select price from public.product_variants where store_id = tests.fx('store_a') and sku = 'TAZ-1'),
          10000::bigint, 'y no cambia nada antes de confirmar');
select tests.logout();

-- Permisos y aislamiento.
select tests.login('viewer');
select is(pg_temp.err(format('select public.import_preview_changes(%L, %L)', tests.fx('store_a'), tests.fx('job'))),
          'forbidden', 'sin permiso de importar no se ve');
select tests.logout();

select tests.login('owner_b');
select is(pg_temp.err(format('select public.import_preview_changes(%L, %L)', tests.fx('store_a'), tests.fx('job'))),
          'forbidden', 'otra tienda no puede leer la vista previa');
select is((public.import_preview_changes(tests.fx('store_b'), tests.fx('job')) ->> 'price_changes')::int, 0,
          'ni pasando su propia tienda con la importación ajena: no ve filas');
select tests.logout();

select * from finish();
rollback;
