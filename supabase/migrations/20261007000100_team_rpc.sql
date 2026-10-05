-- =============================================================================
-- Fase 2 · RPC de equipo (F2-T02)
-- Contrato: GATE0 §7.2 (invitación, revocación), §8.3 (matriz y restricciones
--           estructurales 1–5), §19.3 (límite max_staff).
--
-- Restricciones estructurales que aplican estas funciones (GATE0 §8.3):
--  1. Nadie asigna un rol con permisos que no posee (rango estrictamente menor y
--     permisos ⊆ los del actor en esa tienda).
--  2. Nadie modifica ni elimina al org_owner; la propiedad solo cambia con
--     access_transfer_ownership, hecha por el propio dueño.
--  3. store_admin no crea store_admin (consecuencia de 1: rango menor estricto).
--  4. Siempre exactamente un org_owner (índice único parcial + transferencia atómica).
--  Además: org_admin no gestiona a otro org_admin; nadie se gestiona a sí mismo.
--
-- Errores: 42501 {unauthenticated, mfa_required, forbidden};
--          P0001 {not_found, validation_failed, conflict, limit_reached} + detail.
-- Un recurso de otro tenant responde igual que uno inexistente para no revelar
-- su existencia.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rangos. 100 = org_owner/org_admin (todos los permisos de tienda, §8.3); si no,
-- el rango del rol de tienda; 0 = sin acceso.
-- -----------------------------------------------------------------------------

-- Rango efectivo del usuario actual en una tienda (exige AAL2 y membresías activas).
create or replace function app.actor_store_rank(p_store_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select 100 from public.stores s
      where s.id = p_store_id
        and app.current_org_role(s.organization_id) in ('org_owner', 'org_admin')),
    (select r.rank
       from public.store_members sm
       join public.stores s on s.id = sm.store_id
       join public.organization_members m
         on m.organization_id = s.organization_id and m.user_id = sm.user_id and m.status = 'active'
       join public.roles r on r.id = sm.role_id
      where sm.store_id = p_store_id and sm.user_id = auth.uid() and sm.status = 'active'
        and app.has_aal2()),
    0
  )
$$;
revoke all on function app.actor_store_rank(uuid) from public;

-- Rango de un miembro cualquiera en una tienda, sin importar su estado (para
-- protegerlo también cuando está suspendido). NULL = no es miembro de la tienda.
create or replace function app.member_store_rank(p_store_id uuid, p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select 100 from public.stores s
       join public.organization_members m on m.organization_id = s.organization_id
      where s.id = p_store_id and m.user_id = p_user_id and m.role in ('org_owner', 'org_admin')),
    (select r.rank from public.store_members sm
       join public.roles r on r.id = sm.role_id
      where sm.store_id = p_store_id and sm.user_id = p_user_id)
  )
$$;
revoke all on function app.member_store_rank(uuid, uuid) from public;

