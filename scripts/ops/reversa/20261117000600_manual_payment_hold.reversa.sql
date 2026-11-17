-- =============================================================================
-- Reversa de 20261117000600_manual_payment_hold.sql (integración del issue #18).
-- Vuelve `storefront.place_order` a la definición de 20261013000600 (el pago
-- manual vence con el plazo de la tienda) y la versión a 20261117000500.
-- Sin pérdida: no toca tablas ni datos; los pedidos ya creados conservan su plazo.
-- Uso (solo con autorización): psql -X -1 -v ON_ERROR_STOP=1 -f <este archivo>
-- =============================================================================

-- Candado: solo sobre una base exactamente en 20261117000600.
do $$
begin
  if coalesce(public.app_schema_version(), '') <> '20261117000600' then
    raise exception using errcode = 'P0001', message = 'reversa_bloqueada',
      detail = format('La base está en %s; esta reversa solo aplica a 20261117000600.',
                      coalesce(public.app_schema_version(), 'desconocida'));
  end if;
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


create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261117000500'::text
$$;
