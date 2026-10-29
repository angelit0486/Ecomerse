-- =============================================================================
-- La tienda pública consulta la versión del esquema solo con storefront_gateway.
-- =============================================================================
begin;
select plan(4);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text;
  return v_msg;
end $$;
create function pg_temp.as_gateway() returns text language plpgsql as $$
declare v text;
begin
  perform tests.as_role('storefront_gateway');
  v := storefront.schema_version();
  perform tests.logout();
  return v;
end $$;

select is(pg_temp.as_gateway(), public.app_schema_version(), 'la tienda lee la misma versión que el panel');
select ok(has_function_privilege('storefront_gateway', 'storefront.schema_version()', 'execute'),
          'storefront_gateway puede ejecutarla');
select ok(not has_function_privilege('anon', 'storefront.schema_version()', 'execute'), 'anon no');
select ok(not has_function_privilege('authenticated', 'storefront.schema_version()', 'execute'),
          'authenticated no (el esquema storefront no se expone)');

select * from finish();
rollback;
