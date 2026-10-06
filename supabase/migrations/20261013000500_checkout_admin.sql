-- =============================================================================
-- Fase 6 · Panel de envíos, impuestos, descuentos y pedidos + rate limits del
-- checkout (F6-T05). Contrato: GATE0 §12.3, §17.7, T-11, T-16, T-24, A20.
--
-- * Rate limits con contadores en la base (T-24): ventana fija por clave. El
--   servidor pasa el HASH de la IP (nunca la IP en claro) y el email normalizado.
-- * Descuentos: 10 intentos de código por carrito y hora (A20).
-- * PII del pedido solo por RPC con customers.pii.read (D-F6-01).
-- =============================================================================

create table system.rate_limits (
  bucket       text not null check (char_length(bucket) between 3 and 200),
  window_start timestamptz not null,
  hits         integer not null default 0 check (hits >= 0),
  primary key (bucket, window_start)
);
alter table system.rate_limits enable row level security;
alter table system.rate_limits force row level security;
revoke all on table system.rate_limits from public, anon, authenticated, service_role, storefront_gateway, system_worker;

-- Suma un intento a `p_bucket` en la ventana actual; true si sigue dentro del límite.
create or replace function app.rate_limit_take(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits  integer;
begin
  insert into system.rate_limits (bucket, window_start, hits) values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = system.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end
$$;
revoke all on function app.rate_limit_take(text, integer, integer) from public;

-- Purga de ventanas viejas (job diario de mantenimiento).
create or replace function system.purge_rate_limits()
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (delete from system.rate_limits where window_start < now() - interval '2 days' returning 1)
  select count(*)::integer from d
$$;

-- Antes de place_order (§17.7): 10 por IP y tienda cada 10 minutos; 20 pedidos
-- por email y tienda al día. Devuelve false al exceder (sin excepción: así el
-- evento de seguridad se confirma); el servidor responde `rate_limited`.
create or replace function storefront.checkout_guard(p_store_id uuid, p_ip_hash text, p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'client';
  end if;
  if not app.rate_limit_take('checkout:ip:' || p_store_id || ':' || p_ip_hash, 10, 600)
     or (p_email is not null and not app.rate_limit_take(
           'checkout:email:' || p_store_id || ':' || encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex'),
           20, 86400)) then
    perform system.record_security_event('checkout.rate_limited', 'warning', null, p_store_id, null, null, null,
                                         jsonb_build_object('ip_hash', left(p_ip_hash, 16)));
    return false;
  end if;
  return true;
end
$$;
revoke all on function storefront.checkout_guard(uuid, text, text) from public;
grant execute on function storefront.checkout_guard(uuid, text, text) to storefront_gateway;

-- Intentos de código limitados (redefine 20261013000300).
create or replace function storefront.cart_set_details(p_store_id uuid, p_token text, p_details jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart  public.carts := app.cart_for_token(p_store_id, p_token);
  v_email text;
  v_code  text;
  v_rate  uuid;
begin
  if v_cart.id is null or not app.store_accepts_carts(p_store_id, false) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'cart';
  end if;
  if jsonb_typeof(p_details) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'details';
  end if;
  perform 1 from public.carts c where c.id = v_cart.id for update;

  if p_details ? 'email' then
    v_email := nullif(lower(btrim(p_details ->> 'email')), '');
    if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'email';
    end if;
    update public.carts set email = v_email where id = v_cart.id;
  end if;
  if p_details ? 'shipping_address' then
    if jsonb_typeof(p_details -> 'shipping_address') <> 'null'
       and not app.address_valid(p_details -> 'shipping_address') then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'shipping_address';
    end if;
    update public.carts set shipping_address = nullif(p_details -> 'shipping_address', 'null'::jsonb)
     where id = v_cart.id;
  end if;
  if p_details ? 'shipping_rate_id' then
    begin
      v_rate := nullif(p_details ->> 'shipping_rate_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'shipping_rate_id';
    end;
    if v_rate is not null and not exists (select 1 from public.shipping_rates r
                                            where r.store_id = p_store_id and r.id = v_rate and r.is_active) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'shipping_rate_id';
    end if;
    update public.carts set shipping_rate_id = v_rate where id = v_cart.id;
  end if;
  if p_details ? 'discount_code' then
    v_code := nullif(upper(btrim(coalesce(p_details ->> 'discount_code', ''))), '');
    -- Enumeración de códigos (A20, T-11): 10 intentos por carrito y hora.
    if v_code is not null and not app.rate_limit_take('discount:cart:' || v_cart.id, 10, 3600) then
      raise exception using errcode = 'P0001', message = 'rate_limited', detail = 'discount_code';
    end if;
    if v_code is not null and v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then
      raise exception using errcode = 'P0001', message = 'discount_invalid', detail = 'not_found';
    end if;
    update public.carts set discount_code = v_code where id = v_cart.id;
  end if;
  return app.cart_view(app.cart_touch(v_cart.id));
end
$$;
-- -----------------------------------------------------------------------------
-- Envíos (shipping.manage)
-- -----------------------------------------------------------------------------
create or replace function public.shipping_upsert_zone(p_store_id uuid, p_zone jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid;
  v_countries text[];
  v_regions   text[];
begin
  perform app.require_store_permission(p_store_id, 'shipping.manage');
  if jsonb_typeof(p_zone) is distinct from 'object' or jsonb_typeof(p_zone -> 'countries') is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'countries';
  end if;
  begin
    v_id := nullif(p_zone ->> 'id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'zone';
  end;
  select array_agg(distinct upper(btrim(x))) into v_countries from jsonb_array_elements_text(p_zone -> 'countries') x;
  if v_countries is null or exists (select 1 from unnest(v_countries) c where c !~ '^[A-Z]{2}$') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'countries';
  end if;
  if jsonb_typeof(p_zone -> 'regions') = 'array' then
    select array_agg(distinct btrim(x)) filter (where btrim(x) <> '') into v_regions
      from jsonb_array_elements_text(p_zone -> 'regions') x;
    if exists (select 1 from unnest(v_regions) r where char_length(r) > 120) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'regions';
    end if;
  end if;
  begin
    if v_id is null then
      insert into public.shipping_zones (store_id, name, countries, regions)
      values (p_store_id, btrim(coalesce(p_zone ->> 'name', '')), v_countries, v_regions) returning id into v_id;
    else
      update public.shipping_zones set name = btrim(coalesce(p_zone ->> 'name', '')), countries = v_countries,
             regions = v_regions
       where store_id = p_store_id and id = v_id;
      if not found then
        raise exception using errcode = 'P0001', message = 'not_found', detail = 'zone';
      end if;
    end if;
  exception when check_violation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'name';
  end;
  perform audit.record('shipping.zone_saved', 'shipping_zone', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('name', p_zone ->> 'name', 'countries', v_countries));
  return v_id;
end
$$;

create or replace function public.shipping_delete_zone(p_store_id uuid, p_zone_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'shipping.manage');
  delete from public.shipping_zones where store_id = p_store_id and id = p_zone_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'zone';
  end if;
  perform audit.record('shipping.zone_deleted', 'shipping_zone', p_zone_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id, null, null);
end
$$;

create or replace function public.shipping_upsert_rate(p_store_id uuid, p_rate jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_zone uuid;
begin
  perform app.require_store_permission(p_store_id, 'shipping.manage');
  if jsonb_typeof(p_rate) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rate';
  end if;
  begin
    v_id := nullif(p_rate ->> 'id', '')::uuid;
    v_zone := (p_rate ->> 'zone_id')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rate';
  end;
  if not exists (select 1 from public.shipping_zones z where z.store_id = p_store_id and z.id = v_zone) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'zone';
  end if;
  begin
    if v_id is null then
      insert into public.shipping_rates (store_id, zone_id, name, type, price, free_over_subtotal, min_weight_g,
                                         max_weight_g, est_days_min, est_days_max, is_active, position)
      values (p_store_id, v_zone, btrim(coalesce(p_rate ->> 'name', '')), p_rate ->> 'type',
              coalesce((p_rate ->> 'price')::bigint, 0), (p_rate ->> 'free_over_subtotal')::bigint,
              (p_rate ->> 'min_weight_g')::integer, (p_rate ->> 'max_weight_g')::integer,
              (p_rate ->> 'est_days_min')::integer, (p_rate ->> 'est_days_max')::integer,
              coalesce((p_rate ->> 'is_active')::boolean, true), coalesce((p_rate ->> 'position')::integer, 0))
      returning id into v_id;
    else
      update public.shipping_rates
         set name = btrim(coalesce(p_rate ->> 'name', '')), type = p_rate ->> 'type',
             price = coalesce((p_rate ->> 'price')::bigint, 0),
             free_over_subtotal = (p_rate ->> 'free_over_subtotal')::bigint,
             min_weight_g = (p_rate ->> 'min_weight_g')::integer, max_weight_g = (p_rate ->> 'max_weight_g')::integer,
             est_days_min = (p_rate ->> 'est_days_min')::integer, est_days_max = (p_rate ->> 'est_days_max')::integer,
             is_active = coalesce((p_rate ->> 'is_active')::boolean, true),
             position = coalesce((p_rate ->> 'position')::integer, 0)
       where store_id = p_store_id and id = v_id and zone_id = v_zone;
      if not found then
        raise exception using errcode = 'P0001', message = 'not_found', detail = 'rate';
      end if;
    end if;
  exception
    when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rate';
  end;
  perform audit.record('shipping.rate_saved', 'shipping_rate', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, p_rate - 'id');
  return v_id;
end
$$;

create or replace function public.shipping_delete_rate(p_store_id uuid, p_rate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'shipping.manage');
  -- Los pedidos guardan su snapshot de envío; la referencia queda en NULL.
  delete from public.shipping_rates where store_id = p_store_id and id = p_rate_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'rate';
  end if;
  perform audit.record('shipping.rate_deleted', 'shipping_rate', p_rate_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id, null, null);
end
$$;

-- -----------------------------------------------------------------------------
-- Impuestos (taxes.manage): una tasa por tienda (§9.2 SIMPLIFY).
-- -----------------------------------------------------------------------------
create or replace function public.taxes_update(p_store_id uuid, p_prices_include_tax boolean, p_tax_rate_bps integer,
                                               p_tax_applies_to_shipping boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.stores;
begin
  perform app.require_store_permission(p_store_id, 'taxes.manage');
  if p_tax_rate_bps is null or p_tax_rate_bps not between 0 and 10000
     or p_prices_include_tax is null or p_tax_applies_to_shipping is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'tax_rate_bps';
  end if;
  select * into v_old from public.stores where id = p_store_id for update;
  update public.stores
     set prices_include_tax = p_prices_include_tax, tax_rate_bps = p_tax_rate_bps,
         tax_applies_to_shipping = p_tax_applies_to_shipping
   where id = p_store_id;
  perform audit.record('store.taxes_updated', 'store', p_store_id, v_old.organization_id, p_store_id,
                       jsonb_build_object('prices_include_tax', v_old.prices_include_tax, 'tax_rate_bps', v_old.tax_rate_bps,
                                          'tax_applies_to_shipping', v_old.tax_applies_to_shipping),
                       jsonb_build_object('prices_include_tax', p_prices_include_tax, 'tax_rate_bps', p_tax_rate_bps,
                                          'tax_applies_to_shipping', p_tax_applies_to_shipping));
end
$$;

-- -----------------------------------------------------------------------------
-- Descuentos (discounts.manage)
-- -----------------------------------------------------------------------------
create or replace function public.discounts_upsert(p_store_id uuid, p_discount jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_code text := upper(btrim(coalesce(p_discount ->> 'code', '')));
begin
  perform app.require_store_permission(p_store_id, 'discounts.manage');
  if jsonb_typeof(p_discount) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'discount';
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'code';
  end if;
  begin
    v_id := nullif(p_discount ->> 'id', '')::uuid;
    if v_id is null then
      insert into public.discounts (store_id, code, type, value, min_subtotal, starts_at, ends_at, usage_limit,
                                    usage_limit_per_customer)
      values (p_store_id, v_code, p_discount ->> 'type', coalesce((p_discount ->> 'value')::bigint, 0),
              coalesce((p_discount ->> 'min_subtotal')::bigint, 0), (p_discount ->> 'starts_at')::timestamptz,
              (p_discount ->> 'ends_at')::timestamptz, (p_discount ->> 'usage_limit')::integer,
              (p_discount ->> 'usage_limit_per_customer')::integer)
      returning id into v_id;
    else
      update public.discounts
         set code = v_code, type = p_discount ->> 'type', value = coalesce((p_discount ->> 'value')::bigint, 0),
             min_subtotal = coalesce((p_discount ->> 'min_subtotal')::bigint, 0),
             starts_at = (p_discount ->> 'starts_at')::timestamptz, ends_at = (p_discount ->> 'ends_at')::timestamptz,
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

create or replace function public.discounts_set_status(p_store_id uuid, p_discount_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'discounts.manage');
  if p_status is null or p_status not in ('active', 'disabled', 'archived') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  update public.discounts set status = p_status
   where store_id = p_store_id and id = p_discount_id and status <> 'archived';
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'discount';
  end if;
  perform audit.record('discount.status_changed', 'discount', p_discount_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('status', p_status));
end
$$;

-- -----------------------------------------------------------------------------
-- Pedidos: contacto (PII) solo con customers.pii.read; nota interna con orders.update.
-- -----------------------------------------------------------------------------
create or replace function public.orders_get_contact(p_store_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform app.require_store_permission(p_store_id, 'orders.read');
  perform app.require_store_permission(p_store_id, 'customers.pii.read');
  select jsonb_build_object('email', o.email, 'phone', o.phone, 'customer_name', o.customer_name,
                            'shipping_address', o.shipping_address, 'billing_address', o.billing_address,
                            'customer_note', o.customer_note, 'staff_note', o.staff_note)
    into v
    from public.orders o where o.store_id = p_store_id and o.id = p_order_id;
  if v is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  return v;
end
$$;

create or replace function public.orders_set_staff_note(p_store_id uuid, p_order_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'orders.update');
  if char_length(coalesce(p_note, '')) > 4000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'staff_note';
  end if;
  update public.orders set staff_note = nullif(btrim(p_note), '') where store_id = p_store_id and id = p_order_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
end
$$;

create or replace function system.enqueue_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.enqueue_job('media.purge_orphans', '{}'::jsonb, null,
                          'media.purge_orphans:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  perform app.enqueue_job('orders.expire', '{}'::jsonb, null,
                          'orders.expire:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  perform app.enqueue_job('rate_limits.purge', '{}'::jsonb, null,
                          'rate_limits.purge:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
end
$$;

revoke all on function system.purge_rate_limits() from public;
grant execute on function system.purge_rate_limits() to system_worker;
revoke all on function public.shipping_upsert_zone(uuid, jsonb) from public;
revoke all on function public.shipping_delete_zone(uuid, uuid) from public;
revoke all on function public.shipping_upsert_rate(uuid, jsonb) from public;
revoke all on function public.shipping_delete_rate(uuid, uuid) from public;
revoke all on function public.taxes_update(uuid, boolean, integer, boolean) from public;
revoke all on function public.discounts_upsert(uuid, jsonb) from public;
revoke all on function public.discounts_set_status(uuid, uuid, text) from public;
revoke all on function public.orders_get_contact(uuid, uuid) from public;
revoke all on function public.orders_set_staff_note(uuid, uuid, text) from public;
grant execute on function public.shipping_upsert_zone(uuid, jsonb) to authenticated;
grant execute on function public.shipping_delete_zone(uuid, uuid) to authenticated;
grant execute on function public.shipping_upsert_rate(uuid, jsonb) to authenticated;
grant execute on function public.shipping_delete_rate(uuid, uuid) to authenticated;
grant execute on function public.taxes_update(uuid, boolean, integer, boolean) to authenticated;
grant execute on function public.discounts_upsert(uuid, jsonb) to authenticated;
grant execute on function public.discounts_set_status(uuid, uuid, text) to authenticated;
grant execute on function public.orders_get_contact(uuid, uuid) to authenticated;
grant execute on function public.orders_set_staff_note(uuid, uuid, text) to authenticated;
