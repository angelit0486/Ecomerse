-- =============================================================================
-- Helpers de pruebas (esquema "tests"). Este archivo se ejecuta primero y CONFIRMA
-- (commit) para que los demás archivos usen los helpers. Solo existe en bases de
-- prueba (local, CI, rama de Supabase): nunca en producción.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, storefront_gateway, system_worker;

-- Valores de fixtures accesibles desde cualquier rol durante la prueba.
create table if not exists tests.fixtures (key text primary key, id uuid not null);
grant select on tests.fixtures to anon, authenticated, storefront_gateway, system_worker;

create or replace function tests.set_fx(p_key text, p_id uuid) returns uuid
language sql security definer set search_path = '' as $$
  insert into tests.fixtures (key, id) values (p_key, p_id)
  on conflict (key) do update set id = excluded.id
  returning id
$$;

create or replace function tests.fx(p_key text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select f.id into v from tests.fixtures f where f.key = p_key;
  if v is null then raise exception 'fixture % no definido', p_key; end if;
  return v;
end $$;

create or replace function tests.create_user(p_key text, p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v, lower(p_email));
  return tests.set_fx(p_key, v);
end $$;

-- Simula una sesión de Supabase: rol authenticated + claims del JWT.
create or replace function tests.login(p_key text, p_aal text default 'aal2') returns void
language plpgsql as $$
declare v_user uuid := tests.fx(p_key);
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_user, 'role', 'authenticated', 'aal', p_aal,
    'email', (select u.email from auth.users u where u.id = v_user))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Sesión de comprador recién verificada con un código por email (amr otp, aal1).
create or replace function tests.login_otp(p_key text, p_seconds_ago integer default 0) returns void
language plpgsql as $$
declare v_user uuid := tests.fx(p_key);
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_user, 'role', 'authenticated', 'aal', 'aal1',
    'amr', json_build_array(json_build_object('method', 'otp',
                                              'timestamp', extract(epoch from now())::bigint - p_seconds_ago)),
    'email', (select u.email from auth.users u where u.id = v_user))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function tests.as_role(p_role text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', p_role, true);
end $$;

create or replace function tests.logout() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'none', true);
end $$;

-- Plan de pruebas con límites holgados.
create or replace function tests.ensure_plan(p_key text default 'test_plan', p_max_stores int default 3,
                                             p_max_staff int default 20) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  insert into public.plans (key, name) values (p_key, p_key)
  on conflict (key) do update set name = excluded.name returning id into v;
  insert into public.plan_entitlements (plan_id, key, value_int) values
    (v, 'max_stores', p_max_stores), (v, 'max_staff', p_max_staff), (v, 'max_products', 1000),
    (v, 'storage_mb', 1000)
  on conflict (plan_id, key) do update set value_int = excluded.value_int;
  return v;
end $$;

-- Tenant completo: organización + suscripción activa + tienda + dominio + tema +
-- dueño. Devuelve el id de la tienda y registra fixtures org_<k>, store_<k>.
create or replace function tests.create_tenant(p_key text, p_owner_key text,
                                               p_plan text default 'test_plan') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_store uuid;
begin
  perform tests.ensure_plan(p_plan);
  insert into public.organizations (name, slug, country) values ('Org ' || p_key, 'org-' || p_key, 'MX')
  returning id into v_org;
  insert into public.subscriptions (organization_id, plan_id, status)
  values (v_org, (select id from public.plans where key = p_plan), 'active');
  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, tests.fx(p_owner_key), 'org_owner');
  insert into public.stores (organization_id, name, handle, currency, country, timezone)
  values (v_org, 'Tienda ' || p_key, 'tienda-' || p_key, 'MXN', 'MX', 'America/Mexico_City')
  returning id into v_store;
  insert into public.store_domains (store_id, hostname, type, status, is_primary)
  values (v_store, 'tienda-' || p_key || '.tiendas.test', 'platform_subdomain', 'active', true);
  insert into public.store_themes (store_id) values (v_store);
  perform tests.set_fx('org_' || p_key, v_org);
  return tests.set_fx('store_' || p_key, v_store);
end $$;

