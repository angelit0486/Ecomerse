-- =============================================================================
-- Versión del esquema (misión Panel, Paso E). El panel la compara al cargar
-- con la que espera el código (`EXPECTED_SCHEMA_VERSION`): si la base va
-- atrás (faltan migraciones), muestra un aviso claro en vez de pantallas rotas.
--
-- REGLA: cada migración nueva redefine esta función con su propia versión, y
-- `src/server/db/schema-version.ts` se actualiza en el mismo commit.
-- =============================================================================

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261024000300'::text
$$;

revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to authenticated;
