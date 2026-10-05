-- =============================================================================
-- Fase 2 · Consola de plataforma mínima: lecturas (F2-T12)
-- Contrato: GATE0 §7.6 (los platform admins NO leen datos de tenant por RLS:
-- usan funciones de plataforma), §8.3 (platform.tenants.read: support ve
-- metadatos, sin datos de comercio; admin/owner gestionan).
-- =============================================================================

-- Rol de plataforma del usuario actual (NULL si no es staff activo o sin AAL2).
create or replace function public.access_platform_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ps.role from public.platform_staff ps
   where ps.user_id = auth.uid() and ps.status = 'active' and app.has_aal2()
$$;

-- Organizaciones con metadatos (sin datos de comercio).
create or replace function public.platform_list_organizations(p_search text default null, p_limit integer default 50)
returns table (
  id                  uuid,
  name                text,
  slug                text,
  status              text,
  plan_key            text,
  subscription_status text,
  store_count         integer,
  owner_email         text,
  created_at          timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin', 'platform_support']);
  return query
  select o.id, o.name, o.slug, o.status, p.key, s.status,
         (select count(*)::integer from public.stores st where st.organization_id = o.id and st.status <> 'closed'),
         (select u.email::text from public.organization_members m join auth.users u on u.id = m.user_id
           where m.organization_id = o.id and m.role = 'org_owner'),
         o.created_at
    from public.organizations o
    left join public.subscriptions s on s.organization_id = o.id and s.status <> 'cancelled'
    left join public.plans p on p.id = s.plan_id
   where v_search is null
      or o.name ilike '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%'
      or o.slug ilike '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%'
   order by o.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

-- Tiendas de una organización (o todas) con su dominio primario.
create or replace function public.platform_list_stores(p_organization_id uuid default null)
returns table (
  id               uuid,
  organization_id  uuid,
  organization     text,
  name             text,
  handle           text,
  status           text,
  primary_hostname text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin', 'platform_support']);
  return query
  select st.id, st.organization_id, o.name, st.name, st.handle, st.status,
         (select d.hostname from public.store_domains d where d.store_id = st.id and d.is_primary)
    from public.stores st
    join public.organizations o on o.id = st.organization_id
   where p_organization_id is null or st.organization_id = p_organization_id
   order by o.name, st.name
   limit 500;
end
$$;

-- Concesiones de soporte: owner/admin ven todas; support solo las suyas.
create or replace function public.platform_list_support_grants(p_active_only boolean default true)
returns table (
  id            uuid,
  organization  text,
  store_name    text,
  grantee_email text,
  granted_by    text,
  reason        text,
  ticket_ref    text,
  starts_at     timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_platform_role(array['platform_owner', 'platform_admin', 'platform_support']);
  v_manager boolean := app.is_platform_staff(array['platform_owner', 'platform_admin']);
begin
  return query
  select g.id, o.name, st.name, gu.email::text, bu.email::text, g.reason, g.ticket_ref,
         g.starts_at, g.expires_at, g.revoked_at
    from public.support_access_grants g
    join public.organizations o on o.id = g.organization_id
    join public.stores st on st.id = g.store_id
    join auth.users gu on gu.id = g.grantee_user_id
    left join auth.users bu on bu.id = g.granted_by
   where (v_manager or g.grantee_user_id = v_uid)
     and (not coalesce(p_active_only, true) or (g.revoked_at is null and g.expires_at > now()))
   order by g.created_at desc
   limit 200;
end
$$;

-- Staff que puede recibir una concesión (para el formulario).
create or replace function public.platform_list_support_staff()
returns table (user_id uuid, email text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  return query
  select ps.user_id, u.email::text, ps.role
    from public.platform_staff ps join auth.users u on u.id = ps.user_id
   where ps.status = 'active' and ps.role in ('platform_support', 'platform_admin')
   order by u.email;
end
$$;

revoke all on function public.access_platform_role() from public;
revoke all on function public.platform_list_organizations(text, integer) from public;
revoke all on function public.platform_list_stores(uuid) from public;
revoke all on function public.platform_list_support_grants(boolean) from public;
revoke all on function public.platform_list_support_staff() from public;
grant execute on function public.access_platform_role() to authenticated;
grant execute on function public.platform_list_organizations(text, integer) to authenticated;
grant execute on function public.platform_list_stores(uuid) to authenticated;
grant execute on function public.platform_list_support_grants(boolean) to authenticated;
grant execute on function public.platform_list_support_staff() to authenticated;