-- Tienda adicional en una organización existente.
create or replace function tests.create_store(p_key text, p_org_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_store uuid;
begin
  insert into public.stores (organization_id, name, handle, currency, country, timezone)
  values (tests.fx(p_org_key), 'Tienda ' || p_key, 'tienda-' || p_key, 'MXN', 'MX', 'America/Mexico_City')
  returning id into v_store;
  insert into public.store_domains (store_id, hostname, type, status, is_primary)
  values (v_store, 'tienda-' || p_key || '.tiendas.test', 'platform_subdomain', 'active', true);
  insert into public.store_themes (store_id) values (v_store);
  return tests.set_fx('store_' || p_key, v_store);
end $$;

-- Miembro de tienda (y miembro de la organización si aún no lo es).
create or replace function tests.add_store_member(p_store_key text, p_user_key text, p_role_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_store uuid := tests.fx('store_' || p_store_key); v_org uuid;
begin
  select organization_id into v_org from public.stores where id = v_store;
  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, tests.fx(p_user_key), 'org_member') on conflict (organization_id, user_id) do nothing;
  insert into public.store_members (store_id, user_id, role_id)
  values (v_store, tests.fx(p_user_key),
          (select id from public.roles where key = p_role_key and organization_id is null));
end $$;

create or replace function tests.add_org_member(p_org_key text, p_user_key text, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (tests.fx(p_org_key), tests.fx(p_user_key), p_role);
end $$;

create or replace function tests.make_platform_staff(p_user_key text, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.platform_staff (user_id, role) values (tests.fx(p_user_key), p_role);
end $$;

-- Ejecuta SQL y devuelve el número de filas afectadas o leídas; si el rol no tiene
-- privilegio sobre la tabla, devuelve 0 (sin acceso). Se ejecuta como el rol actual.
create or replace function tests.row_count(p_sql text) returns bigint
language plpgsql as $$
declare v bigint;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
exception when insufficient_privilege then
  return 0;
end $$;

-- -----------------------------------------------------------------------------
-- Aislamiento genérico. Clasifica cada tabla de "public" por sus columnas de
-- tenant usando el CATÁLOGO (no information_schema, que oculta columnas sin
-- privilegio) y devuelve el filtro que selecciona las filas del tenant objetivo.
-- -----------------------------------------------------------------------------
create or replace function tests.tenant_filter(p_table text, p_store uuid, p_org uuid,
                                               p_include_org boolean) returns text
language plpgsql stable as $$
declare
  v_rel oid := to_regclass(format('public.%I', p_table));
  v_has_store boolean;
  v_has_org boolean;
begin
  select exists (select 1 from pg_catalog.pg_attribute a
                  where a.attrelid = v_rel and a.attname = 'store_id' and not a.attisdropped),
         exists (select 1 from pg_catalog.pg_attribute a
                  where a.attrelid = v_rel and a.attname = 'organization_id' and not a.attisdropped)
    into v_has_store, v_has_org;
  if p_table = 'stores' then
    return case when p_include_org then format('id = %L or organization_id = %L', p_store, p_org)
                else format('id = %L', p_store) end;
  elsif p_table = 'organizations' then
    return case when p_include_org then format('id = %L', p_org) end;
  elsif v_has_store then
    return format('store_id = %L', p_store);
  elsif v_has_org and p_include_org then
    return format('organization_id = %L', p_org);
  end if;
  return null;
end $$;

-- Tablas de las que el rol actual puede LEER al menos una fila del tenant objetivo.
create or replace function tests.visible_tenant_tables(p_store uuid, p_org uuid,
                                                       p_include_org boolean default true)
returns setof text language plpgsql as $$
declare r record; v_filter text;
begin
  for r in select c.relname from pg_catalog.pg_class c
             join pg_catalog.pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1 loop
    v_filter := tests.tenant_filter(r.relname, p_store, p_org, p_include_org);
    continue when v_filter is null;
    if tests.row_count(format('select 1 from public.%I where %s', r.relname, v_filter)) > 0 then
      return next r.relname;
    end if;
  end loop;
end $$;

-- Filas del tenant objetivo que el rol actual logra MODIFICAR: para cada tabla se
-- prueba cada columna sobre la que el rol tiene privilegio UPDATE.
create or replace function tests.updatable_tenant_rows(p_store uuid, p_org uuid,
                                                       p_include_org boolean default true)
returns bigint language plpgsql as $$
declare r record; c record; v_filter text; v_total bigint := 0;
begin
  for r in select cl.oid, cl.relname from pg_catalog.pg_class cl
             join pg_catalog.pg_namespace n on n.oid = cl.relnamespace
            where n.nspname = 'public' and cl.relkind in ('r', 'p') order by 2 loop
    v_filter := tests.tenant_filter(r.relname, p_store, p_org, p_include_org);
    continue when v_filter is null;
    for c in select a.attname from pg_catalog.pg_attribute a
              where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
                and has_column_privilege(current_user, r.oid, a.attnum, 'UPDATE') loop
      v_total := v_total + tests.row_count(format('update public.%I set %I = %I where %s',
                                                  r.relname, c.attname, c.attname, v_filter));
    end loop;
    v_total := v_total + tests.row_count(format('delete from public.%I where %s', r.relname, v_filter));
  end loop;
  return v_total;
end $$;

-- Igual que visible_tenant_tables, pero ejecutado como un rol sin acceso al
-- esquema "extensions" (donde vive pgTAP): cambia de rol solo durante la lectura.
create or replace function tests.visible_tenant_tables_as(p_role text, p_store uuid, p_org uuid)
returns text[] language plpgsql as $$
declare v text[];
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', p_role, true);
  v := array(select t from tests.visible_tenant_tables(p_store, p_org) t);
  perform set_config('role', 'none', true);
  return v;
end $$;

-- Ejecuta SQL con otro rol (incluidos los que no ven pgTAP) y devuelve 'ok' o el
-- SQLSTATE del error. El rol se restablece siempre.
create or replace function tests.sqlstate_as(p_role text, p_sql text) returns text
language plpgsql as $$
declare v_state text := 'ok';
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', p_role, true);
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  perform set_config('role', 'none', true);
  return v_state;
end $$;

-- Pedido mínimo (sin partidas) para las pruebas de reservas: desde la F6 la
-- reserva exige un pedido real de la misma tienda (FK compuesta, D-F4-01).
create or replace function tests.order(p_store uuid, p_id uuid default null) returns uuid
language sql security definer set search_path = '' as $$
  insert into public.orders (id, store_id, number, display_number, checkout_idempotency_key, email,
                             customer_name, requires_shipping, currency, prices_include_tax, tax_rate_bps,
                             tax_applies_to_shipping, subtotal, total)
  select coalesce(p_id, app.uuid_v7()), p_store, n, '#' || n, 'test-' || gen_random_uuid(), 'test@example.test',
         'Prueba', false, 'MXN', true, 0, false, 0, 0
    from (select coalesce(max(o.number), 1000) + 1 as n from public.orders o where o.store_id = p_store) x
  returning id
$$;

grant execute on all functions in schema tests to anon, authenticated, storefront_gateway, system_worker;

select pass('helpers de pruebas instalados');
select * from finish();
commit;
