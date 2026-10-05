-- =============================================================================
-- Gate F2 · Endurecimiento y pendientes de la Fase 2
--  1. D-F2-18: comparaciones de autorización seguras ante NULL (`is distinct from`)
--     en las RPC de equipo. Hoy ya eran seguras porque antes se exige
--     has_org_permission; esto lo hace robusto ante cambios futuros.
--  2. CF-10 / GATE0 §38 F2: system.user_has_store_permission, variante con
--     usuario explícito para el worker (importaciones y jobs en nombre de un
--     usuario). Sin AAL2 (no hay sesión) ni concesiones de soporte.
--  3. D-F1-10: audit.log_change, auditoría genérica por trigger de las tablas de
--     configuración de plataforma que pueden cambiar fuera de una RPC.
-- =============================================================================

-- 1. ---------------------------------------------------------------------------
create or replace function app.assert_can_manage_org_member(p_org uuid, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_aal2_user();
  v_role text;
begin
  if not app.has_org_permission(p_org, 'org.members.manage') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_user_id = v_uid then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'self';
  end if;
  select m.role into v_role from public.organization_members m
   where m.organization_id = p_org and m.user_id = p_user_id;
  if v_role is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'member';
  end if;
  if v_role = 'org_owner' then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'owner';
  end if;
  if v_role = 'org_admin' and app.current_org_role(p_org) is distinct from 'org_owner' then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'rank';
  end if;
  return v_role;
end
$$;
revoke all on function app.assert_can_manage_org_member(uuid, uuid) from public;

create or replace function public.access_invite_member(
  p_organization_id uuid,
  p_email           text,
  p_org_role        text default null,
  p_store_id        uuid default null,
  p_store_role_key  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := app.require_aal2_user();
  v_email    text := app.normalize_email(p_email);
  v_role_id  uuid;
  v_user     uuid;
  v_inv      uuid;
  v_pending  integer;
begin
  if (p_org_role is null) = (p_store_id is null) or (p_store_id is null) <> (p_store_role_key is null) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'role';
  end if;
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'email';
  end if;

  if p_org_role is not null then
    if not app.has_org_permission(p_organization_id, 'org.members.manage') then
      raise exception using errcode = '42501', message = 'forbidden';
    end if;
    if p_org_role = 'org_owner' then
      raise exception using errcode = '42501', message = 'forbidden', detail = 'ownership_transfer_only';
    end if;
    if p_org_role not in ('org_admin', 'org_member') then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'role';
    end if;
    if p_org_role = 'org_admin' and app.current_org_role(p_organization_id) is distinct from 'org_owner' then
      raise exception using errcode = '42501', message = 'forbidden', detail = 'rank';
    end if;
  else
    perform app.assert_store_in_org(p_organization_id, p_store_id);
    if not app.has_store_permission(p_store_id, 'staff.manage') then
      raise exception using errcode = '42501', message = 'forbidden';
    end if;
    v_role_id := app.resolve_store_role(p_store_id, p_store_role_key);
    if v_role_id is null then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'role';
    end if;
    if not app.store_role_assignable(p_store_id, v_role_id) then
      raise exception using errcode = '42501', message = 'forbidden', detail = 'rank';
    end if;
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_user is not null and (
       (p_org_role is not null and exists (
          select 1 from public.organization_members m
           where m.organization_id = p_organization_id and m.user_id = v_user))
    or (p_store_id is not null and exists (
          select 1 from public.store_members sm
           where sm.store_id = p_store_id and sm.user_id = v_user))
  ) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'already_member';
  end if;

  -- Aviso temprano del límite; el definitivo lo aplica el trigger al aceptar.
  if v_user is null or not exists (
    select 1 from public.organization_members m
     where m.organization_id = p_organization_id and m.user_id = v_user and m.status = 'active'
  ) then
    perform app.assert_within_limit(p_organization_id, 'max_staff');
  end if;

  -- Anti-abuso: máximo 20 invitaciones pendientes por organización (§7.2).
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':invitations', 0));
  select count(*) into v_pending from public.organization_invitations i
   where i.organization_id = p_organization_id and i.accepted_at is null
     and i.revoked_at is null and i.expires_at > now();
  if v_pending >= 20 then
    raise exception using errcode = 'P0001', message = 'limit_reached',
      detail = json_build_object('key', 'pending_invitations', 'limit', 20, 'used', v_pending)::text;
  end if;

  -- Una invitación caducada no debe bloquear la nueva (índice único de pendientes).
  update public.organization_invitations i
     set revoked_at = now(), token_hash = null
   where i.organization_id = p_organization_id and i.email = v_email
     and i.accepted_at is null and i.revoked_at is null and i.expires_at <= now();

  begin
    insert into public.organization_invitations
      (organization_id, store_id, email, org_role, store_role_id, expires_at, invited_by)
    values (p_organization_id, p_store_id, v_email, p_org_role, v_role_id, now() + interval '7 days', v_uid)
    returning id into v_inv;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'invitation_pending';
  end;

  perform app.enqueue_job('access.invitation_email', jsonb_build_object('invitation_id', v_inv),
                          p_store_id, 'invitation:' || v_inv::text);
  perform audit.record('member.invited', 'invitation', v_inv, p_organization_id, p_store_id, null,
                       jsonb_build_object('org_role', p_org_role, 'store_role', p_store_role_key));
  return v_inv;
