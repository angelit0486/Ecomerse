-- =============================================================================
-- ADR-040: importar solo los productos sin errores. Sin pedirlo, nada cambia;
-- pidiéndolo, se salta completo todo producto con alguna fila con error y lo
-- demás entra en una sola transacción.
-- =============================================================================
begin;
select plan(9);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');

create function pg_temp.cols() returns text[] language sql as $$
  select array['handle', 'title', 'sku', 'price', 'option1_name', 'option1_value']
$$;
create function pg_temp.prow(p_row integer, p_handle text, p_sku text, p_price bigint, p_errors jsonb default '[]')
returns jsonb language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle, 'sku', p_sku),
    'errors', p_errors,
    'normalized', jsonb_build_object('handle', p_handle, 'product', jsonb_build_object('title', initcap(p_handle)),
      'option_names', null,
      'variants', jsonb_build_array(jsonb_build_object('row_number', p_row, 'sku', p_sku, 'price', p_price))))
$$;
create function pg_temp.work(p_job uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_role('system_worker');
  v := system.import_commit(p_job);
  perform tests.logout();
  return v;
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

select tests.login('owner');
-- taza: bien. plato: su segunda fila (variante) trae un error, así que se salta completo.
-- vaso: error en su propia fila.
select tests.set_fx('job', public.imports_create(tests.fx('store_a'), 'create_only', 'mixto.csv', pg_temp.cols(),
  '{}', jsonb_build_array(
    pg_temp.prow(2, 'taza', 'TAZ-1', 15000),
    pg_temp.prow(3, 'plato', 'PLA-1', 22000),
    jsonb_build_object('row_number', 4, 'raw', '{"handle":"plato","sku":"PLA-2"}'::jsonb,
                       'errors', '["price: valor no válido"]'::jsonb, 'normalized', null),
    pg_temp.prow(5, 'vaso', 'VAS-1', 9000, '["title: es obligatorio"]'::jsonb))));
select is((select (totals ->> 'errors')::int from public.import_jobs where id = tests.fx('job')), 2,
          'el plan registra dos filas con error');

select is(pg_temp.err(format('select public.imports_commit(%L, %L)', tests.fx('store_a'), tests.fx('job'))),
          'conflict/import_not_ready', 'sin pedirlo, con errores no se confirma (como siempre)');
select is(public.imports_commit(tests.fx('store_a'), tests.fx('job'), true) ->> 'status', 'committing',
          'pidiendo importar las filas buenas, se confirma');
select tests.logout();

select is(pg_temp.work(tests.fx('job')) ->> 'created', '1', 'el worker crea solo el producto sin errores');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug = 'taza'), 1,
          'taza se creó');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug in ('plato', 'vaso')),
          0, 'plato (error en una variante) y vaso no se crearon: nada a medias');
select is((select totals ->> 'skipped' from public.import_jobs where id = tests.fx('job')), '2',
          'la importación anota cuántas filas se saltaron');
select is((select after ->> 'skipped_error_rows' from audit.audit_logs
            where action = 'import.committed' and entity_id = tests.fx('job')), '2',
          'y la auditoría también');

-- Todo con errores: no hay nada que importar.
select tests.login('owner');
select tests.set_fx('job2', public.imports_create(tests.fx('store_a'), 'create_only', 'malo.csv', pg_temp.cols(),
  '{}', jsonb_build_array(pg_temp.prow(2, 'jarra', 'JAR-1', 1000, '["title: es obligatorio"]'::jsonb))));
select is(pg_temp.err(format('select public.imports_commit(%L, %L, true)', tests.fx('store_a'), tests.fx('job2'))),
          'conflict/import_nothing_valid', 'si ningún producto está bien, no hay nada que confirmar');
select tests.logout();

select * from finish();
rollback;
