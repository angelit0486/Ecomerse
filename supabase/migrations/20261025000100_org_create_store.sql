-- =============================================================================
-- ADR-038 (aprobado por el propietario el 2026-10-22): la dueña o una
-- administradora de la organización crea otra tienda desde su panel, con el
-- permiso de organización `org.stores.create` (ya definido en el contrato y sin
-- uso hasta hoy). Mismo alta que `platform_add_store`: tienda en borrador,
-- subdominio de la plataforma, contador de pedidos, tema por defecto y
-- auditoría. Solo dentro de SU organización; el límite del plan lo aplica el
-- trigger de `stores` (`app.assert_within_limit`). No crea organizaciones ni
-- cuentas (eso es E15, no aprobado).
-- =============================================================================

create or replace function public.org_create_store(
  p_org_id       uuid,
  p_store_name   text,
  p_store_handle text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := app.require_aal2_user();
  v_root_domain text;
  v_org         record;
  v_base        record;
  v_store_id    uuid;
  v_name        text := btrim(coalesce(p_store_name, ''));
  v_handle      text := lower(btrim(coalesce(p_store_handle, '')));
  v_hostname    text;
begin
  -- Sin el permiso (u otra organización) no se distingue de «no existe».
  if p_org_id is null or not app.has_org_permission(p_org_id, 'org.stores.create') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if length(v_name) not between 2 and 80 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'store_name';
  end if;
  if v_handle !~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'store_handle';
  end if;

  select lower(ps.value ->> 'domain') into v_root_domain
    from public.platform_settings ps where ps.key = 'storefront.root_domain';
  if v_root_domain is null
     or v_root_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
    raise exception using errcode = 'P0001', message = 'platform_not_configured',
      detail = 'platform_settings.storefront.root_domain';
  end if;

  select o.id, o.status, o.country into v_org
    from public.organizations o where o.id = p_org_id
     for update;
  if not found then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if v_org.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'organization_status';
  end if;

  -- Moneda, zona horaria, idioma e impuesto: los de la primera tienda de la
  -- organización (la dueña ya los eligió); si no hay, los de la plataforma.
  select s.currency, s.timezone, s.locale, s.tax_rate_bps into v_base
    from public.stores s where s.organization_id = v_org.id
   order by s.created_at limit 1;

  begin
    insert into public.stores (organization_id, name, handle, currency, country, timezone, locale,
                               tax_rate_bps)
    values (v_org.id, v_name, v_handle, coalesce(v_base.currency, 'MXN'), v_org.country,
            coalesce(v_base.timezone, 'America/Mexico_City'), coalesce(v_base.locale, 'es-MX'),
            coalesce(v_base.tax_rate_bps, 1600))
    returning id into v_store_id;

    v_hostname := v_handle || '.' || v_root_domain;
    insert into public.store_domains (store_id, hostname, type, status, is_primary, verified_at)
    values (v_store_id, v_hostname, 'platform_subdomain', 'active', true, now());
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'handle';
    -- Dirección reservada o con «--» (CHECK de `stores.handle`).
    when check_violation then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'store_handle';
  end;

  insert into public.store_counters (store_id, key, value)
  select v_store_id, 'order_number', s.order_number_start - 1 from public.stores s where s.id = v_store_id;

  insert into public.store_themes (store_id) values (v_store_id);

  perform audit.record('store.created', 'store', v_store_id, v_org.id, v_store_id, null,
                       jsonb_build_object('handle', v_handle, 'hostname', v_hostname,
                                          'created_by_org_member', v_actor));

  return jsonb_build_object('store_id', v_store_id, 'handle', v_handle, 'hostname', v_hostname);
end
$$;

revoke all on function public.org_create_store(uuid, text, text) from public;
grant execute on function public.org_create_store(uuid, text, text) to authenticated;

-- Organizaciones donde la persona puede crear tiendas (para mostrar «Nueva
-- tienda» en el panel). Solo las suyas; la autoridad sigue siendo
-- `org_create_store`.
create or replace function public.access_orgs_can_create_stores()
returns table (organization_id uuid, organization_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
   where om.user_id = auth.uid()
     and app.has_org_permission(o.id, 'org.stores.create')
   order by o.name
$$;

revoke all on function public.access_orgs_can_create_stores() from public;
grant execute on function public.access_orgs_can_create_stores() to authenticated;

-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version() returns text language sql immutable set search_path = '' as $$ select '20261025000100'::text $$;
