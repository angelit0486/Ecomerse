-- =============================================================================
-- Consola de plataforma: búsqueda de tiendas.
--
-- platform_list_stores devolvía como máximo 500 tiendas ordenadas por nombre:
-- con más tiendas, algunas no se podían elegir al conceder soporte. Ahora acepta
-- una búsqueda (nombre o handle de la tienda, nombre u slug de la organización)
-- y, sin búsqueda, muestra primero las más recientes.
-- =============================================================================

drop function public.platform_list_stores(uuid);

create function public.platform_list_stores(p_organization_id uuid default null, p_search text default null)
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
declare
  v_pattern text := '%' || replace(replace(replace(nullif(btrim(coalesce(p_search, '')), ''),
                      '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin', 'platform_support']);
  return query
  select st.id, st.organization_id, o.name, st.name, st.handle, st.status,
         (select d.hostname from public.store_domains d where d.store_id = st.id and d.is_primary)
    from public.stores st
    join public.organizations o on o.id = st.organization_id
   where (p_organization_id is null or st.organization_id = p_organization_id)
     and (v_pattern is null
          or st.name ilike v_pattern or st.handle ilike v_pattern
          or o.name ilike v_pattern or o.slug ilike v_pattern)
   order by st.created_at desc, st.id
   limit 500;
end
$$;

revoke all on function public.platform_list_stores(uuid, text) from public;
grant execute on function public.platform_list_stores(uuid, text) to authenticated;
