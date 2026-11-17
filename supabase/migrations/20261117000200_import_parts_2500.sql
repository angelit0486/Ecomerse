-- =============================================================================
-- ADR-067 (PROPUESTO; issue #18): partes de hasta 2,500 filas y hasta 20 partes
-- por lote, en lugar de 5,000 y 10. El tope de 50,000 filas por lote no cambia.
--
-- Por qué: cada parte se aplica en UNA transacción del worker, con el
-- statement_timeout de la cola (~50-57 s por intento, 3 intentos). Con 5,000
-- filas, en un runner lento de CI la parte se pasaba del tiempo
-- (import-batch.spec.ts). Con 20261117000100 una parte de 4,998 filas tarda
-- ~12 s en local; con 2,500 filas, ~6 s: holgura de ~8x sobre el límite.
--
--  * import_batches.parts_count e import_jobs.part_number: hasta 20.
--  * public.imports_batch_create: 1 a 20 partes, cada una de 1 a 2,500 filas
--    (antes 1 a 10 y 1 a 5,000); el resto, igual que en 20261113000400.
--  * Sin cambios: una importación suelta sigue aceptando hasta 5,000 filas
--    (todo o nada, como siempre); el tope de 30 importaciones por hora (cada
--    parte cuenta: un lote de 50,000 filas usa 20 de las 30); los lotes ya
--    creados con partes de hasta 5,000 filas siguen funcionando igual.
--
-- Reversa: scripts/ops/reversa/20261117000200_import_parts_2500.reversa.sql
--   (se rechaza si ya hay un lote con más de 10 partes: no se borra nada).
-- =============================================================================

alter table public.import_batches drop constraint import_batches_parts_count_check;
alter table public.import_batches
  add constraint import_batches_parts_count_check check (parts_count between 1 and 20);

alter table public.import_jobs drop constraint import_jobs_part_number_check;
alter table public.import_jobs
  add constraint import_jobs_part_number_check check (part_number between 1 and 20);

-- 1. Crear el lote (o retomar el mismo archivo): como en 20261113000400, con los topes nuevos.
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
  -- ADR-067: hasta 20 partes de hasta 2,500 filas (antes 10 de 5,000).
  if v_parts not between 1 and 20 or coalesce(cardinality(p_part_fingerprints), 0) <> v_parts
     or exists (select 1 from unnest(p_part_rows) r where r is null or r not between 1 and 2500)
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


-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261117000200'::text
$$;
