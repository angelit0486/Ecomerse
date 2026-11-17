-- =============================================================================
-- ADR-067 (20261117000200): partes de hasta 2,500 filas y hasta 20 partes por
-- lote; el tope de 50,000 filas por lote no cambia.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');

create function pg_temp.fp(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), ''); end $$;
create function pg_temp.batch(p_name text, p_rows integer[]) returns text language sql as $$
  select pg_temp.err(format('select public.imports_batch_create(%L, %L, %L, %L, %L, %L)', tests.fx('store_a'),
    p_name, 'create_only', p_rows,
    array(select pg_temp.fp(p_name || g) from generate_series(1, cardinality(p_rows)) g), pg_temp.fp(p_name)))
$$;

select tests.login('owner');

select is(pg_temp.batch('grande.csv', array(select 2500 from generate_series(1, 20))), 'ok',
          '20 partes de 2,500 filas (50,000) se aceptan');
select is((select array[parts_count, total_rows] from public.import_batches
            where store_id = tests.fx('store_a') and file_name = 'grande.csv'), array[20, 50000],
          'el lote guarda 20 partes y 50,000 filas');
select is(pg_temp.batch('x.csv', array(select 10 from generate_series(1, 21))), 'validation_failed/batch',
          '21 partes no');
select is(pg_temp.batch('x.csv', array[2501]), 'validation_failed/batch', 'una parte de 2,501 filas no');
select is(pg_temp.batch('x.csv', array(select 2500 from generate_series(1, 20)) || 1), 'validation_failed/batch',
          'ni más de 50,000 filas (21 partes)');

-- La parte 20 se sube como cualquier otra.
select tests.set_fx('grande', (select id from public.import_batches
                                where store_id = tests.fx('store_a') and file_name = 'grande.csv'));
select is((public.imports_create_part(tests.fx('store_a'), tests.fx('grande'), 20, pg_temp.fp('grande.csv20'),
             array['handle', 'title', 'sku', 'price'], '{}',
             jsonb_build_array(jsonb_build_object('row_number', 47502, 'raw', jsonb_build_object('handle', 'taza'),
               'errors', '[]'::jsonb,
               'normalized', jsonb_build_object('handle', 'taza', 'product', jsonb_build_object('title', 'Taza'),
                 'option_names', null,
                 'variants', jsonb_build_array(jsonb_build_object('row_number', 47502, 'sku', 'TZ', 'price', 1000)))))
           ) ->> 'reused'), 'false', 'la parte 20 se sube');
select is((select part_number from public.import_jobs where batch_id = tests.fx('grande')), 20,
          'y queda como la parte 20 del lote');
select tests.logout();

-- La base rechaza la parte 21 aunque alguien saltara la función.
select matches(pg_temp.err(format('update public.import_jobs set part_number = 21 where batch_id = %L',
                                  tests.fx('grande'))),
               'import_jobs_part_number_check', 'la base no admite una parte 21');

select * from finish();
rollback;
