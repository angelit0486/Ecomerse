-- =============================================================================
-- Fase 6 · Cálculo único del carrito (F6-T02). Contrato: GATE0 §17.3.
--
-- * `app.cart_totals` es aritmética pura (IMMUTABLE) sobre líneas y reglas ya
--   resueltas: la cubren los casos dorados (docs/phases/golden-cart-cases.md).
-- * `app.calculate_cart` resuelve precios vigentes, disponibilidad, descuento y
--   tarifa desde la base y llama a `app.cart_totals`. La usan la vista del
--   carrito, el checkout y `place_order`: el cliente nunca aporta un precio.
-- * Redondeo: mitad al par (banquero) en descuento porcentual e impuestos;
--   prorrateo del descuento por residuo mayor (la suma es exacta).
-- =============================================================================

-- round_half_even(n / d) para n ≥ 0, d > 0.
create or replace function app.div_half_even(p_n numeric, p_d numeric)
returns bigint
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  q numeric;
  r numeric;
begin
  if p_n < 0 or p_d <= 0 then
    raise exception using errcode = '22023', message = 'div_half_even: dominio inválido';
  end if;
  q := floor(p_n / p_d);
  r := p_n - q * p_d;
  if 2 * r > p_d or (2 * r = p_d and mod(q, 2) = 1) then
    q := q + 1;
  end if;
  return q::bigint;
end
$$;
revoke all on function app.div_half_even(numeric, numeric) from public;

-- Reparte `p_amount` entre pesos `p_weights` (≥ 0) proporcionalmente, con el
-- método del residuo mayor; empates por orden de línea. Suma exacta.
create or replace function app.allocate_largest_remainder(p_amount bigint, p_weights bigint[])
returns bigint[]
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_total  numeric := 0;
  v_n      integer := coalesce(array_length(p_weights, 1), 0);
  v_out    bigint[] := array[]::bigint[];
  v_left   bigint;
  v_i      integer;
  v_order  integer[];
begin
  if v_n = 0 then
    return v_out;
  end if;
  select coalesce(sum(w), 0) into v_total from unnest(p_weights) w;
  if v_total = 0 or p_amount = 0 then
    return array_fill(0::bigint, array[v_n]);
  end if;
  for v_i in 1 .. v_n loop
    v_out := v_out || floor(p_amount::numeric * p_weights[v_i] / v_total)::bigint;
  end loop;
  v_left := p_amount - (select sum(x) from unnest(v_out) x);
  select array_agg(i order by (p_amount::numeric * p_weights[i]) % v_total desc, i)
    into v_order
    from generate_series(1, v_n) i;
  for v_i in 1 .. v_left loop
    v_out[v_order[v_i]] := v_out[v_order[v_i]] + 1;
  end loop;
  return v_out;
end
$$;
revoke all on function app.allocate_largest_remainder(bigint, bigint[]) from public;

