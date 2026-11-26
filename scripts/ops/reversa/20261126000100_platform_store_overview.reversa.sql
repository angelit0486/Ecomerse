-- =============================================================================
-- Reversa de 20261126000100_platform_store_overview.sql (consola «Mis clientes»).
-- 2026-11-26.
--
-- SIN PÉRDIDA: la migración solo agregó una función de lectura
-- (public.platform_store_overview) y subió la versión. Esto la quita y deja
-- public.app_schema_version() EXACTA a la de 20261119000100; el esquema queda
-- idéntico al de una base con las migraciones hasta 20261119000100 (lo prueba
-- scripts/ops/reversa/comprobar-0400.sh).
--
-- El código de esta rama espera 20261126000100 (EXPECTED_SCHEMA_VERSION): con la
-- base en 20261119000100 la tienda mostraría «mantenimiento». Orden:
--   1. desplegar el código que espera 20261119000100 (sin este cambio);
--   2. correr esto.
--
-- Uso (SOLO con autorización y en la ventana): psql -X -1 -v ON_ERROR_STOP=1 -f <este archivo>
-- =============================================================================

-- Candado: solo sobre una base exactamente en 20261126000100.
do $$
begin
  if coalesce(public.app_schema_version(), '') <> '20261126000100' then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = format('La base está en %s; esta reversa solo aplica a 20261126000100.',
                      coalesce(public.app_schema_version(), 'desconocida'));
  end if;
end
$$;

drop function if exists public.platform_store_overview(text, integer);

-- Versión del esquema (D-POR-06): idéntica a la de 20261119000100_order_whatsapp_handoff_flag.sql.
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261119000100'::text
$$;
