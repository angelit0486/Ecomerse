-- =============================================================================
-- Promociones automáticas y mayoreo — datos, permisos, auditoría y límites del
-- plan (ADR-070; diseño y decisiones del propietario del 2026-11-25 en
-- docs/plan/PROPUESTA-PROMOCIONES-MAYOREO.md).
--
-- * promotions: una oferta automática de la tienda (sin código). Tipos v1:
--     volume       — mayoreo por cantidad, 1 a 5 escalones por producto;
--     buy_n_pay_m  — lleva N y paga M (3×2, 2×1);
--     nth_percent  — la N-ésima pieza con X % de descuento («2.ª al 50 %»).
--   Reglas en `rules` (jsonb validado por app.promotion_rules_valid).
-- * promotion_targets: productos o categorías a los que aplica (alcance
--   `products` / `categories`; `store` = toda la tienda, sin filas).
-- * order_promotions: lo que cada pedido recibió, por partida, con copia de la
--   regla (append-only, como order_events).
-- * orders.promotion_total y order_items.promotion_allocation: la parte de
--   discount_total / discount_allocation que viene de promociones (el resto es
--   el cupón). Los CHECK de totales existentes no cambian.
-- * discounts.combines_with_promotions: el cupón se suma a las promociones solo
--   si la tienda lo marca (decisión del propietario: por omisión, no).
-- * Límite del plan `max_active_promotions` (Tienda 5; Tienda Plus sin tope
--   práctico) y función `promotion_reports` (reporte completo, Tienda Plus).
--   Como toda clave de límite, ausente = 0: hasta que la consola guarde el valor
--   en cada plan, ninguna tienda puede ACTIVAR promociones (cerrado por omisión,
--   GATE0 §19.3). Valores en docs/runbooks/precios-aprobados-2026-11.md.
-- * Permisos: los de cupones (`discounts.read` / `discounts.manage`, área
--   marketing), que ya tienen los mismos roles. Sin permisos nuevos.
--
-- El cálculo (motor y su uso en el carrito y en place_order) está en
-- 20261125000200_promotion_engine.sql. Aditiva: solo tablas, columnas y
-- funciones nuevas o reemplazadas con la misma firma. Reversa:
-- scripts/ops/reversa/20261125000100_promotions.reversa.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Claves del plan
-- -----------------------------------------------------------------------------
create or replace function app.entitlement_type(p_key text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_key in ('max_stores', 'max_products', 'max_variants_per_product', 'max_staff',
                   'max_locations', 'max_custom_domains', 'storage_mb', 'max_active_promotions') then 'int'
    when p_key in ('advanced_analytics', 'abandoned_cart', 'custom_roles', 'api_access',
                   'remove_platform_branding', 'custom_domains', 'promotion_reports') then 'bool'
  end
$$;
revoke all on function app.entitlement_type(text) from public;

-- -----------------------------------------------------------------------------
-- 2. Cupones: ¿se suman a las promociones?
-- -----------------------------------------------------------------------------
alter table public.discounts add column combines_with_promotions boolean not null default false;

-- -----------------------------------------------------------------------------
-- 3. Promociones
-- -----------------------------------------------------------------------------
-- Reglas por tipo (dinero en centavos, porcentajes en puntos base):
--   volume:      {"mode":"unit_price"|"percent","tiers":[{"min_qty":5,"value":8500}, …]}
--                1..5 escalones, min_qty ≥ 2 y creciente; el valor baja (precio)
--                o sube (porcentaje 1..9999) con cada escalón.
--   buy_n_pay_m: {"buy":3,"pay":2}            2 ≤ buy ≤ 20, 1 ≤ pay < buy
--   nth_percent: {"nth":2,"percent_bps":5000} 2 ≤ nth ≤ 20, 1 ≤ percent_bps ≤ 10000
create or replace function app.promotion_rules_valid(p_type text, p_rules jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tier  jsonb;
  v_prev  jsonb;
  v_n     integer;
  v_mode  text;
begin
  if jsonb_typeof(p_rules) is distinct from 'object' then
    return false;
  end if;
  case p_type
    when 'volume' then
      v_mode := p_rules ->> 'mode';
      if v_mode is null or v_mode not in ('unit_price', 'percent')
         or jsonb_typeof(p_rules -> 'tiers') is distinct from 'array'
         or (select count(*) from jsonb_object_keys(p_rules) k where k not in ('mode', 'tiers')) > 0 then
        return false;
      end if;
      v_n := jsonb_array_length(p_rules -> 'tiers');
      if v_n not between 1 and 5 then
        return false;
      end if;
      for v_tier in select t from jsonb_array_elements(p_rules -> 'tiers') t loop
        if jsonb_typeof(v_tier) is distinct from 'object'
           or jsonb_typeof(v_tier -> 'min_qty') is distinct from 'number'
           or jsonb_typeof(v_tier -> 'value') is distinct from 'number'
           or (select count(*) from jsonb_object_keys(v_tier) k where k not in ('min_qty', 'value')) > 0
           or (v_tier ->> 'min_qty') !~ '^\d{1,3}$' or (v_tier ->> 'value') !~ '^\d{1,12}$'
           or (v_tier ->> 'min_qty')::integer < 2
           or (v_mode = 'unit_price' and (v_tier ->> 'value')::bigint < 1)
           or (v_mode = 'percent' and (v_tier ->> 'value')::bigint not between 1 and 9999) then
          return false;
        end if;
        if v_prev is not null and (
             (v_tier ->> 'min_qty')::integer <= (v_prev ->> 'min_qty')::integer
             or (v_mode = 'unit_price' and (v_tier ->> 'value')::bigint >= (v_prev ->> 'value')::bigint)
             or (v_mode = 'percent' and (v_tier ->> 'value')::bigint <= (v_prev ->> 'value')::bigint)) then
          return false;
        end if;
        v_prev := v_tier;
      end loop;
      return true;
    when 'buy_n_pay_m' then
      return (select count(*) from jsonb_object_keys(p_rules) k where k not in ('buy', 'pay')) = 0
         and coalesce(p_rules ->> 'buy', '') ~ '^\d{1,2}$' and coalesce(p_rules ->> 'pay', '') ~ '^\d{1,2}$'
         and jsonb_typeof(p_rules -> 'buy') = 'number' and jsonb_typeof(p_rules -> 'pay') = 'number'
         and (p_rules ->> 'buy')::integer between 2 and 20
         and (p_rules ->> 'pay')::integer between 1 and (p_rules ->> 'buy')::integer - 1;
    when 'nth_percent' then
      return (select count(*) from jsonb_object_keys(p_rules) k where k not in ('nth', 'percent_bps')) = 0
         and coalesce(p_rules ->> 'nth', '') ~ '^\d{1,2}$' and coalesce(p_rules ->> 'percent_bps', '') ~ '^\d{1,5}$'
         and jsonb_typeof(p_rules -> 'nth') = 'number' and jsonb_typeof(p_rules -> 'percent_bps') = 'number'
         and (p_rules ->> 'nth')::integer between 2 and 20
         and (p_rules ->> 'percent_bps')::integer between 1 and 10000;
    else
      return false;
  end case;
end
$$;
revoke all on function app.promotion_rules_valid(text, jsonb) from public;

create table public.promotions (
  id                    uuid primary key default app.uuid_v7(),
  store_id              uuid not null references public.stores (id) on delete cascade,
  name                  text not null check (char_length(btrim(name)) between 1 and 80),
  label                 text not null check (char_length(btrim(label)) between 1 and 40),
  type                  text not null check (type in ('volume', 'buy_n_pay_m', 'nth_percent')),
  rules                 jsonb not null,
  scope                 text not null default 'store' check (scope in ('store', 'categories', 'products')),
  applies_to_sale_items boolean not null default false,
  starts_at             timestamptz,
  ends_at               timestamptz,
  status                text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (store_id, id),
  constraint promotions_rules_valid check (app.promotion_rules_valid(type, rules)),
  constraint promotions_window check (starts_at is null or ends_at is null or starts_at < ends_at)
);
create index promotions_store_status_idx on public.promotions (store_id, status, created_at desc);
create index promotions_created_by_idx on public.promotions (created_by) where created_by is not null;

create table public.promotion_targets (
  id           uuid primary key default app.uuid_v7(),
  store_id     uuid not null references public.stores (id) on delete cascade,
  promotion_id uuid not null,
  product_id   uuid,
  category_id  uuid,
  created_at   timestamptz not null default now(),
  unique (store_id, id),
  constraint promotion_targets_one check (num_nonnulls(product_id, category_id) = 1),
  foreign key (store_id, promotion_id) references public.promotions (store_id, id) on delete cascade,
  foreign key (store_id, product_id) references public.products (store_id, id) on delete cascade,
  foreign key (store_id, category_id) references public.categories (store_id, id) on delete cascade
);
create unique index promotion_targets_product_uq on public.promotion_targets (promotion_id, product_id)
  where product_id is not null;
create unique index promotion_targets_category_uq on public.promotion_targets (promotion_id, category_id)
  where category_id is not null;
create index promotion_targets_product_idx on public.promotion_targets (store_id, product_id)
  where product_id is not null;
create index promotion_targets_category_idx on public.promotion_targets (store_id, category_id)
  where category_id is not null;

-- -----------------------------------------------------------------------------
-- 4. Pedido: parte de promociones y detalle por partida
-- -----------------------------------------------------------------------------
alter table public.orders add column promotion_total bigint not null default 0
  constraint orders_promotion_total check (promotion_total >= 0);
alter table public.orders add constraint orders_promotion_le_discount check (promotion_total <= discount_total);
alter table public.order_items add column promotion_allocation bigint not null default 0
  constraint order_items_promotion_allocation check (promotion_allocation >= 0);
alter table public.order_items add constraint order_items_promotion_le_discount
  check (promotion_allocation <= discount_allocation);

create table public.order_promotions (
  id            uuid primary key default app.uuid_v7(),
  store_id      uuid not null references public.stores (id) on delete restrict,
  order_id      uuid not null,
  order_item_id uuid not null,
  promotion_id  uuid,
  snapshot      jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  units         integer not null check (units > 0),
  amount        bigint not null check (amount > 0),
  created_at    timestamptz not null default now(),
  unique (store_id, id),
  foreign key (store_id, order_id) references public.orders (store_id, id) on delete restrict,
  foreign key (store_id, order_item_id) references public.order_items (store_id, id) on delete restrict,
  foreign key (store_id, promotion_id) references public.promotions (store_id, id)
    on delete set null (promotion_id)
);
create index order_promotions_order_idx on public.order_promotions (store_id, order_id);
create index order_promotions_item_idx on public.order_promotions (store_id, order_item_id);
create index order_promotions_promotion_idx on public.order_promotions (store_id, promotion_id, created_at)
  where promotion_id is not null;

-- -----------------------------------------------------------------------------
-- 5. Triggers
-- -----------------------------------------------------------------------------
create trigger promotions_set_updated_at before update on public.promotions
  for each row execute function app.set_updated_at();
create trigger promotions_prevent_tenant_change before update on public.promotions
  for each row execute function app.prevent_tenant_change();
create trigger promotion_targets_prevent_tenant_change before update on public.promotion_targets
  for each row execute function app.prevent_tenant_change();
create trigger order_promotions_prevent_tenant_change before update on public.order_promotions
  for each row execute function app.prevent_tenant_change();
create trigger order_promotions_append_only before update or delete on public.order_promotions
  for each row execute function app.forbid_mutation();

-- Una promoción que ya se usó en un pedido no cambia de regla (se pausa y se
-- crea otra), como el código de un cupón usado. `archived` es terminal.
create or replace function app.promotions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception using errcode = '23514', message = 'promotion_archived';
  end if;
  if (new.type, new.rules, new.scope, new.applies_to_sale_items)
       is distinct from (old.type, old.rules, old.scope, old.applies_to_sale_items)
     and exists (select 1 from public.order_promotions op
                  where op.store_id = old.store_id and op.promotion_id = old.id) then
    raise exception using errcode = '23514', message = 'promotion_locked';
  end if;
  return new;
end
$$;
revoke all on function app.promotions_guard() from public;
create trigger promotions_guard before update on public.promotions
  for each row execute function app.promotions_guard();

-- Límite del plan al ACTIVAR (también contra escrituras privilegiadas).
create or replace function app.enforce_promotion_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Una archivada no se reactiva: lo rechaza promotions_guard.
  if new.status = 'active' and (tg_op = 'INSERT' or old.status not in ('active', 'archived')) then
    perform app.assert_within_limit((select s.organization_id from public.stores s where s.id = new.store_id),
                                    'max_active_promotions', 1);
  end if;
  return new;
end
$$;
revoke all on function app.enforce_promotion_limit() from public;
create trigger promotions_enforce_limit before insert or update of status on public.promotions
  for each row execute function app.enforce_promotion_limit();

-- -----------------------------------------------------------------------------
-- 6. Uso medido y lectura de plan (mismas firmas)
-- -----------------------------------------------------------------------------
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
    when 'max_products' then
      return (select count(*) from public.products p
                join public.stores s on s.id = p.store_id
               where s.organization_id = p_org and p.deleted_at is null);
    when 'storage_mb' then
      return (select ceil(coalesce(sum(m.bytes), 0) / 1048576.0)::integer
                from public.media m
                join public.stores s on s.id = m.store_id
               where s.organization_id = p_org and m.status <> 'rejected');
    when 'max_active_promotions' then
      -- Activas y sin terminar, en todas las tiendas de la organización.
      return (select count(*) from public.promotions pr
                join public.stores s on s.id = pr.store_id
               where s.organization_id = p_org and pr.status = 'active'
                 and (pr.ends_at is null or pr.ends_at > now()));
    else
      raise exception using errcode = '22023', message = 'unsupported_limit', detail = p_key;
  end case;
end
$$;

create or replace function app.org_billing_json(p_org uuid, p_internal boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub  public.subscriptions;
  v_plan public.plans;
  v_ents jsonb;
begin
  select s.* into v_sub from public.subscriptions s
   where s.organization_id = p_org and s.status <> 'cancelled';
  if v_sub.id is not null then
    select p.* into v_plan from public.plans p where p.id = v_sub.plan_id;
  end if;

  -- Valor efectivo por clave (override vigente ▷ plan ▷ 0) y uso donde se mide.
  select coalesce(jsonb_object_agg(k.key, jsonb_build_object(
           'type', app.entitlement_type(k.key),
           'value', case app.entitlement_type(k.key)
                      when 'int' then to_jsonb(case when k.key = 'max_variants_per_product'
                                                    then coalesce(ov.value_int, pe.value_int, 100)
                                                    else coalesce(ov.value_int, pe.value_int, 0) end)
                      else to_jsonb(coalesce(ov.value_bool, pe.value_bool, false)) end,
           'used', case when k.key in ('max_stores', 'max_staff', 'max_products', 'storage_mb',
                                            'max_active_promotions')
                        then to_jsonb(app.current_usage(p_org, k.key)) end,
           'override', ov.key is not null,
           'override_expires_at', ov.expires_at,
           'override_reason', case when p_internal then ov.reason end)), '{}'::jsonb)
    into v_ents
    from unnest(array['max_stores', 'max_products', 'max_variants_per_product', 'max_staff',
                      'max_locations', 'max_custom_domains', 'storage_mb', 'advanced_analytics',
                      'abandoned_cart', 'custom_roles', 'api_access', 'remove_platform_branding',
                      'custom_domains', 'max_active_promotions', 'promotion_reports']) as k(key)
    left join public.plan_entitlements pe on pe.plan_id = v_sub.plan_id and pe.key = k.key
    left join public.organization_entitlement_overrides ov
           on ov.organization_id = p_org and ov.key = k.key
          and (ov.expires_at is null or ov.expires_at > now());

  return jsonb_build_object(
    'organization_id', p_org,
    'access_mode', app.org_access_mode(p_org),
    'plan', case when v_plan.id is not null
                 then jsonb_build_object('key', v_plan.key, 'name', v_plan.name) end,
    'subscription', case when v_sub.id is not null then jsonb_strip_nulls(jsonb_build_object(
        'status', v_sub.status,
        'current_period_start', v_sub.current_period_start,
        'current_period_end', v_sub.current_period_end,
        'trial_ends_at', v_sub.trial_ends_at,
        'grace_ends_at', v_sub.grace_ends_at,
        'paused_at', v_sub.paused_at,
        'provider', case when p_internal then v_sub.provider end,
        'notes', case when p_internal then v_sub.notes end)) end,
    'entitlements', v_ents);
end
$$;
revoke all on function app.org_billing_json(uuid, boolean) from public;

-- -----------------------------------------------------------------------------
-- 7. RLS y grants: lectura con los permisos de cupones; escritura solo por RPC.
-- -----------------------------------------------------------------------------
alter table public.promotions enable row level security;
alter table public.promotions force row level security;
alter table public.promotion_targets enable row level security;
alter table public.promotion_targets force row level security;
alter table public.order_promotions enable row level security;
alter table public.order_promotions force row level security;

revoke all on table public.promotions, public.promotion_targets, public.order_promotions
  from public, anon, authenticated, service_role;
grant select on table public.promotions, public.promotion_targets, public.order_promotions to authenticated;
grant select (promotion_total) on public.orders to authenticated;

create policy promotions_select on public.promotions for select to authenticated
  using (app.has_store_permission(store_id, 'discounts.read'));
create policy promotion_targets_select on public.promotion_targets for select to authenticated
  using (app.has_store_permission(store_id, 'discounts.read'));
create policy order_promotions_select on public.order_promotions for select to authenticated
  using (app.has_store_permission(store_id, 'orders.read'));

-- -----------------------------------------------------------------------------
-- 8. RPC del panel (discounts.manage), con auditoría
-- -----------------------------------------------------------------------------
-- p_promotion: {id?, name, label, type, rules, scope, product_ids?, category_ids?,
--               applies_to_sale_items?, starts_on?, ends_on?}. Fechas por día en la
-- zona de la tienda; «hasta» incluye ese día (como los cupones). Nace `draft`.
create or replace function public.promotions_upsert(p_store_id uuid, p_promotion jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid;
  v_id      uuid;
  v_old     public.promotions;
  v_tz      text;
  v_from    timestamptz;
  v_to      timestamptz;
  v_scope   text := coalesce(p_promotion ->> 'scope', 'store');
  v_ids     uuid[];
  v_old_ids uuid[];
begin
  v_uid := app.require_store_permission(p_store_id, 'discounts.manage');
  if jsonb_typeof(p_promotion) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'promotion';
  end if;
  if not app.promotion_rules_valid(p_promotion ->> 'type', p_promotion -> 'rules') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rules';
  end if;
  if v_scope not in ('store', 'categories', 'products') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'scope';
  end if;
  begin
    v_ids := case v_scope
               when 'products' then (select array_agg(distinct x::uuid)
                                       from jsonb_array_elements_text(coalesce(p_promotion -> 'product_ids', '[]')) x)
               when 'categories' then (select array_agg(distinct x::uuid)
                                         from jsonb_array_elements_text(coalesce(p_promotion -> 'category_ids', '[]')) x)
             end;
  exception when invalid_text_representation or invalid_parameter_value then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'targets';
  end;
  if v_scope <> 'store' and coalesce(cardinality(v_ids), 0) not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'targets';
  end if;
  if v_scope = 'products' and (select count(*) from public.products p
                                where p.store_id = p_store_id and p.id = any (v_ids) and p.deleted_at is null)
                              <> cardinality(v_ids) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'targets';
  end if;
  if v_scope = 'categories' and (select count(*) from public.categories c
                                  where c.store_id = p_store_id and c.id = any (v_ids)) <> cardinality(v_ids) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'targets';
  end if;

  select s.timezone into v_tz from public.stores s where s.id = p_store_id;
  begin
    if coalesce(p_promotion ->> 'starts_on', '') <> '' then
      v_from := ((p_promotion ->> 'starts_on')::date)::timestamp at time zone v_tz;
    end if;
    if coalesce(p_promotion ->> 'ends_on', '') <> '' then
      v_to := ((p_promotion ->> 'ends_on')::date + 1)::timestamp at time zone v_tz;
    end if;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'dates';
  end;

  begin
    v_id := nullif(p_promotion ->> 'id', '')::uuid;
    if v_id is null then
      insert into public.promotions (store_id, name, label, type, rules, scope, applies_to_sale_items,
                                     starts_at, ends_at, created_by)
      values (p_store_id, btrim(p_promotion ->> 'name'), btrim(p_promotion ->> 'label'), p_promotion ->> 'type',
              p_promotion -> 'rules', v_scope, coalesce((p_promotion ->> 'applies_to_sale_items')::boolean, false),
              v_from, v_to, v_uid)
      returning id into v_id;
    else
      select * into v_old from public.promotions
       where store_id = p_store_id and id = v_id and status <> 'archived' for update;
      if v_old.id is null then
        raise exception using errcode = 'P0001', message = 'not_found', detail = 'promotion';
      end if;
      select array_agg(coalesce(t.product_id, t.category_id) order by coalesce(t.product_id, t.category_id))
        into v_old_ids from public.promotion_targets t where t.store_id = p_store_id and t.promotion_id = v_id;
      if (v_scope is distinct from v_old.scope
          or v_old_ids is distinct from (select array_agg(x order by x) from unnest(v_ids) x))
         and exists (select 1 from public.order_promotions op
                      where op.store_id = p_store_id and op.promotion_id = v_id) then
        raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'promotion_locked';
      end if;
      update public.promotions
         set name = btrim(p_promotion ->> 'name'), label = btrim(p_promotion ->> 'label'),
             type = p_promotion ->> 'type', rules = p_promotion -> 'rules', scope = v_scope,
             applies_to_sale_items = coalesce((p_promotion ->> 'applies_to_sale_items')::boolean, false),
             starts_at = v_from, ends_at = v_to
       where store_id = p_store_id and id = v_id;
      delete from public.promotion_targets where store_id = p_store_id and promotion_id = v_id;
    end if;
    insert into public.promotion_targets (store_id, promotion_id, product_id, category_id)
    select p_store_id, v_id, case when v_scope = 'products' then x end, case when v_scope = 'categories' then x end
      from unnest(v_ids) x;
  exception
    when check_violation or not_null_violation then
      if sqlerrm = 'promotion_locked' then
        raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'promotion_locked';
      end if;
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'promotion';
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
         or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'promotion';
  end;
  perform audit.record('promotion.saved', 'promotion', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       case when v_old.id is not null then to_jsonb(v_old) - 'updated_at' end,
                       (p_promotion - 'id') || jsonb_build_object('scope', v_scope));
  return v_id;
end
$$;

-- draft → active | archived · active → paused | archived · paused → active | archived.
-- Activar cuenta para el límite del plan (trigger promotions_enforce_limit).
create or replace function public.promotions_set_status(p_store_id uuid, p_promotion_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.promotions;
begin
  perform app.require_store_permission(p_store_id, 'discounts.manage');
  if p_status is null or p_status not in ('active', 'paused', 'archived') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  select * into v_old from public.promotions
   where store_id = p_store_id and id = p_promotion_id and status <> 'archived' for update;
  if v_old.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'promotion';
  end if;
  if p_status = 'paused' and v_old.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  if p_status = 'active' and v_old.ends_at is not null and v_old.ends_at <= now() then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'ended';
  end if;
  update public.promotions set status = p_status where id = v_old.id;
  perform audit.record('promotion.status_changed', 'promotion', p_promotion_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('status', v_old.status), jsonb_build_object('status', p_status));
end
$$;

-- Cupones: igual que en 20261013000600 más `combines_with_promotions`.
create or replace function public.discounts_upsert(p_store_id uuid, p_discount jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_code text := upper(btrim(coalesce(p_discount ->> 'code', '')));
  v_tz   text;
  v_from timestamptz;
  v_to   timestamptz;
begin
  perform app.require_store_permission(p_store_id, 'discounts.manage');
  if jsonb_typeof(p_discount) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'discount';
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'code';
  end if;
  -- Vigencia por día en la zona horaria de la tienda: «hasta» incluye ese día.
  select s.timezone into v_tz from public.stores s where s.id = p_store_id;
  begin
    if coalesce(p_discount ->> 'starts_on', '') <> '' then
      v_from := ((p_discount ->> 'starts_on')::date)::timestamp at time zone v_tz;
    end if;
    if coalesce(p_discount ->> 'ends_on', '') <> '' then
      v_to := ((p_discount ->> 'ends_on')::date + 1)::timestamp at time zone v_tz;
    end if;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'dates';
  end;
  begin
    v_id := nullif(p_discount ->> 'id', '')::uuid;
    if v_id is null then
      insert into public.discounts (store_id, code, type, value, min_subtotal, starts_at, ends_at, usage_limit,
                                    usage_limit_per_customer, combines_with_promotions)
      values (p_store_id, v_code, p_discount ->> 'type', coalesce((p_discount ->> 'value')::bigint, 0),
              coalesce((p_discount ->> 'min_subtotal')::bigint, 0), v_from,
              v_to, (p_discount ->> 'usage_limit')::integer,
              (p_discount ->> 'usage_limit_per_customer')::integer,
              coalesce((p_discount ->> 'combines_with_promotions')::boolean, false))
      returning id into v_id;
    else
      update public.discounts
         set code = v_code, type = p_discount ->> 'type', value = coalesce((p_discount ->> 'value')::bigint, 0),
             min_subtotal = coalesce((p_discount ->> 'min_subtotal')::bigint, 0),
             starts_at = v_from, ends_at = v_to,
             usage_limit = (p_discount ->> 'usage_limit')::integer,
             usage_limit_per_customer = (p_discount ->> 'usage_limit_per_customer')::integer,
             combines_with_promotions = coalesce((p_discount ->> 'combines_with_promotions')::boolean,
                                                 combines_with_promotions)
       where store_id = p_store_id and id = v_id and status <> 'archived';
      if not found then
        raise exception using errcode = 'P0001', message = 'not_found', detail = 'discount';
      end if;
    end if;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'code_taken';
    when check_violation then
      if sqlerrm = 'discount_code_locked' then
        raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'code_locked';
      end if;
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'value';
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
         or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'discount';
  end;
  perform audit.record('discount.saved', 'discount', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, (p_discount - 'id') || jsonb_build_object('code', v_code));
  return v_id;
end
$$;

revoke all on function public.promotions_upsert(uuid, jsonb) from public;
revoke all on function public.promotions_set_status(uuid, uuid, text) from public;
grant execute on function public.promotions_upsert(uuid, jsonb) to authenticated;
grant execute on function public.promotions_set_status(uuid, uuid, text) to authenticated;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261125000100'::text
$$;
