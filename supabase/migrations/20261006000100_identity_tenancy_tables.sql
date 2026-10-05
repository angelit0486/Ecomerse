-- =============================================================================
-- Fase 2 — Identity, Tenancy & Access · Tablas
-- Contrato: GATE0 §6 (Organization → Store), §7 (identidad), §8 (RBAC),
--           §9.2 (especificación por tabla), §13 (FK compuestas), §19 (SaaS), §20 (branding)
-- Decisiones de implementación: docs/DECISIONS.md (D-F2-xx)
--
-- Aquí solo se crean tablas, restricciones, índices y triggers de integridad.
-- RLS, grants y políticas: 20261006000400. Funciones RPC: 20261006000500.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Auxiliares de integridad
-- -----------------------------------------------------------------------------

-- Impide modificar las columnas indicadas como argumentos del trigger.
create or replace function app.prevent_column_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_col text;
begin
  foreach v_col in array tg_argv loop
    if (v_old -> v_col) is distinct from (v_new -> v_col) then
      raise exception using
        errcode = '42501',
        message = 'column_immutable',
        detail  = format('%I.%I.%I es inmutable', tg_table_schema, tg_table_name, v_col);
    end if;
  end loop;
  return new;
end
$$;

-- Handles reservados para subdominios y rutas de plataforma (GATE0 §22).
create or replace function app.is_reserved_handle(p_handle text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(p_handle) = any (array[
    'www', 'app', 'admin', 'api', 'platform', 'plataforma', 'console', 'dashboard', 'panel',
    'mail', 'email', 'smtp', 'imap', 'pop', 'mx', 'ns1', 'ns2', 'static', 'assets', 'cdn', 'img',
    'images', 'media', 'files', 'help', 'ayuda', 'soporte', 'support', 'status', 'blog', 'docs',
    'm', 'shop', 'store', 'tienda', 'tiendas', 'test', 'staging', 'dev', 'preview', 'auth',
    'login', 'signin', 'signup', 'account', 'cuenta', 'billing', 'pagos', 'payments', 'checkout',
    'security', 'seguridad', 'root', 'system', 'internal', 'webhooks', 'oauth', 'sso'
  ])
$$;

-- Validación estructural de los tokens de marca (GATE0 §20.2). El contraste se
-- valida en el servidor antes de publicar (src/lib/color/contrast.ts).
create or replace function app.theme_settings_valid(p_settings jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    return false;
  end if;
  for v_key, v_value in select * from jsonb_each(p_settings) loop
    if v_key = 'colors' then
      if jsonb_typeof(v_value) <> 'object' then return false; end if;
      if exists (
        select 1 from jsonb_each(v_value) c
         where c.key not in ('primary', 'accent', 'background', 'foreground', 'muted')
            or jsonb_typeof(c.value) <> 'string'
            or (c.value #>> '{}') !~ '^#[0-9a-f]{6}$'
      ) then return false; end if;
    elsif v_key = 'typography' then
      if jsonb_typeof(v_value) <> 'object' then return false; end if;
      if exists (
        select 1 from jsonb_each(v_value) t
         where t.key not in ('heading', 'body')
            or jsonb_typeof(t.value) <> 'string'
            or (t.value #>> '{}') !~ '^[a-z0-9-]{1,40}$'
      ) then return false; end if;
    elsif v_key = 'shape' then
      if jsonb_typeof(v_value) <> 'object' then return false; end if;
      if exists (
        select 1 from jsonb_each(v_value) s
         where not (
           (s.key = 'radius' and (s.value #>> '{}') in ('none', 'sm', 'md', 'full'))
           or (s.key = 'button_style' and (s.value #>> '{}') in ('solid', 'outline'))
         )
      ) then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
end
$$;

-- Registro de claves de entitlements (GATE0 §19.2): 'int', 'bool' o NULL (desconocida).
create or replace function app.entitlement_type(p_key text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_key in ('max_stores', 'max_products', 'max_variants_per_product', 'max_staff',
                   'max_locations', 'max_custom_domains', 'storage_mb') then 'int'
    when p_key in ('advanced_analytics', 'abandoned_cart', 'custom_roles', 'api_access',
                   'remove_platform_branding', 'custom_domains') then 'bool'
  end
$$;

revoke all on function app.prevent_column_change() from public;
revoke all on function app.is_reserved_handle(text) from public;
revoke all on function app.theme_settings_valid(jsonb) from public;
revoke all on function app.entitlement_type(text) from public;

-- =============================================================================
-- PLANO PLATAFORMA
-- =============================================================================

-- profiles: 1:1 con auth.users. Sin datos de tenant.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (full_name is null or char_length(btrim(full_name)) between 1 and 120),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 300),
  locale      text not null default 'es-MX' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end
$$;
revoke all on function app.handle_new_user() from public;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- platform_staff: plano de plataforma, separado de los tenants (GATE0 §7.6).
create table public.platform_staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('platform_owner', 'platform_admin', 'platform_support')),
  status     text not null default 'active' check (status in ('active', 'suspended')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger platform_staff_set_updated_at before update on public.platform_staff
  for each row execute function app.set_updated_at();

-- Planes y entitlements (GATE0 §19). Los datos comerciales se cargan por la
-- consola de plataforma (Fase 10) o por runbook; ninguna migración inventa planes.
create table public.plans (
  id         uuid primary key default app.uuid_v7(),
  key        text not null unique check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  status     text not null default 'active' check (status in ('active', 'legacy', 'hidden')),
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger plans_set_updated_at before update on public.plans
  for each row execute function app.set_updated_at();

create table public.plan_entitlements (
  plan_id    uuid not null references public.plans (id) on delete cascade,
  key        text not null check (app.entitlement_type(key) is not null),
  value_int  integer check (value_int is null or value_int >= 0),
  value_bool boolean,
  primary key (plan_id, key),
  constraint plan_entitlements_value_matches_type check (
    (app.entitlement_type(key) = 'int'  and value_int  is not null and value_bool is null) or
    (app.entitlement_type(key) = 'bool' and value_bool is not null and value_int  is null)
  )
);

-- =============================================================================
-- PLANO TENANT · ORGANIZACIÓN
-- =============================================================================

-- El dueño NO se guarda aquí: es el único organization_members con rol org_owner
-- (D-F2-02: una sola fuente de verdad, sin dependencia circular).
create table public.organizations (
  id            uuid primary key default app.uuid_v7(),
  name          text not null check (char_length(btrim(name)) between 1 and 120),
  slug          text not null unique
                check (slug = lower(slug) and slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  status        text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  billing_email text check (billing_email is null or (billing_email = lower(billing_email)
                  and char_length(billing_email) <= 254 and billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  country       char(2) not null check (country ~ '^[A-Z]{2}$'),
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint organizations_closed_consistency check ((status = 'closed') = (closed_at is not null))
);

create index organizations_status_idx on public.organizations (status);

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function app.set_updated_at();

create table public.organization_members (
  id              uuid primary key default app.uuid_v7(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null check (role in ('org_owner', 'org_admin', 'org_member')),
  status          text not null default 'active' check (status in ('active', 'suspended')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id),
  constraint organization_members_owner_active check (role <> 'org_owner' or status = 'active')
);

-- Exactamente un dueño por organización.
create unique index organization_members_one_owner_uq
  on public.organization_members (organization_id) where role = 'org_owner';
create index organization_members_user_idx
  on public.organization_members (user_id, status, organization_id);

create trigger organization_members_set_updated_at before update on public.organization_members
  for each row execute function app.set_updated_at();
create trigger organization_members_prevent_tenant_change before update on public.organization_members
  for each row execute function app.prevent_tenant_change();
create trigger organization_members_immutable before update on public.organization_members
  for each row execute function app.prevent_column_change('user_id');

create table public.subscriptions (
  id                       uuid primary key default app.uuid_v7(),
  organization_id          uuid not null references public.organizations (id) on delete restrict,
  plan_id                  uuid not null references public.plans (id) on delete restrict,
  status                   text not null
                           check (status in ('trialing', 'active', 'past_due', 'paused', 'cancelled')),
  current_period_start     timestamptz not null default now(),
  current_period_end       timestamptz,
  trial_ends_at            timestamptz,
  grace_ends_at            timestamptz,
  provider                 text check (provider is null or provider in ('stripe', 'mercadopago', 'manual')),
  provider_customer_id     text,
  provider_subscription_id text,
  notes                    text check (notes is null or char_length(notes) <= 2000),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint subscriptions_trial_has_end check (status <> 'trialing' or trial_ends_at is not null),
  constraint subscriptions_past_due_has_grace check (status <> 'past_due' or grace_ends_at is not null)
);

-- Una suscripción vigente por organización.
create unique index subscriptions_current_uq
  on public.subscriptions (organization_id) where status <> 'cancelled';

create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function app.set_updated_at();
create trigger subscriptions_prevent_tenant_change before update on public.subscriptions
  for each row execute function app.prevent_tenant_change();

create table public.organization_entitlement_overrides (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  key             text not null check (app.entitlement_type(key) is not null),
  value_int       integer check (value_int is null or value_int >= 0),
  value_bool      boolean,
  reason          text not null check (char_length(btrim(reason)) between 5 and 500),
  expires_at      timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (organization_id, key),
  constraint overrides_value_matches_type check (
    (app.entitlement_type(key) = 'int'  and value_int  is not null and value_bool is null) or
    (app.entitlement_type(key) = 'bool' and value_bool is not null and value_int  is null)
  )
);

create trigger overrides_prevent_tenant_change before update on public.organization_entitlement_overrides
  for each row execute function app.prevent_tenant_change();

-- =============================================================================
-- PLANO TENANT · TIENDA
-- =============================================================================

create table public.stores (
  id                      uuid primary key default app.uuid_v7(),
  organization_id         uuid not null references public.organizations (id) on delete restrict,
  name                    text not null check (char_length(btrim(name)) between 1 and 120),
  handle                  text not null unique check (
                            handle = lower(handle)
                            and handle ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'
                            and handle !~ '--'
                            and not app.is_reserved_handle(handle)
                          ),
  status                  text not null default 'draft'
                          check (status in ('draft', 'active', 'paused', 'suspended', 'closed')),
  currency                char(3) not null check (currency ~ '^[A-Z]{3}$'),
  country                 char(2) not null check (country ~ '^[A-Z]{2}$'),
  timezone                text not null check (char_length(timezone) between 1 and 64),
  locale                  text not null default 'es-MX' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  prices_include_tax      boolean not null default true,
  tax_rate_bps            integer not null default 0 check (tax_rate_bps between 0 and 10000),
  tax_applies_to_shipping boolean not null default true,
  order_number_prefix     text not null default '#' check (char_length(order_number_prefix) <= 8),
  order_number_start      bigint not null default 1001 check (order_number_start between 1 and 999999999),
  contact_email           text check (contact_email is null or (contact_email = lower(contact_email)
                            and char_length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  contact_phone           text check (contact_phone is null or char_length(contact_phone) <= 32),
  legal_name              text check (legal_name is null or char_length(legal_name) <= 200),
  tax_id                  text check (tax_id is null or char_length(tax_id) <= 32),
  launched_at             timestamptz,
  closed_at               timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (organization_id, id),
  constraint stores_closed_consistency check ((status = 'closed') = (closed_at is not null)),
  constraint stores_active_was_launched check (status <> 'active' or launched_at is not null)
);

create index stores_organization_idx on public.stores (organization_id);

-- Zona horaria válida (IANA) y moneda inmutable tras el lanzamiento.
create or replace function app.stores_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception using errcode = '23514', message = 'invalid_timezone';
  end if;
  if tg_op = 'UPDATE' and old.launched_at is not null and new.currency <> old.currency then
    raise exception using errcode = '42501', message = 'column_immutable',
      detail = 'currency es inmutable tras el lanzamiento';
  end if;
  return new;
end
$$;
revoke all on function app.stores_validate() from public;

create trigger stores_validate before insert or update on public.stores
  for each row execute function app.stores_validate();
create trigger stores_set_updated_at before update on public.stores
  for each row execute function app.set_updated_at();
create trigger stores_prevent_tenant_change before update on public.stores
  for each row execute function app.prevent_tenant_change();
create trigger stores_immutable before update on public.stores
  for each row execute function app.prevent_column_change('handle');

-- Catálogo de permisos (fuente: código; sembrado más abajo).
create table public.permissions (
  key              text primary key check (key ~ '^[a-z]+(\.[a-z_]+)+$'),
  module           text not null,
  kind             text not null check (kind in ('read', 'write', 'operational')),
  sensitive        boolean not null default false,
  support_readable boolean not null default false,
  description      text not null,
  constraint permissions_support_readable_is_safe
    check (not support_readable or (kind = 'read' and not sensitive))
);

-- Roles de tienda. MVP: solo roles del sistema (organization_id NULL).
-- P2: roles personalizados por organización (GATE0 §8.4).
create table public.roles (
  id              uuid primary key default app.uuid_v7(),
  key             text not null check (key ~ '^[a-z][a-z_]{1,40}$'),
  scope           text not null default 'store' check (scope = 'store'),
  organization_id uuid references public.organizations (id) on delete cascade,
  name            text not null,
  is_system       boolean not null default false,
  -- Jerarquía para impedir asignar un rol igual o superior al propio (GATE0 §8.3).
  rank            integer not null check (rank between 1 and 100),
  created_at      timestamptz not null default now(),
  constraint roles_system_has_no_org check (is_system = (organization_id is null))
);

create unique index roles_key_uq
  on public.roles (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create table public.role_permissions (
  role_id        uuid not null references public.roles (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key),
  -- Los permisos de organización nunca se asignan por tienda.
  constraint role_permissions_no_org_permissions check (permission_key !~ '^org\.')
);

create table public.store_members (
  id         uuid primary key default app.uuid_v7(),
  store_id   uuid not null references public.stores (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role_id    uuid not null references public.roles (id) on delete restrict,
  status     text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, user_id),
  unique (store_id, id)
);

create index store_members_user_idx on public.store_members (user_id, status, store_id);

-- Un miembro de tienda debe pertenecer a la organización dueña de la tienda, y el
-- rol debe ser del sistema o de esa misma organización.
create or replace function app.store_members_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select s.organization_id into v_org from public.stores s where s.id = new.store_id;
  if not exists (
    select 1 from public.organization_members m
     where m.organization_id = v_org and m.user_id = new.user_id
  ) then
    raise exception using errcode = '23514', message = 'store_member_not_in_organization';
  end if;
  if not exists (
    select 1 from public.roles r
     where r.id = new.role_id and (r.organization_id is null or r.organization_id = v_org)
  ) then
    raise exception using errcode = '23514', message = 'role_not_available';
  end if;
  return new;
end
$$;
revoke all on function app.store_members_validate() from public;

create trigger store_members_validate before insert or update on public.store_members
  for each row execute function app.store_members_validate();
create trigger store_members_set_updated_at before update on public.store_members
  for each row execute function app.set_updated_at();
create trigger store_members_prevent_tenant_change before update on public.store_members
  for each row execute function app.prevent_tenant_change();
create trigger store_members_immutable before update on public.store_members
  for each row execute function app.prevent_column_change('user_id');

-- Dominios: hostname único global = única fuente de host → tienda (GATE0 §21.1).
create table public.store_domains (
  id                      uuid primary key default app.uuid_v7(),
  store_id                uuid not null references public.stores (id) on delete cascade,
  hostname                text not null unique check (
                            hostname = lower(hostname)
                            and char_length(hostname) <= 253
                            and hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
                          ),
  type                    text not null check (type in ('platform_subdomain', 'custom')),
  status                  text not null default 'pending'
                          check (status in ('pending', 'verifying', 'active', 'failed', 'removed')),
  is_primary              boolean not null default false,
  verification_token_hash bytea,
  verified_at             timestamptz,
  last_checked_at         timestamptz,
  provider_ref            text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (store_id, id),
  constraint store_domains_primary_is_active check (not is_primary or status = 'active')
);

create unique index store_domains_one_primary_uq on public.store_domains (store_id) where is_primary;
create index store_domains_store_idx on public.store_domains (store_id);

create trigger store_domains_set_updated_at before update on public.store_domains
  for each row execute function app.set_updated_at();
create trigger store_domains_prevent_tenant_change before update on public.store_domains
  for each row execute function app.prevent_tenant_change();
create trigger store_domains_immutable before update on public.store_domains
  for each row execute function app.prevent_column_change('hostname', 'type');

-- Contadores por tienda (número de pedido). Solo accesible por funciones.
create table public.store_counters (
  store_id uuid not null references public.stores (id) on delete cascade,
  key      text not null check (key in ('order_number')),
  value    bigint not null check (value >= 0),
  primary key (store_id, key)
);

create trigger store_counters_prevent_tenant_change before update on public.store_counters
  for each row execute function app.prevent_tenant_change();

-- Branding por tienda (GATE0 §20). Se adelanta desde la Fase 5 (D-F2-05): tokens
-- validados en borrador y publicados. El logo llega con el pipeline de medios (Fase 3).
create table public.store_themes (
  store_id            uuid primary key references public.stores (id) on delete cascade,
  theme_key           text not null default 'base' check (theme_key ~ '^[a-z][a-z0-9_]{1,30}$'),
  theme_version       integer not null default 1 check (theme_version >= 1),
  settings            jsonb not null default '{}'::jsonb check (app.theme_settings_valid(settings)),
  draft_settings      jsonb check (draft_settings is null or app.theme_settings_valid(draft_settings)),
  home_sections       jsonb not null default '[]'::jsonb check (jsonb_typeof(home_sections) = 'array'),
  draft_home_sections jsonb check (draft_home_sections is null or jsonb_typeof(draft_home_sections) = 'array'),
  published_at        timestamptz,
  published_by        uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger store_themes_set_updated_at before update on public.store_themes
  for each row execute function app.set_updated_at();
create trigger store_themes_prevent_tenant_change before update on public.store_themes
  for each row execute function app.prevent_tenant_change();

-- Compradores: plano Comprador, uno por tienda (GATE0 §7.4). Se adelanta desde la
-- Fase 6 (D-F2-06) para fijar desde ya la separación comprador ↔ staff.
create table public.customers (
  id                       uuid primary key default app.uuid_v7(),
  store_id                 uuid not null references public.stores (id) on delete restrict,
  user_id                  uuid references auth.users (id) on delete set null,
  email                    text not null check (email = lower(email) and char_length(email) <= 254
                             and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  first_name               text check (first_name is null or char_length(first_name) <= 80),
  last_name                text check (last_name is null or char_length(last_name) <= 80),
  phone                    text check (phone is null or char_length(phone) <= 32),
  accepts_marketing        boolean not null default false,
  marketing_consent_at     timestamptz,
  marketing_consent_source text check (marketing_consent_source is null or char_length(marketing_consent_source) <= 50),
  orders_count             integer not null default 0 check (orders_count >= 0),
  total_spent              bigint not null default 0 check (total_spent >= 0),
  note                     text check (note is null or char_length(note) <= 2000),
  anonymized_at            timestamptz,
  deleted_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, email),
  constraint customers_marketing_consent check (not accepts_marketing or marketing_consent_at is not null)
);

create unique index customers_store_user_uq on public.customers (store_id, user_id) where user_id is not null;
create index customers_store_created_idx on public.customers (store_id, created_at desc);
create index customers_user_idx on public.customers (user_id) where user_id is not null;

create trigger customers_set_updated_at before update on public.customers
  for each row execute function app.set_updated_at();
create trigger customers_prevent_tenant_change before update on public.customers
  for each row execute function app.prevent_tenant_change();

-- Invitaciones. El token NUNCA se guarda en claro: solo su SHA-256 (D-F2-03).
-- FK compuesta (organization_id, store_id): la tienda pertenece a la organización.
create table public.organization_invitations (
  id              uuid primary key default app.uuid_v7(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  store_id        uuid,
  email           text not null check (email = lower(email) and char_length(email) <= 254
                    and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  org_role        text check (org_role in ('org_owner', 'org_admin', 'org_member')),
  store_role_id   uuid references public.roles (id) on delete restrict,
  token_hash      bytea unique,
  token_issued_at timestamptz,
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid references auth.users (id) on delete set null,
  revoked_at      timestamptz,
  invited_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (organization_id, store_id) references public.stores (organization_id, id) on delete cascade,
  constraint invitations_exactly_one_role check ((org_role is null) <> (store_role_id is null)),
  constraint invitations_store_role_needs_store check ((store_role_id is null) = (store_id is null)),
  constraint invitations_not_both_closed check (accepted_at is null or revoked_at is null)
);

create unique index invitations_pending_uq on public.organization_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

create trigger invitations_set_updated_at before update on public.organization_invitations
  for each row execute function app.set_updated_at();
create trigger invitations_prevent_tenant_change before update on public.organization_invitations
  for each row execute function app.prevent_tenant_change();
create trigger invitations_immutable before update on public.organization_invitations
  for each row execute function app.prevent_column_change('email', 'org_role', 'store_role_id', 'invited_by');

-- Concesiones de soporte de plataforma (GATE0 §7.7, CF-08): solo lectura,
-- ≤ 60 min, motivo obligatorio, sin autoconcesión.
create table public.support_access_grants (
  id              uuid primary key default app.uuid_v7(),
  organization_id uuid not null,
  store_id        uuid not null,
  grantee_user_id uuid not null references auth.users (id) on delete cascade,
  granted_by      uuid not null references auth.users (id) on delete restrict,
  reason          text not null check (char_length(btrim(reason)) between 20 and 1000),
  ticket_ref      text check (ticket_ref is null or char_length(ticket_ref) <= 100),
  scope           text not null default 'read' check (scope = 'read'),
  starts_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  revoked_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, store_id) references public.stores (organization_id, id) on delete cascade,
  constraint support_grants_no_self_grant check (grantee_user_id <> granted_by),
  constraint support_grants_max_60_minutes
    check (expires_at > starts_at and expires_at <= starts_at + interval '60 minutes')
);

create index support_grants_lookup_idx
  on public.support_access_grants (grantee_user_id, store_id, expires_at);

create trigger support_grants_prevent_tenant_change before update on public.support_access_grants
  for each row execute function app.prevent_tenant_change();
create trigger support_grants_immutable before update on public.support_access_grants
  for each row execute function app.prevent_column_change(
    'grantee_user_id', 'granted_by', 'reason', 'ticket_ref', 'scope', 'starts_at', 'expires_at'
  );

-- La cola de jobs ya puede referenciar tiendas (pendiente desde la Fase 1).
alter table system.jobs
  add constraint jobs_store_fk foreign key (store_id) references public.stores (id) on delete cascade;

-- =============================================================================
-- Semilla del catálogo de permisos y roles del sistema (GATE0 §8.2, §8.3).
-- Fuente de verdad: este bloque; el espejo en TypeScript se valida con una prueba.
-- =============================================================================
insert into public.permissions (key, module, kind, sensitive, support_readable, description) values
  ('store.read',                 'store',      'read',        false, true,  'Ver la tienda y su configuración'),
  ('store.update',               'store',      'write',       false, false, 'Editar datos generales de la tienda'),
  ('staff.read',                 'staff',      'read',        false, true,  'Ver el equipo de la tienda'),
  ('staff.manage',               'staff',      'write',       false, false, 'Invitar y gestionar miembros (roles inferiores)'),
  ('products.read',              'catalog',    'read',        false, true,  'Ver productos'),
  ('products.create',            'catalog',    'write',       false, false, 'Crear productos'),
  ('products.update',            'catalog',    'write',       false, false, 'Editar productos'),
  ('products.publish',           'catalog',    'write',       false, false, 'Publicar productos'),
  ('products.delete',            'catalog',    'write',       false, false, 'Eliminar (archivar) productos'),
  ('products.cost.read',         'catalog',    'read',        true,  false, 'Ver costos'),
  ('categories.manage',          'catalog',    'write',       false, false, 'Gestionar categorías'),
  ('brands.manage',              'catalog',    'write',       false, false, 'Gestionar marcas'),
  ('inventory.read',             'inventory',  'read',        false, true,  'Ver inventario'),
  ('inventory.adjust',           'inventory',  'write',       false, false, 'Ajustar inventario'),
  ('inventory.locations.manage', 'inventory',  'write',       false, false, 'Gestionar ubicaciones'),
  ('orders.read',                'orders',     'read',        false, true,  'Ver pedidos'),
  ('orders.update',              'orders',     'write',       false, false, 'Editar pedidos (notas, contacto)'),
  ('orders.fulfill',             'orders',     'operational', false, false, 'Surtir y enviar pedidos'),
  ('orders.cancel',              'orders',     'operational', false, false, 'Cancelar pedidos'),
  ('orders.refund',              'orders',     'operational', false, false, 'Reembolsar pedidos'),
  ('customers.read',             'customers',  'read',        false, true,  'Ver clientes (datos enmascarados)'),
  ('customers.pii.read',         'customers',  'read',        true,  false, 'Ver datos personales completos de clientes'),
  ('customers.update',           'customers',  'write',       false, false, 'Editar clientes'),
  ('customers.delete',           'customers',  'write',       false, false, 'Anonimizar clientes'),
  ('discounts.read',             'marketing',  'read',        false, true,  'Ver descuentos'),
  ('discounts.manage',           'marketing',  'write',       false, false, 'Gestionar descuentos'),
  ('payments.read',              'payments',   'read',        true,  false, 'Ver pagos'),
  ('payments.manage',            'payments',   'write',       false, false, 'Gestionar cuentas de pago'),
  ('shipping.manage',            'settings',   'write',       false, false, 'Gestionar envíos'),
  ('taxes.manage',               'settings',   'write',       false, false, 'Gestionar impuestos'),
  ('appearance.manage',          'appearance', 'write',       false, false, 'Gestionar apariencia'),
  ('content.manage',             'appearance', 'write',       false, false, 'Gestionar páginas y menús'),
  ('seo.manage',                 'appearance', 'write',       false, false, 'Gestionar SEO'),
  ('domains.manage',             'settings',   'write',       false, false, 'Gestionar dominios'),
  ('analytics.read',             'analytics',  'read',        false, true,  'Ver analítica'),
  ('imports.run',                'imports',    'write',       false, false, 'Importar datos'),
  ('exports.run',                'imports',    'read',        true,  false, 'Exportar datos'),
  ('notifications.manage',       'settings',   'write',       false, false, 'Gestionar notificaciones'),
  ('audit.read',                 'audit',      'read',        true,  false, 'Ver el registro de actividad'),
  ('org.read',                   'org',        'read',        false, false, 'Ver la organización'),
  ('org.update',                 'org',        'write',       false, false, 'Editar la organización'),
  ('org.members.manage',         'org',        'write',       false, false, 'Gestionar miembros de la organización'),
  ('org.stores.create',          'org',        'write',       false, false, 'Crear tiendas'),
  ('org.billing.read',           'org',        'read',        true,  false, 'Ver facturación del SaaS'),
  ('org.billing.manage',         'org',        'write',       false, false, 'Gestionar facturación del SaaS'),
  ('org.delete',                 'org',        'write',       false, false, 'Cerrar la organización'),
  ('org.transfer_ownership',     'org',        'write',       false, false, 'Transferir la propiedad');

insert into public.roles (key, name, is_system, rank) values
  ('store_admin',       'Administrador de tienda', true, 90),
  ('catalog_manager',   'Catálogo',                true, 50),
  ('inventory_manager', 'Inventario',              true, 50),
  ('order_manager',     'Pedidos',                 true, 50),
  ('marketing_manager', 'Marketing',               true, 50),
  ('support_agent',     'Atención a clientes',     true, 30),
  ('viewer',            'Solo lectura',            true, 10);

-- store_admin: todos los permisos de tienda.
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p
 where r.key = 'store_admin' and r.organization_id is null and p.module <> 'org';

insert into public.role_permissions (role_id, permission_key)
select r.id, m.permission_key
  from public.roles r
  join (values
    ('catalog_manager', 'store.read'), ('catalog_manager', 'products.read'),
    ('catalog_manager', 'products.create'), ('catalog_manager', 'products.update'),
    ('catalog_manager', 'products.publish'), ('catalog_manager', 'products.delete'),
    ('catalog_manager', 'products.cost.read'), ('catalog_manager', 'categories.manage'),
    ('catalog_manager', 'brands.manage'), ('catalog_manager', 'inventory.read'),
    ('catalog_manager', 'analytics.read'), ('catalog_manager', 'imports.run'),
    ('catalog_manager', 'exports.run'),

    ('inventory_manager', 'store.read'), ('inventory_manager', 'products.read'),
    ('inventory_manager', 'products.cost.read'), ('inventory_manager', 'inventory.read'),
    ('inventory_manager', 'inventory.adjust'), ('inventory_manager', 'inventory.locations.manage'),
    ('inventory_manager', 'orders.read'), ('inventory_manager', 'analytics.read'),
    ('inventory_manager', 'imports.run'), ('inventory_manager', 'exports.run'),

    ('order_manager', 'store.read'), ('order_manager', 'products.read'),
    ('order_manager', 'inventory.read'), ('order_manager', 'orders.read'),
    ('order_manager', 'orders.update'), ('order_manager', 'orders.fulfill'),
    ('order_manager', 'orders.cancel'), ('order_manager', 'orders.refund'),
    ('order_manager', 'customers.read'), ('order_manager', 'customers.pii.read'),
    ('order_manager', 'customers.update'), ('order_manager', 'discounts.read'),
    ('order_manager', 'payments.read'), ('order_manager', 'analytics.read'),
    ('order_manager', 'exports.run'),

    ('marketing_manager', 'store.read'), ('marketing_manager', 'products.read'),
    ('marketing_manager', 'customers.read'), ('marketing_manager', 'discounts.read'),
    ('marketing_manager', 'discounts.manage'), ('marketing_manager', 'appearance.manage'),
    ('marketing_manager', 'content.manage'), ('marketing_manager', 'seo.manage'),
    ('marketing_manager', 'analytics.read'),

    ('support_agent', 'store.read'), ('support_agent', 'products.read'),
    ('support_agent', 'inventory.read'), ('support_agent', 'orders.read'),
    ('support_agent', 'customers.read'), ('support_agent', 'customers.pii.read'),
    ('support_agent', 'customers.update'), ('support_agent', 'discounts.read'),

    ('viewer', 'store.read'), ('viewer', 'products.read'), ('viewer', 'inventory.read'),
    ('viewer', 'orders.read'), ('viewer', 'customers.read'), ('viewer', 'discounts.read'),
    ('viewer', 'analytics.read')
  ) as m (role_key, permission_key) on m.role_key = r.key
 where r.organization_id is null;
