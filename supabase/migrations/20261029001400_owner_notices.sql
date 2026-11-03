-- =============================================================================
-- Avisos al dueño por correo (D-F2-16, D-F2-20): suspensión, reactivación y
-- cierre por la plataforma, y transferencia de propiedad. Se encolan en la misma
-- transacción que el cambio (outbox): si el correo falla se reintenta, y si el
-- cambio se revierte no sale aviso.
--
-- El motivo que escribe el personal de la plataforma es una nota interna (queda
-- en la auditoría) y no viaja en el correo; el aviso invita a escribir a soporte.
-- Las funciones se redefinen completas: solo cambia el `enqueue_job` final.
-- =============================================================================

create or replace function public.platform_set_tenant_status(
  p_organization_id uuid,
  p_status          text,
  p_reason          text,
  p_store_id        uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old    text;
  v_new    text := p_status;
  v_reason text := btrim(p_reason);
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  if v_reason is null or char_length(v_reason) not between 10 and 1000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reason';
  end if;

  if p_store_id is null then
    if p_status is null or p_status not in ('active', 'suspended', 'closed') then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
    end if;
    select o.status into v_old from public.organizations o where o.id = p_organization_id for update;
    if v_old is null then
      raise exception using errcode = 'P0001', message = 'not_found', detail = 'organization';
    end if;
    if v_old = 'closed' then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'organization_closed';
    end if;
    if v_old = v_new then
      return;
    end if;
    update public.organizations
       set status = v_new, closed_at = case when v_new = 'closed' then now() end
     where id = p_organization_id;
    if v_new = 'closed' then
      update public.stores set status = 'closed', closed_at = now()
       where organization_id = p_organization_id and status <> 'closed';
    end if;
  else
    if p_status is null or p_status not in ('active', 'suspended') then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
    end if;
    select s.status into v_old from public.stores s
     where s.id = p_store_id and s.organization_id = p_organization_id for update;
    if v_old is null then
      raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
    end if;
    if v_old = 'closed' then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'store_closed';
    end if;
    if p_status = 'active' then
      if v_old <> 'suspended' then
        return;
      end if;
      select case when s.launched_at is not null then 'paused' else 'draft' end into v_new
        from public.stores s where s.id = p_store_id;
    elsif v_old = 'suspended' then
      return;
    end if;
    update public.stores set status = v_new where id = p_store_id;
  end if;

  perform audit.record(case v_new when 'suspended' then 'tenant.suspended'
                                  when 'closed' then 'tenant.closed'
                                  else 'tenant.reactivated' end,
                       case when p_store_id is null then 'organization' else 'store' end,
                       coalesce(p_store_id, p_organization_id), p_organization_id, p_store_id,
                       jsonb_build_object('status', v_old), jsonb_build_object('status', v_new), v_reason);
  -- Aviso al dueño (D-F2-20). El motivo es una nota interna de la plataforma: no viaja.
  perform app.enqueue_job('tenant.owner_notice',
    jsonb_build_object('notice_id', app.uuid_v7(), 'organization_id', p_organization_id, 'store_id', p_store_id,
                       'kind', case v_new when 'suspended' then 'suspended' when 'closed' then 'closed'
                                          else 'reactivated' end,
                       'store_status', case when p_store_id is not null then v_new end),
    p_store_id, null, now(), 5);
end
$$;

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
  -- Aviso a quien entrega y a quien recibe (D-F2-16): si no fue el dueño, lo sabe enseguida.
  perform app.enqueue_job('tenant.owner_notice',
    jsonb_build_object('notice_id', app.uuid_v7(), 'organization_id', p_organization_id,
                       'kind', 'ownership_transferred', 'previous_owner', v_uid, 'new_owner', p_new_owner_id),
    null, null, now(), 5);
end
$$;

-- Destinatarios y nombres del aviso, solo para el worker. Sin p_user_ids: el
-- dueño actual. Con p_user_ids: solo esos usuarios si son miembros de la
-- organización (el job no puede pedir correos de cualquiera).
create function system.owner_notice_contacts(p_organization_id uuid, p_store_id uuid, p_user_ids uuid[] default null)
returns table (user_id uuid, email text, full_name text, organization_name text, store_name text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email::text, p.full_name, o.name,
         (select s.name from public.stores s where s.id = p_store_id and s.organization_id = o.id),
         m.role
    from public.organizations o
    join public.organization_members m on m.organization_id = o.id
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
   where o.id = p_organization_id
     and u.email is not null
     and case when p_user_ids is null then m.role = 'org_owner' else m.user_id = any(p_user_ids) end
$$;

revoke all on function system.owner_notice_contacts(uuid, uuid, uuid[]) from public;
grant execute on function system.owner_notice_contacts(uuid, uuid, uuid[]) to system_worker;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029001400'::text
$$;
