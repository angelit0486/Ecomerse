-- =============================================================================
-- Versión del esquema (misión Panel, Paso E): el panel compara la última
-- migración aplicada con la que espera el código y avisa si faltan.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select is(public.app_schema_version(), '20261029000200', 'la versión es la de la última migración');
select ok(has_function_privilege('authenticated', 'public.app_schema_version()', 'execute'),
          'el panel puede leerla');
select ok(not has_function_privilege('anon', 'public.app_schema_version()', 'execute')
          and not has_function_privilege('storefront_gateway', 'public.app_schema_version()', 'execute'),
          'anon y la tienda no');
select is((select prosecdef from pg_proc where oid = 'public.app_schema_version()'::regprocedure), false,
          'no es SECURITY DEFINER');

select * from finish();
rollback;
