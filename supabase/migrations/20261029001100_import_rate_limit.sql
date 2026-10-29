-- Auditoría de amenazas 2026-10-29 (AUD-03, vecino ruidoso): una tienda podía
-- crear importaciones sin límite (cada una valida hasta 5,000 filas en la base).
-- Tope por tienda: 30 importaciones por hora, en un trigger para cubrir todo
-- camino que cree una. Las demás tiendas no se ven afectadas.
create function app.import_jobs_rate_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.rate_limit_take('imports:' || new.store_id::text, 30, 3600) then
    raise exception using errcode = 'P0001', message = 'rate_limited', detail = 'imports';
  end if;
  return new;
end
$$;
revoke all on function app.import_jobs_rate_limit() from public;

create trigger import_jobs_rate_limit before insert on public.import_jobs
  for each row execute function app.import_jobs_rate_limit();

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029001100'::text
$$;
