-- =============================================================================
-- Reversa de 20261116000100_home_control_center.sql (Inicio como centro de
-- control, PR #12). 2026-11-17.
--
-- ORDEN DE REVERSA DEL PAQUETE (11 migraciones). Las reversas van de la más
-- nueva a la más vieja y cada una tiene su propio candado de versión:
--   1.º esta reversa (20261116000100 → 20261113000400) y desplegar el código
--       que espera 20261113000400 (producto/orden-10 sin el PR #12);
--   2.º solo si hace falta, la reversa de 0400
--       (20261113000400_import_batches.reversa.sql, con TODO su candado).
-- La reversa de 0400 se rechaza mientras la base esté en 20261116000100; así
-- está diseñada y no se debilita.
--
-- Qué hace: la migración solo agregó lecturas (dos funciones y un índice) y
-- subió la versión. Esto las elimina y deja public.app_schema_version() EXACTA
-- a la de 20261113000400. No borra ni cambia datos. El esquema resultante es
-- idéntico (pg_dump -s y permisos de funciones) al de una base con las
-- migraciones hasta 20261113000400; lo prueba scripts/ops/reversa/comprobar-0400.sh.
--
-- Uso (SOLO con autorización y en la ventana): psql -X -1 -v ON_ERROR_STOP=1 -f <este archivo>
-- =============================================================================

-- Candado: solo sobre una base exactamente en 20261116000100.
do $$
begin
  if coalesce(public.app_schema_version(), '') <> '20261116000100'
     or to_regprocedure('public.dashboard_customer_mix(uuid, date, date)') is null then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = format('La base está en %s; esta reversa solo aplica a 20261116000100.',
                      coalesce(public.app_schema_version(), 'desconocida'));
  end if;
end
$$;

drop function public.dashboard_customer_mix(uuid, date, date);
drop function public.dashboard_recoverable_carts(uuid);
drop index public.carts_store_recoverable_idx;

-- Versión del esquema (D-POR-06): idéntica a la de 20261113000400_import_batches.sql.
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261113000400'::text
$$;
