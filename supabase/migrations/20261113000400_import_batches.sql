-- =============================================================================
-- ADR-064, opción A (aprobada por el propietario, Orden 10 mensaje 4):
-- importar más de 5,000 filas por partes transaccionales.
--
--  * El navegador parte el archivo en partes de hasta 5,000 filas sin separar
--    las filas de un mismo producto y crea un LOTE (public.import_batches) con la
--    huella (SHA-256) de cada parte. Cada parte es una importación normal
--    (import_jobs.batch_id / part_number): misma validación, misma vista previa,
--    TODO o NADA al aplicarse (GATE0 §26.1 sigue intacto por parte).
--  * La atomicidad es por parte. El propietario aceptó en forma expresa que un
--    lote quede aplicado a medias: las partes se aplican en orden y el lote se
--    detiene en la primera que falla; las anteriores quedan aplicadas, esa no
--    deja nada y las siguientes esperan. El panel lo dice parte por parte.
--  * Idempotente: subir otra vez la misma parte (misma huella) devuelve la misma
--    importación; una parte corregida (otra huella) reemplaza a la anterior si
--    esta no se aplicó. Una parte aplicada no se puede volver a subir.
--  * Recuperable: el lote vive en la base; volver a elegir el mismo archivo lo
--    retoma (misma huella del archivo) y solo sube las partes que faltan. El
--    worker avanza a la siguiente parte en la misma transacción en que termina
--    la anterior.
--  * Un producto no puede quedar repartido entre dos partes (la base lo rechaza).
--  * Topes: hasta 10 partes y 50,000 filas por lote; cada parte cuenta en el tope
--    de 30 importaciones por hora (se comprueba al crear el lote). Un lote de una
--    sola parte sirve para un archivo de más de 4 MB con hasta 5,000 filas (el
--    servidor ya no recibe el archivo entero: solo cada parte, de hasta 3.5 MB).
--  * Cancelar solo mientras ninguna parte se está aplicando; lo aplicado se queda.
--
-- Reversa: public.imports_commit como en 20261027000200 y
--   public.imports_accept_categories como en 20261113000200 y
--   system.fail_stuck_imports como en 20261015000700; drop de
--   system.resume_stuck_publish_runs y de la columna publish_runs.resumes; drop de las funciones
--   nuevas, de las columnas batch_id, part_number y part_fingerprint de
--   import_jobs y de la tabla import_batches. Las importaciones de las partes
--   quedan como importaciones sueltas (sus productos no cambian).
-- =============================================================================

create table public.import_batches (
  id                  uuid primary key default app.uuid_v7(),
  store_id            uuid not null references public.stores (id) on delete cascade,
  file_name           text not null check (char_length(file_name) between 1 and 200),
  mode                text not null check (mode in ('create_only', 'update_existing', 'upsert')),
  total_rows          integer not null check (total_rows between 1 and 50000),
  parts_count         integer not null check (parts_count between 1 and 10),
  part_rows           integer[] not null,
  part_fingerprints   text[] not null,
  file_fingerprint    text not null check (file_fingerprint ~ '^[0-9a-f]{64}$'),
  status              text not null default 'uploading'
                      check (status in ('uploading', 'ready', 'running', 'stopped', 'completed', 'cancelled')),
  new_categories      text[] not null default '{}' check (cardinality(new_categories) <= 200),
  requested_by        uuid references auth.users (id) on delete set null,
  commit_requested_by uuid references auth.users (id) on delete set null,
  stop_reason         text check (stop_reason is null or char_length(stop_reason) <= 300),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (store_id, id),
  check (cardinality(part_rows) = parts_count and cardinality(part_fingerprints) = parts_count)
);
create index import_batches_store_idx on public.import_batches (store_id, created_at desc);
create index import_batches_requested_by_idx on public.import_batches (requested_by);
create index import_batches_commit_requested_by_idx on public.import_batches (commit_requested_by);

create trigger import_batches_set_updated_at before update on public.import_batches
  for each row execute function app.set_updated_at();
create trigger import_batches_prevent_tenant_change before update on public.import_batches
  for each row execute function app.prevent_tenant_change();

