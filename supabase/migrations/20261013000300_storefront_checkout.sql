-- =============================================================================
-- Fase 6 · Carrito público y place_order (F6-T03). Contrato: GATE0 §17.2-17.6.
--
-- * El navegador solo aporta: token del carrito (cookie httpOnly; aquí llega en
--   claro y se guarda su SHA-256), variante y cantidad, datos de contacto,
--   dirección, tarifa, código, `expected_total` e `idempotency_key`.
-- * El token del invitado para ver su pedido lo deriva el servidor
--   (HMAC de la clave de idempotencia); aquí solo llega su hash.
-- * place_order es UNA transacción sin llamadas de red: cualquier error revierte
--   pedido, contador, cupón y reservas.
-- =============================================================================

-- El pedido recuerda su carrito para que una repetición (doble clic) solo
-- devuelva el pedido a quien tiene ese carrito.
alter table public.orders add column cart_id uuid;
alter table public.orders
  add constraint orders_cart_fk foreign key (store_id, cart_id) references public.carts (store_id, id)
  on delete set null (cart_id);

create or replace function app.orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable text[] := array['paid_total', 'refunded_total', 'status', 'payment_status', 'fulfillment_status',
                            'needs_attention', 'cancel_reason', 'staff_note', 'paid_at', 'cancelled_at',
                            'completed_at', 'customer_id', 'shipping_rate_id', 'cart_id', 'updated_at'];
  v_actor   text := coalesce(nullif(current_setting('app.order_actor', true), ''), 'system');
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

-- -----------------------------------------------------------------------------
-- Ayudas
-- -----------------------------------------------------------------------------
create or replace function app.cart_token_hash(p_token text)
returns bytea
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'cart_token';
  end if;
  return sha256(convert_to(p_token, 'UTF8'));
end
$$;
revoke all on function app.cart_token_hash(text) from public;

-- La tienda acepta carritos (activa o en vista previa de borrador) y su
-- organización no está suspendida ni cerrada.
create or replace function app.store_accepts_carts(p_store_id uuid, p_for_order boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.stores s
                   join public.organizations o on o.id = s.organization_id
                  where s.id = p_store_id and o.status = 'active'
                    and (s.status = 'active' or (not p_for_order and s.status = 'draft')))
$$;
revoke all on function app.store_accepts_carts(uuid, boolean) from public;

-- Carrito activo y vigente del token (o null).
create or replace function app.cart_for_token(p_store_id uuid, p_token text)
returns public.carts
language sql
stable
security definer
set search_path = ''
as $$
  select c.* from public.carts c
   where c.store_id = p_store_id and c.token_hash = app.cart_token_hash(p_token)
     and c.status = 'active' and c.expires_at > now()
$$;
revoke all on function app.cart_for_token(uuid, text) from public;

create or replace function app.cart_view(p_cart public.carts)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.calculate_cart(p_cart.store_id, p_cart.id, p_cart.shipping_rate_id, p_cart.discount_code)
         || jsonb_build_object('discount_code', p_cart.discount_code, 'shipping_rate_id', p_cart.shipping_rate_id,
                               'expires_at', p_cart.expires_at)
$$;
revoke all on function app.cart_view(public.carts) from public;

-- Toca la actividad y extiende la vigencia (30 días desde la última actividad).
create or replace function app.cart_touch(p_cart_id uuid)
returns public.carts
language sql
security definer
set search_path = ''
as $$
  update public.carts set last_activity_at = now(), expires_at = now() + interval '30 days'
   where id = p_cart_id
  returning *
$$;
revoke all on function app.cart_touch(uuid) from public;

