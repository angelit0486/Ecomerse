-- =============================================================================
-- Reversa de 20261117000300_staff_mfa_attempts.sql (límite de intentos del
-- 2FA, auditoría de autorización 2026-11-17, hallazgo 1). 2026-11-17.
--
-- SIN PÉRDIDA: la migración no agregó tablas ni columnas; solo creó
-- system.take_staff_mfa_attempt y subió la versión. Esto borra esa función y
-- deja public.app_schema_version() EXACTA a la de 20261113000400. El esquema
-- queda idéntico (pg_dump -s, con permisos) al de una base con las migraciones
-- hasta 20261113000400; lo prueba scripts/ops/reversa/comprobar-0400.sh (paso 0).
-- Las claves staff_mfa:* de system.rate_limits son efímeras (ventana de 15 min;
-- las purga system.purge_rate_limits) y los eventos auth.mfa_rate_limited son
-- auditoría (nunca se borran): ambos se quedan.
--
-- El código de esta rama llama a system.take_staff_mfa_attempt en cada intento
-- de TOTP y espera su versión (EXPECTED_SCHEMA_VERSION 20261117000300, D-POR-06):
-- con la base en 0400 nadie del staff podría completar la 2FA. Orden:
--   1. desplegar el código que espera 20261113000400 (sin este cambio);
--   2. correr esto.
--
-- ORDEN DE REVERSA: de la migración más nueva a la más vieja, cada una con su
-- candado de versión. La reversa de 0400 se rechaza mientras la base esté en
-- esta versión.
--
-- Uso (SOLO con autorización y en la ventana): psql -X -1 -v ON_ERROR_STOP=1 -f <este archivo>
-- =============================================================================

-- Candado: solo sobre una base exactamente en 20261117000300.
do $$
begin
  if coalesce(public.app_schema_version(), '') <> '20261117000300' then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = format('La base está en %s; esta reversa solo aplica a 20261117000300.',
                      coalesce(public.app_schema_version(), 'desconocida'));
  end if;
end
$$;

-- 1. La única función nueva (sin datos propios).
drop function system.take_staff_mfa_attempt(uuid, uuid, text);

-- 2. Versión del esquema (D-POR-06): idéntica a la de 20261113000400_import_batches.sql.
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261117000200'::text
$$;
