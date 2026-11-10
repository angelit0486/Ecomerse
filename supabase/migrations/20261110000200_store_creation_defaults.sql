-- =============================================================================
-- Crear tiendas en la demostración (pedido del propietario, 2026-11-10).
--
-- 1. Dirección temporal en vercel.app: `storefront.root_domain` acepta, además
--    de `domain`, un `prefix` opcional y `attach`. Con
--    {"domain":"vercel.app","prefix":"pruva-tienda-","attach":true} una tienda
--    nueva queda en `pruva-tienda-<dirección>.vercel.app` (como las de la
--    demostración) y un job (`domains.attach_platform`) la da de alta en el
--    proyecto de Vercel. Sin `prefix` todo queda igual que antes
--    (`<dirección>.<dominio>`). La base nunca llama a la red (§44.10): el job
--    corre en el worker y solo anota el resultado.
-- 2. Funciones encendidas al nacer: la lista `stores.default_features` (solo
--    funciones que la tienda puede cambiar, sin kill switch) se enciende en la
--    tienda nueva como si la dueña lo hubiera hecho (motivo
--    `app.store_toggle_reason()`), así que la puede apagar en Ajustes →
--    Funciones. Las tiendas que ya existen no cambian.
--
-- Las tres altas de tienda (`org_create_store`, `platform_add_store`,
-- `platform_create_organization_with_store`) usan lo mismo.
--
-- Reversa: quitar `prefix`/`attach` del ajuste vuelve a la dirección
-- `<dirección>.<dominio>`; borrar `stores.default_features` deja de encender
-- funciones. Las funciones redefinidas se restauran desde 20261006000500,
-- 20261022000100 y 20261025000100.
-- =============================================================================