-- -----------------------------------------------------------------------------
-- Aritmética pura. Entrada:
--   p_lines: [{unit_price, quantity}]  (solo líneas vendibles)
--   p_rules: {tax_rate_bps, prices_include_tax, tax_applies_to_shipping,
--             discount: {type, value} | null,
--             shipping: {type, price, free_over_subtotal} | null}
-- Salida: {lines: [{line_subtotal, discount_allocation, line_total, tax_amount}],
--          subtotal, discount_total, shipping_total, tax_total, total}
-- -----------------------------------------------------------------------------
create or replace function app.cart_totals(p_lines jsonb, p_rules jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rate      integer := coalesce((p_rules ->> 'tax_rate_bps')::integer, 0);
  v_included  boolean := coalesce((p_rules ->> 'prices_include_tax')::boolean, false);
  v_tax_ship  boolean := coalesce((p_rules ->> 'tax_applies_to_shipping')::boolean, false);
  v_disc      jsonb := nullif(p_rules -> 'discount', 'null'::jsonb);
  v_ship      jsonb := nullif(p_rules -> 'shipping', 'null'::jsonb);
  v_subs      bigint[] := array[]::bigint[];
  v_subtotal  bigint := 0;
  v_discount  bigint := 0;
  v_alloc     bigint[];
  v_shipping  bigint := 0;
  v_tax       bigint := 0;
  v_line_tax  bigint;
  v_lines     jsonb := '[]'::jsonb;
  v_line      jsonb;
  v_i         integer := 0;
begin
  if v_rate not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'tax_rate_bps fuera de rango';
  end if;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if (v_line ->> 'unit_price')::bigint < 0 or (v_line ->> 'quantity')::integer < 1 then
      raise exception using errcode = '22023', message = 'línea inválida';
    end if;
    v_subs := v_subs || ((v_line ->> 'unit_price')::bigint * (v_line ->> 'quantity')::integer);
  end loop;
  select coalesce(sum(x), 0) into v_subtotal from unnest(v_subs) x;

  -- Descuento sobre el subtotal de mercancía.
  if v_disc is not null then
    v_discount := case v_disc ->> 'type'
      when 'percentage' then app.div_half_even(v_subtotal::numeric * (v_disc ->> 'value')::bigint, 10000)
      when 'fixed_amount' then least((v_disc ->> 'value')::bigint, v_subtotal)
      else 0
    end;
  end if;
  v_alloc := app.allocate_largest_remainder(v_discount, v_subs);

  -- Envío: `free_over` se evalúa sobre el subtotal ya descontado (§17.3.4).
  if v_ship is not null then
    v_shipping := case
      when v_disc ->> 'type' = 'free_shipping' then 0
      when v_ship ->> 'type' = 'pickup' then 0
      when v_ship ->> 'type' = 'free_over'
           and v_subtotal - v_discount >= (v_ship ->> 'free_over_subtotal')::bigint then 0
      else (v_ship ->> 'price')::bigint
    end;
  end if;

  -- Impuesto por línea (sobre lo cobrado) y luego sumado (§17.3.5).
  for v_i in 1 .. coalesce(array_length(v_subs, 1), 0) loop
    v_line_tax := case when v_included
                       then app.div_half_even((v_subs[v_i] - v_alloc[v_i])::numeric * v_rate, 10000 + v_rate)
                       else app.div_half_even((v_subs[v_i] - v_alloc[v_i])::numeric * v_rate, 10000) end;
    v_tax := v_tax + v_line_tax;
    v_lines := v_lines || jsonb_build_object('line_subtotal', v_subs[v_i], 'discount_allocation', v_alloc[v_i],
                                             'line_total', v_subs[v_i] - v_alloc[v_i], 'tax_amount', v_line_tax);
  end loop;
  if v_tax_ship and v_shipping > 0 then
    v_tax := v_tax + case when v_included then app.div_half_even(v_shipping::numeric * v_rate, 10000 + v_rate)
                          else app.div_half_even(v_shipping::numeric * v_rate, 10000) end;
  end if;

  return jsonb_build_object(
    'lines', v_lines, 'subtotal', v_subtotal, 'discount_total', v_discount, 'shipping_total', v_shipping,
    'tax_total', v_tax,
    'total', v_subtotal - v_discount + v_shipping + case when v_included then 0 else v_tax end);
end
$$;
revoke all on function app.cart_totals(jsonb, jsonb) from public;

-- -----------------------------------------------------------------------------
-- Dirección (snapshot de envío): forma y longitudes; país ISO-3166 alfa-2.
-- -----------------------------------------------------------------------------
create or replace function app.address_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p) k
           where k not in ('recipient_name', 'line1', 'line2', 'city', 'region', 'postal_code', 'country', 'phone')) = 0
     and char_length(btrim(coalesce(p ->> 'recipient_name', ''))) between 1 and 120
     and char_length(btrim(coalesce(p ->> 'line1', ''))) between 1 and 200
     and char_length(coalesce(p ->> 'line2', '')) <= 200
     and char_length(btrim(coalesce(p ->> 'city', ''))) between 1 and 120
     and char_length(btrim(coalesce(p ->> 'region', ''))) between 1 and 120
     and coalesce(p ->> 'postal_code', '') ~ '^[A-Za-z0-9 -]{3,12}$'
     and coalesce(p ->> 'country', '') ~ '^[A-Z]{2}$'
     and (p ->> 'phone' is null or (p ->> 'phone') ~ '^\+?[0-9 ()-]{7,20}$')
