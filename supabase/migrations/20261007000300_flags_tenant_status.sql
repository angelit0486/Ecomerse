-- =============================================================================
-- Fase 2 · Feature flags y estado de tenant (F2-T04)
-- Contrato: GATE0 §9.2 (feature_flags, feature_flag_overrides), §7.2 (suspensión
--           de organización/tienda), §8.3 (platform.flags.manage,
--           platform.tenants.manage), §29 (eventos flag.* y tenant.*);
--           blueprint v0.1 §27.2 (orden de resolución, sin scope de usuario §46).
--
-- Entitlement = lo que el plan da (comercial). Flag = lo que está encendido
-- (técnico: lanzamiento gradual, kill switch). Un flag puede depender de un
-- entitlement, nunca al revés.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tablas (plano plataforma). Sin grants: se leen solo mediante funciones.
-- -----------------------------------------------------------------------------
create table public.feature_flags (
  key             text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  description     text not null check (char_length(btrim(description)) between 5 and 500),
  default_enabled boolean not null default false,
  kill_switch     boolean not null default false,
  entitlement_key text check (entitlement_key is null or app.entitlement_type(entitlement_key) = 'bool'),
  owner           text not null check (char_length(btrim(owner)) between 2 and 100),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger feature_flags_set_updated_at before update on public.feature_flags
  for each row execute function app.set_updated_at();

create table public.feature_flag_overrides (
  id         uuid primary key default app.uuid_v7(),
  flag_key   text not null references public.feature_flags (key) on delete cascade,
  scope      text not null check (scope in ('plan', 'organization', 'store')),
  scope_id   uuid not null,
  enabled    boolean not null,
  expires_at timestamptz,
  reason     text not null check (char_length(btrim(reason)) between 5 and 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (flag_key, scope, scope_id)
);

create index feature_flag_overrides_scope_idx on public.feature_flag_overrides (scope, scope_id);

create trigger feature_flag_overrides_set_updated_at before update on public.feature_flag_overrides
  for each row execute function app.set_updated_at();
create trigger feature_flag_overrides_immutable before update on public.feature_flag_overrides
  for each row execute function app.prevent_column_change('flag_key', 'scope', 'scope_id');

-- scope_id es polimórfico: se valida que el destino exista.
create or replace function app.feature_flag_overrides_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_exists boolean;
begin
  v_exists := case new.scope
    when 'plan' then exists (select 1 from public.plans p where p.id = new.scope_id)
    when 'organization' then exists (select 1 from public.organizations o where o.id = new.scope_id)
    when 'store' then exists (select 1 from public.stores s where s.id = new.scope_id)
    else false
  end;
  if not coalesce(v_exists, false) then
    raise exception using errcode = '23503', message = 'flag_override_target_missing';
  end if;
  return new;
end
$$;
revoke all on function app.feature_flag_overrides_validate() from public;

create trigger feature_flag_overrides_validate before insert on public.feature_flag_overrides
  for each row execute function app.feature_flag_overrides_validate();

alter table public.feature_flags enable row level security;
alter table public.feature_flags force row level security;
alter table public.feature_flag_overrides enable row level security;
alter table public.feature_flag_overrides force row level security;
revoke all on table public.feature_flags from public, anon, authenticated, service_role;
revoke all on table public.feature_flag_overrides from public, anon, authenticated, service_role;

-- Flags iniciales (blueprint v0.1 §27.2), todos apagados por defecto.
insert into public.feature_flags (key, description, entitlement_key, owner) values
  ('custom_domains', 'Dominios propios para la tienda', 'custom_domains', 'plataforma'),
  ('multi_warehouse', 'Varias ubicaciones de inventario', null, 'plataforma'),
  ('advanced_analytics', 'Analítica avanzada', 'advanced_analytics', 'plataforma'),
  ('api_access', 'Acceso a la API pública', 'api_access', 'plataforma'),
  ('abandoned_cart', 'Recuperación de carritos abandonados', 'abandoned_cart', 'plataforma'),
  ('digital_products', 'Productos digitales', null, 'plataforma'),
  ('stripe_provider', 'Proveedor de pagos Stripe', null, 'plataforma'),
  ('new_checkout', 'Checkout nuevo (lanzamiento gradual)', null, 'plataforma');

-- -----------------------------------------------------------------------------
-- Entitlement booleano efectivo: override vigente ▷ plan ▷ false (cerrado).
-- -----------------------------------------------------------------------------
create or replace function app.entitlement_enabled(p_org uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select o.value_bool from public.organization_entitlement_overrides o
      where o.organization_id = p_org and o.key = p_key
        and (o.expires_at is null or o.expires_at > now())),
    (select e.value_bool
       from public.subscriptions s
       join public.plan_entitlements e on e.plan_id = s.plan_id and e.key = p_key
      where s.organization_id = p_org and s.status <> 'cancelled'),
    false
  )
$$;
revoke all on function app.entitlement_enabled(uuid, text) from public;

-- -----------------------------------------------------------------------------
-- Resolución de un flag (blueprint §27.2):
--   1. inexistente o kill_switch → false
--   2. override de tienda  3. override de organización  4. override de plan
--   5. entitlement ligado   6. default_enabled
-- Los overrides caducados se ignoran. Sin tienda ni organización: global.
-- -----------------------------------------------------------------------------
create or replace function app.flag_enabled(p_key text, p_store_id uuid default null, p_org uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_flag  public.feature_flags;
  v_org   uuid := p_org;
  v_plan  uuid;
  v_value boolean;
begin
  select * into v_flag from public.feature_flags f where f.key = p_key;
  if v_flag.key is null or v_flag.kill_switch then
    return false;
  end if;

  if p_store_id is not null then
    select s.organization_id into v_org from public.stores s where s.id = p_store_id;
    select o.enabled into v_value from public.feature_flag_overrides o
     where o.flag_key = p_key and o.scope = 'store' and o.scope_id = p_store_id
       and (o.expires_at is null or o.expires_at > now());
    if v_value is not null then
      return v_value;
    end if;
  end if;

  if v_org is not null then
    select o.enabled into v_value from public.feature_flag_overrides o
     where o.flag_key = p_key and o.scope = 'organization' and o.scope_id = v_org
       and (o.expires_at is null or o.expires_at > now());
    if v_value is not null then
      return v_value;
    end if;

    select s.plan_id into v_plan from public.subscriptions s
     where s.organization_id = v_org and s.status <> 'cancelled';
    select o.enabled into v_value from public.feature_flag_overrides o
     where o.flag_key = p_key and o.scope = 'plan' and o.scope_id = v_plan
       and (o.expires_at is null or o.expires_at > now());
    if v_value is not null then
      return v_value;
    end if;

    if v_flag.entitlement_key is not null then
      return app.entitlement_enabled(v_org, v_flag.entitlement_key);
    end if;
  end if;

  return v_flag.default_enabled;
end
$$;
revoke all on function app.flag_enabled(text, uuid, uuid) from public;

-- Panel: flags resueltos de una tienda que el usuario puede ver.
create or replace function public.access_store_flags(p_store_id uuid)
returns table (key text, enabled boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_store_permission(p_store_id, 'store.read') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return query select f.key, app.flag_enabled(f.key, p_store_id) from public.feature_flags f order by f.key;
end
$$;

-- Storefront: flags resueltos de una tienda resuelta por host (solo booleanos).
create or replace function storefront.get_store_flags(p_store_id uuid)
returns table (key text, enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select f.key, app.flag_enabled(f.key, p_store_id)
    from public.feature_flags f
   where exists (select 1 from public.stores s where s.id = p_store_id and s.status <> 'closed')
   order by f.key
$$;

-- -----------------------------------------------------------------------------
-- Gestión de flags (platform.flags.manage = platform_owner, platform_admin).
-- -----------------------------------------------------------------------------
create or replace function public.platform_upsert_feature_flag(
  p_key             text,
  p_description     text,
  p_default_enabled boolean,
  p_owner           text,
  p_entitlement_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{1,62}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'key';
  end if;
  if p_entitlement_key is not null and app.entitlement_type(p_entitlement_key) is distinct from 'bool' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'entitlement_key';
  end if;
  if p_default_enabled is null or char_length(btrim(coalesce(p_description, ''))) not between 5 and 500
     or char_length(btrim(coalesce(p_owner, ''))) not between 2 and 100 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'flag';
  end if;

  select to_jsonb(f) - 'created_at' - 'updated_at' into v_before from public.feature_flags f where f.key = p_key;

  insert into public.feature_flags (key, description, default_enabled, owner, entitlement_key)
  values (p_key, btrim(p_description), p_default_enabled, btrim(p_owner), p_entitlement_key)
  on conflict (key) do update
    set description = excluded.description, default_enabled = excluded.default_enabled,
        owner = excluded.owner, entitlement_key = excluded.entitlement_key;

  perform audit.record('flag.changed', 'feature_flag', null, null, null, v_before,
                       jsonb_build_object('key', p_key, 'default_enabled', p_default_enabled,
                                          'entitlement_key', p_entitlement_key));
end
$$;

-- Apagado global de emergencia; exige motivo.
create or replace function public.platform_set_flag_kill_switch(p_key text, p_on boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  if p_on is null or char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reason';
  end if;
  update public.feature_flags set kill_switch = p_on where key = p_key;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'flag';
  end if;
  perform audit.record('flag.changed', 'feature_flag', null, null, null, null,
                       jsonb_build_object('key', p_key, 'kill_switch', p_on), btrim(p_reason));
end
$$;

create or replace function public.platform_set_flag_override(
  p_key        text,
  p_scope      text,
  p_scope_id   uuid,
  p_enabled    boolean,
  p_reason     text,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_role(array['platform_owner', 'platform_admin']);
  v_org   uuid;
  v_store uuid;
begin
  if not exists (select 1 from public.feature_flags f where f.key = p_key) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'flag';
  end if;
  if p_scope is null or p_scope not in ('plan', 'organization', 'store') or p_scope_id is null
     or p_enabled is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'scope';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reason';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'expires_at';
  end if;

  case p_scope
    when 'organization' then
      select o.id into v_org from public.organizations o where o.id = p_scope_id;
    when 'store' then
      select s.organization_id, s.id into v_org, v_store from public.stores s where s.id = p_scope_id;
    else
      null;
  end case;
  if (p_scope = 'plan' and not exists (select 1 from public.plans p where p.id = p_scope_id))
     or (p_scope <> 'plan' and v_org is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = p_scope;
  end if;

  insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, expires_at, reason, created_by)
  values (p_key, p_scope, p_scope_id, p_enabled, p_expires_at, btrim(p_reason), v_actor)
  on conflict (flag_key, scope, scope_id) do update
    set enabled = excluded.enabled, expires_at = excluded.expires_at, reason = excluded.reason,
        created_by = excluded.created_by;

  perform audit.record('override.created', 'feature_flag_override', null, v_org, v_store, null,
                       jsonb_build_object('key', p_key, 'scope', p_scope, 'scope_id', p_scope_id,
                                          'enabled', p_enabled, 'expires_at', p_expires_at),
                       btrim(p_reason));
end
$$;

create or replace function public.platform_delete_flag_override(p_key text, p_scope text, p_scope_id uuid,
                                                                p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.feature_flag_overrides;
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reason';
  end if;
  delete from public.feature_flag_overrides o
   where o.flag_key = p_key and o.scope = p_scope and o.scope_id = p_scope_id
  returning * into v_row;
  if v_row.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'override';
  end if;
  perform audit.record('override.deleted', 'feature_flag_override', v_row.id,
                       case p_scope when 'organization' then p_scope_id
                                    when 'store' then (select s.organization_id from public.stores s where s.id = p_scope_id)
                       end,
                       case when p_scope = 'store' then p_scope_id end,
                       jsonb_build_object('key', p_key, 'scope', p_scope, 'enabled', v_row.enabled), null,
                       btrim(p_reason));
end
$$;

-- -----------------------------------------------------------------------------
-- Estado de tenant (platform.tenants.manage). Sin p_store_id: organización
-- (active | suspended | closed). Con p_store_id: tienda (suspended | active).
-- - Cerrar es definitivo: la organización y todas sus tiendas pasan a closed.
-- - Reactivar una tienda nunca la publica: vuelve a paused si ya se lanzó (el
--   dueño decide cuándo reanudar) o a draft si no.
-- El efecto es inmediato: has_store_permission y storefront.resolve_host leen el
-- estado en vivo.
-- -----------------------------------------------------------------------------
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
end
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.access_store_flags(uuid) from public;
revoke all on function storefront.get_store_flags(uuid) from public;
revoke all on function public.platform_upsert_feature_flag(text, text, boolean, text, text) from public;
revoke all on function public.platform_set_flag_kill_switch(text, boolean, text) from public;
revoke all on function public.platform_set_flag_override(text, text, uuid, boolean, text, timestamptz) from public;
revoke all on function public.platform_delete_flag_override(text, text, uuid, text) from public;
revoke all on function public.platform_set_tenant_status(uuid, text, text, uuid) from public;

grant execute on function public.access_store_flags(uuid) to authenticated;
grant execute on function storefront.get_store_flags(uuid) to storefront_gateway;
grant execute on function public.platform_upsert_feature_flag(text, text, boolean, text, text) to authenticated;
grant execute on function public.platform_set_flag_kill_switch(text, boolean, text) to authenticated;
grant execute on function public.platform_set_flag_override(text, text, uuid, boolean, text, timestamptz) to authenticated;
grant execute on function public.platform_delete_flag_override(text, text, uuid, text) to authenticated;
grant execute on function public.platform_set_tenant_status(uuid, text, text, uuid) to authenticated;