end
$$;

create or replace function public.access_change_org_role(p_organization_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text := app.assert_can_manage_org_member(p_organization_id, p_user_id);
begin
  if p_role = 'org_owner' then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'ownership_transfer_only';
  end if;
  if p_role is null or p_role not in ('org_admin', 'org_member') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'role';
  end if;
  if p_role = 'org_admin' and app.current_org_role(p_organization_id) is distinct from 'org_owner' then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'rank';
  end if;
  if v_old = p_role then
    return;
  end if;

  update public.organization_members set role = p_role
   where organization_id = p_organization_id and user_id = p_user_id;

  perform audit.record('member.role_changed', 'organization_member', p_user_id, p_organization_id, null,
                       jsonb_build_object('role', v_old), jsonb_build_object('role', p_role));
end
$$;

-- 2. ---------------------------------------------------------------------------
create or replace function system.user_has_store_permission(p_user_id uuid, p_store_id uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind         text;
  v_org          uuid;
  v_store_status text;
  v_mode         text;
begin
  if p_user_id is null or p_store_id is null or p_permission is null then
    return false;
  end if;
  select p.kind into v_kind from public.permissions p where p.key = p_permission and p.module <> 'org';
  if v_kind is null then
    return false;
  end if;
  select s.organization_id, s.status into v_org, v_store_status from public.stores s where s.id = p_store_id;
  if v_org is null or v_store_status in ('suspended', 'closed') then
    return false;
  end if;
  v_mode := app.org_access_mode(v_org);
  if v_mode = 'suspended' or (v_mode = 'read_only' and v_kind = 'write') then
    return false;
  end if;
  return exists (
    select 1 from public.organization_members m
     where m.organization_id = v_org and m.user_id = p_user_id and m.status = 'active'
       and m.role in ('org_owner', 'org_admin')
  ) or exists (
    select 1
      from public.store_members sm
      join public.role_permissions rp on rp.role_id = sm.role_id
      join public.organization_members m
        on m.organization_id = v_org and m.user_id = sm.user_id and m.status = 'active'
     where sm.store_id = p_store_id and sm.user_id = p_user_id and sm.status = 'active'
       and rp.permission_key = p_permission
  );
end
$$;

revoke all on function system.user_has_store_permission(uuid, uuid, text) from public;
grant execute on function system.user_has_store_permission(uuid, uuid, text) to system_worker;

-- 3. ---------------------------------------------------------------------------
create or replace function audit.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_org uuid := nullif(v_row ->> 'organization_id', '')::uuid;
begin
  perform audit.record('config.' || lower(tg_op), tg_table_name,
                       case when (v_row ->> 'id') ~ '^[0-9a-f-]{36}$' then (v_row ->> 'id')::uuid end,
                       v_org, null, v_old, v_new, null,
                       jsonb_build_object('table', tg_table_schema || '.' || tg_table_name));
  return null;
end
$$;
revoke all on function audit.log_change() from public;

create trigger plans_log_change after insert or update or delete on public.plans
  for each row execute function audit.log_change();
create trigger plan_entitlements_log_change after insert or update or delete on public.plan_entitlements
  for each row execute function audit.log_change();
create trigger platform_settings_log_change after insert or update or delete on public.platform_settings
  for each row execute function audit.log_change();
create trigger platform_staff_log_change after insert or update or delete on public.platform_staff
  for each row execute function audit.log_change();
create trigger subscriptions_log_change after insert or update or delete on public.subscriptions
  for each row execute function audit.log_change();
create trigger entitlement_overrides_log_change after insert or update or delete
  on public.organization_entitlement_overrides
  for each row execute function audit.log_change();

-- 4. ---------------------------------------------------------------------------
-- Revisión de seguridad del gate: el reset de MFA borra TODOS los factores del
-- usuario (Auth Admin). Una organización solo puede pedirlo si el usuario no
-- tiene otro acceso sensible: ni staff de plataforma activo ni miembro de otra
-- organización (eso iría por soporte de plataforma con verificación).
create or replace function public.access_authorize_mfa_reset(p_organization_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_can_manage_org_member(p_organization_id, p_user_id);
  if exists (select 1 from public.platform_staff ps where ps.user_id = p_user_id and ps.status = 'active')
     or exists (select 1 from public.organization_members m
                 where m.user_id = p_user_id and m.organization_id <> p_organization_id) then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'other_access';
  end if;
  perform audit.record('member.mfa_reset', 'organization_member', p_user_id, p_organization_id,
                       null, null, null, 'Reset de verificación en dos pasos solicitado por la organización');
end
$$;
