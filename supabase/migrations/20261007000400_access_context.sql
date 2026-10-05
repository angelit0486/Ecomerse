-- =============================================================================
-- Fase 2 · Contexto de autorización por request (F2-T05)
-- Contrato: GATE0 §7.2 ("el contexto de tienda viene de la URL y se valida en
-- cada request"; access_list_my_stores), §7.3 (permisos nunca en el JWT), §44.7
-- (no se cachea entre requests nada que dependa de la autorización).
--
-- Una sola llamada resuelve tienda + rol + permisos efectivos, evaluados en vivo
-- con app.has_store_permission. El servidor la memoiza solo dentro del request.
-- =============================================================================

-- Contexto de una tienda por handle. Sin store.read → not_found (no revela si
-- existe una tienda con ese handle).
create or replace function public.access_store_context(p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := app.require_aal2_user();
  v_store public.stores;
  v_perms text[];
begin
  select * into v_store from public.stores s where s.handle = lower(btrim(p_handle));
  if v_store.id is null or not app.has_store_permission(v_store.id, 'store.read') then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
  end if;

  select coalesce(array_agg(p.key order by p.key), '{}') into v_perms
    from public.permissions p
   where p.module not in ('org', 'platform') and app.has_store_permission(v_store.id, p.key);

  return jsonb_build_object(
    'user_id', v_uid,
    'store', jsonb_build_object(
      'id', v_store.id, 'organization_id', v_store.organization_id, 'name', v_store.name,
      'handle', v_store.handle, 'status', v_store.status, 'currency', v_store.currency,
      'locale', v_store.locale, 'timezone', v_store.timezone),
    'org_role', app.current_org_role(v_store.organization_id),
    'access_mode', app.org_access_mode(v_store.organization_id),
    'support_grant_id', (
      select g.id from public.support_access_grants g
       where g.grantee_user_id = v_uid and g.store_id = v_store.id and g.revoked_at is null
         and now() >= g.starts_at and now() < g.expires_at
         and not exists (select 1 from public.organization_members m
                          where m.organization_id = v_store.organization_id and m.user_id = v_uid
                            and m.status = 'active')
       order by g.expires_at desc limit 1),
    'permissions', to_jsonb(v_perms)
  );
end
$$;

-- Tiendas accesibles para el selector del panel (GATE0 §7.2).
create or replace function public.access_list_my_stores()
returns table (store_id uuid, organization_id uuid, organization_name text, name text, handle text,
               status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_aal2_user();
  return query
  select s.id, s.organization_id, o.name, s.name, s.handle, s.status
    from public.stores s
    join public.organizations o on o.id = s.organization_id
   where s.status <> 'closed'
     and (
       exists (select 1 from public.organization_members m
                where m.organization_id = s.organization_id and m.user_id = auth.uid())
       or exists (select 1 from public.support_access_grants g
                   where g.store_id = s.id and g.grantee_user_id = auth.uid())
     )
     and app.has_store_permission(s.id, 'store.read')
   order by o.name, s.name;
end
$$;

revoke all on function public.access_store_context(text) from public;
revoke all on function public.access_list_my_stores() from public;
grant execute on function public.access_store_context(text) to authenticated;
grant execute on function public.access_list_my_stores() to authenticated;
