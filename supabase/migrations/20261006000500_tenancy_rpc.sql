-- =============================================================================
-- Fase 2 · Funciones RPC de identidad y tenancy
-- Contrato: GATE0 §7.2 (invitaciones), §16.4/§38 F2 (alta de tenant), §20.3
--           (publicar tema), §21.1 (host → tienda)
--
-- Errores: errcode 42501 + message ∈ {unauthenticated, mfa_required, forbidden};
--          P0001 + message = código de negocio (ver src/server/errors.ts).
-- =============================================================================

create or replace function app.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$ select lower(btrim(p_email)) $$;
revoke all on function app.normalize_email(text) from public;

-- Token aleatorio de 256 bits (dos UUIDv4: 244 bits de entropía real) en hex.
create or replace function app.random_token()
returns text
language sql
volatile
set search_path = ''
as $$ select encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex') $$;
revoke all on function app.random_token() from public;

create or replace function app.token_hash(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$ select sha256(convert_to(p_token, 'UTF8')) $$;
revoke all on function app.token_hash(text) from public;

-- =============================================================================
-- Alta asistida de un tenant (onboarding paso 0, por la plataforma; Q-N3).
-- Crea: organización, suscripción (trial), tienda en borrador, subdominio,
-- contador de pedidos, tema por defecto e invitación al dueño. Encola el email.
-- =============================================================================
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
  v_root_domain text;
  v_plan_id     uuid;
  v_org_id      uuid;
  v_store_id    uuid;
  v_invite_id   uuid;
  v_hostname    text;
  v_email       text := app.normalize_email(p_owner_email);
begin
  select lower(ps.value ->> 'domain') into v_root_domain
    from public.platform_settings ps where ps.key = 'storefront.root_domain';
  if v_root_domain is null
     or v_root_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
    raise exception using errcode = 'P0001', message = 'platform_not_configured',
      detail = 'platform_settings.storefront.root_domain';
  end if;

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

  v_hostname := lower(btrim(p_store_handle)) || '.' || v_root_domain;
  insert into public.store_domains (store_id, hostname, type, status, is_primary, verified_at)
  values (v_store_id, v_hostname, 'platform_subdomain', 'active', true, now());

  insert into public.store_counters (store_id, key, value)
  select v_store_id, 'order_number', s.order_number_start - 1 from public.stores s where s.id = v_store_id;

  insert into public.store_themes (store_id) values (v_store_id);

  insert into public.organization_invitations (organization_id, email, org_role, expires_at, invited_by)
  values (v_org_id, v_email, 'org_owner', now() + interval '7 days', v_actor)
  returning id into v_invite_id;

  perform app.enqueue_job('access.invitation_email', jsonb_build_object('invitation_id', v_invite_id),
                          v_store_id, 'invitation:' || v_invite_id::text);

  perform audit.record('organization.created', 'organization', v_org_id, v_org_id, null, null,
                       jsonb_build_object('slug', lower(btrim(p_org_slug)), 'plan', p_plan_key));
  perform audit.record('store.created', 'store', v_store_id, v_org_id, v_store_id, null,
                       jsonb_build_object('handle', lower(btrim(p_store_handle)), 'hostname', v_hostname));
  perform audit.record('member.invited', 'invitation', v_invite_id, v_org_id, null, null,
                       jsonb_build_object('role', 'org_owner'));

  return jsonb_build_object(
    'organization_id', v_org_id, 'store_id', v_store_id,
    'invitation_id', v_invite_id, 'hostname', v_hostname
  );
end
$$;

revoke all on function public.platform_create_organization_with_store(text, text, text, text, text, text, text, text, text, text, integer, integer) from public;
grant execute on function public.platform_create_organization_with_store(text, text, text, text, text, text, text, text, text, text, integer, integer) to authenticated;

-- =============================================================================
-- Emisión del token de invitación (worker). Genera un token nuevo, guarda SOLO
-- su hash y lo devuelve para enviarlo por email. Reemitir invalida el anterior.
-- =============================================================================
create or replace function system.issue_invitation_token(p_invitation_id uuid)
returns table (token text, email text, organization_name text, store_name text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := app.random_token();
begin
  return query
  update public.organization_invitations i
     set token_hash = app.token_hash(v_token), token_issued_at = now()
    from public.organizations o
   where i.id = p_invitation_id and o.id = i.organization_id
     and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     and o.status = 'active'
  returning v_token, i.email, o.name,
            (select s.name from public.stores s where s.id = i.store_id), i.expires_at;
end
$$;

revoke all on function system.issue_invitation_token(uuid) from public;
grant execute on function system.issue_invitation_token(uuid) to system_worker;

-- =============================================================================
-- Aceptación de invitación (onboarding paso 1). Exige sesión con 2FA (AAL2) y que
-- el email verificado de la sesión coincida con el invitado.
-- =============================================================================
create or replace function public.access_accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := app.require_aal2_user();
  v_email     text := app.normalize_email(auth.email());
  v_inv       public.organization_invitations;
  v_org_rank  integer;
  v_cur_role  text;
  v_cur_rank  integer;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invitation_invalid';
  end if;

  select * into v_inv from public.organization_invitations i
   where i.token_hash = app.token_hash(p_token)
   for update;

  if v_inv.id is null or v_inv.accepted_at is not null or v_inv.revoked_at is not null
     or v_inv.expires_at <= now()
     or not exists (select 1 from public.organizations o where o.id = v_inv.organization_id and o.status = 'active') then
    raise exception using errcode = 'P0001', message = 'invitation_invalid';
  end if;

  if v_email is null or v_email <> v_inv.email then
    raise exception using errcode = 'P0001', message = 'invitation_email_mismatch';
  end if;

  select m.role into v_cur_role from public.organization_members m
   where m.organization_id = v_inv.organization_id and m.user_id = v_uid;
  v_cur_rank := case v_cur_role when 'org_owner' then 3 when 'org_admin' then 2 when 'org_member' then 1 else 0 end;

  if v_inv.org_role = 'org_owner' and exists (
    select 1 from public.organization_members m
     where m.organization_id = v_inv.organization_id and m.role = 'org_owner' and m.user_id <> v_uid
  ) then
    -- La propiedad solo cambia por transferencia explícita (GATE0 §8.3, regla 2).
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'organization_has_owner';
  end if;

  if v_inv.org_role is not null then
    v_org_rank := case v_inv.org_role when 'org_owner' then 3 when 'org_admin' then 2 else 1 end;
    if v_cur_role is null then
      insert into public.organization_members (organization_id, user_id, role)
      values (v_inv.organization_id, v_uid, v_inv.org_role);
    elsif v_org_rank > v_cur_rank then
      update public.organization_members set role = v_inv.org_role, status = 'active'
       where organization_id = v_inv.organization_id and user_id = v_uid;
    end if;
  else
    if v_cur_role is null then
      insert into public.organization_members (organization_id, user_id, role)
      values (v_inv.organization_id, v_uid, 'org_member');
    end if;
    insert into public.store_members (store_id, user_id, role_id)
    values (v_inv.store_id, v_uid, v_inv.store_role_id)
    on conflict (store_id, user_id) do update set role_id = excluded.role_id, status = 'active';
  end if;

  update public.organization_invitations
     set accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  perform audit.record('member.joined', 'invitation', v_inv.id, v_inv.organization_id, v_inv.store_id,
                       null, jsonb_build_object('org_role', v_inv.org_role,
                                                'store_role_id', v_inv.store_role_id));

  return jsonb_build_object('organization_id', v_inv.organization_id, 'store_id', v_inv.store_id);
end
$$;

revoke all on function public.access_accept_invitation(text) from public;
grant execute on function public.access_accept_invitation(text) to authenticated;

-- =============================================================================
-- Publicar el branding (borrador → vigente). El contraste se valida en el
-- servidor antes de invocar esta función; aquí se revalida la estructura.
-- =============================================================================
create or replace function public.appearance_publish_theme(p_store_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_aal2_user();
  v_before jsonb;
  v_after  jsonb;
  v_now    timestamptz := now();
begin
  if not app.has_store_permission(p_store_id, 'appearance.manage') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  select t.settings, t.draft_settings into v_before, v_after
    from public.store_themes t where t.store_id = p_store_id for update;
  if v_after is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'no_draft';
  end if;

  update public.store_themes
     set settings = draft_settings,
         home_sections = coalesce(draft_home_sections, home_sections),
         draft_settings = null,
         draft_home_sections = null,
         published_at = v_now,
         published_by = v_uid
   where store_id = p_store_id;

  perform audit.record('theme.published', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id),
                       p_store_id, jsonb_build_object('settings', v_before),
                       jsonb_build_object('settings', v_after));
  return v_now;
end
$$;

revoke all on function public.appearance_publish_theme(uuid) from public;
grant execute on function public.appearance_publish_theme(uuid) to authenticated;

-- =============================================================================
-- Storefront (rol storefront_gateway; esquema no expuesto)
-- =============================================================================

-- host → tienda. Única fuente: store_domains (hostname único global). Una tienda
-- cerrada o inexistente no devuelve fila (respuesta uniforme, sin enumeración).
create or replace function storefront.resolve_host(p_hostname text)
returns table (store_id uuid, store_status text, primary_hostname text, is_primary boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host text := lower(btrim(coalesce(p_hostname, '')));
begin
  v_host := regexp_replace(v_host, ':[0-9]{1,5}$', '');
  v_host := regexp_replace(v_host, '\.$', '');
  if char_length(v_host) = 0 or char_length(v_host) > 253
     or v_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
    return;
  end if;

  return query
  select d.store_id,
         case
           when s.status = 'suspended' or app.org_access_mode(s.organization_id) = 'suspended' then 'suspended'
           else s.status
         end,
         (select p.hostname from public.store_domains p
           where p.store_id = d.store_id and p.is_primary and p.status = 'active'),
         d.is_primary
    from public.store_domains d
    join public.stores s on s.id = d.store_id
    join public.organizations o on o.id = s.organization_id
   where d.hostname = v_host and d.status = 'active'
     and s.status <> 'closed' and o.status <> 'closed';
end
$$;

-- Datos públicos de la tienda y su branding vigente (nunca el borrador).
create or replace function storefront.get_store_public(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'handle', s.handle, 'status', s.status,
    'locale', s.locale, 'currency', s.currency, 'country', s.country,
    'theme', jsonb_build_object('key', t.theme_key, 'version', t.theme_version,
                                'settings', coalesce(t.settings, '{}'::jsonb))
  )
  from public.stores s
  left join public.store_themes t on t.store_id = s.id
  where s.id = p_store_id and s.status <> 'closed'
$$;

revoke all on function storefront.resolve_host(text) from public;
revoke all on function storefront.get_store_public(uuid) from public;
grant execute on function storefront.resolve_host(text) to storefront_gateway;
grant execute on function storefront.get_store_public(uuid) to storefront_gateway;
