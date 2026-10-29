-- =============================================================================
-- AUD-03: una tienda no puede crear importaciones sin límite (vecino ruidoso).
-- =============================================================================
begin;
select plan(4);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');

create function pg_temp.err_detail(p_store text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  perform public.imports_create(tests.fx('store_' || p_store), 'update_existing', 'x.csv',
    array['handle', 'price'], '{}',
    jsonb_build_array(jsonb_build_object('row_number', 2, 'raw', jsonb_build_object('handle', 'no-existe', 'price', '10'))));
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

select tests.login('owner');
select is((select count(*)::int from generate_series(1, 30) g where pg_temp.err_detail('a') = 'ok'), 30,
          'hasta 30 importaciones por hora en una tienda');
select is(pg_temp.err_detail('a'), 'rate_limited/imports', 'la 31.ª se rechaza con un error claro');
select is((select count(*)::int from public.import_jobs where store_id = tests.fx('store_a')), 30,
          'la rechazada no deja un trabajo a medias');
select tests.logout();

select tests.login('owner_b');
select is(pg_temp.err_detail('b'), 'ok', 'otra tienda no se ve afectada');
select tests.logout();

select * from finish();
rollback;
