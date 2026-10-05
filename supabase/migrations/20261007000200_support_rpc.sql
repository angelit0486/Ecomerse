-- =============================================================================
-- Fase 2 · Acceso temporal de soporte de plataforma (F2-T03)
-- Contrato: GATE0 §7.6, §7.7. Requisitos de la Fase 2: solo lectura, máximo 60
-- minutos, motivo obligatorio y aviso al dueño.
--
-- El alcance de lectura lo aplica app.has_store_permission (permisos `read` con
-- support_readable = true, concesión vigente, staff activo y AAL2). Aquí solo se
-- conceden, revocan y auditan las concesiones.
--
-- Auditoría: support_session.started (concesión), support_session.ended
-- (revocación) y support_session.page_viewed (cada página que abre el soporte).
-- La caducidad no necesita evento: expires_at ya la registra.
-- =============================================================================

create or replace function public.platform_grant_support_access(
  p_store_id        uuid,
  p_grantee_user_id uuid,
  p_reason          text,
  p_minutes         integer default 60,
  p_ticket_ref      text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := app.require_platform_role(array['platform_owner', 'platform_admin']);
  v_org    uuid;
  v_reason text := btrim(p_reason);
  v_grant  uuid;
begin
  if p_grantee_user_id = v_actor then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'self_grant';
  end if;
  if not exists (
    select 1 from public.platform_staff ps
     where ps.user_id = p_grantee_user_id and ps.status = 'active'
       and ps.role in ('platform_support', 'platform_admin')
  ) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'grantee';
  end if;
  if p_minutes is null or p_minutes not between 1 and 60 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'minutes';
  end if;
  if v_reason is null or char_length(v_reason) not between 20 and 1000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reason';
  end if;
  if p_ticket_ref is not null and char_length(p_ticket_ref) > 100 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'ticket_ref';
  end if;

  select s.organization_id into v_org from public.stores s
   where s.id = p_store_id and s.status <> 'closed';
  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
  end if;

  -- Sin concesiones superpuestas: extender = revocar y conceder otra (§7.7).
  perform pg_advisory_xact_lock(hashtextextended(p_grantee_user_id::text || ':' || p_store_id::text, 0));
  if exists (
    select 1 from public.support_access_grants g
     where g.grantee_user_id = p_grantee_user_id and g.store_id = p_store_id
       and g.revoked_at is null and g.expires_at > now()
  ) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'grant_active';
  end if;

  insert into public.support_access_grants
    (organization_id, store_id, grantee_user_id, granted_by, reason, ticket_ref, starts_at, expires_at)
  values (v_org, p_store_id, p_grantee_user_id, v_actor, v_reason, nullif(btrim(p_ticket_ref), ''),
          now(), now() + make_interval(mins => p_minutes))
  returning id into v_grant;

  -- Aviso al dueño por email, en la misma transacción (outbox).
  perform app.enqueue_job('access.support_access_notice', jsonb_build_object('grant_id', v_grant),
                          p_store_id, 'support_notice:' || v_grant::text);
  perform audit.record('support_session.started', 'support_access_grant', v_grant, v_org, p_store_id,
                       null, jsonb_build_object('grantee', p_grantee_user_id, 'minutes', p_minutes),
                       v_reason, jsonb_build_object('ticket_ref', p_ticket_ref), v_grant);
  return v_grant;
end
$$;

-- -----------------------------------------------------------------------------
-- Revocación común. p_by: 'platform' | 'owner'. Quien no está autorizado recibe
-- not_found (no revela la existencia de concesiones ajenas).
-- -----------------------------------------------------------------------------
create or replace function app.revoke_support_grant(p_grant_id uuid, p_by text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := app.require_aal2_user();
  v_grant public.support_access_grants;
  v_ok    boolean;
begin
  select * into v_grant from public.support_access_grants g where g.id = p_grant_id for update;

  -- coalesce: una comparación con NULL (sin rol) no debe autorizar por omisión.
  v_ok := coalesce(v_grant.id is not null and case p_by
    when 'platform' then
      app.is_platform_staff(array['platform_owner', 'platform_admin'])
      or (v_grant.grantee_user_id = v_uid
          and app.is_platform_staff(array['platform_support', 'platform_admin', 'platform_owner']))
    when 'owner' then
      app.current_org_role(v_grant.organization_id) = 'org_owner'
    else false
  end, false);
  if not v_ok then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'grant';
  end if;

  if v_grant.revoked_at is not null or v_grant.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'grant_closed';
  end if;

  update public.support_access_grants set revoked_at = now(), revoked_by = v_uid where id = v_grant.id;

  perform audit.record('support_session.ended', 'support_access_grant', v_grant.id, v_grant.organization_id,
                       v_grant.store_id, null, jsonb_build_object('revoked_by', p_by), null, '{}'::jsonb,
                       v_grant.id);
end
$$;
revoke all on function app.revoke_support_grant(uuid, text) from public;

-- Plataforma: platform_owner/platform_admin, o el propio soporte para terminar antes.
create or replace function public.platform_revoke_support_access(p_grant_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$ select app.revoke_support_grant(p_grant_id, 'platform') $$;

-- Tenant: solo el dueño de la organización (GATE0 §7.7).
create or replace function public.access_revoke_support_access(p_grant_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$ select app.revoke_support_grant(p_grant_id, 'owner') $$;

-- -----------------------------------------------------------------------------
-- Registro de páginas vistas por el soporte (GATE0 §7.7, "rutas visitadas").
-- Solo el titular de una concesión vigente. Se guarda la ruta sin query string.
-- -----------------------------------------------------------------------------
create or replace function public.support_log_page_view(p_grant_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := app.require_aal2_user();
  v_grant public.support_access_grants;
  v_path  text := split_part(split_part(p_path, '?', 1), '#', 1);
begin
  select * into v_grant from public.support_access_grants g
   where g.id = p_grant_id and g.grantee_user_id = v_uid
     and g.revoked_at is null and now() >= g.starts_at and now() < g.expires_at;
  if v_grant.id is null
     or not app.is_platform_staff(array['platform_support', 'platform_admin', 'platform_owner']) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if v_path is null or char_length(v_path) not between 1 and 300 or v_path !~ '^/[A-Za-z0-9/_.~%-]*$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'path';
  end if;

  perform audit.record('support_session.page_viewed', 'store', v_grant.store_id, v_grant.organization_id,
                       v_grant.store_id, null, null, null, jsonb_build_object('path', v_path), v_grant.id);
end
$$;

revoke all on function public.platform_grant_support_access(uuid, uuid, text, integer, text) from public;
revoke all on function public.platform_revoke_support_access(uuid) from public;
revoke all on function public.access_revoke_support_access(uuid) from public;
revoke all on function public.support_log_page_view(uuid, text) from public;

grant execute on function public.platform_grant_support_access(uuid, uuid, text, integer, text) to authenticated;
grant execute on function public.platform_revoke_support_access(uuid) to authenticated;
grant execute on function public.access_revoke_support_access(uuid) to authenticated;
grant execute on function public.support_log_page_view(uuid, text) to authenticated;
