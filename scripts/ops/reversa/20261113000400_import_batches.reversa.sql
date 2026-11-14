-- =============================================================================
-- Reversa de 20261113000400_import_batches.sql (ADR-064). Orden 10, mensaje 5 (M1).
--
-- *** NO ES UNA REVERSA SIN PÉRDIDA. *** Solo con autorización expresa, con un
-- respaldo verificado tomado justo antes (docs/runbooks/respaldos.md) y cuando
-- la recuperación hacia adelante (runbook de despliegue, §9) no alcance.
--
-- SE PIERDE (no se puede reconstruir después):
--   - public.import_batches completa: nombre del archivo, partes, huellas,
--     estado, motivo de detención y categorías aceptadas de cada lote.
--   - import_jobs.batch_id, part_number y part_fingerprint: qué importación era
--     qué parte de qué lote.
--   - publish_runs.resumes: cuántas veces se retomó cada publicación.
-- SE CONSERVA:
--   - Productos, variantes, existencias, categorías y movimientos ya aplicados.
--   - Cada importación (import_jobs y sus filas) como importación suelta, con su
--     estado; las corridas de publicación y su resultado.
-- QUEDA DISTINTO:
--   - Las partes «validadas» que no se aplicaron se pueden confirmar sueltas
--     (imports_commit ya no las rechaza): hay que cancelarlas antes (paso 0).
--
-- Comprobado con scripts/ops/reversa/comprobar-0400.sh: tras esta reversa, el
-- esquema es idéntico (pg_dump -s) al de una base con las migraciones hasta
-- 20261113000300. Eso prueba el ESQUEMA, no recupera los datos de arriba.
-- =============================================================================

-- 0. Que ninguna parte sin aplicar quede como importación suelta confirmable.
update public.import_jobs set status = 'cancelled', error = 'Lote retirado (reversa de ADR-064).'
 where batch_id is not null and status in ('uploaded', 'validating', 'validated');

-- 1. Funciones nuevas.
drop function if exists system.resume_stuck_publish_runs();
drop function if exists public.imports_batch_accept_categories(uuid, uuid, text[]);
drop function if exists public.imports_batch_new_categories(uuid, uuid);
drop function if exists public.imports_batch_cancel(uuid, uuid);
drop function if exists system.import_batch_after_part(uuid);
drop function if exists public.imports_batch_commit(uuid, uuid);
drop function if exists app.import_batch_advance(uuid);
drop function if exists public.imports_create_part(uuid, uuid, integer, text, text[], text[], jsonb);
drop function if exists app.import_batch_apply_categories(uuid, uuid);
drop function if exists public.imports_batch_create(uuid, text, text, integer[], text[], text);
drop function if exists app.import_batch_parts(uuid);
drop function if exists app.import_batch_part_job(uuid, integer);

-- 2. Columnas y tabla (aquí se pierden los datos listados arriba).
alter table public.publish_runs drop column if exists resumes;
alter table public.import_jobs drop constraint if exists import_jobs_batch_fk,
  drop constraint if exists import_jobs_batch_part,
  drop column if exists batch_id, drop column if exists part_number, drop column if exists part_fingerprint;
drop table if exists public.import_batches;

