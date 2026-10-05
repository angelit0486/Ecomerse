set client_min_messages = warning;
-- =============================================================================
-- SHIM DE SUPABASE AUTH — SOLO PARA PRUEBAS pgTAP SOBRE POSTGRESQL ESTÁNDAR.
-- Emula lo mínimo de Supabase Auth en la base (auth.users y funciones de
-- contexto). El stack de desarrollo (scripts/dev/stack.sh) NO usa este archivo:
-- allí el esquema "auth" lo crea el servidor real de Supabase Auth (GoTrue).
-- =============================================================================

create schema if not exists auth;

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

