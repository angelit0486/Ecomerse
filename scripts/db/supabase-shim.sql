set client_min_messages = warning;
-- =============================================================================
-- SHIM DE SUPABASE — SOLO PARA PRUEBAS SOBRE POSTGRESQL ESTÁNDAR (local y CI).
-- NUNCA se aplica en un proyecto Supabase: allí estos objetos ya existen.
--
-- Reproduce lo que las migraciones asumen de Supabase, incluidos los privilegios
-- por defecto PERMISIVOS que Supabase concede en "public". Así las pruebas
-- verifican que nuestras migraciones los revocan de verdad.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator nologin noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

create schema if not exists extensions;
create schema if not exists auth;
grant usage on schema extensions to anon, authenticated, service_role;

create extension if not exists pgtap with schema extensions;

-- Supabase: search_path de postgres incluye "extensions".
select format('alter database %I set search_path = "$user", public, extensions', current_database())
\gexec

-- Supabase Auth: tabla de usuarios (subconjunto de columnas) y funciones de
-- contexto. Las funciones copian la definición de Supabase: leen los claims del
-- JWT que PostgREST deja en `request.jwt.claims`.
create table if not exists auth.users (
  id                 uuid primary key,
  email              text unique,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.email() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid(), auth.email() to anon, authenticated, service_role;

-- Supabase: privilegios por defecto permisivos en public (lo que revocamos).
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
