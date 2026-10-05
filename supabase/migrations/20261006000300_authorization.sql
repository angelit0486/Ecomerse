-- =============================================================================
-- Fase 2 · Núcleo de autorización (GATE0 §8, §12.2, §19.3, §19.4; ADR-002, ADR-017)
--
-- Reglas:
--  - Todo permiso de staff o de plataforma exige AAL2 (MFA). Un JWT aal1 (p. ej. el
--    de un comprador con OTP) no concede ningún permiso de staff (CF-02).
--  - Los permisos se evalúan en vivo contra las membresías; nunca van en el JWT.
--  - Permiso desconocido = denegado.
-- =============================================================================

-- authenticated necesita USAGE en "app" para que las políticas RLS invoquen estos
-- helpers. Solo recibe EXECUTE de las funciones listadas al final.
grant usage on schema app to authenticated;

-- -----------------------------------------------------------------------------
create or replace function app.has_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $$;

-- -----------------------------------------------------------------------------
-- Modo de acceso derivado de la organización y su suscripción (GATE0 §19.4).
-- full | read_only | suspended. Sin suscripción vigente = suspended (cerrado por defecto).
-- -----------------------------------------------------------------------------
create or replace function app.org_access_mode(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when o.id is null or o.status <> 'active' then 'suspended'
    when s.id is null then 'suspended'
    when s.status = 'active' then 'full'
    when s.status = 'trialing' then case when s.trial_ends_at > now() then 'full' else 'read_only' end
    when s.status = 'past_due' then case when s.grace_ends_at > now() then 'full' else 'read_only' end
    when s.status = 'paused' then 'read_only'
    else 'suspended'
  end
  from (select 1) as one
  left join public.organizations o on o.id = p_org
  left join public.subscriptions s on s.organization_id = p_org and s.status <> 'cancelled'
$$;

-- -----------------------------------------------------------------------------
-- app.has_store_permission: ÚNICA función de autorización de tienda (contrato §43).
-- -----------------------------------------------------------------------------
create or replace function app.has_store_permission(p_store_id uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid              uuid := auth.uid();
  v_kind             text;
  v_support_readable boolean;
  v_org              uuid;
  v_store_status     text;
  v_mode             text;
begin
  if v_uid is null or p_store_id is null or p_permission is null then
    return false;
  end if;
  if not app.has_aal2() then
    return false;
  end if;

  select p.kind, p.support_readable into v_kind, v_support_readable
    from public.permissions p
   where p.key = p_permission and p.module <> 'org';
  if v_kind is null then
    return false;
  end if;

  select s.organization_id, s.status into v_org, v_store_status
    from public.stores s where s.id = p_store_id;
  if v_org is null or v_store_status in ('suspended', 'closed') then
    return false;
  end if;

  v_mode := app.org_access_mode(v_org);
  if v_mode = 'suspended' or (v_mode = 'read_only' and v_kind = 'write') then
    return false;
  end if;

  -- Dueño o administrador de la organización: todos los permisos de tienda.
  if exists (
    select 1 from public.organization_members m
     where m.organization_id = v_org and m.user_id = v_uid
       and m.status = 'active' and m.role in ('org_owner', 'org_admin')
  ) then
    return true;
  end if;

  -- Rol de tienda. Exige además membresía ACTIVA en la organización: suspender
  -- a alguien en la organización le retira el acceso a todas sus tiendas.
  if exists (
    select 1
      from public.store_members sm
      join public.role_permissions rp on rp.role_id = sm.role_id
      join public.organization_members m
        on m.organization_id = v_org and m.user_id = sm.user_id and m.status = 'active'
     where sm.store_id = p_store_id and sm.user_id = v_uid and sm.status = 'active'
       and rp.permission_key = p_permission
  ) then
    return true;
  end if;

  -- Soporte de plataforma: solo lectura no sensible, con concesión vigente.
  if v_kind = 'read' and v_support_readable and exists (
    select 1
      from public.support_access_grants g
      join public.platform_staff ps on ps.user_id = g.grantee_user_id and ps.status = 'active'
                                   and ps.role in ('platform_support', 'platform_admin')
     where g.grantee_user_id = v_uid and g.store_id = p_store_id and g.revoked_at is null
       and now() >= g.starts_at and now() < g.expires_at
  ) then
    return true;
  end if;

  return false;
end
$$;

-- -----------------------------------------------------------------------------
-- Rol activo del usuario actual en una organización (NULL si no hay o sin AAL2).
-- -----------------------------------------------------------------------------
create or replace function app.current_org_role(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
   where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
     and o.status <> 'closed' and app.has_aal2()
$$;

-- -----------------------------------------------------------------------------
-- Permisos de organización (GATE0 §8.3). Facturación siempre disponible para el
-- dueño, aunque la cuenta esté en solo lectura o suspendida (debe poder pagar).
-- -----------------------------------------------------------------------------
create or replace function app.has_org_permission(p_org uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := app.current_org_role(p_org);
  v_kind text;
  v_mode text;
begin
  if v_role is null or p_permission is null then
    return false;
  end if;
  select p.kind into v_kind from public.permissions p where p.key = p_permission and p.module = 'org';
  if v_kind is null then
    return false;
  end if;

  if not (
    v_role = 'org_owner'
    or (v_role = 'org_admin' and p_permission in
        ('org.read', 'org.update', 'org.members.manage', 'org.stores.create', 'org.billing.read'))
    or (v_role = 'org_member' and p_permission = 'org.read')
  ) then
    return false;
  end if;

  if v_role = 'org_owner' and p_permission in ('org.read', 'org.billing.read', 'org.billing.manage') then
    return true;
  end if;

  v_mode := app.org_access_mode(p_org);
  if v_mode = 'suspended' or (v_mode = 'read_only' and v_kind = 'write') then
    return false;
  end if;
  return true;
end
$$;

-- -----------------------------------------------------------------------------
-- Plataforma: el usuario actual es platform_staff activo con uno de los roles y AAL2.
-- -----------------------------------------------------------------------------
create or replace function app.is_platform_staff(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_aal2() and exists (
    select 1 from public.platform_staff ps
     where ps.user_id = auth.uid() and ps.status = 'active' and ps.role = any (p_roles)
  )
$$;

-- -----------------------------------------------------------------------------
-- Errores estándar para RPC (los mapea src/server/errors.ts por mensaje).
-- -----------------------------------------------------------------------------
create or replace function app.require_aal2_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'unauthenticated';
  end if;
  if not app.has_aal2() then
    raise exception using errcode = '42501', message = 'mfa_required';
  end if;
  return v_uid;
end
$$;

create or replace function app.require_platform_role(p_roles text[])
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_aal2_user();
begin
  if not app.is_platform_staff(p_roles) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return v_uid;
end
$$;

-- -----------------------------------------------------------------------------
-- Límites del plan (GATE0 §19.3). Clave ausente = 0 (cerrado por defecto).
-- -----------------------------------------------------------------------------
create or replace function app.effective_limit(p_org uuid, p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select o.value_int from public.organization_entitlement_overrides o
      where o.organization_id = p_org and o.key = p_key
        and (o.expires_at is null or o.expires_at > now())),
    (select e.value_int
       from public.subscriptions s
       join public.plan_entitlements e on e.plan_id = s.plan_id and e.key = p_key
      where s.organization_id = p_org and s.status <> 'cancelled'),
    0
  )
$$;

create or replace function app.current_usage(p_org uuid, p_key text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  case p_key
    when 'max_stores' then
      return (select count(*) from public.stores s
               where s.organization_id = p_org and s.status <> 'closed');
    when 'max_staff' then
      return (select count(*) from public.organization_members m
               where m.organization_id = p_org and m.status = 'active');
    else
      raise exception using errcode = '22023', message = 'unsupported_limit', detail = p_key;
  end case;
end
$$;

create or replace function app.assert_within_limit(p_org uuid, p_key text, p_increment integer default 1)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_used  integer;
begin
  -- Serializa por organización y clave: evita superar el límite por concurrencia.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_key, 0));
  v_limit := app.effective_limit(p_org, p_key);
  v_used  := app.current_usage(p_org, p_key);
  if v_used + p_increment > v_limit then
    raise exception using errcode = 'P0001', message = 'limit_reached',
      detail = json_build_object('key', p_key, 'limit', v_limit, 'used', v_used)::text;
  end if;
end
$$;

-- Límites aplicados por triggers: nadie puede saltárselos, ni las funciones privilegiadas.
create or replace function app.enforce_store_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_within_limit(new.organization_id, 'max_stores');
  return new;
end
$$;

create trigger stores_enforce_limit before insert on public.stores
  for each row execute function app.enforce_store_limit();

create or replace function app.enforce_staff_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    perform app.assert_within_limit(new.organization_id, 'max_staff');
  end if;
  return new;
end
$$;

create trigger organization_members_enforce_limit before insert or update of status
  on public.organization_members
  for each row execute function app.enforce_staff_limit();

-- -----------------------------------------------------------------------------
-- Privilegios: nada es ejecutable por PUBLIC; authenticated solo lo que usan las
-- políticas RLS. Las demás funciones solo se invocan desde funciones del mismo dueño.
-- -----------------------------------------------------------------------------
revoke all on function app.has_aal2() from public;
revoke all on function app.org_access_mode(uuid) from public;
revoke all on function app.has_store_permission(uuid, text) from public;
revoke all on function app.current_org_role(uuid) from public;
revoke all on function app.has_org_permission(uuid, text) from public;
revoke all on function app.is_platform_staff(text[]) from public;
revoke all on function app.require_aal2_user() from public;
revoke all on function app.require_platform_role(text[]) from public;
revoke all on function app.effective_limit(uuid, text) from public;
revoke all on function app.current_usage(uuid, text) from public;
revoke all on function app.assert_within_limit(uuid, text, integer) from public;
revoke all on function app.enforce_store_limit() from public;
revoke all on function app.enforce_staff_limit() from public;

grant execute on function app.has_aal2() to authenticated;
grant execute on function app.has_store_permission(uuid, text) to authenticated;
grant execute on function app.has_org_permission(uuid, text) to authenticated;
grant execute on function app.current_org_role(uuid) to authenticated;
