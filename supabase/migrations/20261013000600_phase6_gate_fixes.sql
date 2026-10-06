-- =============================================================================
-- Gate F6 · correcciones de la revisión adversarial (docs/phases/PHASE-06-REPORT.md §5)
-- M2 códigos: límite por IP además del carrito; un código no válido no revela
--    tipo ni valor (inactivo/no iniciado = inexistente para el público);
--    envío gratis sin envío = no aplica.
-- M3 consentimiento de marketing: se guarda en el pedido y pasa al cliente
--    solo al confirmarse el pago.
-- M4 límite diario por email: cuenta solo pedidos creados (dentro de place_order).
-- L1 orden de bloqueos pedido → pago también en mark_payment_*.
-- L2 sin actor explícito, el guard NO concede las transiciones de sistema.
-- L3 reintentar un pago devuelve el pedido a `pending`.
-- L4 nota interna con customers.pii.read y auditada.
-- L5 `fake` no se lista sin payments.allow_fake.
-- L6 vigencia de descuentos por día en la zona horaria de la tienda (fin inclusivo).
-- =============================================================================

alter table public.orders add column accepts_marketing boolean not null default false;


create or replace function app.orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable text[] := array['paid_total', 'refunded_total', 'status', 'payment_status', 'fulfillment_status',
                            'needs_attention', 'cancel_reason', 'staff_note', 'paid_at', 'cancelled_at',
                            'completed_at', 'customer_id', 'shipping_rate_id', 'cart_id', 'updated_at'];
  v_actor   text := coalesce(nullif(current_setting('app.order_actor', true), ''), 'unknown');
begin
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable)
     or (new.customer_id is distinct from old.customer_id and new.customer_id is not null)
     or (new.shipping_rate_id is distinct from old.shipping_rate_id and new.shipping_rate_id is not null)
     or (new.cart_id is distinct from old.cart_id and new.cart_id is not null) then
    raise exception using errcode = '42501', message = 'immutable', detail = 'orders';
  end if;
  perform app.assert_order_transition('status', old.status, new.status, v_actor);
  perform app.assert_order_transition('payment', old.payment_status, new.payment_status, v_actor);
  perform app.assert_order_transition('fulfillment', old.fulfillment_status, new.fulfillment_status, v_actor);
  if old.fulfillment_status = 'unfulfilled' and new.fulfillment_status <> 'unfulfilled'
     and new.payment_status not in ('paid', 'partially_refunded') then
    raise exception using errcode = 'P0001', message = 'invalid_transition', detail = 'fulfillment_requires_payment';
  end if;
  return new;
end
$$;

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
    if v_disc.status = 'ok' and v_disc.type = 'free_shipping' and not v_needs then
      v_disc.status := 'not_applicable';
    end if;
    -- Un código no válido no revela si existe, su tipo ni su valor (Gate F6).
    v_disc_out := case
      when v_disc.status = 'ok' then
        jsonb_build_object('code', v_code, 'status', 'ok', 'type', v_disc.type, 'value', v_disc.value,
                           'min_subtotal', v_disc.min_subtotal)
      else jsonb_build_object('code', v_code,
                              'status', case when v_disc.status in ('inactive', 'not_started') then 'not_found'
                                             else v_disc.status end,
                              'min_subtotal', case when v_disc.status = 'min_subtotal' then v_disc.min_subtotal end)
    end;
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

