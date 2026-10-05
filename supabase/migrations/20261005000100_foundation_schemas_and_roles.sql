-- =============================================================================
-- Fase 1 — Foundation · Esquemas, privilegios por defecto y roles de mínimo privilegio
-- Contrato: docs/architecture/GATE0-ARCHITECTURE-REVIEW.md §9.1, §11.4, §12.1 (ADR-016)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Esquemas internos. NINGUNO se expone por la Data API (supabase/config.toml
--    expone solo "public" y "graphql_public").
--      app        → helpers de autorización y utilidades SQL
--      audit      → auditoría (Fase 2)
--      private    → datos sensibles internos
--      storefront → funciones del rol storefront_gateway
--      system     → cola de trabajos y funciones del rol system_worker
-- -----------------------------------------------------------------------------
create schema if not exists app;
create schema if not exists audit;
create schema if not exists private;
create schema if not exists storefront;
create schema if not exists system;

revoke all on schema app, audit, private, storefront, system from public;
revoke all on schema app, audit, private, storefront, system from anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Privilegios por defecto: nada implícito.
--    Supabase concede por defecto ALL a anon/authenticated/service_role sobre lo
--    que se cree en "public". Aquí se revoca para objetos creados por este rol:
--    cada grant será explícito y revisable.
--    - anon: cero grants (CF-03).
--    - service_role: sin acceso a tablas (lista blanca §11.5: solo Auth Admin y
--      Storage Admin, que no operan sobre tablas de public).
--    - EXECUTE de funciones: PostgreSQL lo concede a PUBLIC por defecto; se revoca.
-- -----------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated, service_role;

alter default privileges in schema app, audit, private, storefront, system
  revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- 3. Roles de base de datos de mínimo privilegio (ADR-016).
--    Se crean SIN LOGIN: la contraseña y el LOGIN se habilitan por entorno con el
--    runbook docs/runbooks/database-roles.md (nunca hay secretos en migraciones).
--    No reciben grants de tabla: solo USAGE de su esquema y EXECUTE de funciones
--    SECURITY DEFINER auditadas.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'storefront_gateway') then
    create role storefront_gateway nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'system_worker') then
    create role system_worker nologin noinherit;
  end if;
end
$$;

grant usage on schema storefront to storefront_gateway;
grant usage on schema system to system_worker;

-- Límites defensivos por rol.
alter role storefront_gateway set statement_timeout = '5s';
alter role system_worker set statement_timeout = '30s';
alter role storefront_gateway set idle_in_transaction_session_timeout = '10s';
alter role system_worker set idle_in_transaction_session_timeout = '30s';