alter table public.import_batches enable row level security;
alter table public.import_batches force row level security;
revoke all on table public.import_batches from public, anon, authenticated, service_role;
grant select on table public.import_batches to authenticated;
create policy import_batches_select on public.import_batches for select to authenticated
  using (app.has_store_permission(store_id, 'imports.run'));

alter table public.import_jobs
  add column batch_id uuid,
  add column part_number integer check (part_number between 1 and 10),
  add column part_fingerprint text check (part_fingerprint is null or part_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint import_jobs_batch_fk foreign key (store_id, batch_id)
    references public.import_batches (store_id, id) on delete cascade,
  add constraint import_jobs_batch_part check ((batch_id is null) = (part_number is null));
create index import_jobs_batch_idx on public.import_jobs (store_id, batch_id, part_number);
-- Una sola importación viva por parte (las canceladas y las fallidas no cuentan).
create unique index import_jobs_batch_part_live_uq on public.import_jobs (batch_id, part_number)
  where batch_id is not null and status not in ('cancelled', 'failed');

-- La importación viva de cada parte (la más reciente que no se canceló).
create function app.import_batch_part_job(p_batch_id uuid, p_part integer)
returns public.import_jobs
language sql
stable
security definer
set search_path = ''
as $$
  select j.* from public.import_jobs j
   where j.batch_id = p_batch_id and j.part_number = p_part and j.status <> 'cancelled'
   order by (j.status <> 'failed') desc, j.created_at desc
   limit 1
$$;
revoke all on function app.import_batch_part_job(uuid, integer) from public;

-- Lo que ya se subió de cada parte (para retomar sin volver a subirla).
create function app.import_batch_parts(p_batch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('part', g.n, 'status', j.status, 'fingerprint', j.part_fingerprint,
                                               'errors', coalesce((j.totals ->> 'errors')::integer, 0))
                            order by g.n), '[]'::jsonb)
    from public.import_batches b
    cross join lateral generate_series(1, b.parts_count) g(n)
    cross join lateral app.import_batch_part_job(b.id, g.n) j
   where b.id = p_batch_id and j.id is not null
$$;
revoke all on function app.import_batch_parts(uuid) from public;

