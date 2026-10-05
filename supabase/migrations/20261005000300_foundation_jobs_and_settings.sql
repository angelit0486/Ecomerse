-- =============================================================================
-- Fase 1 — Foundation · Cola transaccional única (system.jobs) y platform_settings
-- Contrato: GATE0 §9.2 (Sistema), §28 (Event Architecture, ADR-019), §35 (health)
--
-- Decisión de implementación (registrada en docs/DECISIONS.md, D-F1-03):
--   la tabla vive en el esquema "system" (no expuesto) en lugar de "public".
--   Es más estricto que la especificación: ni siquiera es alcanzable por la Data API.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- platform_settings: configuración global de la plataforma.
-- Lectura y escritura solo mediante funciones (Fase 2+). Sin políticas = sin acceso.
-- -----------------------------------------------------------------------------
create table public.platform_settings (
  key         text primary key
              check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' and length(key) <= 64),
  value       jsonb not null check (jsonb_typeof(value) = 'object'),
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.platform_settings enable row level security;
alter table public.platform_settings force row level security;
revoke all on table public.platform_settings from anon, authenticated, service_role;

create trigger platform_settings_set_updated_at
  before update on public.platform_settings
  for each row execute function app.set_updated_at();

comment on table public.platform_settings is
  'Configuración global (gracias de suscripción, handles reservados, defaults de branding). Acceso solo por funciones.';

-- -----------------------------------------------------------------------------
-- system.jobs: outbox + cola (un job por suscriptor de evento, encolado en la
-- MISMA transacción que el cambio de negocio).
-- Estados: queued → running → succeeded | (queued con backoff) | dead
-- -----------------------------------------------------------------------------
create table system.jobs (
  id            uuid primary key default app.uuid_v7(),
  -- FK a public.stores(id) ON DELETE CASCADE se agrega en la Fase 2 (la tabla aún no existe).
  store_id      uuid,
  type          text not null
                check (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and length(type) <= 100),
  payload       jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  dedupe_key    text check (dedupe_key is null or length(dedupe_key) between 1 and 200),
  status        text not null default 'queued'
                check (status in ('queued', 'running', 'succeeded', 'dead')),
  attempts      integer not null default 0 check (attempts >= 0),
  max_attempts  integer not null default 8 check (max_attempts between 1 and 50),
  run_after     timestamptz not null default now(),
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz,
  constraint jobs_running_has_lock
    check ((status = 'running') = (locked_at is not null and locked_by is not null)),
  constraint jobs_finished_consistency
    check ((status in ('succeeded', 'dead')) = (finished_at is not null))
);

create unique index jobs_dedupe_key_uq on system.jobs (dedupe_key) where dedupe_key is not null;
create index jobs_ready_idx on system.jobs (run_after, id) where status = 'queued';
create index jobs_running_idx on system.jobs (locked_at) where status = 'running';
create index jobs_finished_idx on system.jobs (finished_at) where status in ('succeeded', 'dead');
create index jobs_store_idx on system.jobs (store_id) where store_id is not null;

alter table system.jobs enable row level security;
alter table system.jobs force row level security;
revoke all on table system.jobs from public, anon, authenticated, service_role, storefront_gateway, system_worker;

create trigger jobs_set_updated_at
  before update on system.jobs
  for each row execute function app.set_updated_at();

create trigger jobs_prevent_tenant_change
  before update on system.jobs
  for each row execute function app.prevent_tenant_change();

comment on table system.jobs is
  'Cola transaccional única (outbox + jobs). Solo accesible mediante funciones system.* y app.enqueue_job.';

-- -----------------------------------------------------------------------------
-- app.enqueue_job: encola dentro de la transacción del llamador.
-- Idempotente por dedupe_key (devuelve el job existente). NO es ejecutable por
-- ningún rol de aplicación: la invocan funciones SECURITY DEFINER del mismo dueño.
-- -----------------------------------------------------------------------------
create or replace function app.enqueue_job(
  p_type          text,
  p_payload       jsonb       default '{}'::jsonb,
  p_store_id      uuid        default null,
  p_dedupe_key    text        default null,
  p_run_after     timestamptz default now(),
  p_max_attempts  integer     default 8
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into system.jobs (type, payload, store_id, dedupe_key, run_after, max_attempts)
  values (p_type, coalesce(p_payload, '{}'::jsonb), p_store_id, p_dedupe_key,
          coalesce(p_run_after, now()), coalesce(p_max_attempts, 8))
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    select j.id into v_id from system.jobs j where j.dedupe_key = p_dedupe_key;
  end if;

  return v_id;
end
$$;

revoke all on function app.enqueue_job(text, jsonb, uuid, text, timestamptz, integer) from public;

-- -----------------------------------------------------------------------------
-- system.claim_jobs: toma hasta p_limit jobs listos (FOR UPDATE SKIP LOCKED).
-- Recupera jobs "running" cuyo bloqueo venció (worker caído): si agotaron sus
-- intentos pasan a dead; si no, se vuelven a encolar y pueden reclamarse.
-- -----------------------------------------------------------------------------
create or replace function system.claim_jobs(
  p_worker_id            text,
  p_limit                integer default 10,
  p_lock_timeout_seconds integer default 300
)
returns table (
  job_id           uuid,
  job_type         text,
  job_store_id     uuid,
  job_payload      jsonb,
  job_attempts     integer,
  job_max_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null or length(p_worker_id) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'invalid_worker_id';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid_limit';
  end if;
  if p_lock_timeout_seconds is null or p_lock_timeout_seconds not between 30 and 3600 then
    raise exception using errcode = '22023', message = 'invalid_lock_timeout';
  end if;

  update system.jobs j
     set status = 'dead', locked_at = null, locked_by = null, finished_at = now(),
         last_error = 'lock_timeout: intentos agotados'
   where j.status = 'running'
     and j.locked_at < now() - make_interval(secs => p_lock_timeout_seconds)
     and j.attempts >= j.max_attempts;

  update system.jobs j
     set status = 'queued', locked_at = null, locked_by = null,
         last_error = 'lock_timeout: reencolado'
   where j.status = 'running'
     and j.locked_at < now() - make_interval(secs => p_lock_timeout_seconds)
     and j.attempts < j.max_attempts;

  return query
  with candidates as (
    select j.id
      from system.jobs j
     where j.status = 'queued'
       and j.run_after <= now()
     order by j.run_after, j.id
     limit p_limit
     for update skip locked
  )
  update system.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_at = now(),
         locked_by = p_worker_id
    from candidates c
   where j.id = c.id
  returning j.id, j.type, j.store_id, j.payload, j.attempts, j.max_attempts;
end
$$;

-- -----------------------------------------------------------------------------
-- system.complete_job: marca éxito solo si el job sigue tomado por ese worker.
-- -----------------------------------------------------------------------------
create or replace function system.complete_job(p_job_id uuid, p_worker_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update system.jobs j
     set status = 'succeeded', locked_at = null, locked_by = null,
         finished_at = now(), last_error = null
   where j.id = p_job_id and j.status = 'running' and j.locked_by = p_worker_id;
  return found;
end
$$;

-- -----------------------------------------------------------------------------
-- system.fail_job: registra el fallo. Permanente o intentos agotados → dead.
-- Si no, reencola con backoff exponencial: 1, 2, 4 … 64 minutos (máximo).
-- Devuelve el nuevo estado, o NULL si el job no estaba tomado por ese worker.
-- -----------------------------------------------------------------------------
create or replace function system.fail_job(
  p_job_id    uuid,
  p_worker_id text,
  p_error     text,
  p_permanent boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update system.jobs j
     set status = case when coalesce(p_permanent, false) or j.attempts >= j.max_attempts
                       then 'dead' else 'queued' end,
         run_after = case when coalesce(p_permanent, false) or j.attempts >= j.max_attempts
                          then j.run_after
                          else now() + least(make_interval(mins => power(2, greatest(j.attempts - 1, 0))::int),
                                             interval '64 minutes') end,
         finished_at = case when coalesce(p_permanent, false) or j.attempts >= j.max_attempts
                            then now() else null end,
         locked_at = null,
         locked_by = null,
         last_error = left(coalesce(p_error, 'error desconocido'), 1000)
   where j.id = p_job_id and j.status = 'running' and j.locked_by = p_worker_id
  returning j.status into v_status;
  return v_status;
end
$$;

-- -----------------------------------------------------------------------------
-- system.purge_finished_jobs: elimina jobs terminados antiguos.
-- succeeded > p_succeeded_retention; dead > p_dead_retention (se conservan más
-- tiempo para diagnóstico). Devuelve el número de filas eliminadas.
-- -----------------------------------------------------------------------------
create or replace function system.purge_finished_jobs(
  p_succeeded_retention interval default interval '7 days',
  p_dead_retention      interval default interval '30 days'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from system.jobs j
   where (j.status = 'succeeded' and j.finished_at < now() - p_succeeded_retention)
      or (j.status = 'dead'      and j.finished_at < now() - p_dead_retention);
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- -----------------------------------------------------------------------------
-- system.health_check: estado de la base de datos y de la cola (readiness).
-- -----------------------------------------------------------------------------
create or replace function system.health_check()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'db', true,
    'oldest_ready_seconds', coalesce(
      (select floor(extract(epoch from (now() - min(j.run_after))))::int
         from system.jobs j where j.status = 'queued' and j.run_after <= now()), 0),
    'running_jobs', (select count(*) from system.jobs j where j.status = 'running'),
    'dead_jobs',    (select count(*) from system.jobs j where j.status = 'dead')
  )
$$;

revoke all on function system.claim_jobs(text, integer, integer) from public;
revoke all on function system.complete_job(uuid, text) from public;
revoke all on function system.fail_job(uuid, text, text, boolean) from public;
revoke all on function system.purge_finished_jobs(interval, interval) from public;
revoke all on function system.health_check() from public;

grant execute on function system.claim_jobs(text, integer, integer) to system_worker;
grant execute on function system.complete_job(uuid, text) to system_worker;
grant execute on function system.fail_job(uuid, text, text, boolean) to system_worker;
grant execute on function system.purge_finished_jobs(interval, interval) to system_worker;
grant execute on function system.health_check() to system_worker;