-- Rol de tienda por clave, disponible para la organización de la tienda (los
-- roles propios de la organización, P2, tienen prioridad sobre los de sistema).
create or replace function app.resolve_store_role(p_store_id uuid, p_role_key text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
    from public.roles r
    join public.stores s on s.id = p_store_id
   where r.key = p_role_key and r.scope = 'store'
     and (r.organization_id is null or r.organization_id = s.organization_id)
   order by r.organization_id nulls last
   limit 1
$$;
revoke all on function app.resolve_store_role(uuid, text) from public;

-- ¿Puede el usuario actual asignar este rol en esta tienda? (restricciones 1 y 3)
create or replace function app.store_role_assignable(p_store_id uuid, p_role_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org        uuid;
  v_role_rank  integer;
  v_actor_rank integer;
begin
  select s.organization_id into v_org from public.stores s where s.id = p_store_id;
  select r.rank into v_role_rank
    from public.roles r
   where r.id = p_role_id and r.scope = 'store'
     and (r.organization_id is null or r.organization_id = v_org);
  if v_org is null or v_role_rank is null then
    return false;
  end if;
  if not app.has_store_permission(p_store_id, 'staff.manage') then
    return false;
  end if;
  v_actor_rank := app.actor_store_rank(p_store_id);
  if v_actor_rank = 100 then
    return true;
  end if;
  if v_role_rank >= v_actor_rank then
    return false;
  end if;
  return not exists (
    select 1 from public.role_permissions rp
     where rp.role_id = p_role_id
       and not app.has_store_permission(p_store_id, rp.permission_key)
  );
end
$$;
revoke all on function app.store_role_assignable(uuid, uuid) from public;

-- Autoriza gestionar a un miembro de tienda. Devuelve el id del actor.
create or replace function app.assert_can_manage_store_member(p_store_id uuid, p_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := app.require_aal2_user();
  v_target_rank integer;
begin
  if not app.has_store_permission(p_store_id, 'staff.manage') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_user_id = v_uid then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'self';
  end if;
  v_target_rank := app.member_store_rank(p_store_id, p_user_id);
  if v_target_rank is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'member';
  end if;
  -- org_owner/org_admin (100) se gestionan solo a nivel de organización.
  if v_target_rank >= app.actor_store_rank(p_store_id) or v_target_rank = 100 then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'rank';
  end if;
  return v_uid;
end
$$;
revoke all on function app.assert_can_manage_store_member(uuid, uuid) from public;

-- Autoriza gestionar a un miembro de la organización. Devuelve su rol actual.
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
  if v_role = 'org_admin' and app.current_org_role(p_org) <> 'org_owner' then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'rank';
  end if;
  return v_role;
end
$$;
revoke all on function app.assert_can_manage_org_member(uuid, uuid) from public;

-- La tienda pertenece a la organización; si no, forbidden (no revela que exista).
create or replace function app.assert_store_in_org(p_org uuid, p_store_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.organization_id = p_org) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
end
$$;
revoke all on function app.assert_store_in_org(uuid, uuid) from public;

-- =============================================================================
-- Invitar (GATE0 §7.2). Exactamente uno: p_org_role, o p_store_id + p_store_role_key.
-- org_owner nunca se invita desde el tenant (alta asistida o transferencia).
-- =============================================================================
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
    if p_org_role = 'org_admin' and app.current_org_role(p_organization_id) <> 'org_owner' then
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

-- =============================================================================
-- Revocar una invitación pendiente. Solo quien podría haberla emitido.
-- =============================================================================
create or replace function public.access_revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_aal2_user();
  v_inv public.organization_invitations;
  v_ok  boolean;
begin
  select * into v_inv from public.organization_invitations i where i.id = p_invitation_id for update;

  if v_inv.id is null then
    v_ok := false;
  elsif v_inv.org_role is not null then
    v_ok := app.has_org_permission(v_inv.organization_id, 'org.members.manage')
            and v_inv.org_role <> 'org_owner'
            and (v_inv.org_role <> 'org_admin' or app.current_org_role(v_inv.organization_id) = 'org_owner');
  else
    v_ok := app.store_role_assignable(v_inv.store_id, v_inv.store_role_id);
  end if;
  if not v_ok then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'invitation';
  end if;

  if v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'invitation_closed';
  end if;

  update public.organization_invitations
     set revoked_at = now(), token_hash = null
   where id = v_inv.id;

  perform audit.record('member.invitation_revoked', 'invitation', v_inv.id, v_inv.organization_id,
                       v_inv.store_id, null, null);
end
$$;

-- =============================================================================
-- Cambiar el rol de tienda de un miembro.
-- =============================================================================
create or replace function public.access_change_member_role(p_store_id uuid, p_user_id uuid, p_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_id  uuid;
  v_old_role uuid;
  v_org      uuid;
begin
  perform app.assert_can_manage_store_member(p_store_id, p_user_id);
  v_role_id := app.resolve_store_role(p_store_id, p_role_key);
  if v_role_id is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'role';
  end if;
  if not app.store_role_assignable(p_store_id, v_role_id) then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'rank';
  end if;

  select sm.role_id into v_old_role from public.store_members sm
   where sm.store_id = p_store_id and sm.user_id = p_user_id
   for update;
  if v_old_role = v_role_id then
    return;
  end if;

  update public.store_members set role_id = v_role_id
   where store_id = p_store_id and user_id = p_user_id;

  select s.organization_id into v_org from public.stores s where s.id = p_store_id;
  perform audit.record('member.role_changed', 'store_member', p_user_id, v_org, p_store_id,
                       jsonb_build_object('role', (select r.key from public.roles r where r.id = v_old_role)),
                       jsonb_build_object('role', p_role_key));
end
$$;

-- =============================================================================
-- Cambiar el rol de organización (org_admin ↔ org_member). Solo el dueño puede
-- crear o degradar administradores; org_owner solo por transferencia.
-- =============================================================================
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
  if p_role = 'org_admin' and app.current_org_role(p_organization_id) <> 'org_owner' then
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

-- =============================================================================
-- Suspender / reactivar. Sin p_store_id: en la organización (retira el acceso a
-- todas sus tiendas). Con p_store_id: solo en esa tienda. Reactivar en la
-- organización vuelve a contar para max_staff (trigger).
-- =============================================================================
create or replace function app.set_member_status(p_org uuid, p_user_id uuid, p_store_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if p_store_id is null then
    perform app.assert_can_manage_org_member(p_org, p_user_id);
    select m.status into v_old from public.organization_members m
     where m.organization_id = p_org and m.user_id = p_user_id for update;
    if v_old = p_status then
      return;
    end if;
    update public.organization_members set status = p_status
     where organization_id = p_org and user_id = p_user_id;
  else
    perform app.assert_store_in_org(p_org, p_store_id);
    perform app.assert_can_manage_store_member(p_store_id, p_user_id);
    select sm.status into v_old from public.store_members sm
     where sm.store_id = p_store_id and sm.user_id = p_user_id for update;
    if v_old = p_status then
      return;
    end if;
    update public.store_members set status = p_status
     where store_id = p_store_id and user_id = p_user_id;
  end if;

  perform audit.record(case p_status when 'suspended' then 'member.suspended' else 'member.reactivated' end,
                       case when p_store_id is null then 'organization_member' else 'store_member' end,
                       p_user_id, p_org, p_store_id,
                       jsonb_build_object('status', v_old), jsonb_build_object('status', p_status));
end
$$;
revoke all on function app.set_member_status(uuid, uuid, uuid, text) from public;

create or replace function public.access_suspend_member(p_organization_id uuid, p_user_id uuid,
                                                        p_store_id uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$ select app.set_member_status(p_organization_id, p_user_id, p_store_id, 'suspended') $$;

create or replace function public.access_reactivate_member(p_organization_id uuid, p_user_id uuid,
                                                           p_store_id uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$ select app.set_member_status(p_organization_id, p_user_id, p_store_id, 'active') $$;

-- =============================================================================
-- Quitar a un miembro (definitivo). Sin p_store_id: de la organización y de todas
-- sus tiendas. Con p_store_id: solo de esa tienda.
-- =============================================================================
create or replace function public.access_remove_member(p_organization_id uuid, p_user_id uuid,
                                                       p_store_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if p_store_id is null then
    v_role := app.assert_can_manage_org_member(p_organization_id, p_user_id);
    delete from public.store_members sm
     using public.stores s
     where s.id = sm.store_id and s.organization_id = p_organization_id and sm.user_id = p_user_id;
    delete from public.organization_members
     where organization_id = p_organization_id and user_id = p_user_id;
  else
    perform app.assert_store_in_org(p_organization_id, p_store_id);
    perform app.assert_can_manage_store_member(p_store_id, p_user_id);
    select r.key into v_role from public.store_members sm join public.roles r on r.id = sm.role_id
     where sm.store_id = p_store_id and sm.user_id = p_user_id;
    delete from public.store_members where store_id = p_store_id and user_id = p_user_id;
  end if;

  perform audit.record('member.removed',
                       case when p_store_id is null then 'organization_member' else 'store_member' end,
                       p_user_id, p_organization_id, p_store_id, jsonb_build_object('role', v_role), null);
end
$$;

-- =============================================================================
-- Transferir la propiedad (restricciones 2 y 4). Atómica: el dueño actual pasa a
-- org_admin y el destinatario, que debe ser miembro activo, a org_owner.
-- =============================================================================
create or replace function public.access_transfer_ownership(p_organization_id uuid, p_new_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_aal2_user();
  v_status text;
begin
  if not app.has_org_permission(p_organization_id, 'org.transfer_ownership') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_new_owner_id is null or p_new_owner_id = v_uid then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'new_owner';
  end if;

  -- Bloquea todas las membresías de la organización: serializa transferencias.
  perform 1 from public.organization_members m where m.organization_id = p_organization_id for update;

  select m.status into v_status from public.organization_members m
   where m.organization_id = p_organization_id and m.user_id = p_new_owner_id;
  if v_status is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'member';
  end if;
  if v_status <> 'active' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'member_suspended';
  end if;

  update public.organization_members set role = 'org_admin'
   where organization_id = p_organization_id and user_id = v_uid and role = 'org_owner';
  update public.organization_members set role = 'org_owner'
   where organization_id = p_organization_id and user_id = p_new_owner_id;

  perform audit.record('organization.ownership_transferred', 'organization', p_organization_id,
                       p_organization_id, null, jsonb_build_object('owner', v_uid),
                       jsonb_build_object('owner', p_new_owner_id));
end
$$;

-- =============================================================================
-- Equipo de una tienda con nombre y email (profiles y auth.users no son legibles
-- entre miembros por RLS). Incluye a org_owner/org_admin, que acceden a todas las
-- tiendas. El estado efectivo considera la suspensión en la organización.
-- =============================================================================
create or replace function public.access_list_store_members(p_store_id uuid)
returns table (
  user_id    uuid,
  email      text,
  full_name  text,
  access     text,
  role_key   text,
  role_name  text,
  role_rank  integer,
  status     text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_store_permission(p_store_id, 'staff.read') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  return query
  select m.user_id, u.email::text, p.full_name, 'organization'::text, m.role,
         null::text, 100, m.status, m.created_at
    from public.stores s
    join public.organization_members m on m.organization_id = s.organization_id
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
   where s.id = p_store_id and m.role in ('org_owner', 'org_admin')
  union all
  select sm.user_id, u.email::text, p.full_name, 'store'::text, r.key, r.name, r.rank,
         case when m.status = 'active' then sm.status else m.status end, sm.created_at
    from public.store_members sm
    join public.stores s on s.id = sm.store_id
    join public.organization_members m on m.organization_id = s.organization_id and m.user_id = sm.user_id
    join public.roles r on r.id = sm.role_id
    join auth.users u on u.id = sm.user_id
    left join public.profiles p on p.id = sm.user_id
   where sm.store_id = p_store_id and m.role not in ('org_owner', 'org_admin')
   order by 7 desc, 9;
end
$$;

-- -----------------------------------------------------------------------------
-- Grants: solo authenticated (la autorización real ocurre dentro de cada función).
-- -----------------------------------------------------------------------------
revoke all on function public.access_invite_member(uuid, text, text, uuid, text) from public;
revoke all on function public.access_revoke_invitation(uuid) from public;
revoke all on function public.access_change_member_role(uuid, uuid, text) from public;
revoke all on function public.access_change_org_role(uuid, uuid, text) from public;
revoke all on function public.access_suspend_member(uuid, uuid, uuid) from public;
revoke all on function public.access_reactivate_member(uuid, uuid, uuid) from public;
revoke all on function public.access_remove_member(uuid, uuid, uuid) from public;
revoke all on function public.access_transfer_ownership(uuid, uuid) from public;
revoke all on function public.access_list_store_members(uuid) from public;

grant execute on function public.access_invite_member(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.access_revoke_invitation(uuid) to authenticated;
grant execute on function public.access_change_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.access_change_org_role(uuid, uuid, text) to authenticated;
grant execute on function public.access_suspend_member(uuid, uuid, uuid) to authenticated;
grant execute on function public.access_reactivate_member(uuid, uuid, uuid) to authenticated;
grant execute on function public.access_remove_member(uuid, uuid, uuid) to authenticated;
grant execute on function public.access_transfer_ownership(uuid, uuid) to authenticated;
grant execute on function public.access_list_store_members(uuid) to authenticated;