-- -----------------------------------------------------------------------------
-- storefront.cart_* (solo storefront_gateway)
-- -----------------------------------------------------------------------------
create or replace function storefront.cart_get(p_store_id uuid, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cart public.carts;
begin
  if not app.store_accepts_carts(p_store_id, false) then
    return null;
  end if;
  v_cart := app.cart_for_token(p_store_id, p_token);
  return case when v_cart.id is null then null else app.cart_view(v_cart) end;
end
$$;

-- Agrega unidades (crea el carrito con ese token si no existe). Un token de un
-- carrito ya convertido o abandonado → conflict `cart_closed`: el servidor
-- emite un token nuevo.
create or replace function storefront.cart_add_item(p_store_id uuid, p_token text, p_variant_id uuid,
                                                    p_quantity integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea := app.cart_token_hash(p_token);
  v_cart public.carts;
  v_qty  integer;
begin
  if not app.store_accepts_carts(p_store_id, false) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'store';
  end if;
  if p_quantity is null or p_quantity not between 1 and 999 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'quantity';
  end if;
  if not exists (select 1 from public.product_variants v
                   join public.products p on p.store_id = v.store_id and p.id = v.product_id
                  where v.store_id = p_store_id and v.id = p_variant_id and v.deleted_at is null
                    and v.status = 'active' and p.status = 'active' and p.deleted_at is null
                    and p.product_type = 'physical') then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'variant';
  end if;

  select * into v_cart from public.carts c where c.token_hash = v_hash for update;
  if v_cart.id is not null and (v_cart.store_id <> p_store_id or v_cart.status <> 'active'
                                or v_cart.expires_at <= now()) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'cart_closed';
  end if;
  if v_cart.id is null then
    insert into public.carts (store_id, token_hash) values (p_store_id, v_hash)
    on conflict (token_hash) do nothing
    returning * into v_cart;
    if v_cart.id is null then -- carrera con otra petición del mismo token
      select * into v_cart from public.carts c where c.token_hash = v_hash and c.store_id = p_store_id for update;
    end if;
  end if;

  if (select count(*) from public.cart_items ci where ci.cart_id = v_cart.id and ci.variant_id <> p_variant_id) >= 50 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'cart_lines';
  end if;
  insert into public.cart_items (store_id, cart_id, variant_id, quantity)
  values (p_store_id, v_cart.id, p_variant_id, p_quantity)
  on conflict (cart_id, variant_id) do update set quantity = public.cart_items.quantity + excluded.quantity
  returning quantity into v_qty;
  if v_qty > 999 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'quantity';
  end if;
  return app.cart_view(app.cart_touch(v_cart.id));
end
$$;

-- Fija la cantidad de una línea; 0 la quita.
create or replace function storefront.cart_set_quantity(p_store_id uuid, p_token text, p_variant_id uuid,
                                                        p_quantity integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart public.carts := app.cart_for_token(p_store_id, p_token);
begin
  if v_cart.id is null or not app.store_accepts_carts(p_store_id, false) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'cart';
  end if;
  if p_quantity is null or p_quantity not between 0 and 999 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'quantity';
  end if;
  perform 1 from public.carts c where c.id = v_cart.id for update;
  if p_quantity = 0 then
    delete from public.cart_items ci where ci.cart_id = v_cart.id and ci.variant_id = p_variant_id;
  else
    update public.cart_items ci set quantity = p_quantity
     where ci.cart_id = v_cart.id and ci.variant_id = p_variant_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'not_found', detail = 'line';
    end if;
  end if;
  return app.cart_view(app.cart_touch(v_cart.id));
end
$$;

-- Datos del checkout guardados en el carrito (todos opcionales; null borra).
-- p_details: {email?, shipping_address?, shipping_rate_id?, discount_code?}
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
    if v_code is not null and v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then
      raise exception using errcode = 'P0001', message = 'discount_invalid', detail = 'not_found';
    end if;
    update public.carts set discount_code = v_code where id = v_cart.id;
  end if;
  return app.cart_view(app.cart_touch(v_cart.id));
end
$$;

-- Métodos de pago disponibles en el checkout (sin configuración secreta).
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
$$;

-- Respuesta de una repetición idempotente: el pedido y su último intento de pago.
create or replace function app.order_replay(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('order_id', o.id, 'display_number', o.display_number, 'total', o.total,
                            'currency', o.currency, 'replayed', true,
                            'payment', (select jsonb_build_object('id', p.id, 'provider', p.provider,
                                                                  'status', p.status, 'expires_at', p.expires_at)
                                          from public.payments p where p.store_id = o.store_id and p.order_id = o.id
                                         order by p.created_at desc limit 1))
    from public.orders o where o.id = p_order_id
$$;
revoke all on function app.order_replay(uuid) from public;

-- -----------------------------------------------------------------------------
-- storefront.place_order (§17.4). p_input:
--   {email, customer_name, phone?, shipping_address?, shipping_rate_id?, discount_code?,
--    customer_note?, payment_account_id, accepts_marketing?}
-- -----------------------------------------------------------------------------
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
  insert into public.customers (store_id, email, phone, accepts_marketing, marketing_consent_at,
                                marketing_consent_source)
  values (p_store_id, v_email, v_phone, coalesce((p_input ->> 'accepts_marketing')::boolean, false),
          case when coalesce((p_input ->> 'accepts_marketing')::boolean, false) then now() end,
          case when coalesce((p_input ->> 'accepts_marketing')::boolean, false) then 'checkout' end)
  on conflict (store_id, email) do update
     set accepts_marketing = public.customers.accepts_marketing or excluded.accepts_marketing,
         marketing_consent_at = coalesce(public.customers.marketing_consent_at, excluded.marketing_consent_at),
         marketing_consent_source = coalesce(public.customers.marketing_consent_source,
                                             excluded.marketing_consent_source)
  returning id into v_customer;

  -- 8. Pedido con snapshot.
  insert into public.orders (
    store_id, number, display_number, guest_access_token_hash, source, checkout_idempotency_key, cart_id,
    customer_id, email, phone, customer_name, shipping_address, requires_shipping,
    currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
    shipping_rate_id, shipping_snapshot, discount_snapshot,
    subtotal, discount_total, shipping_total, tax_total, total, customer_note)
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
    (v_calc ->> 'tax_total')::bigint, (v_calc ->> 'total')::bigint, v_note)
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

-- Pedido del invitado (§16.5): id + hash de su token. Sin datos internos.
create or replace function storefront.get_order_for_guest(p_store_id uuid, p_order_id uuid, p_token_hash bytea)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'display_number', o.display_number, 'status', o.status, 'payment_status', o.payment_status,
    'fulfillment_status', o.fulfillment_status, 'placed_at', o.placed_at, 'paid_at', o.paid_at,
    'cancelled_at', o.cancelled_at, 'cancel_reason', o.cancel_reason,
    'email', o.email, 'customer_name', o.customer_name, 'shipping_address', o.shipping_address,
    'currency', o.currency, 'prices_include_tax', o.prices_include_tax,
    'subtotal', o.subtotal, 'discount_total', o.discount_total, 'shipping_total', o.shipping_total,
    'tax_total', o.tax_total, 'total', o.total, 'shipping', o.shipping_snapshot,
    'discount', o.discount_snapshot - 'value',
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'product_title', i.product_title, 'variant_title', i.variant_title, 'quantity', i.quantity,
                'unit_price', i.unit_price, 'line_total', i.line_total, 'image_path', i.image_path)
                order by i.position), '[]'::jsonb)
                from public.order_items i where i.store_id = o.store_id and i.order_id = o.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('type', e.type, 'to_value', e.to_value,
                                                            'message', e.message, 'created_at', e.created_at)
                                         order by e.created_at), '[]'::jsonb)
                 from public.order_events e
                where e.store_id = o.store_id and e.order_id = o.id and e.customer_visible),
    'payment', (select jsonb_build_object('id', p.id, 'provider', p.provider, 'status', p.status,
                                          'expires_at', p.expires_at, 'display_name', a.display_name,
                                          'instructions', a.public_config ->> 'instructions')
                  from public.payments p
                  join public.payment_accounts a on a.store_id = p.store_id and a.id = p.payment_account_id
                 where p.store_id = o.store_id and p.order_id = o.id
                 order by p.created_at desc limit 1))
    from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id
     and p_token_hash is not null and o.guest_access_token_hash = p_token_hash
$$;

revoke all on function storefront.cart_get(uuid, text) from public;
revoke all on function storefront.cart_add_item(uuid, text, uuid, integer) from public;
revoke all on function storefront.cart_set_quantity(uuid, text, uuid, integer) from public;
revoke all on function storefront.cart_set_details(uuid, text, jsonb) from public;
revoke all on function storefront.payment_methods(uuid) from public;
revoke all on function storefront.place_order(uuid, text, jsonb, bigint, text, bytea) from public;
revoke all on function storefront.get_order_for_guest(uuid, uuid, bytea) from public;
grant execute on function storefront.cart_get(uuid, text) to storefront_gateway;
grant execute on function storefront.cart_add_item(uuid, text, uuid, integer) to storefront_gateway;
grant execute on function storefront.cart_set_quantity(uuid, text, uuid, integer) to storefront_gateway;
grant execute on function storefront.cart_set_details(uuid, text, jsonb) to storefront_gateway;
grant execute on function storefront.payment_methods(uuid) to storefront_gateway;
grant execute on function storefront.place_order(uuid, text, jsonb, bigint, text, bytea) to storefront_gateway;
grant execute on function storefront.get_order_for_guest(uuid, uuid, bytea) to storefront_gateway;
