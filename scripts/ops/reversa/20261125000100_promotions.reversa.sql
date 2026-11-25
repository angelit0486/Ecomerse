-- =============================================================================
-- Reversa de 20261125000100_promotions.sql (promociones, ADR-070).
-- Quita tablas, columnas y funciones de promociones y vuelve las funciones
-- reemplazadas (claves del plan, uso medido, lectura del plan y discounts_upsert)
-- a sus definiciones anteriores. Deja la versión en 20261119000100.
-- Requiere antes la reversa de 20261125000200.
--
-- Candado de datos: se RECHAZA sin cambiar nada si alguna tienda ya creó
-- promociones, algún pedido recibió una, o la consola guardó valores para
-- `max_active_promotions` / `promotion_reports` (en planes o excepciones): con la
-- función anterior esas filas violarían su CHECK. Quitarlos antes es un cambio
-- de datos que requiere autorización. No borra filas; sí se pierde la marca
-- «se combina con promociones» de los cupones (columna).
-- Uso (solo con autorización): psql -X -1 -v ON_ERROR_STOP=1 -f <este archivo>
-- =============================================================================

-- Candado: solo sobre una base exactamente en 20261125000100.
do $$
begin
  if coalesce(public.app_schema_version(), '') <> '20261125000100' then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = format('La base está en %s; esta reversa solo aplica a 20261125000100.',
                      coalesce(public.app_schema_version(), 'desconocida'));
  end if;
end
$$;

do $$
begin
  if exists (select 1 from public.promotions) or exists (select 1 from public.order_promotions)
     or exists (select 1 from public.orders where promotion_total > 0) then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = 'Hay promociones o pedidos con promociones: la reversa perdería datos.';
  end if;
  if exists (select 1 from public.plan_entitlements where key in ('max_active_promotions', 'promotion_reports'))
     or exists (select 1 from public.organization_entitlement_overrides
                 where key in ('max_active_promotions', 'promotion_reports')) then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = 'Hay valores de max_active_promotions o promotion_reports en planes o excepciones.';
  end if;
end
$$;

drop function public.promotions_set_status(uuid, uuid, text);
drop function public.promotions_upsert(uuid, jsonb);
drop table public.order_promotions;
drop table public.promotion_targets;
drop table public.promotions;
drop function app.enforce_promotion_limit();
drop function app.promotions_guard();
drop function app.promotion_rules_valid(text, jsonb);

alter table public.order_items drop constraint order_items_promotion_le_discount;
alter table public.order_items drop column promotion_allocation;
alter table public.orders drop constraint orders_promotion_le_discount;
alter table public.orders drop column promotion_total;
alter table public.discounts drop column combines_with_promotions;

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
           'used', case when k.key in ('max_stores', 'max_staff', 'max_products', 'storage_mb')
                        then to_jsonb(app.current_usage(p_org, k.key)) end,
           'override', ov.key is not null,
           'override_expires_at', ov.expires_at,
           'override_reason', case when p_internal then ov.reason end)), '{}'::jsonb)
    into v_ents
    from unnest(array['max_stores', 'max_products', 'max_variants_per_product', 'max_staff',
                      'max_locations', 'max_custom_domains', 'storage_mb', 'advanced_analytics',
                      'abandoned_cart', 'custom_roles', 'api_access', 'remove_platform_branding',
                      'custom_domains']) as k(key)
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
                                    usage_limit_per_customer)
      values (p_store_id, v_code, p_discount ->> 'type', coalesce((p_discount ->> 'value')::bigint, 0),
              coalesce((p_discount ->> 'min_subtotal')::bigint, 0), v_from,
              v_to, (p_discount ->> 'usage_limit')::integer,
              (p_discount ->> 'usage_limit_per_customer')::integer)
      returning id into v_id;
    else
      update public.discounts
         set code = v_code, type = p_discount ->> 'type', value = coalesce((p_discount ->> 'value')::bigint, 0),
             min_subtotal = coalesce((p_discount ->> 'min_subtotal')::bigint, 0),
             starts_at = v_from, ends_at = v_to,
             usage_limit = (p_discount ->> 'usage_limit')::integer,
             usage_limit_per_customer = (p_discount ->> 'usage_limit_per_customer')::integer
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

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261119000100'::text
$$;
