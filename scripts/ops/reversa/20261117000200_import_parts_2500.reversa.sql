-- =============================================================================
-- Reversa de 20261117000200_import_parts_2500.sql (ADR-067: partes de 2,500
-- filas, hasta 20 partes). 2026-11-17.
--
-- SIN PÉRDIDA: vuelve a los topes de 20261113000400 (hasta 10 partes de 5,000
-- filas) y deja public.app_schema_version() EXACTA a la de 20261117000100. El
-- esquema queda idéntico (pg_dump -s, con permisos) al de una base con las
-- migraciones hasta 20261117000100; lo prueba scripts/ops/reversa/comprobar-0400.sh
-- (paso 0, lista NEWER).
--
-- Si ya existe un lote con más de 10 partes, el candado la RECHAZA sin cambiar
-- nada: volver al tope de 10 obligaría a borrar esos lotes y no se borra nada.
--
-- ANTES DE CORRER ESTO: el código de ADR-067 parte los archivos en partes de
-- 2,500 filas y espera la versión 20261117000200. Orden: 1. desplegar el código
-- que espera 20261117000100 (la rama de la opción (b), sin ADR-067); 2. correr
-- esto. Con la base en 20261117000100 el código de ADR-067 mostraría «mantenimiento».
--
-- ORDEN DE REVERSA: es la primera (la más nueva). Después, solo si hace falta,
-- 20261117000100_import_commit_speed.reversa.sql y luego la de 0400.
--
-- Uso (SOLO con autorización y en la ventana): psql -X -1 -v ON_ERROR_STOP=1 -f <este archivo>
-- =============================================================================

-- Candado: solo sobre una base exactamente en 20261117000200 y sin lotes de más de 10 partes.
do $$
declare
  v_big integer;
begin
  if coalesce(public.app_schema_version(), '') <> '20261117000200' then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = format('La base está en %s; esta reversa solo aplica a 20261117000200.',
                      coalesce(public.app_schema_version(), 'desconocida'));
  end if;
  select count(*) into v_big from public.import_batches where parts_count > 10;
  if v_big > 0 or exists (select 1 from public.import_jobs where part_number > 10) then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = format('Hay %s lotes con más de 10 partes; volver al tope de 10 obligaría a borrarlos.', v_big);
  end if;
end
$$;

alter table public.import_batches drop constraint import_batches_parts_count_check;
alter table public.import_batches
  add constraint import_batches_parts_count_check check (parts_count between 1 and 10);

alter table public.import_jobs drop constraint import_jobs_part_number_check;
alter table public.import_jobs
  add constraint import_jobs_part_number_check check (part_number between 1 and 10);

-- public.imports_batch_create como en 20261113000400_import_batches.sql.
create or replace function public.imports_batch_create(p_store_id uuid, p_file_name text, p_mode text, p_part_rows integer[],
                                            p_part_fingerprints text[], p_file_fingerprint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid;
  v_id    uuid;
  v_total integer;
  v_parts integer := coalesce(cardinality(p_part_rows), 0);
  v_hits  integer;
begin
  v_uid := app.require_store_permission(p_store_id, 'imports.run');
  if p_mode is null or p_mode not in ('create_only', 'update_existing', 'upsert') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'mode';
  end if;
  if v_parts not between 1 and 10 or coalesce(cardinality(p_part_fingerprints), 0) <> v_parts
     or exists (select 1 from unnest(p_part_rows) r where r is null or r not between 1 and 5000)
     or exists (select 1 from unnest(p_part_fingerprints) f where f is null or f !~ '^[0-9a-f]{64}$')
     or coalesce(p_file_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'batch';
  end if;
  v_total := (select sum(r) from unnest(p_part_rows) r);
  if v_total > 50000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'too_many_rows';
  end if;
  -- El mismo archivo (y modo) que ya se está importando: se retoma ese lote.
  select b.id into v_id from public.import_batches b
   where b.store_id = p_store_id and b.file_fingerprint = p_file_fingerprint and b.mode = p_mode
     and b.status not in ('completed', 'cancelled') and b.created_at > now() - interval '7 days'
   order by b.created_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object('batch_id', v_id, 'resumed', true, 'parts', app.import_batch_parts(v_id));
  end if;
  -- Cada parte es una importación: el lote debe caber en el tope por hora.
  select coalesce(sum(r.hits), 0)::integer into v_hits from system.rate_limits r
   where r.bucket = 'imports:' || p_store_id::text
     and r.window_start = to_timestamp(floor(extract(epoch from now()) / 3600) * 3600);
  if v_hits + v_parts > 30 then
    raise exception using errcode = 'P0001', message = 'rate_limited', detail = 'imports_batch';
  end if;
  insert into public.import_batches (store_id, file_name, mode, total_rows, parts_count, part_rows,
                                     part_fingerprints, file_fingerprint, requested_by)
  values (p_store_id, left(btrim(coalesce(nullif(p_file_name, ''), 'archivo.csv')), 200), p_mode, v_total, v_parts,
          p_part_rows, p_part_fingerprints, p_file_fingerprint, v_uid)
  returning id into v_id;
  perform audit.record('import.batch_created', 'import_batch', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id, null,
                       jsonb_build_object('file', p_file_name, 'mode', p_mode, 'rows', v_total, 'parts', v_parts));
  return jsonb_build_object('batch_id', v_id, 'resumed', false, 'parts', '[]'::jsonb);
end
$$;

-- Versión del esquema (D-POR-06): idéntica a la de 20261117000100_import_commit_speed.sql.
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261117000100'::text
$$;