-- ---------------------------------------------------------------- Dirección
create or replace function app.platform_store_hostname(p_handle text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_setting jsonb;
  v_domain  text;
  v_prefix  text;
  v_label   text;
begin
  select ps.value into v_setting from public.platform_settings ps where ps.key = 'storefront.root_domain';
  v_domain := lower(v_setting ->> 'domain');
  v_prefix := coalesce(lower(v_setting ->> 'prefix'), '');
  if v_domain is null
     or v_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
     or (v_prefix <> '' and v_prefix !~ '^[a-z0-9][a-z0-9-]{0,23}$') then
    raise exception using errcode = 'P0001', message = 'platform_not_configured',
      detail = 'platform_settings.storefront.root_domain';
  end if;
  v_label := v_prefix || lower(btrim(coalesce(p_handle, '')));
  if v_label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'store_handle';
  end if;
  return v_label || '.' || v_domain;
end
$$;
revoke all on function app.platform_store_hostname(text) from public;

-- ------------------------------------------- Lo que se hace al crear la tienda
-- Enciende las funciones de la lista y, si la plataforma lo pide, encola el alta
-- de la dirección en el hosting. Devuelve las funciones encendidas.
create or replace function app.store_creation_defaults(p_store_id uuid, p_hostname text, p_actor uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys   text[] := '{}';
  v_list   jsonb;
  v_domain uuid;
begin
  select ps.value -> 'keys' into v_list from public.platform_settings ps where ps.key = 'stores.default_features';
  if jsonb_typeof(v_list) = 'array' then
    with wanted as (
      select f.key
        from public.feature_flags f
       where f.store_toggle and not f.kill_switch
         and f.key in (select jsonb_array_elements_text(v_list) where jsonb_typeof(v_list) = 'array')
         and not app.flag_enabled(f.key, p_store_id)
    ), ins as (
      insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason, created_by)
      select w.key, 'store', p_store_id, true, app.store_toggle_reason(), p_actor from wanted w
      on conflict (flag_key, scope, scope_id) do nothing
      returning flag_key
    )
    select coalesce(array_agg(ins.flag_key order by ins.flag_key), '{}') into v_keys from ins;
  end if;

  if exists (select 1 from public.platform_settings ps
              where ps.key = 'storefront.root_domain' and ps.value -> 'attach' = 'true'::jsonb) then
    select d.id into v_domain from public.store_domains d
     where d.store_id = p_store_id and d.hostname = p_hostname and d.type = 'platform_subdomain';
    if v_domain is not null then
      perform app.enqueue_job('domains.attach_platform', jsonb_build_object('domain_id', v_domain), p_store_id,
                              'domains.attach_platform:' || v_domain::text);
    end if;
  end if;
  return v_keys;
end
$$;
revoke all on function app.store_creation_defaults(uuid, text, uuid) from public;

-- Funciones que nacen encendidas en las tiendas nuevas (aprobado por el
-- propietario el 2026-11-10). Solo se toman las que la tienda puede cambiar.
insert into public.platform_settings (key, value, description)
values ('stores.default_features',
        '{"keys":["email_texts","order_printing","panel_help","returns","store_health","theme_personality","weekly_summary"]}',
        'Funciones que se encienden al crear una tienda; la tienda las puede apagar.')
on conflict (key) do nothing;

-- ------------------------------------------------------- Worker: alta en Vercel
-- Qué dar de alta: solo una dirección de la plataforma, activa y aún sin alta.
create or replace function system.domains_platform_target(p_domain_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('store_id', d.store_id, 'hostname', d.hostname)
    from public.store_domains d
   where d.id = p_domain_id and d.type = 'platform_subdomain' and d.status = 'active'
     and d.provider_ref is null
$$;
revoke all on function system.domains_platform_target(uuid) from public;
grant execute on function system.domains_platform_target(uuid) to system_worker;

-- El worker anota que el hosting ya sirve la dirección (idempotente).
create or replace function system.domains_platform_attached(p_domain_id uuid, p_ref text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.store_domains;
begin
  if p_ref is null or char_length(p_ref) not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'provider_ref';
  end if;
  update public.store_domains d set provider_ref = p_ref
   where d.id = p_domain_id and d.type = 'platform_subdomain' and d.provider_ref is null
  returning * into v_row;
  if v_row.id is null then
    return false;
  end if;
  perform audit.record('domain.attached', 'store_domain', v_row.id,
                       (select s.organization_id from public.stores s where s.id = v_row.store_id),
                       v_row.store_id, null, jsonb_build_object('hostname', v_row.hostname));
  return true;
end
$$;
revoke all on function system.domains_platform_attached(uuid, text) from public;
grant execute on function system.domains_platform_attached(uuid, text) to system_worker;

-- ------------------------------------------- Las tres altas de tienda (iguales
-- a sus versiones anteriores salvo la dirección y lo que se hace al crearla)
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
  v_org         record;
  v_base        record;
  v_store_id    uuid;
  v_name        text := btrim(coalesce(p_store_name, ''));
  v_handle      text := lower(btrim(coalesce(p_store_handle, '')));
  v_hostname    text;
  v_features    text[];
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

  v_hostname := app.platform_store_hostname(v_handle);

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

  v_features := app.store_creation_defaults(v_store_id, v_hostname, v_actor);

  perform audit.record('store.created', 'store', v_store_id, v_org.id, v_store_id, null,
                       jsonb_build_object('handle', v_handle, 'hostname', v_hostname,
                                          'created_by_org_member', v_actor, 'features', v_features));

  return jsonb_build_object('store_id', v_store_id, 'handle', v_handle, 'hostname', v_hostname);
end
$$;

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
  v_org         record;
  v_store_id    uuid;
  v_handle      text := lower(btrim(coalesce(p_store_handle, '')));
  v_hostname    text;
  v_features    text[];
begin
  v_hostname := app.platform_store_hostname(v_handle);

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

    insert into public.store_domains (store_id, hostname, type, status, is_primary, verified_at)
    values (v_store_id, v_hostname, 'platform_subdomain', 'active', true, now());
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'handle';
  end;

  insert into public.store_counters (store_id, key, value)
  select v_store_id, 'order_number', s.order_number_start - 1 from public.stores s where s.id = v_store_id;

  insert into public.store_themes (store_id) values (v_store_id);

  v_features := app.store_creation_defaults(v_store_id, v_hostname, v_actor);

  perform audit.record('store.created', 'store', v_store_id, v_org.id, v_store_id, null,
                       jsonb_build_object('handle', v_handle, 'hostname', v_hostname,
                                          'added_by_platform', v_actor, 'features', v_features));

  return jsonb_build_object('store_id', v_store_id, 'handle', v_handle, 'hostname', v_hostname);
end
$$;

create or replace function public.platform_create_organization_with_store(
  p_org_name     text,
  p_org_slug     text,
  p_org_country  text,
  p_owner_email  text,
  p_store_name   text,
  p_store_handle text,
  p_plan_key     text,
  p_currency     text    default 'MXN',
  p_timezone     text    default 'America/Mexico_City',
  p_locale       text    default 'es-MX',
  p_tax_rate_bps integer default 1600,
  p_trial_days   integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := app.require_platform_role(array['platform_owner', 'platform_admin']);
  v_plan_id     uuid;
  v_org_id      uuid;
  v_store_id    uuid;
  v_invite_id   uuid;
  v_hostname    text;
  v_features    text[];
  v_email       text := app.normalize_email(p_owner_email);
begin
  v_hostname := app.platform_store_hostname(p_store_handle);

  select p.id into v_plan_id from public.plans p where p.key = p_plan_key and p.status = 'active';
  if v_plan_id is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'plan';
  end if;
  if p_trial_days is null or p_trial_days not between 0 and 90 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'trial_days';
  end if;

  insert into public.organizations (name, slug, country)
  values (btrim(p_org_name), lower(btrim(p_org_slug)), upper(p_org_country))
  returning id into v_org_id;

  insert into public.subscriptions (organization_id, plan_id, status, trial_ends_at, provider)
  values (v_org_id, v_plan_id, 'trialing', now() + make_interval(days => p_trial_days), 'manual');

  insert into public.stores (organization_id, name, handle, currency, country, timezone, locale,
                             tax_rate_bps)
  values (v_org_id, btrim(p_store_name), lower(btrim(p_store_handle)), upper(p_currency),
          upper(p_org_country), p_timezone, p_locale, p_tax_rate_bps)
  returning id into v_store_id;

  insert into public.store_domains (store_id, hostname, type, status, is_primary, verified_at)
  values (v_store_id, v_hostname, 'platform_subdomain', 'active', true, now());

  insert into public.store_counters (store_id, key, value)
  select v_store_id, 'order_number', s.order_number_start - 1 from public.stores s where s.id = v_store_id;

  insert into public.store_themes (store_id) values (v_store_id);

  v_features := app.store_creation_defaults(v_store_id, v_hostname, v_actor);

  insert into public.organization_invitations (organization_id, email, org_role, expires_at, invited_by)
  values (v_org_id, v_email, 'org_owner', now() + interval '7 days', v_actor)
  returning id into v_invite_id;

  perform app.enqueue_job('access.invitation_email', jsonb_build_object('invitation_id', v_invite_id),
                          v_store_id, 'invitation:' || v_invite_id::text);

  perform audit.record('organization.created', 'organization', v_org_id, v_org_id, null, null,
                       jsonb_build_object('slug', lower(btrim(p_org_slug)), 'plan', p_plan_key));
  perform audit.record('store.created', 'store', v_store_id, v_org_id, v_store_id, null,
                       jsonb_build_object('handle', lower(btrim(p_store_handle)), 'hostname', v_hostname,
                                          'features', v_features));
  perform audit.record('member.invited', 'invitation', v_invite_id, v_org_id, null, null,
                       jsonb_build_object('role', 'org_owner'));

  return jsonb_build_object(
    'organization_id', v_org_id, 'store_id', v_store_id,
    'invitation_id', v_invite_id, 'hostname', v_hostname
  );
end
$$;

-- Versión del esquema (D-POR-06).
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261110000200'::text
$$;