create or replace function storefront.place_order(p_store_id uuid, p_token text, p_input jsonb, p_expected_total bigint,
                                                  p_idem_key text, p_guest_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash      bytea := app.cart_token_hash(p_token);
  v_order     public.orders;
  v_cart      public.carts;
  v_store     public.stores;
  v_calc      jsonb;
  v_email     text := lower(btrim(coalesce(p_input ->> 'email', '')));
  v_name      text := btrim(coalesce(p_input ->> 'customer_name', ''));
  v_phone     text := nullif(btrim(coalesce(p_input ->> 'phone', '')), '');
  v_note      text := nullif(btrim(coalesce(p_input ->> 'customer_note', '')), '');
  v_account   uuid;
  v_provider  text;
  v_rate      uuid;
  v_disc      record;
  v_disc_id   uuid;
  v_number    bigint;
  v_customer  uuid;
  v_ttl       integer;
  v_expires   timestamptz;
  v_payment   uuid;
  v_items     jsonb;
  v_line      jsonb;
  v_pos       integer := 0;
begin
  if p_idem_key is null or p_idem_key !~ '^[A-Za-z0-9_-]{16,100}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'idempotency_key';
  end if;
  if p_guest_token_hash is null or octet_length(p_guest_token_hash) <> 32 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'guest_token';
  end if;

  -- 0. Idempotencia: el mismo carrito y la misma clave devuelven el mismo pedido.
  select o.* into v_order from public.orders o
   where o.store_id = p_store_id and o.checkout_idempotency_key = p_idem_key;
  if v_order.id is not null then
    if not exists (select 1 from public.carts c where c.store_id = p_store_id and c.id = v_order.cart_id
                                                  and c.token_hash = v_hash) then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'idempotency_key';
    end if;
    return app.order_replay(v_order.id);
  end if;

  -- 1. Carrito bloqueado (serializa por carrito). Tras esperar el bloqueo, una
  --    petición gemela ya pudo crear el pedido: se repite el paso 0.
  select * into v_cart from public.carts c
   where c.store_id = p_store_id and c.token_hash = v_hash for update;
  select o.* into v_order from public.orders o
   where o.store_id = p_store_id and o.checkout_idempotency_key = p_idem_key and o.cart_id = v_cart.id;
  if v_order.id is not null then
    return app.order_replay(v_order.id);
  end if;
  if v_cart.id is null or v_cart.status <> 'active' or v_cart.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'cart_invalid', detail = 'cart';
  end if;

  -- 2. Tienda activa y organización no suspendida.
  if not app.store_accepts_carts(p_store_id, true) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
  end if;
  select * into v_store from public.stores s where s.id = p_store_id;

  -- 3. Validación de la entrada.
  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'input';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'email';
  end if;
  if char_length(v_name) not between 1 and 160 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'customer_name';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{7,20}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'phone';
  end if;
  if char_length(coalesce(v_note, '')) > 1000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'customer_note';
  end if;
  if jsonb_typeof(p_input -> 'shipping_address') = 'object' and not app.address_valid(p_input -> 'shipping_address') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'shipping_address';
  end if;
  begin
    v_account := (p_input ->> 'payment_account_id')::uuid;
    v_rate := nullif(p_input ->> 'shipping_rate_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'input';
  end;
  select a.provider into v_provider from public.payment_accounts a
   where a.store_id = p_store_id and a.id = v_account and a.status = 'active';
  if v_provider is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'payment_account_id';
  end if;

  update public.carts
     set email = v_email,
         shipping_address = case when jsonb_typeof(p_input -> 'shipping_address') = 'object'
                                 then p_input -> 'shipping_address' else shipping_address end,
         shipping_rate_id = coalesce(v_rate, shipping_rate_id),
         discount_code = case when p_input ? 'discount_code'
                              then nullif(upper(btrim(coalesce(p_input ->> 'discount_code', ''))), '')
                              else discount_code end
   where id = v_cart.id
  returning * into v_cart;

  -- 4. Totales desde la base; el total esperado solo detecta cambios.
  v_calc := app.calculate_cart(p_store_id, v_cart.id, v_cart.shipping_rate_id, v_cart.discount_code);
  if jsonb_array_length(v_calc -> 'lines') = 0 or (v_calc ->> 'item_count')::integer = 0 then
    raise exception using errcode = 'P0001', message = 'cart_invalid', detail = 'empty';
  end if;
  if (v_calc ->> 'has_unavailable')::boolean then
    raise exception using errcode = 'P0001', message = 'cart_invalid', detail = 'unavailable';
  end if;
  if (v_calc ->> 'requires_shipping')::boolean and v_calc -> 'shipping' ->> 'status' <> 'ok' then
    raise exception using errcode = 'P0001', message = 'validation_failed',
                          detail = case v_calc -> 'shipping' ->> 'status' when 'address_required' then 'shipping_address'
                                        else 'shipping_rate_id' end;
  end if;
  if v_cart.discount_code is not null and v_calc -> 'discount' ->> 'status' <> 'ok' then
    raise exception using errcode = 'P0001', message = 'discount_invalid', detail = v_calc -> 'discount' ->> 'status';
  end if;
  if (v_calc ->> 'total')::bigint = 0 then
    -- Sin pasarela no hay pedidos gratuitos en el MVP (D-F6-05).
    raise exception using errcode = 'P0001', message = 'cart_invalid', detail = 'zero_total';
  end if;
  if p_expected_total is distinct from (v_calc ->> 'total')::bigint then
    raise exception using errcode = 'P0001', message = 'price_changed', detail = v_calc ->> 'total';
  end if;

  -- 5. Cupón: bloqueo, revalidación y reserva (cuenta para el límite).
  if v_cart.discount_code is not null then
    select d.id into v_disc_id from public.discounts d
     where d.store_id = p_store_id and d.code = v_cart.discount_code for update;
    select * into v_disc from app.discount_status(p_store_id, v_cart.discount_code,
                                                  (v_calc ->> 'subtotal')::bigint, v_email);
    if v_disc.status <> 'ok' then
      raise exception using errcode = 'P0001', message = 'discount_invalid', detail = v_disc.status;
    end if;
    update public.discounts set times_reserved = times_reserved + 1 where id = v_disc_id;
  end if;

  -- 6. Número del pedido (contador por tienda; se revierte con todo lo demás).
  --    Upsert atómico: también serializa los primeros pedidos simultáneos de una
  --    tienda sin fila de contador (carrera hallada por la prueba de concurrencia).
  insert into public.store_counters (store_id, key, value)
  values (p_store_id, 'order_number', v_store.order_number_start)
  on conflict (store_id, key) do update set value = public.store_counters.value + 1
  returning value into v_number;

  -- 7. Cliente por email (uno por tienda).
  -- El consentimiento de marketing se guarda en el pedido y solo pasa al cliente
  -- al confirmarse el pago (Gate F6: nadie suscribe un email ajeno con un pedido impago).
  insert into public.customers (store_id, email, phone)
  values (p_store_id, v_email, v_phone)
  on conflict (store_id, email) do update set updated_at = now()
  returning id into v_customer;

  -- 8. Pedido con snapshot.
  insert into public.orders (
    store_id, number, display_number, guest_access_token_hash, source, checkout_idempotency_key, cart_id,
    customer_id, email, phone, customer_name, shipping_address, requires_shipping,
    currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
    shipping_rate_id, shipping_snapshot, discount_snapshot,
    subtotal, discount_total, shipping_total, tax_total, total, customer_note, accepts_marketing)
  values (
    p_store_id, v_number, coalesce(v_store.order_number_prefix, '#') || v_number, p_guest_token_hash, 'storefront',
    p_idem_key, v_cart.id, v_customer, v_email, v_phone, v_name,
    case when (v_calc ->> 'requires_shipping')::boolean then v_cart.shipping_address end,
    (v_calc ->> 'requires_shipping')::boolean,
    v_store.currency, v_store.prices_include_tax, v_store.tax_rate_bps, v_store.tax_applies_to_shipping,
    case when v_calc -> 'shipping' ->> 'status' = 'ok' then (v_calc -> 'shipping' ->> 'rate_id')::uuid end,
    case when v_calc -> 'shipping' ->> 'status' = 'ok' then (v_calc -> 'shipping') - 'status' end,
    case when v_cart.discount_code is not null then
      jsonb_build_object('code', v_cart.discount_code, 'type', v_calc -> 'discount' -> 'type',
                         'value', v_calc -> 'discount' -> 'value', 'amount', v_calc -> 'discount_total') end,
    (v_calc ->> 'subtotal')::bigint, (v_calc ->> 'discount_total')::bigint, (v_calc ->> 'shipping_total')::bigint,
    (v_calc ->> 'tax_total')::bigint, (v_calc ->> 'total')::bigint, v_note,
    coalesce((p_input ->> 'accepts_marketing')::boolean, false))
  returning * into v_order;

  -- 9. Partidas (snapshot).
  for v_line in select * from jsonb_array_elements(v_calc -> 'lines') loop
    insert into public.order_items (
      store_id, order_id, variant_id, product_id, product_title, variant_title, sku, option_values, image_path,
      product_type, requires_shipping, weight_g, unit_price, compare_at_price, quantity, discount_allocation,
      tax_amount, line_total, position)
    values (
      p_store_id, v_order.id, (v_line ->> 'variant_id')::uuid, (v_line ->> 'product_id')::uuid,
      v_line ->> 'product_title', v_line ->> 'variant_title', v_line ->> 'sku', v_line -> 'option_values',
      v_line -> 'image' ->> 'path', v_line ->> 'product_type', (v_line ->> 'requires_shipping')::boolean,
      (v_line ->> 'weight_g')::integer, (v_line ->> 'unit_price')::bigint,
      (v_line ->> 'compare_at_price')::bigint, (v_line ->> 'quantity')::integer,
      (v_line ->> 'discount_allocation')::bigint, (v_line ->> 'tax_amount')::bigint,
      (v_line ->> 'line_total')::bigint, v_pos);
    v_pos := v_pos + 1;
  end loop;

  if v_disc_id is not null then
    insert into public.discount_redemptions (store_id, discount_id, order_id, customer_id, amount)
    values (p_store_id, v_disc_id, v_order.id, v_customer, (v_calc ->> 'discount_total')::bigint);
  end if;

  -- 10. Reserva de inventario: `insufficient_stock` revierte TODO.
  v_ttl := v_store.reservation_ttl_minutes;
  v_expires := now() + make_interval(mins => v_ttl);
  select jsonb_agg(jsonb_build_object('variant_id', l -> 'variant_id', 'quantity', l -> 'quantity'))
    into v_items from jsonb_array_elements(v_calc -> 'lines') l;
  perform app.inventory_reserve(p_store_id, v_order.id, v_items, v_expires);

  -- 11. Intento de pago (la llamada al proveedor va después del commit, §17.5).
  insert into public.payments (store_id, order_id, payment_account_id, provider, amount, currency, idempotency_key,
                               expires_at)
  values (p_store_id, v_order.id, v_account, v_provider, v_order.total, v_order.currency,
          'pay_' || replace(v_order.id::text, '-', ''), v_expires - interval '2 minutes')
  returning id into v_payment;

  -- §17.7: 20 pedidos por email y tienda al día. Cuenta solo pedidos creados:
  -- un intento fallido revierte también este contador (Gate F6).
  if not app.rate_limit_take('checkout:email:' || p_store_id || ':' || encode(sha256(convert_to(v_email, 'UTF8')), 'hex'),
                             20, 86400) then
    raise exception using errcode = 'P0001', message = 'rate_limited', detail = 'email';
  end if;

  -- 12-13. Carrito convertido; evento y job.
  update public.carts set status = 'converted' where id = v_cart.id;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, metadata)
  values (p_store_id, v_order.id, 'order.created', 'Pedido recibido', true, 'customer',
          jsonb_build_object('total', v_order.total, 'items', (v_calc ->> 'item_count')::integer));
  perform app.enqueue_job('order.created', jsonb_build_object('order_id', v_order.id), p_store_id,
                          'order.created:' || v_order.id);

  return jsonb_build_object('order_id', v_order.id, 'display_number', v_order.display_number,
                            'total', v_order.total, 'currency', v_order.currency, 'replayed', false,
                            'payment', jsonb_build_object('id', v_payment, 'provider', v_provider, 'status', 'created',
                                                          'expires_at', v_expires - interval '2 minutes'));
end
$$;

create or replace function app.confirm_order_payment(p_payment_id uuid, p_actor text, p_method text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay   public.payments;
  v_order public.orders;
  v_res   uuid;
begin
  select * into v_pay from public.payments p where p.id = p_payment_id;
  if v_pay.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'payment';
  end if;
  select * into v_order from public.orders o where o.store_id = v_pay.store_id and o.id = v_pay.order_id for update;
  perform 1 from public.payments p where p.id = v_pay.id for update;
  select * into v_pay from public.payments p where p.id = p_payment_id;

  if v_pay.status = 'succeeded' then
    return jsonb_build_object('order_id', v_order.id, 'replayed', true);
  end if;
  if v_order.status <> 'pending_payment' or v_pay.status not in ('created', 'pending', 'authorized') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'order_not_payable';
  end if;
  select r.id into v_res from public.inventory_reservations r
   where r.store_id = v_order.store_id and r.order_id = v_order.id and r.status = 'active';
  if v_res is null then
    -- La reserva venció: el pago tardío (re-reserva, CF-04) llega con la F7.
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'reservation_expired';
  end if;

  perform app.set_order_actor(p_actor);
  update public.payments set status = 'succeeded', method = coalesce(p_method, method), last_synced_at = now()
   where id = v_pay.id;
  perform app.inventory_commit(v_order.store_id, v_res);
  update public.orders
     set status = 'open', payment_status = 'paid', paid_total = total, paid_at = now()
   where id = v_order.id;

  update public.discounts d set times_reserved = d.times_reserved - 1, times_used = d.times_used + 1
    from public.discount_redemptions dr
   where dr.order_id = v_order.id and dr.status = 'reserved' and d.store_id = dr.store_id and d.id = dr.discount_id;
  update public.discount_redemptions set status = 'confirmed' where order_id = v_order.id and status = 'reserved';

  update public.customers
     set orders_count = orders_count + 1, total_spent = total_spent + v_order.total,
         accepts_marketing = accepts_marketing or v_order.accepts_marketing,
         marketing_consent_at = case when v_order.accepts_marketing and marketing_consent_at is null
                                     then now() else marketing_consent_at end,
         marketing_consent_source = case when v_order.accepts_marketing and marketing_consent_source is null
                                         then 'checkout' else marketing_consent_source end
   where store_id = v_order.store_id and id = v_order.customer_id;
  update public.products p set sales_count = p.sales_count + x.q
    from (select i.product_id, sum(i.quantity)::integer as q from public.order_items i
           where i.store_id = v_order.store_id and i.order_id = v_order.id and i.product_id is not null
           group by i.product_id) x
   where p.store_id = v_order.store_id and p.id = x.product_id;

  perform app.enqueue_job('order.paid', jsonb_build_object('order_id', v_order.id), v_order.store_id,
                          'order.paid:' || v_order.id);
  return jsonb_build_object('order_id', v_order.id, 'replayed', false);
end
$$;

create or replace function system.mark_payment_pending(p_payment_id uuid, p_provider_checkout_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments;
begin
  -- Mismo orden de bloqueo que confirm_order_payment y expire_orders: pedido → pago.
  perform 1 from public.orders o join public.payments p on p.store_id = o.store_id and p.order_id = o.id
   where p.id = p_payment_id for update of o;
  select * into v_pay from public.payments p where p.id = p_payment_id for update;
  if v_pay.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'payment';
  end if;
  if v_pay.status <> 'created' then
    return; -- idempotente: ya avanzó
  end if;
  perform app.set_order_actor('system');
  update public.payments set status = 'pending', provider_checkout_id = left(p_provider_checkout_id, 200)
   where id = v_pay.id;
  update public.orders set payment_status = 'pending'
   where store_id = v_pay.store_id and id = v_pay.order_id and payment_status in ('unpaid', 'failed')
     and status = 'pending_payment';
end
$$;

create or replace function system.mark_payment_failed(p_payment_id uuid, p_failure_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments;
begin
  -- Mismo orden de bloqueo que confirm_order_payment y expire_orders: pedido → pago.
  perform 1 from public.orders o join public.payments p on p.store_id = o.store_id and p.order_id = o.id
   where p.id = p_payment_id for update of o;
  select * into v_pay from public.payments p where p.id = p_payment_id for update;
  if v_pay.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'payment';
  end if;
  if v_pay.status not in ('created', 'pending') then
    return;
  end if;
  perform app.set_order_actor('system');
  update public.payments set status = 'failed', failure_code = left(coalesce(p_failure_code, 'provider_error'), 100)
   where id = v_pay.id;
  -- El pedido sigue pendiente con su reserva: se puede reintentar (§17.5.16).
  update public.orders set payment_status = 'failed'
   where store_id = v_pay.store_id and id = v_pay.order_id and payment_status in ('unpaid', 'pending')
     and status = 'pending_payment';
end
$$;

create or replace function storefront.retry_payment(p_store_id uuid, p_order_id uuid, p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_last  public.payments;
  v_res   public.inventory_reservations;
  v_id    uuid;
begin
  select * into v_order from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id and p_token_hash is not null
     and o.guest_access_token_hash = p_token_hash for update;
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  select * into v_res from public.inventory_reservations r
   where r.store_id = p_store_id and r.order_id = v_order.id and r.status = 'active';
  if v_order.status <> 'pending_payment' or v_res.id is null or v_res.expires_at <= now() + interval '3 minutes' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'order_not_payable';
  end if;
  select * into v_last from public.payments p
   where p.store_id = p_store_id and p.order_id = v_order.id order by p.created_at desc limit 1;
  if v_last.status in ('created', 'pending', 'authorized') then
    return jsonb_build_object('id', v_last.id, 'provider', v_last.provider, 'status', v_last.status,
                              'expires_at', v_last.expires_at, 'replayed', true);
  end if;
  if (select count(*) from public.payments p where p.store_id = p_store_id and p.order_id = v_order.id) >= 5 then
    raise exception using errcode = 'P0001', message = 'rate_limited', detail = 'payment_attempts'; -- §17.7
  end if;
  insert into public.payments (store_id, order_id, payment_account_id, provider, amount, currency, idempotency_key,
                               expires_at)
  select p_store_id, v_order.id, a.id, a.provider, v_order.total, v_order.currency,
         'pay_' || replace(app.uuid_v7()::text, '-', ''), v_res.expires_at - interval '2 minutes'
    from public.payment_accounts a
   where a.store_id = p_store_id and a.id = v_last.payment_account_id and a.status = 'active'
  returning id into v_id;
  if v_id is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'payment_account_id';
  end if;
  -- Nuevo intento: el pedido vuelve a `pending` (failed → pending), así una
  -- confirmación posterior no choca con una transición de sistema (Gate F6).
  perform app.set_order_actor('customer');
  update public.orders set payment_status = 'pending'
   where id = v_order.id and payment_status = 'failed';
  return jsonb_build_object('id', v_id, 'provider', v_last.provider, 'status', 'created',
                            'expires_at', v_res.expires_at - interval '2 minutes', 'replayed', false);
end
$$;

create or replace function storefront.payment_methods(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'provider', a.provider, 'display_name', a.display_name,
                                               'instructions', a.public_config ->> 'instructions')
                            order by a.created_at), '[]'::jsonb)
    from public.payment_accounts a
   where a.store_id = p_store_id and a.status = 'active' and app.store_accepts_carts(p_store_id, false)
     and (a.provider <> 'fake' or app.fake_payments_allowed())
$$;

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
  -- El límite por email vive en place_order (solo pedidos creados, Gate F6).
  if not app.rate_limit_take('checkout:ip:' || p_store_id || ':' || p_ip_hash, 10, 600) then
    perform system.record_security_event('checkout.rate_limited', 'warning', null, p_store_id, null, null, null,
                                         jsonb_build_object('ip_hash', left(p_ip_hash, 16)));
    return false;
  end if;
  return true;
end
$$;

-- Intentos de códigos de descuento por IP y tienda (A20): 30 por hora, además
-- de los 10 por carrito (un carrito nuevo no reinicia el límite).
create or replace function storefront.discount_guard(p_store_id uuid, p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'client';
  end if;
  if not app.rate_limit_take('discount:ip:' || p_store_id || ':' || p_ip_hash, 30, 3600) then
    perform system.record_security_event('discount.rate_limited', 'warning', null, p_store_id, null, null, null,
                                         jsonb_build_object('ip_hash', left(p_ip_hash, 16)));
    return false;
  end if;
  return true;
end
$$;
revoke all on function storefront.discount_guard(uuid, text) from public;
grant execute on function storefront.discount_guard(uuid, text) to storefront_gateway;


create or replace function public.orders_set_staff_note(p_store_id uuid, p_order_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'orders.update');
  -- La nota solo se lee con customers.pii.read: solo quien la ve la reescribe.
  perform app.require_store_permission(p_store_id, 'customers.pii.read');
  if char_length(coalesce(p_note, '')) > 4000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'staff_note';
  end if;
  update public.orders set staff_note = nullif(btrim(p_note), '') where store_id = p_store_id and id = p_order_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  perform audit.record('order.staff_note_updated', 'order', p_order_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, null);
end
$$;

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
