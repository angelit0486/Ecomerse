-- =============================================================================
-- Metatests de seguridad del esquema (GATE0 §34.3.1). Bloquean el merge.
-- Se escriben de forma GENÉRICA: cada tabla o función nueva de fases futuras
-- queda cubierta automáticamente.
-- Esquemas propios: public, app, audit, private, storefront, system.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- 1. RLS habilitado Y forzado en todas las tablas propias.
select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
        and (not c.relrowsecurity or not c.relforcerowsecurity) $$,
  'toda tabla propia tiene RLS habilitado y forzado'
);

-- 2. anon no tiene ningún privilegio de tabla.
select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'v', 'm', 'f')
        and n.nspname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
        and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') $$,
  'anon no tiene privilegios sobre ninguna tabla o vista'
);

-- 3. anon no puede ejecutar ninguna función propia (excluye miembros de extensiones).
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon no puede ejecutar ninguna función propia'
);

-- 4. Ninguna función propia es ejecutable por PUBLIC (proacl NULL = PUBLIC por defecto).
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        and (p.proacl is null
             or exists (select 1 from aclexplode(p.proacl) a
                         where a.grantee = 0 and a.privilege_type = 'EXECUTE')) $$,
  'ninguna función propia es ejecutable por PUBLIC'
);

-- 5. Toda función SECURITY DEFINER fija search_path.
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef
        and n.nspname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
                         where cfg like 'search_path=%') $$,
  'toda función SECURITY DEFINER fija search_path'
);

-- 6. anon no tiene USAGE en los esquemas internos.
select is_empty(
  $$ select s from unnest(array['app', 'audit', 'private', 'storefront', 'system']) s
      where has_schema_privilege('anon', s, 'USAGE') $$,
  'anon no tiene USAGE en esquemas internos'
);

-- 7. service_role no tiene privilegios de tabla (lista blanca §11.5).
select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'v', 'm', 'f')
        and n.nspname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
        and has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') $$,
  'service_role no tiene privilegios sobre tablas propias'
);

-- 8. Los roles de mínimo privilegio no tienen privilegios de tabla.
select is_empty(
  $$ select r || ' → ' || n.nspname || '.' || c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['storefront_gateway', 'system_worker']) r
      where c.relkind in ('r', 'p', 'v', 'm', 'f')
        and n.nspname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
        and has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') $$,
  'storefront_gateway y system_worker no tienen privilegios de tabla'
);

-- 9. Los roles de mínimo privilegio existen, no son superusuarios ni omiten RLS.
select is_empty(
  $$ select rolname from pg_roles
      where rolname in ('storefront_gateway', 'system_worker')
        and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb) $$,
  'roles de mínimo privilegio sin atributos elevados'
);
select is(
  (select count(*)::int from pg_roles where rolname in ('storefront_gateway', 'system_worker')),
  2,
  'existen storefront_gateway y system_worker'
);

-- 10. Cada rol solo usa su propio esquema.
select ok(
  not has_schema_privilege('storefront_gateway', 'system', 'USAGE')
  and not has_schema_privilege('system_worker', 'storefront', 'USAGE')
  and not has_schema_privilege('storefront_gateway', 'app', 'USAGE')
  and not has_schema_privilege('system_worker', 'app', 'USAGE'),
  'cada rol de mínimo privilegio está confinado a su esquema'
);

-- 11. Toda tabla con store_id tiene el trigger de inmutabilidad de tenant
--     (prevent_tenant_change) o es append-only (forbid_mutation: ningún UPDATE).
select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
        and exists (select 1 from pg_attribute a
                     where a.attrelid = c.oid and a.attname = 'store_id' and not a.attisdropped)
        and not exists (select 1 from pg_trigger t
                         where t.tgrelid = c.oid and not t.tgisinternal
                           and t.tgfoid in ('app.prevent_tenant_change()'::regprocedure,
                                            'app.forbid_mutation()'::regprocedure)) $$,
  'toda tabla con store_id tiene prevent_tenant_change o es append-only'
);

-- 12. Toda FK hacia una tabla con store_id es compuesta e incluye store_id en ambos
--     lados (GATE0 §13, sin excepciones).
select is_empty(
  $$ select con.conrelid::regclass::text || ' → ' || con.confrelid::regclass::text
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_namespace n on n.oid = c.relnamespace
      where con.contype = 'f'
        and n.nspname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
        and exists (select 1 from pg_attribute a
                     where a.attrelid = con.confrelid and a.attname = 'store_id' and not a.attisdropped)
        and (
          not exists (select 1 from unnest(con.confkey) k
                        join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k
                       where a.attname = 'store_id')
          or not exists (select 1 from unnest(con.conkey) k
                           join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k
                          where a.attname = 'store_id')
        ) $$,
  'toda FK hacia una tabla con store_id es compuesta'
);

-- 13. Ninguna vista propia omite RLS (security_invoker obligatorio).
select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'v'
        and n.nspname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
        and not coalesce(c.reloptions @> array['security_invoker=true'], false) $$,
  'toda vista propia usa security_invoker=true'
);

select * from finish();
rollback;