-- 1. Crear el lote (o retomar el mismo archivo).
create function public.imports_batch_create(p_store_id uuid, p_file_name text, p_mode text, p_part_rows integer[],
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
revoke all on function public.imports_batch_create(uuid, text, text, integer[], text[], text) from public;
grant execute on function public.imports_batch_create(uuid, text, text, integer[], text[], text) to authenticated;

-- Aplica a una parte las categorías aceptadas en el lote (las que le faltan y se pueden crear).
create function app.import_batch_apply_categories(p_batch_id uuid, p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.import_batches;
  v_paths text[];
begin
  select * into v_batch from public.import_batches b where b.id = p_batch_id;
  v_paths := array(select m ->> 'path' from jsonb_array_elements(app.import_missing_categories(v_batch.store_id, p_job_id)) m
                    where (m ->> 'creatable')::boolean
                      and m ->> 'key' = any (select app.import_category_key(c) from unnest(v_batch.new_categories) c)
                    order by (m ->> 'first_row')::integer);
  update public.import_jobs set new_categories = v_paths where id = p_job_id;
  perform app.import_recheck_categories(p_job_id);
end
$$;
revoke all on function app.import_batch_apply_categories(uuid, uuid) from public;

-- 2. Subir una parte (idempotente; una corregida reemplaza a la anterior sin aplicar).
create function public.imports_create_part(p_store_id uuid, p_batch_id uuid, p_part integer, p_fingerprint text,
                                           p_columns text[], p_ignored text[], p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.import_batches;
  v_live  public.import_jobs;
  v_job   uuid;
  v_dup   text;
begin
  perform app.require_store_permission(p_store_id, 'imports.run');
  select * into v_batch from public.import_batches b where b.store_id = p_store_id and b.id = p_batch_id for update;
  if v_batch.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'import_batch';
  end if;
  if v_batch.status in ('completed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'batch_closed';
  end if;
  if p_part is null or p_part not between 1 and v_batch.parts_count
     or coalesce(p_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'part';
  end if;

  v_live := app.import_batch_part_job(v_batch.id, p_part);
  if v_live.id is not null and v_live.status <> 'failed' and v_live.part_fingerprint = p_fingerprint then
    -- La misma parte otra vez (reintento, doble clic, retomar): la misma importación.
    return jsonb_build_object('job_id', v_live.id, 'reused', true);
  end if;
  if v_live.status = 'completed' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'part_applied';
  end if;
  if v_live.status in ('committing', 'validating') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'part_processing';
  end if;
  -- Primera vez: debe ser la parte del archivo con que se creó el lote.
  if v_live.id is null and v_batch.part_fingerprints[p_part] <> p_fingerprint
     and not exists (select 1 from public.import_jobs j where j.batch_id = v_batch.id and j.part_number = p_part) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'part_fingerprint';
  end if;
  -- Una parte corregida reemplaza a la que no se aplicó.
  if v_live.id is not null and v_live.status = 'validated' then
    update public.import_jobs set status = 'cancelled', error = 'Reemplazada por una versión corregida.'
     where id = v_live.id;
  end if;

  v_job := public.imports_create(p_store_id, v_batch.mode,
                                 format('%s · parte %s de %s', left(v_batch.file_name, 170), p_part, v_batch.parts_count),
                                 p_columns, p_ignored, p_rows);
  update public.import_jobs set batch_id = v_batch.id, part_number = p_part, part_fingerprint = p_fingerprint
   where id = v_job;
  update public.import_batches b
     set part_fingerprints[p_part] = p_fingerprint,
         part_rows[p_part] = jsonb_array_length(p_rows),
         total_rows = (select sum(x)::integer
                         from unnest(b.part_rows[:p_part - 1] || jsonb_array_length(p_rows) || b.part_rows[p_part + 1:]) x)
   where b.id = v_batch.id;

  -- Un producto no puede quedar repartido entre dos partes (por conjuntos: con
  -- 5,000 filas contra las de las demás partes, una unión por hash).
  with mine as (
    select distinct lower(btrim(r.raw ->> 'handle')) as h from public.import_job_rows r
     where r.store_id = p_store_id and r.import_job_id = v_job and nullif(btrim(r.raw ->> 'handle'), '') is not null
  ), others as (
    select distinct lower(btrim(o.raw ->> 'handle')) as h
      from public.import_jobs oj
      join public.import_job_rows o on o.store_id = oj.store_id and o.import_job_id = oj.id
     where oj.store_id = p_store_id and oj.batch_id = v_batch.id and oj.id <> v_job
       and oj.status not in ('cancelled', 'failed')
  )
  select m.h into v_dup from mine m join others x on x.h = m.h limit 1;
  if v_dup is not null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'split_product',
      hint = left(v_dup, 200);
  end if;

  if cardinality(v_batch.new_categories) > 0 and app.has_store_permission(p_store_id, 'categories.manage') then
    perform app.import_batch_apply_categories(v_batch.id, v_job);
  end if;
  -- Con todas las partes arriba, el lote queda listo.
  if v_batch.status = 'uploading'
     and (select count(distinct j.part_number) from public.import_jobs j
           where j.batch_id = v_batch.id and j.status not in ('cancelled', 'failed')) = v_batch.parts_count then
    update public.import_batches set status = 'ready' where id = v_batch.id;
  end if;
  return jsonb_build_object('job_id', v_job, 'reused', false);
end
$$;
revoke all on function public.imports_create_part(uuid, uuid, integer, text, text[], text[], jsonb) from public;
grant execute on function public.imports_create_part(uuid, uuid, integer, text, text[], text[], jsonb) to authenticated;

-- 3. Avanzar el lote: empieza la siguiente parte o se detiene con el motivo.
create function app.import_batch_advance(p_batch_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.import_batches;
  v_job   public.import_jobs;
  v_part  integer;
  v_need  text;
begin
  select * into v_batch from public.import_batches b where b.id = p_batch_id for update;
  if v_batch.id is null or v_batch.status <> 'running' then
    return coalesce(v_batch.status, 'missing');
  end if;
  if exists (select 1 from public.import_jobs j where j.batch_id = v_batch.id and j.status = 'committing') then
    return 'running';
  end if;
  for v_part in 1 .. v_batch.parts_count loop
    v_job := app.import_batch_part_job(v_batch.id, v_part);
    continue when v_job.status = 'completed';
    if v_job.id is null then
      update public.import_batches set status = 'stopped', stop_reason = format('Falta subir la parte %s.', v_part)
       where id = v_batch.id;
      return 'stopped';
    end if;
    if v_job.status = 'failed' then
      update public.import_batches
         set status = 'stopped',
             stop_reason = left(format('La parte %s no se pudo aplicar: %s', v_part, coalesce(v_job.error, '')), 300)
       where id = v_batch.id;
      return 'stopped';
    end if;
    if v_job.status <> 'validated' or coalesce((v_job.totals ->> 'errors')::integer, 1) > 0 then
      update public.import_batches
         set status = 'stopped',
             stop_reason = format('La parte %s tiene errores: corrígela y súbela de nuevo.', v_part)
       where id = v_batch.id;
      return 'stopped';
    end if;
    -- CF-10 temprano: quien pidió aplicar el lote debe tener lo que exige esta parte.
    select n into v_need from unnest(array['imports.run'] || coalesce(v_job.needs, '{}')) with ordinality q(n, o)
     where not coalesce(system.user_has_store_permission(v_batch.commit_requested_by, v_batch.store_id, n), false)
     order by o limit 1;
    if v_need is not null then
      update public.import_batches
         set status = 'stopped',
             stop_reason = format('Quien aplicó el lote ya no tiene el permiso necesario (%s).', v_need)
       where id = v_batch.id;
      return 'stopped';
    end if;
    update public.import_jobs
       set status = 'committing', commit_requested_by = v_batch.commit_requested_by,
           commit_requested_at = now(), error = null
     where id = v_job.id;
    perform app.enqueue_job('import.commit', jsonb_build_object('import_job_id', v_job.id), v_batch.store_id,
                            'import.commit:' || v_job.id, now(), 3);
    return 'running';
  end loop;
  update public.import_batches set status = 'completed', stop_reason = null where id = v_batch.id;
  perform audit.record('import.batch_completed', 'import_batch', v_batch.id,
                       (select s.organization_id from public.stores s where s.id = v_batch.store_id), v_batch.store_id,
                       null, jsonb_build_object('parts', v_batch.parts_count, 'rows', v_batch.total_rows));
  return 'completed';
end
$$;
revoke all on function app.import_batch_advance(uuid) from public;

-- 4. Aplicar el lote (en orden). Repetir no empieza dos veces la misma parte.
create function public.imports_batch_commit(p_store_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid;
  v_batch public.import_batches;
begin
  v_uid := app.require_store_permission(p_store_id, 'imports.run');
  select * into v_batch from public.import_batches b where b.store_id = p_store_id and b.id = p_batch_id for update;
  if v_batch.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'import_batch';
  end if;
  if v_batch.status in ('completed', 'cancelled') then
    return jsonb_build_object('status', v_batch.status, 'replayed', true);
  end if;
  if v_batch.status = 'running'
     and exists (select 1 from public.import_jobs j where j.batch_id = v_batch.id and j.status = 'committing') then
    return jsonb_build_object('status', 'running', 'replayed', true);
  end if;
  update public.import_batches
     set status = 'running', commit_requested_by = v_uid, stop_reason = null
   where id = v_batch.id;
  return jsonb_build_object('status', app.import_batch_advance(v_batch.id), 'replayed', false);
end
$$;
revoke all on function public.imports_batch_commit(uuid, uuid) from public;
grant execute on function public.imports_batch_commit(uuid, uuid) to authenticated;

-- 5. El worker, al terminar una parte (aplicada o no), avanza el lote en la
--    MISMA transacción: si el worker se cae, no queda un lote sin siguiente paso.
create function system.import_batch_after_part(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
begin
  select j.batch_id into v_batch from public.import_jobs j where j.id = p_job_id;
  if v_batch is null then
    return null;
  end if;
  return app.import_batch_advance(v_batch);
end
$$;
revoke all on function system.import_batch_after_part(uuid) from public;
grant execute on function system.import_batch_after_part(uuid) to system_worker;

-- 6. Cancelar (solo si ninguna parte se está aplicando; lo aplicado se queda).
create function public.imports_batch_cancel(p_store_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch   public.import_batches;
  v_applied integer;
begin
  perform app.require_store_permission(p_store_id, 'imports.run');
  select * into v_batch from public.import_batches b where b.store_id = p_store_id and b.id = p_batch_id for update;
  if v_batch.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'import_batch';
  end if;
  if v_batch.status in ('completed', 'cancelled') then
    return jsonb_build_object('status', v_batch.status, 'replayed', true);
  end if;
  if exists (select 1 from public.import_jobs j where j.batch_id = v_batch.id and j.status in ('committing', 'validating')) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'batch_processing';
  end if;
  update public.import_jobs set status = 'cancelled', error = 'Lote cancelado.'
   where batch_id = v_batch.id and status in ('uploaded', 'validated');
  select count(*)::integer into v_applied from public.import_jobs j where j.batch_id = v_batch.id and j.status = 'completed';
  update public.import_batches
     set status = 'cancelled',
         stop_reason = case when v_applied > 0
                            then format('Lote cancelado: %s %s ya aplicada%s se queda%s en tu catálogo.', v_applied,
                                        case when v_applied = 1 then 'parte' else 'partes' end,
                                        case when v_applied = 1 then '' else 's' end,
                                        case when v_applied = 1 then '' else 'n' end)
                            else 'Lote cancelado: no se aplicó ninguna parte.' end
   where id = v_batch.id;
  perform audit.record('import.batch_cancelled', 'import_batch', v_batch.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id, null,
                       jsonb_build_object('applied_parts', v_applied));
  return jsonb_build_object('status', 'cancelled', 'applied_parts', v_applied);
end
$$;
revoke all on function public.imports_batch_cancel(uuid, uuid) from public;
grant execute on function public.imports_batch_cancel(uuid, uuid) to authenticated;

-- 7. ADR-065 en lotes: categorías que faltan en todo el lote y aceptarlas una vez.
create function public.imports_batch_new_categories(p_store_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_batch public.import_batches;
begin
  perform app.require_store_permission(p_store_id, 'imports.run');
  select * into v_batch from public.import_batches b where b.store_id = p_store_id and b.id = p_batch_id;
  if v_batch.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'import_batch';
  end if;
  return jsonb_build_object(
    'can_create', app.has_store_permission(p_store_id, 'categories.manage'),
    'accepted', to_jsonb(v_batch.new_categories),
    'missing', coalesce((
      select jsonb_agg(g.obj order by g.first_part, g.first_row)
        from (select min(j.part_number) as first_part,
                     min((m ->> 'first_row')::integer) as first_row,
                     jsonb_build_object(
                       'path', (array_agg(m ->> 'path' order by j.part_number, (m ->> 'first_row')::integer))[1],
                       'key', m ->> 'key',
                       'products', sum((m ->> 'products')::integer),
                       'creatable', bool_and((m ->> 'creatable')::boolean),
                       'reason', (array_agg(m ->> 'reason' order by j.part_number)
                                    filter (where m ->> 'reason' is not null))[1],
                       'hint', (array_agg(m ->> 'hint' order by j.part_number)
                                  filter (where m ->> 'hint' is not null))[1],
                       'similar', (array_agg(m -> 'similar' order by j.part_number))[1],
                       'accepted', (m ->> 'key') = any (select app.import_category_key(c)
                                                          from unnest(v_batch.new_categories) c)) as obj
                from public.import_jobs j
                cross join lateral jsonb_array_elements(app.import_missing_categories(p_store_id, j.id)) m
               where j.store_id = p_store_id and j.batch_id = v_batch.id and j.status = 'validated'
               group by m ->> 'key') g), '[]'::jsonb));
end
$$;
revoke all on function public.imports_batch_new_categories(uuid, uuid) from public;
grant execute on function public.imports_batch_new_categories(uuid, uuid) to authenticated;

create function public.imports_batch_accept_categories(p_store_id uuid, p_batch_id uuid, p_paths text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch   public.import_batches;
  v_missing jsonb;
  v_keys    text[];
  v_job     uuid;
begin
  perform app.require_store_permission(p_store_id, 'imports.run');
  perform app.require_store_permission(p_store_id, 'categories.manage');
  select * into v_batch from public.import_batches b where b.store_id = p_store_id and b.id = p_batch_id for update;
  if v_batch.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'import_batch';
  end if;
  if v_batch.status not in ('uploading', 'ready', 'stopped') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'batch_not_editable';
  end if;
  if coalesce(cardinality(p_paths), 0) > 200 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'categories';
  end if;
  v_missing := public.imports_batch_new_categories(p_store_id, p_batch_id) -> 'missing';
  v_keys := array(select distinct app.import_category_key(p) from unnest(coalesce(p_paths, '{}')) p
                   where nullif(btrim(p), '') is not null);
  if exists (select 1 from unnest(v_keys) k
              where not exists (select 1 from jsonb_array_elements(v_missing) m
                                 where m ->> 'key' = k and (m ->> 'creatable')::boolean)) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'categories';
  end if;
  update public.import_batches
     set new_categories = array(select m ->> 'path' from jsonb_array_elements(v_missing) m where m ->> 'key' = any (v_keys))
   where id = v_batch.id;
  for v_job in select j.id from public.import_jobs j where j.batch_id = v_batch.id and j.status = 'validated' loop
    perform app.import_batch_apply_categories(v_batch.id, v_job);
  end loop;
  perform audit.record('import.categories_accepted', 'import_batch', v_batch.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('categories', to_jsonb(p_paths)));
  return (select jsonb_build_object('accepted', to_jsonb(b.new_categories)) from public.import_batches b where b.id = v_batch.id);
end
$$;
revoke all on function public.imports_batch_accept_categories(uuid, uuid, text[]) from public;
grant execute on function public.imports_batch_accept_categories(uuid, uuid, text[]) to authenticated;

-- 8. Una parte de lote solo se aplica desde su lote (en orden), y sus categorías
--    nuevas se eligen en el lote (igual para todas sus partes).
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
  if v_job.batch_id is not null then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'batch_part';
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
  -- ADR-064: las partes de un lote se aplican en orden desde el lote.
  if v_job.batch_id is not null then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'batch_part';
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

-- 10. Mantenimiento: una publicación de candidatos (Orden 10, mensaje 4) cuyo
--     trabajo murió —agotó sus intentos, o un worker con el código anterior lo
--     descartó por no conocerlo durante un despliegue— se retoma sola, hasta 3
--     veces. Después queda fallida con el motivo; los productos que faltaban
--     siguen en borrador (nada se publica sin pasar las reglas).
alter table public.publish_runs
  add column resumes integer not null default 0 check (resumes between 0 and 3);

create function system.resume_stuck_publish_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run   public.publish_runs;
  v_count integer := 0;
begin
  for v_run in
    select r.* from public.publish_runs r
     where r.status in ('queued', 'running') and r.updated_at < now() - interval '15 minutes'
       and not exists (select 1 from system.jobs q
                        where q.type = 'catalog.publish_run' and q.status in ('queued', 'running')
                          and q.payload ->> 'run_id' = r.id::text)
     for update of r skip locked
  loop
    if v_run.resumes >= 3 then
      update public.publish_runs
         set status = 'failed', finished_at = now(),
             error = 'La publicación no terminó después de varios intentos. Los productos que faltaban siguen en borrador: publícalos desde Productos.'
       where id = v_run.id;
    else
      update public.publish_runs set resumes = resumes + 1 where id = v_run.id;
      -- Llave nueva: la del trabajo muerto sigue ocupada (la cola no duplica llaves).
      perform app.enqueue_job('catalog.publish_run', jsonb_build_object('run_id', v_run.id), v_run.store_id,
                              format('catalog.publish_run:%s:%s', v_run.id, v_run.resumes + 1), now(), 5);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
revoke all on function system.resume_stuck_publish_runs() from public;
grant execute on function system.resume_stuck_publish_runs() to system_worker;

-- 9. Mantenimiento: una parte que nunca terminó (worker caído y sin reintentos)
--    queda fallida como cualquier importación atascada Y detiene su lote con el
--    motivo (antes el lote se quedaba «aplicando» para siempre).
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
    perform system.import_batch_after_part(v_job);
    v_count := v_count + 1;
  end loop;
  -- Y la publicación de candidatos que se quedó sin trabajo (sección 10).
  perform system.resume_stuck_publish_runs();
  return v_count;
end
$$;

-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261113000400'::text
$$;
