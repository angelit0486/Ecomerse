-- =============================================================================
-- Gate F2 · Revisión de código: reactivar un miembro en la tienda cuando la
-- suspensión es de la organización ahora falla con member_org_suspended (antes
-- devolvía éxito sin cambiar nada).
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
    -- Reactivar en la tienda no sirve si la suspensión es de la organización:
    -- se informa en vez de devolver un éxito que no cambia nada.
    if p_status = 'active' and exists (
      select 1 from public.organization_members m
       where m.organization_id = p_org and m.user_id = p_user_id and m.status = 'suspended'
    ) then
      raise exception using errcode = 'P0001', message = 'member_org_suspended';
    end if;
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

