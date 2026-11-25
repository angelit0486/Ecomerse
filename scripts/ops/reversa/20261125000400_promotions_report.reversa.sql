-- =============================================================================
-- Reversa de 20261125000400_promotions_report.sql (promociones, ADR-070, fase 4).
-- Quita el reporte (solo lectura) y deja la versión en 20261125000300.
-- Sin pérdida: no toca tablas ni datos.
-- Uso (solo con autorización): psql -X -1 -v ON_ERROR_STOP=1 -f <este archivo>
-- =============================================================================

-- Candado: solo sobre una base exactamente en 20261125000400.
do $$
begin
  if coalesce(public.app_schema_version(), '') <> '20261125000400' then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = format('La base está en %s; esta reversa solo aplica a 20261125000400.',
                      coalesce(public.app_schema_version(), 'desconocida'));
  end if;
end
$$;

drop function public.promotions_report(uuid, date, date);

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261125000300'::text
$$;