$$;
revoke all on function app.address_valid(jsonb) from public;

-- Tarifas activas que cubren el país, la región y el peso.
create or replace function app.shipping_options(p_store_id uuid, p_address jsonb, p_weight_g bigint)
returns table (rate_id uuid, name text, type text, price bigint, free_over_subtotal bigint,
               est_days_min integer, est_days_max integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, r.type, r.price, r.free_over_subtotal, r.est_days_min, r.est_days_max
    from public.shipping_rates r
    join public.shipping_zones z on z.store_id = r.store_id and z.id = r.zone_id
   where r.store_id = p_store_id and r.is_active
     and (p_address ->> 'country') = any (z.countries)
     and (z.regions is null or lower(btrim(p_address ->> 'region')) in (select lower(x) from unnest(z.regions) x))
     and (r.min_weight_g is null or p_weight_g >= r.min_weight_g)
     and (r.max_weight_g is null or p_weight_g <= r.max_weight_g)
   order by r.position, r.price, r.name
$$;
revoke all on function app.shipping_options(uuid, jsonb, bigint) from public;

-- Estado de un código para un carrito: ok | not_found | inactive | not_started |
-- expired | min_subtotal | exhausted | customer_limit.
create or replace function app.discount_status(p_store_id uuid, p_code text, p_subtotal bigint, p_email text)
returns table (discount_id uuid, status text, type text, value bigint, min_subtotal bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.discounts;
begin
  select * into d from public.discounts x where x.store_id = p_store_id and x.code = upper(btrim(p_code));
  if d.id is null or d.status = 'archived' then
    return query select null::uuid, 'not_found'::text, null::text, null::bigint, null::bigint;
    return;
  end if;
  return query select d.id,
    case
      when d.status <> 'active' then 'inactive'
      when d.starts_at is not null and now() < d.starts_at then 'not_started'
      when d.ends_at is not null and now() >= d.ends_at then 'expired'
      when p_subtotal < d.min_subtotal then 'min_subtotal'
      when d.usage_limit is not null and d.times_reserved + d.times_used >= d.usage_limit then 'exhausted'
      when d.usage_limit_per_customer is not null and p_email is not null
           and (select count(*) from public.discount_redemptions dr
                  join public.orders o on o.store_id = dr.store_id and o.id = dr.order_id
                 where dr.store_id = p_store_id and dr.discount_id = d.id and dr.status <> 'released'
                   and o.email = lower(p_email)) >= d.usage_limit_per_customer then 'customer_limit'
      else 'ok'
    end, d.type, d.value, d.min_subtotal;
end
$$;
revoke all on function app.discount_status(uuid, text, bigint, text) from public;

-- -----------------------------------------------------------------------------
-- Carrito completo (§17.3). Las líneas no vendibles se marcan `unavailable` y no
-- suman; las que piden más de lo disponible (con `deny`) se marcan
-- `insufficient_stock` y sí suman (la reserva de place_order decide).
-- -----------------------------------------------------------------------------
create or replace function app.calculate_cart(p_store_id uuid, p_cart_id uuid, p_shipping_rate_id uuid default null,
                                              p_discount_code text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store    public.stores;
  v_cart     public.carts;
  v_lines    jsonb;
  v_sellable jsonb;
  v_weight   bigint;
  v_needs    boolean;
  v_subtotal bigint;
  v_code     text := nullif(upper(btrim(coalesce(p_discount_code, ''))), '');
  v_disc     record;
  v_disc_out jsonb;
  v_rate     record;
  v_rate_id  uuid;
  v_ship_out jsonb;
  v_options  jsonb := '[]'::jsonb;
  v_totals   jsonb;
  v_merged   jsonb := '[]'::jsonb;
  v_i        integer := 0;
  v_line     jsonb;
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  select * into v_cart from public.carts c where c.store_id = p_store_id and c.id = p_cart_id;
  if v_store.id is null or v_cart.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'cart';
  end if;

  select coalesce(jsonb_agg(l order by l ->> 'added_at', l ->> 'variant_id'), '[]'::jsonb) into v_lines
    from (
      select jsonb_build_object(
               'variant_id', v.id, 'product_id', p.id, 'product_title', p.title, 'product_slug', p.slug,
               'product_type', p.product_type,
               'variant_title', nullif((select string_agg(ov.value, ' / ' order by o.position)
                                          from public.variant_option_values vov
                                          join public.product_option_values ov on ov.id = vov.option_value_id
                                          join public.product_options o on o.id = ov.option_id
                                         where vov.variant_id = v.id), ''),
               'option_values', coalesce((select jsonb_object_agg(o.name, ov.value)
                                            from public.variant_option_values vov
                                            join public.product_option_values ov on ov.id = vov.option_value_id
                                            join public.product_options o on o.id = ov.option_id
                                           where vov.variant_id = v.id), '{}'::jsonb),
               'sku', v.sku, 'unit_price', v.price, 'compare_at_price', v.compare_at_price,
               'quantity', ci.quantity, 'weight_g', coalesce(v.weight_g, 0),
               'requires_shipping', v.requires_shipping,
               'image', coalesce(
                  (select jsonb_build_object('path', m.storage_path, 'alt', m.alt_text) from public.media m
                    where m.store_id = v.store_id and m.id = v.image_id and m.status = 'ready' and m.deleted_at is null),
                  app.product_cover(p.store_id, p.id)),
               'added_at', ci.created_at,
               'state', case
                 when v.deleted_at is not null or v.status <> 'active' or p.deleted_at is not null
                      or p.status <> 'active' or p.product_type <> 'physical' then 'unavailable'
                 when v.track_inventory and v.inventory_policy = 'deny'
                      and coalesce((select sum(l.available) from public.inventory_levels l
                                      join public.inventory_locations loc on loc.store_id = l.store_id
                                       and loc.id = l.location_id and loc.is_active
                                     where l.store_id = v.store_id and l.variant_id = v.id), 0) < ci.quantity
                      then 'insufficient_stock'
                 else 'ok' end,
               'available_quantity', case when v.track_inventory and v.inventory_policy = 'deny' then
                  greatest(coalesce((select sum(l.available) from public.inventory_levels l
                                       join public.inventory_locations loc on loc.store_id = l.store_id
                                        and loc.id = l.location_id and loc.is_active
                                      where l.store_id = v.store_id and l.variant_id = v.id), 0), 0) end
             ) as l
        from public.cart_items ci
        join public.product_variants v on v.store_id = ci.store_id and v.id = ci.variant_id
        join public.products p on p.store_id = v.store_id and p.id = v.product_id
       where ci.store_id = p_store_id and ci.cart_id = p_cart_id
    ) x;

  select coalesce(jsonb_agg(l order by n), '[]'::jsonb) into v_sellable
    from jsonb_array_elements(v_lines) with ordinality e(l, n) where l ->> 'state' <> 'unavailable';
  select coalesce(sum((l ->> 'weight_g')::bigint * (l ->> 'quantity')::integer)
                    filter (where (l ->> 'requires_shipping')::boolean), 0),
         coalesce(bool_or((l ->> 'requires_shipping')::boolean), false),
         coalesce(sum((l ->> 'unit_price')::bigint * (l ->> 'quantity')::integer), 0)
    into v_weight, v_needs, v_subtotal
    from jsonb_array_elements(v_sellable) l;

  -- Descuento
  if v_code is not null then
    select * into v_disc from app.discount_status(p_store_id, v_code, v_subtotal, v_cart.email);
    v_disc_out := jsonb_build_object('code', v_code, 'status', v_disc.status, 'type', v_disc.type,
                                     'value', v_disc.value, 'min_subtotal', v_disc.min_subtotal);
  end if;

  -- Envío: opciones para la dirección del carrito y tarifa elegida.
  v_rate_id := coalesce(p_shipping_rate_id, v_cart.shipping_rate_id);
  if v_needs then
    if v_cart.shipping_address is not null and app.address_valid(v_cart.shipping_address) then
      select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) into v_options
        from app.shipping_options(p_store_id, v_cart.shipping_address, v_weight) o;
    end if;
    select * into v_rate from jsonb_to_record(
        (select o from jsonb_array_elements(v_options) o where (o ->> 'rate_id')::uuid = v_rate_id))
      as r(rate_id uuid, name text, type text, price bigint, free_over_subtotal bigint,
           est_days_min integer, est_days_max integer);
    v_ship_out := case
      when v_cart.shipping_address is null or not app.address_valid(v_cart.shipping_address)
        then jsonb_build_object('status', 'address_required')
      when v_rate.rate_id is null and v_rate_id is not null then jsonb_build_object('status', 'unavailable')
      when v_rate.rate_id is null then jsonb_build_object('status', 'rate_required')
      else jsonb_build_object('status', 'ok', 'rate_id', v_rate.rate_id, 'name', v_rate.name, 'type', v_rate.type,
                              'price', v_rate.price, 'free_over_subtotal', v_rate.free_over_subtotal,
                              'est_days_min', v_rate.est_days_min, 'est_days_max', v_rate.est_days_max)
    end;
  else
    v_ship_out := jsonb_build_object('status', 'not_required');
  end if;

  v_totals := app.cart_totals(
    (select coalesce(jsonb_agg(jsonb_build_object('unit_price', l -> 'unit_price', 'quantity', l -> 'quantity')
                               order by n), '[]'::jsonb)
       from jsonb_array_elements(v_sellable) with ordinality e(l, n)),
    jsonb_build_object(
      'tax_rate_bps', v_store.tax_rate_bps, 'prices_include_tax', v_store.prices_include_tax,
      'tax_applies_to_shipping', v_store.tax_applies_to_shipping,
      'discount', case when v_disc_out ->> 'status' = 'ok'
                       then jsonb_build_object('type', v_disc_out -> 'type', 'value', v_disc_out -> 'value') end,
      'shipping', case when v_ship_out ->> 'status' = 'ok' then v_ship_out end));

  -- Unir el cálculo por línea con los datos de cada línea vendible.
  for v_line in select * from jsonb_array_elements(v_sellable) loop
    v_merged := v_merged || (v_line || (v_totals -> 'lines' -> v_i));
    v_i := v_i + 1;
  end loop;
  v_merged := v_merged || coalesce((select jsonb_agg(l order by n) from jsonb_array_elements(v_lines)
                                       with ordinality e(l, n) where l ->> 'state' = 'unavailable'), '[]'::jsonb);

  return jsonb_build_object(
    'cart_id', v_cart.id, 'currency', v_store.currency, 'prices_include_tax', v_store.prices_include_tax,
    'tax_rate_bps', v_store.tax_rate_bps, 'tax_applies_to_shipping', v_store.tax_applies_to_shipping,
    'email', v_cart.email, 'shipping_address', v_cart.shipping_address,
    'lines', v_merged, 'item_count', (select coalesce(sum((l ->> 'quantity')::integer), 0)
                                        from jsonb_array_elements(v_sellable) l),
    'requires_shipping', v_needs, 'weight_g', v_weight,
    'discount', case when v_disc_out is null then null
                     else v_disc_out || jsonb_build_object('amount', case when v_disc_out ->> 'status' = 'ok'
                                                                          then v_totals -> 'discount_total' else to_jsonb(0) end) end,
    'shipping', v_ship_out, 'shipping_options', v_options,
    'subtotal', v_totals -> 'subtotal', 'discount_total', v_totals -> 'discount_total',
    'shipping_total', v_totals -> 'shipping_total', 'tax_total', v_totals -> 'tax_total',
    'total', v_totals -> 'total',
    'has_unavailable', exists (select 1 from jsonb_array_elements(v_lines) l where l ->> 'state' = 'unavailable'),
    'has_insufficient_stock', exists (select 1 from jsonb_array_elements(v_lines) l
                                       where l ->> 'state' = 'insufficient_stock'));
end
$$;
revoke all on function app.calculate_cart(uuid, uuid, uuid, text) from public;
