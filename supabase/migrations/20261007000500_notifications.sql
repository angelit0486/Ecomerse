-- =============================================================================
-- Fase 2 · Entregas de notificaciones (F2-T08)
-- Contrato: GATE0 §27.1–§27.3 (dedupe_key único, sin reenvíos al reprocesar,
-- el envío nunca bloquea la transacción de negocio), §38 F2 (estructura de
-- notification_deliveries; canal mínimo de plataforma).
--
-- Solo el worker (system_worker) lee y escribe, mediante funciones system.*.
-- Sin store_id: las notificaciones de plataforma de la F2 (invitación, aviso de
-- soporte) pertenecen a la organización; las de tienda llegan en la F7.
-- =============================================================================

create table public.notification_deliveries (
  id                  uuid primary key default app.uuid_v7(),
  dedupe_key          text not null unique check (char_length(dedupe_key) between 3 and 200),
  channel             text not null check (channel in ('email')),
  template            text not null check (template ~ '^[a-z][a-z_]{1,60}$'),
  -- sha256 del destinatario normalizado: permite deduplicar sin guardar el email.
  recipient_hash      bytea not null check (octet_length(recipient_hash) = 32),
  organization_id     uuid references public.organizations (id) on delete cascade,
  status              text not null check (status in ('sent', 'suppressed')),
  provider            text not null check (provider in ('resend', 'mailpit', 'fake')),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  created_at          timestamptz not null default now()
);

create index notification_deliveries_org_idx on public.notification_deliveries (organization_id, created_at desc);

create trigger notification_deliveries_append_only before update or delete on public.notification_deliveries
  for each row execute function app.forbid_mutation();

alter table public.notification_deliveries enable row level security;
alter table public.notification_deliveries force row level security;
revoke all on table public.notification_deliveries from public, anon, authenticated, service_role;

-- ¿Ya se entregó? (el handler lo consulta antes de enviar).
create or replace function system.notification_delivered(p_dedupe_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.notification_deliveries d where d.dedupe_key = p_dedupe_key) $$;

-- Registra una entrega. Idempotente: una segunda llamada con la misma clave no hace nada.
create or replace function system.record_notification_delivery(
  p_dedupe_key          text,
  p_template            text,
  p_recipient           text,
  p_organization_id     uuid,
  p_status              text,
  p_provider            text,
  p_provider_message_id text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notification_deliveries
    (dedupe_key, channel, template, recipient_hash, organization_id, status, provider, provider_message_id)
  values (p_dedupe_key, 'email', p_template, sha256(convert_to(lower(btrim(p_recipient)), 'UTF8')),
          p_organization_id, p_status, p_provider, p_provider_message_id)
  on conflict (dedupe_key) do nothing
$$;

-- Datos del aviso de soporte para el dueño (GATE0 §7.7). Solo concesiones vigentes:
-- si ya se revocó o caducó, no hay nada que avisar.
create or replace function system.get_support_access_notice(p_grant_id uuid)
returns table (
  organization_id uuid,
  owner_email     text,
  owner_name      text,
  store_name      text,
  reason          text,
  minutes         integer,
  expires_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.organization_id, u.email::text, p.full_name, s.name, g.reason,
         (extract(epoch from (g.expires_at - g.starts_at)) / 60)::integer, g.expires_at
    from public.support_access_grants g
    join public.stores s on s.id = g.store_id
    join public.organization_members m
      on m.organization_id = g.organization_id and m.role = 'org_owner'
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
   where g.id = p_grant_id and g.revoked_at is null and g.expires_at > now()
$$;

revoke all on function system.notification_delivered(text) from public;
revoke all on function system.record_notification_delivery(text, text, text, uuid, text, text, text) from public;
revoke all on function system.get_support_access_notice(uuid) from public;
grant execute on function system.notification_delivered(text) to system_worker;
grant execute on function system.record_notification_delivery(text, text, text, uuid, text, text, text) to system_worker;
grant execute on function system.get_support_access_notice(uuid) to system_worker;
