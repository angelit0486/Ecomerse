-- =============================================================================
-- Fase 2 · Auditoría y eventos de seguridad (GATE0 §29, ADR-015)
-- Append-only, particionada por mes, esquema no expuesto. Sin secretos.
-- =============================================================================

create table audit.audit_logs (
  id               uuid not null default app.uuid_v7(),
  occurred_at      timestamptz not null default now(),
  organization_id  uuid,
  store_id         uuid,
  actor_type       text not null
                   check (actor_type in ('user', 'platform_staff', 'system', 'provider', 'api_key')),
  actor_user_id    uuid,
  actor_label      text not null check (char_length(actor_label) between 1 and 200),
  support_grant_id uuid,
  action           text not null check (action ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  entity_type      text not null check (char_length(entity_type) between 1 and 60),
  entity_id        uuid,
  before           jsonb check (before is null or jsonb_typeof(before) = 'object'),
  after            jsonb check (after is null or jsonb_typeof(after) = 'object'),
  reason           text check (reason is null or char_length(reason) <= 1000),
  request_id       text check (request_id is null or char_length(request_id) <= 64),
  ip               inet,
  user_agent       text check (user_agent is null or char_length(user_agent) <= 500),
  metadata         jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create index audit_logs_store_idx on audit.audit_logs (store_id, occurred_at desc) where store_id is not null;
create index audit_logs_org_idx on audit.audit_logs (organization_id, occurred_at desc) where organization_id is not null;
create index audit_logs_entity_idx on audit.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on audit.audit_logs (actor_user_id, occurred_at desc) where actor_user_id is not null;

alter table audit.audit_logs enable row level security;
alter table audit.audit_logs force row level security;
revoke all on table audit.audit_logs from public, anon, authenticated, service_role, storefront_gateway, system_worker;

-- Append-only: el trigger se clona a cada partición.
create trigger audit_logs_append_only before update or delete on audit.audit_logs
  for each row execute function app.forbid_mutation();

-- Crea las particiones mensuales que falten (mes actual + p_months_ahead).
create or replace function audit.ensure_partitions(p_months_ahead integer default 24)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now())::date;
  v_from  date;
  v_name  text;
  v_count integer := 0;
begin
  for i in 0 .. greatest(p_months_ahead, 0) loop
    v_from := (v_month + make_interval(months => i))::date;
    v_name := format('audit_logs_%s', to_char(v_from, 'YYYYMM'));
    if to_regclass(format('audit.%I', v_name)) is null then
      execute format(
        'create table audit.%I partition of audit.audit_logs for values from (%L) to (%L)',
        v_name, v_from, (v_from + interval '1 month')::date
      );
      execute format('alter table audit.%I enable row level security', v_name);
      execute format('alter table audit.%I force row level security', v_name);
      execute format(
        'revoke all on table audit.%I from public, anon, authenticated, service_role, storefront_gateway, system_worker',
        v_name
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end
$$;
revoke all on function audit.ensure_partitions(integer) from public;

do $$ begin perform audit.ensure_partitions(24); end $$;

-- Red de seguridad: nunca se pierde un registro aunque falte una partición.
-- Debe permanecer vacía (las particiones se crean con antelación).
create table audit.audit_logs_default partition of audit.audit_logs default;
alter table audit.audit_logs_default enable row level security;
alter table audit.audit_logs_default force row level security;
revoke all on table audit.audit_logs_default from public, anon, authenticated, service_role, storefront_gateway, system_worker;

-- Mantenimiento ejecutable por el worker (job periódico; ver runbook).
create or replace function system.maintain_audit_partitions()
returns integer
language sql
security definer
set search_path = ''
as $$ select audit.ensure_partitions(24) $$;
revoke all on function system.maintain_audit_partitions() from public;
grant execute on function system.maintain_audit_partitions() to system_worker;

-- -----------------------------------------------------------------------------
-- audit.record: punto único de escritura semántica. Lo invocan las funciones
-- SECURITY DEFINER del mismo dueño; ningún rol de aplicación puede ejecutarlo.
-- Actor: `app.actor` (operaciones de sistema) o auth.uid() (usuario).
-- -----------------------------------------------------------------------------
create or replace function audit.record(
  p_action           text,
  p_entity_type      text,
  p_entity_id        uuid,
  p_organization_id  uuid  default null,
  p_store_id         uuid  default null,
  p_before           jsonb default null,
  p_after            jsonb default null,
  p_reason           text  default null,
  p_metadata         jsonb default '{}'::jsonb,
  p_support_grant_id uuid  default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_actor jsonb := nullif(current_setting('app.actor', true), '')::jsonb;
  v_type  text;
  v_label text;
begin
  if v_actor is not null then
    v_type  := coalesce(v_actor ->> 'type', 'system');
    v_label := coalesce(v_actor ->> 'label', 'system');
  elsif v_uid is not null then
    v_type := case
      when exists (select 1 from public.platform_staff ps
                    where ps.user_id = v_uid and ps.status = 'active') then 'platform_staff'
      else 'user' end;
    v_label := coalesce((select u.email from auth.users u where u.id = v_uid), v_uid::text);
  else
    v_type  := 'system';
    v_label := 'system';
  end if;

  insert into audit.audit_logs (
    organization_id, store_id, actor_type, actor_user_id, actor_label, support_grant_id,
    action, entity_type, entity_id, before, after, reason, metadata
  ) values (
    p_organization_id, p_store_id, v_type, v_uid, left(v_label, 200), p_support_grant_id,
    p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason, coalesce(p_metadata, '{}'::jsonb)
  );
end
$$;
revoke all on function audit.record(text, text, uuid, uuid, uuid, jsonb, jsonb, text, jsonb, uuid) from public;

-- -----------------------------------------------------------------------------
-- Eventos de seguridad (login de staff, MFA, firmas inválidas, denegaciones…).
-- -----------------------------------------------------------------------------
create table audit.security_events (
  id              uuid primary key default app.uuid_v7(),
  occurred_at     timestamptz not null default now(),
  type            text not null check (type ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  severity        text not null check (severity in ('info', 'warning', 'critical')),
  user_id         uuid,
  organization_id uuid,
  store_id        uuid,
  ip              inet,
  user_agent      text check (user_agent is null or char_length(user_agent) <= 500),
  request_id      text check (request_id is null or char_length(request_id) <= 64),
  metadata        jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create index security_events_time_idx on audit.security_events (occurred_at desc);
create index security_events_user_idx on audit.security_events (user_id, occurred_at desc) where user_id is not null;

alter table audit.security_events enable row level security;
alter table audit.security_events force row level security;
revoke all on table audit.security_events from public, anon, authenticated, service_role, storefront_gateway, system_worker;

create trigger security_events_append_only before update or delete on audit.security_events
  for each row execute function app.forbid_mutation();

-- El servidor registra eventos sin sesión (p. ej. login fallido) mediante el worker.
create or replace function system.record_security_event(
  p_type       text,
  p_severity   text,
  p_user_id    uuid  default null,
  p_store_id   uuid  default null,
  p_ip         inet  default null,
  p_user_agent text  default null,
  p_request_id text  default null,
  p_metadata   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into audit.security_events (type, severity, user_id, store_id, organization_id, ip,
                                     user_agent, request_id, metadata)
  values (p_type, p_severity, p_user_id, p_store_id,
          (select s.organization_id from public.stores s where s.id = p_store_id),
          p_ip, left(p_user_agent, 500), left(p_request_id, 64), coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function system.record_security_event(text, text, uuid, uuid, inet, text, text, jsonb) from public;
grant execute on function system.record_security_event(text, text, uuid, uuid, inet, text, text, jsonb) to system_worker;