-- 3. Funciones reemplazadas: su definición anterior.
create or replace function public.imports_commit(p_store_id uuid, p_job_id uuid, p_skip_errors boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_job public.import_jobs;
begin
  v_uid := app.require_store_permission(p_store_id, 'imports.run');
  select * into v_job from public.import_jobs j where j.store_id = p_store_id and j.id = p_job_id for update;
  if v_job.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'import_job';
  end if;
  if v_job.status in ('completed', 'committing') then
    return jsonb_build_object('status', v_job.status, 'replayed', true);
  end if;
  if v_job.status <> 'validated' or v_job.totals ->> 'errors' is null then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'import_not_ready';
  end if;
  -- Con errores, solo si se pide en forma expresa importar las filas buenas (ADR-040)
  -- y queda al menos un producto sin errores.
  if (v_job.totals ->> 'errors')::integer > 0 then
    if not coalesce(p_skip_errors, false) then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'import_not_ready';
    end if;
    if not exists (select 1 from public.import_job_rows r
                    where r.import_job_id = v_job.id and r.normalized is not null
                      and not exists (select 1 from public.import_job_rows e
                                 where e.import_job_id = r.import_job_id and jsonb_array_length(e.errors) > 0
                                   and lower(btrim(coalesce(e.raw ->> 'handle', '')))
                                       = lower(btrim(coalesce(r.raw ->> 'handle', ''))))) then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'import_nothing_valid';
    end if;
  end if;
  -- DB-L6: quien confirma debe tener lo que exige el lote (si no, el job queda intacto).
  if exists (select 1 from unnest(v_job.needs) n where not app.has_store_permission(p_store_id, n)) then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'import_permissions';
  end if;
  update public.import_jobs
     set status = 'committing', commit_requested_by = v_uid, commit_requested_at = now(), error = null
   where id = v_job.id;
  perform app.enqueue_job('import.commit', jsonb_build_object('import_job_id', v_job.id), p_store_id,
                          'import.commit:' || v_job.id, now(), 3);
  return jsonb_build_object('status', 'committing', 'replayed', false);
end
$$;

create or replace function public.imports_accept_categories(p_store_id uuid, p_job_id uuid, p_paths text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid;
  v_job     public.import_jobs;
  v_missing jsonb;
  v_keys    text[];
  v_paths   text[];
begin
  v_uid := app.require_store_permission(p_store_id, 'imports.run');
  perform app.require_store_permission(p_store_id, 'categories.manage');
  select * into v_job from public.import_jobs j where j.store_id = p_store_id and j.id = p_job_id for update;
  if v_job.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'import_job';
  end if;
  if v_job.status <> 'validated' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'import_not_validated';
  end if;
  if coalesce(cardinality(p_paths), 0) > 200 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'categories';
  end if;
  -- Cada ruta pedida debe ser una de las que faltan y poderse crear; se guarda
  -- con la forma en que la escribió el archivo (la primera vez que aparece).
  v_missing := app.import_missing_categories(p_store_id, p_job_id);
  v_keys := array(select distinct app.import_category_key(p) from unnest(coalesce(p_paths, '{}')) p
                   where nullif(btrim(p), '') is not null);
  if exists (select 1 from unnest(v_keys) k
              where not exists (select 1 from jsonb_array_elements(v_missing) m
                                 where m ->> 'key' = k and (m ->> 'creatable')::boolean)) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'categories';
  end if;
  v_paths := array(select m ->> 'path' from jsonb_array_elements(v_missing) m where m ->> 'key' = any (v_keys)
                    order by (m ->> 'first_row')::integer);
  update public.import_jobs set new_categories = v_paths where id = v_job.id;
  perform app.import_recheck_categories(v_job.id);
  perform audit.record('import.categories_accepted', 'import_job', v_job.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('categories', to_jsonb(v_paths)));
  return (select jsonb_build_object('accepted', to_jsonb(j.new_categories), 'totals', j.totals)
            from public.import_jobs j where j.id = v_job.id);
end
$$;

create or replace function system.fail_stuck_imports()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job   uuid;
  v_count integer := 0;
begin
  for v_job in
    select j.id from public.import_jobs j
     where j.status = 'committing' and j.commit_requested_at < now() - interval '30 minutes'
       and not exists (select 1 from system.jobs q
                        where q.dedupe_key = 'import.commit:' || j.id and q.status in ('queued', 'running'))
     for update skip locked
  loop
    perform app.import_mark_failed(v_job, 'La importación no terminó. No se cambió nada: vuelve a subir el archivo.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;


-- 4. Versión del esquema anterior.
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261113000300'::text
$$;
