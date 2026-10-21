-- =============================================================================
-- Pulido · Otra tienda en la misma organización (GATE0 §2: ORGANIZATION → STORE
-- ×N, limitado por max_stores). La crea la plataforma, como la primera (el alta
-- por cuenta propia es E15, no aprobada): tienda en borrador, subdominio de la
-- plataforma activo y principal, contador de pedidos, tema por defecto y
-- auditoría. El límite del plan lo aplica el trigger de `stores`
-- (`app.assert_within_limit`). La dueña y las administradoras de la organización
-- la administran por su rol de organización; nadie de otra organización la ve.
-- =============================================================================

create or replace function public.platform_add_store(
  p_org_id       uuid,
  p_store_name   text,
  p_store_handle text,
  p_currency     text    default 'MXN',
  p_timezone     text    default 'America/Mexico_City',
  p_locale       text    default 'es-MX',
  p_tax_rate_bps integer default 1600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := app.require_platform_role(array['platform_owner', 'platform_admin']);
  v_root_domain text;
  v_org         record;
  v_store_id    uuid;
  v_handle      text := lower(btrim(coalesce(p_store_handle, '')));
  v_hostname    text;
begin
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
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'organization';
  end if;
  if v_org.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'organization_status';
  end if;

  begin
    insert into public.stores (organization_id, name, handle, currency, country, timezone, locale,
                               tax_rate_bps)
    values (v_org.id, btrim(p_store_name), v_handle, upper(p_currency), v_org.country, p_timezone,
            p_locale, p_tax_rate_bps)
    returning id into v_store_id;

    v_hostname := v_handle || '.' || v_root_domain;
    insert into public.store_domains (store_id, hostname, type, status, is_primary, verified_at)
    values (v_store_id, v_hostname, 'platform_subdomain', 'active', true, now());
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'handle';
  end;

  insert into public.store_counters (store_id, key, value)
  select v_store_id, 'order_number', s.order_number_start - 1 from public.stores s where s.id = v_store_id;

  insert into public.store_themes (store_id) values (v_store_id);

  perform audit.record('store.created', 'store', v_store_id, v_org.id, v_store_id, null,
                       jsonb_build_object('handle', v_handle, 'hostname', v_hostname,
                                          'added_by_platform', v_actor));

  return jsonb_build_object('store_id', v_store_id, 'handle', v_handle, 'hostname', v_hostname);
end
$$;

revoke all on function public.platform_add_store(uuid, text, text, text, text, text, integer) from public;
grant execute on function public.platform_add_store(uuid, text, text, text, text, text, integer) to authenticated;
