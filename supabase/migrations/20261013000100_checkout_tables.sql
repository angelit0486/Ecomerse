-- =============================================================================
-- Fase 6 · Tablas de clientes, carrito, envíos, descuentos, pedidos y pagos (F6-T01)
-- Contrato: GATE0 §9.2, §13, §16, §17.1, §18.3; CF-05, CF-07; D-F4-01.
--
-- * Dinero en bigint (centavos); porcentajes en puntos base.
-- * Pedidos, partidas, eventos, pagos y redenciones nunca se borran.
-- * El snapshot del pedido es inmutable (trigger); solo cambian pagos,
--   reembolsos, estados, `needs_attention`, la nota interna y los tiempos.
-- * Escrituras solo por funciones (`storefront.*`, `system.*` y RPC de staff).
-- * Datos de contacto del pedido (email, teléfono, nombre, direcciones): sin
--   grant de columna; el panel los lee por RPC con `customers.pii.read` (D-F6-01).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tienda: vigencia de la reserva de inventario durante el pago (§17.4 paso 10).
-- -----------------------------------------------------------------------------
alter table public.stores
  add column reservation_ttl_minutes integer not null default 30
    check (reservation_ttl_minutes between 10 and 120);

-- -----------------------------------------------------------------------------
-- Direcciones de clientes (§9.2). Escritura por la cuenta del comprador (F8).
-- -----------------------------------------------------------------------------
create table public.customer_addresses (
  id             uuid primary key default app.uuid_v7(),
  store_id       uuid not null references public.stores (id) on delete restrict,
  customer_id    uuid not null,
  recipient_name text not null check (char_length(btrim(recipient_name)) between 1 and 120),
  line1          text not null check (char_length(btrim(line1)) between 1 and 200),
  line2          text check (line2 is null or char_length(line2) <= 200),
  city           text not null check (char_length(btrim(city)) between 1 and 120),
  region         text not null check (char_length(btrim(region)) between 1 and 120),
  postal_code    text not null check (postal_code ~ '^[A-Za-z0-9 -]{3,12}$'),
  country        text not null check (country ~ '^[A-Z]{2}$'),
  phone          text check (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$'),
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (store_id, id),
  foreign key (store_id, customer_id) references public.customers (store_id, id) on delete cascade
);
create unique index customer_addresses_default_uq on public.customer_addresses (customer_id) where is_default;
create index customer_addresses_customer_idx on public.customer_addresses (store_id, customer_id);

-- -----------------------------------------------------------------------------
-- Envíos (§9.2)
-- -----------------------------------------------------------------------------
create table public.shipping_zones (
  id         uuid primary key default app.uuid_v7(),
  store_id   uuid not null references public.stores (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  countries  text[] not null check (cardinality(countries) between 1 and 250
                                    and array_position(countries, null) is null),
  regions    text[] check (regions is null or (cardinality(regions) between 1 and 200
                                                and array_position(regions, null) is null)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, id)
);

create table public.shipping_rates (
  id                 uuid primary key default app.uuid_v7(),
  store_id           uuid not null references public.stores (id) on delete cascade,
  zone_id            uuid not null,
  name               text not null check (char_length(btrim(name)) between 1 and 80),
  type               text not null check (type in ('flat', 'free_over', 'pickup')),
  price              bigint not null default 0 check (price >= 0),
  free_over_subtotal bigint check (free_over_subtotal is null or free_over_subtotal >= 0),
  min_weight_g       integer check (min_weight_g is null or min_weight_g >= 0),
  max_weight_g       integer check (max_weight_g is null or max_weight_g > 0),
  est_days_min       integer check (est_days_min is null or est_days_min between 0 and 365),
  est_days_max       integer check (est_days_max is null or est_days_max between 0 and 365),
  is_active          boolean not null default true,
  position           integer not null default 0 check (position between 0 and 1000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (store_id, id),
  foreign key (store_id, zone_id) references public.shipping_zones (store_id, id) on delete cascade,
  constraint shipping_rates_free_over check ((type = 'free_over') = (free_over_subtotal is not null)),
  constraint shipping_rates_pickup_free check (type <> 'pickup' or price = 0),
  constraint shipping_rates_weight_range check (min_weight_g is null or max_weight_g is null
                                                or min_weight_g < max_weight_g),
  constraint shipping_rates_days_range check (est_days_min is null or est_days_max is null
                                              or est_days_min <= est_days_max)
);
create index shipping_rates_store_active_idx on public.shipping_rates (store_id, is_active, zone_id);

-- -----------------------------------------------------------------------------
-- Descuentos (D-F6-02). Código normalizado en mayúsculas; los límites cuentan
-- reservados + confirmados (CF-07).
-- -----------------------------------------------------------------------------
create table public.discounts (
  id                       uuid primary key default app.uuid_v7(),
  store_id                 uuid not null references public.stores (id) on delete cascade,
  code                     text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  type                     text not null check (type in ('percentage', 'fixed_amount', 'free_shipping')),
  value                    bigint not null check (value >= 0),
  min_subtotal             bigint not null default 0 check (min_subtotal >= 0),
  starts_at                timestamptz,
  ends_at                  timestamptz,
  usage_limit              integer check (usage_limit is null or usage_limit > 0),
  usage_limit_per_customer integer check (usage_limit_per_customer is null or usage_limit_per_customer > 0),
  times_reserved           integer not null default 0 check (times_reserved >= 0),
  times_used               integer not null default 0 check (times_used >= 0),
  status                   text not null default 'active' check (status in ('active', 'disabled', 'archived')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, code),
  constraint discounts_value_by_type check (
    case type
      when 'percentage' then value between 1 and 10000
      when 'fixed_amount' then value > 0
      else value = 0
    end),
  constraint discounts_window check (starts_at is null or ends_at is null or starts_at < ends_at),
  constraint discounts_within_limit check (usage_limit is null or times_reserved + times_used <= usage_limit)
);

-- El código no cambia después de usarse (§12.3).
create or replace function app.discounts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is distinct from old.code and (old.times_used > 0 or old.times_reserved > 0) then
    raise exception using errcode = '23514', message = 'discount_code_locked';
  end if;
  return new;
end
$$;
revoke all on function app.discounts_guard() from public;

-- -----------------------------------------------------------------------------
-- Carrito (§17.1): sin precios. El token solo existe como hash.
-- -----------------------------------------------------------------------------
create table public.carts (
  id               uuid primary key default app.uuid_v7(),
  store_id         uuid not null references public.stores (id) on delete cascade,
  token_hash       bytea not null unique check (octet_length(token_hash) = 32),
  customer_id      uuid,
  email            text check (email is null or (email = lower(email) and char_length(email) <= 254
                                                 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  shipping_address jsonb check (shipping_address is null or jsonb_typeof(shipping_address) = 'object'),
  shipping_rate_id uuid,
  discount_code    text check (discount_code is null or discount_code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  status           text not null default 'active' check (status in ('active', 'converted', 'abandoned')),
  last_activity_at timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '30 days',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (store_id, id),
  foreign key (store_id, customer_id) references public.customers (store_id, id) on delete set null (customer_id),
  foreign key (store_id, shipping_rate_id) references public.shipping_rates (store_id, id)
    on delete set null (shipping_rate_id)
);
create index carts_expiry_idx on public.carts (status, expires_at);

create table public.cart_items (
  id         uuid primary key default app.uuid_v7(),
  store_id   uuid not null references public.stores (id) on delete cascade,
  cart_id    uuid not null,
  variant_id uuid not null,
  quantity   integer not null check (quantity between 1 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, id),
  unique (cart_id, variant_id),
  foreign key (store_id, cart_id) references public.carts (store_id, id) on delete cascade,
  foreign key (store_id, variant_id) references public.product_variants (store_id, id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- Pedidos (§16.1)
-- -----------------------------------------------------------------------------
create table public.orders (
  id                       uuid primary key default app.uuid_v7(),
  store_id                 uuid not null references public.stores (id) on delete restrict,
  number                   bigint not null check (number > 0),
  display_number           text not null check (char_length(display_number) between 1 and 40),
  guest_access_token_hash  bytea check (guest_access_token_hash is null or octet_length(guest_access_token_hash) = 32),
  source                   text not null default 'storefront' check (source in ('storefront', 'admin', 'api')),
  checkout_idempotency_key text not null check (char_length(checkout_idempotency_key) between 16 and 100),
  -- Cliente (snapshot)
  customer_id              uuid,
  email                    text not null check (email = lower(email) and char_length(email) <= 254
                                                and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone                    text check (phone is null or char_length(phone) <= 32),
  customer_name            text not null check (char_length(btrim(customer_name)) between 1 and 160),
  shipping_address         jsonb check (shipping_address is null or jsonb_typeof(shipping_address) = 'object'),
  billing_address          jsonb check (billing_address is null or jsonb_typeof(billing_address) = 'object'),
  requires_shipping        boolean not null,
  -- Moneda e impuestos (snapshot)
  currency                 text not null check (currency ~ '^[A-Z]{3}$'),
  prices_include_tax       boolean not null,
  tax_rate_bps             integer not null check (tax_rate_bps between 0 and 10000),
  tax_applies_to_shipping  boolean not null,
  -- Envío y descuento (snapshot)
  shipping_rate_id         uuid,
  shipping_snapshot        jsonb check (shipping_snapshot is null or jsonb_typeof(shipping_snapshot) = 'object'),
  discount_snapshot        jsonb check (discount_snapshot is null or jsonb_typeof(discount_snapshot) = 'object'),
  -- Totales
  subtotal                 bigint not null check (subtotal >= 0),
  discount_total           bigint not null default 0 check (discount_total >= 0),
  shipping_total           bigint not null default 0 check (shipping_total >= 0),
  tax_total                bigint not null default 0 check (tax_total >= 0),
  total                    bigint not null check (total >= 0),
  paid_total               bigint not null default 0 check (paid_total >= 0),
  refunded_total           bigint not null default 0 check (refunded_total >= 0),
  -- Estados
  status                   text not null default 'pending_payment'
                           check (status in ('pending_payment', 'open', 'completed', 'cancelled')),
  payment_status           text not null default 'unpaid'
                           check (payment_status in ('unpaid', 'pending', 'authorized', 'paid', 'partially_refunded',
                                                     'refunded', 'failed', 'expired', 'voided')),
  fulfillment_status       text not null default 'unfulfilled'
                           check (fulfillment_status in ('unfulfilled', 'partially_fulfilled', 'fulfilled',
                                                         'partially_returned', 'returned')),
  needs_attention          boolean not null default false,
  cancel_reason            text check (cancel_reason is null or cancel_reason in
                             ('customer', 'staff', 'payment_expired', 'payment_failed', 'fraud', 'out_of_stock', 'other')),
  -- Tiempos y notas
  placed_at                timestamptz not null default now(),
  paid_at                  timestamptz,
  cancelled_at             timestamptz,
  completed_at             timestamptz,
  customer_note            text check (customer_note is null or char_length(customer_note) <= 1000),
  staff_note               text check (staff_note is null or char_length(staff_note) <= 4000),
  snapshot_version         smallint not null default 1 check (snapshot_version >= 1),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, number),
  unique (store_id, checkout_idempotency_key),
  foreign key (store_id, customer_id) references public.customers (store_id, id) on delete set null (customer_id),
  foreign key (store_id, shipping_rate_id) references public.shipping_rates (store_id, id)
    on delete set null (shipping_rate_id),
  -- CHECK de totales (§16.1)
  constraint orders_total check (
    total = subtotal - discount_total + shipping_total + case when prices_include_tax then 0 else tax_total end),
  constraint orders_discount_le_subtotal check (discount_total <= subtotal),
  constraint orders_paid_refunded check (refunded_total <= paid_total and paid_total <= total),
  constraint orders_shipping_address check (not requires_shipping or shipping_address is not null),
  constraint orders_cancelled check ((status = 'cancelled') = (cancelled_at is not null and cancel_reason is not null))
);
create index orders_store_placed_idx on public.orders (store_id, placed_at desc, id desc);
create index orders_customer_idx on public.orders (store_id, customer_id) where customer_id is not null;
create index orders_pending_idx on public.orders (store_id, status) where status = 'pending_payment';

-- -----------------------------------------------------------------------------
-- Partidas (§16.2, CF-05: FK compuestas con SET NULL por columna)
-- -----------------------------------------------------------------------------
create table public.order_items (
  id                  uuid primary key default app.uuid_v7(),
  store_id            uuid not null references public.stores (id) on delete restrict,
  order_id            uuid not null,
  variant_id          uuid,
  product_id          uuid,
  product_title       text not null check (char_length(product_title) between 1 and 200),
  variant_title       text check (variant_title is null or char_length(variant_title) <= 200),
  sku                 text check (sku is null or char_length(sku) <= 64),
  option_values       jsonb not null default '{}'::jsonb check (jsonb_typeof(option_values) = 'object'),
  image_path          text check (image_path is null or char_length(image_path) <= 500),
  product_type        text not null,
  requires_shipping   boolean not null,
  weight_g            integer check (weight_g is null or weight_g >= 0),
  unit_price          bigint not null check (unit_price >= 0),
  compare_at_price    bigint check (compare_at_price is null or compare_at_price >= 0),
  quantity            integer not null check (quantity between 1 and 999),
  discount_allocation bigint not null default 0 check (discount_allocation >= 0),
  tax_amount          bigint not null default 0 check (tax_amount >= 0),
  line_total          bigint not null check (line_total >= 0),
  position            integer not null default 0,
  fulfilled_quantity  integer not null default 0,
  refunded_quantity   integer not null default 0,
  returned_quantity   integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (store_id, id),
  foreign key (store_id, order_id) references public.orders (store_id, id) on delete restrict,
  foreign key (store_id, variant_id) references public.product_variants (store_id, id) on delete set null (variant_id),
  foreign key (store_id, product_id) references public.products (store_id, id) on delete set null (product_id),
  constraint order_items_line_total check (line_total = unit_price * quantity - discount_allocation),
  constraint order_items_counters check (fulfilled_quantity between 0 and quantity
                                         and refunded_quantity between 0 and quantity
                                         and returned_quantity between 0 and quantity)
);
create index order_items_order_idx on public.order_items (store_id, order_id, position);

-- -----------------------------------------------------------------------------
-- Historial del pedido (§16.3): append-only
-- -----------------------------------------------------------------------------
create table public.order_events (
  id               uuid primary key default app.uuid_v7(),
  store_id         uuid not null references public.stores (id) on delete restrict,
  order_id         uuid not null,
  type             text not null check (type ~ '^[a-z_]+(\.[a-z_]+)+$'),
  axis             text check (axis is null or axis in ('status', 'payment', 'fulfillment')),
  from_value       text,
  to_value         text,
  message          text check (message is null or char_length(message) <= 1000),
  customer_visible boolean not null default false,
  actor_type       text not null check (actor_type in ('customer', 'staff', 'system', 'provider', 'platform_support')),
  actor_user_id    uuid,
  metadata         jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at       timestamptz not null default now(),
  unique (store_id, id),
  foreign key (store_id, order_id) references public.orders (store_id, id) on delete restrict
);
create index order_events_order_idx on public.order_events (store_id, order_id, created_at);

-- -----------------------------------------------------------------------------
-- Redenciones de descuento (CF-07)
-- -----------------------------------------------------------------------------
create table public.discount_redemptions (
  id          uuid primary key default app.uuid_v7(),
  store_id    uuid not null references public.stores (id) on delete restrict,
  discount_id uuid not null,
  order_id    uuid not null,
  customer_id uuid,
  status      text not null default 'reserved' check (status in ('reserved', 'confirmed', 'released')),
  amount      bigint not null check (amount >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (store_id, id),
  unique (order_id),
  foreign key (store_id, discount_id) references public.discounts (store_id, id) on delete restrict,
  foreign key (store_id, order_id) references public.orders (store_id, id) on delete restrict,
  foreign key (store_id, customer_id) references public.customers (store_id, id) on delete set null (customer_id)
);
create index discount_redemptions_customer_idx on public.discount_redemptions (store_id, discount_id, customer_id)
  where status <> 'released';

-- reserved → confirmed | released; nada vuelve atrás.
create or replace function app.discount_redemptions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and not (old.status = 'reserved' and new.status in ('confirmed', 'released')) then
    raise exception using errcode = '23514', message = 'invalid_transition',
                          detail = format('redemption %s → %s', old.status, new.status);
  end if;
  if (to_jsonb(new) - array['status', 'customer_id', 'updated_at'])
     is distinct from (to_jsonb(old) - array['status', 'customer_id', 'updated_at'])
     or (new.customer_id is distinct from old.customer_id and new.customer_id is not null) then
    raise exception using errcode = '42501', message = 'immutable', detail = 'discount_redemptions';
  end if;
  return new;
end
$$;
revoke all on function app.discount_redemptions_guard() from public;

-- -----------------------------------------------------------------------------
-- Cuentas de pago y pagos (§18.3). En la Fase 6 solo `manual` y `fake`; Stripe
-- se agrega en la F7 ampliando el CHECK. `fake` exige el ajuste de plataforma
-- `payments.allow_fake` (nunca en producción; lo valida la RPC que crea cuentas).
-- -----------------------------------------------------------------------------
create table public.payment_accounts (
  id                 uuid primary key default app.uuid_v7(),
  store_id           uuid not null references public.stores (id) on delete restrict,
  provider           text not null check (provider in ('manual', 'fake')),
  mode               text not null default 'live' check (mode in ('test', 'live')),
  status             text not null default 'pending' check (status in ('pending', 'active', 'disabled', 'error')),
  display_name       text not null check (char_length(btrim(display_name)) between 1 and 80),
  public_config      jsonb not null default '{}'::jsonb check (jsonb_typeof(public_config) = 'object'
                                                               and octet_length(public_config::text) <= 8192),
  secret_ref         uuid,
  webhook_secret_ref uuid,
  enabled_methods    text[] not null default '{}'::text[],
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (store_id, id)
);
create unique index payment_accounts_active_uq on public.payment_accounts (store_id, provider) where status = 'active';

create table public.payments (
  id                   uuid primary key default app.uuid_v7(),
  store_id             uuid not null references public.stores (id) on delete restrict,
  order_id             uuid not null,
  payment_account_id   uuid not null,
  provider             text not null check (provider in ('manual', 'fake')),
  provider_checkout_id text check (provider_checkout_id is null or char_length(provider_checkout_id) <= 200),
  provider_payment_id  text check (provider_payment_id is null or char_length(provider_payment_id) <= 200),
  amount               bigint not null check (amount > 0),
  currency             text not null check (currency ~ '^[A-Z]{3}$'),
  status               text not null default 'created'
                       check (status in ('created', 'pending', 'authorized', 'succeeded', 'failed', 'cancelled', 'expired')),
  method               text check (method is null or char_length(method) <= 50),
  failure_code         text check (failure_code is null or char_length(failure_code) <= 100),
  idempotency_key      text not null check (char_length(idempotency_key) between 16 and 100),
  expires_at           timestamptz,
  last_synced_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, idempotency_key),
  foreign key (store_id, order_id) references public.orders (store_id, id) on delete restrict,
  foreign key (store_id, payment_account_id) references public.payment_accounts (store_id, id) on delete restrict
);
create unique index payments_provider_payment_uq on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;
create unique index payments_one_succeeded_uq on public.payments (order_id) where status = 'succeeded';
create index payments_order_idx on public.payments (store_id, order_id, created_at);
create index payments_open_idx on public.payments (status, created_at) where status in ('created', 'pending');

-- Monótono: un pago terminal no cambia; nunca vuelve a `created`.
create or replace function app.payments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'created' and new.status in ('pending', 'authorized', 'succeeded', 'failed', 'cancelled', 'expired'))
    or (old.status = 'pending' and new.status in ('authorized', 'succeeded', 'failed', 'cancelled', 'expired'))
    or (old.status = 'authorized' and new.status in ('succeeded', 'cancelled', 'expired'))
    -- Pago tardío válido sobre un intento ya expirado o fallido (CF-04, solo el sistema en la F7).
    or (old.status in ('expired', 'failed') and new.status = 'succeeded')) then
    raise exception using errcode = '23514', message = 'invalid_transition',
                          detail = format('payment %s → %s', old.status, new.status);
  end if;
  if (to_jsonb(new) - array['status', 'provider_checkout_id', 'provider_payment_id', 'method', 'failure_code',
                            'expires_at', 'last_synced_at', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array['status', 'provider_checkout_id', 'provider_payment_id', 'method', 'failure_code',
                            'expires_at', 'last_synced_at', 'updated_at']) then
    raise exception using errcode = '42501', message = 'immutable', detail = 'payments';
  end if;
  return new;
end
$$;
revoke all on function app.payments_guard() from public;

-- -----------------------------------------------------------------------------
-- Transiciones del pedido (§16.4, normativo). `p_actor` restringe las que solo
-- el sistema puede hacer; el trigger aplica la tabla para cualquier actor.
-- -----------------------------------------------------------------------------
create or replace function app.order_transition_allowed(p_axis text, p_from text, p_to text, p_actor text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_axis
    when 'status' then (p_from, p_to) in (('pending_payment', 'open'), ('pending_payment', 'cancelled'),
                                          ('open', 'completed'), ('open', 'cancelled'))
                       or (p_from = 'cancelled' and p_to = 'open' and p_actor = 'system')
    when 'payment' then (p_from, p_to) in (('unpaid', 'pending'), ('unpaid', 'paid'), ('unpaid', 'expired'),
                                           ('unpaid', 'failed'), ('pending', 'authorized'), ('pending', 'paid'),
                                           ('pending', 'failed'), ('pending', 'expired'), ('authorized', 'paid'),
                                           ('authorized', 'voided'), ('failed', 'pending'), ('failed', 'expired'),
                                           ('paid', 'partially_refunded'), ('paid', 'refunded'),
                                           ('partially_refunded', 'refunded'))
                        or (p_from in ('expired', 'failed') and p_to = 'paid' and p_actor = 'system')
    when 'fulfillment' then (p_from, p_to) in (('unfulfilled', 'partially_fulfilled'), ('unfulfilled', 'fulfilled'),
                                               ('partially_fulfilled', 'fulfilled'),
                                               ('partially_fulfilled', 'partially_returned'),
                                               ('fulfilled', 'partially_returned'), ('fulfilled', 'returned'),
                                               ('partially_returned', 'returned'))
    else false
  end
$$;
revoke all on function app.order_transition_allowed(text, text, text, text) from public;

create or replace function app.assert_order_transition(p_axis text, p_from text, p_to text, p_actor text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is distinct from p_to and not app.order_transition_allowed(p_axis, p_from, p_to, p_actor) then
    raise exception using errcode = 'P0001', message = 'invalid_transition',
                          detail = format('%s: %s → %s', p_axis, p_from, p_to);
  end if;
end
$$;
revoke all on function app.assert_order_transition(text, text, text, text) from public;

-- Snapshot inmutable + transiciones válidas + evento por cada cambio de eje.
-- El actor llega por la marca local `app.order_actor` (lo fija la función que
-- cambia el estado); sin ella es `system`.
create or replace function app.orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable text[] := array['paid_total', 'refunded_total', 'status', 'payment_status', 'fulfillment_status',
                            'needs_attention', 'cancel_reason', 'staff_note', 'paid_at', 'cancelled_at',
                            'completed_at', 'customer_id', 'shipping_rate_id', 'updated_at'];
  v_actor   text := coalesce(nullif(current_setting('app.order_actor', true), ''), 'system');
begin
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable)
     or (new.customer_id is distinct from old.customer_id and new.customer_id is not null)
     or (new.shipping_rate_id is distinct from old.shipping_rate_id and new.shipping_rate_id is not null) then
    raise exception using errcode = '42501', message = 'immutable', detail = 'orders';
  end if;
  perform app.assert_order_transition('status', old.status, new.status, v_actor);
  perform app.assert_order_transition('payment', old.payment_status, new.payment_status, v_actor);
  perform app.assert_order_transition('fulfillment', old.fulfillment_status, new.fulfillment_status, v_actor);
  -- MVP: no se envía sin pago (§16.4).
  if old.fulfillment_status = 'unfulfilled' and new.fulfillment_status <> 'unfulfilled'
     and new.payment_status not in ('paid', 'partially_refunded') then
    raise exception using errcode = 'P0001', message = 'invalid_transition', detail = 'fulfillment_requires_payment';
  end if;
  return new;
end
$$;
revoke all on function app.orders_guard() from public;

create or replace function app.orders_log_transitions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := coalesce(nullif(current_setting('app.order_actor', true), ''), 'system');
  v_user  uuid := case when v_actor in ('staff', 'customer', 'platform_support') then auth.uid() end;
  v_axis  record;
begin
  for v_axis in
    select * from (values ('status', old.status, new.status),
                          ('payment', old.payment_status, new.payment_status),
                          ('fulfillment', old.fulfillment_status, new.fulfillment_status)) a(axis, f, t)
     where a.f is distinct from a.t
  loop
    insert into public.order_events (store_id, order_id, type, axis, from_value, to_value, customer_visible,
                                     actor_type, actor_user_id)
    values (new.store_id, new.id, 'order.' || v_axis.axis || '_changed', v_axis.axis, v_axis.f, v_axis.t,
            v_axis.axis <> 'payment' or v_axis.t in ('paid', 'refunded', 'partially_refunded'),
            v_actor, v_user);
  end loop;
  return null;
end
$$;
revoke all on function app.orders_log_transitions() from public;

-- Partidas: solo cambian los contadores (y las referencias a NULL por borrado).
create or replace function app.order_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable text[] := array['fulfilled_quantity', 'refunded_quantity', 'returned_quantity', 'variant_id',
                            'product_id', 'updated_at'];
begin
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable)
     or (new.variant_id is distinct from old.variant_id and new.variant_id is not null)
     or (new.product_id is distinct from old.product_id and new.product_id is not null) then
    raise exception using errcode = '42501', message = 'immutable', detail = 'order_items';
  end if;
  return new;
end
$$;
revoke all on function app.order_items_guard() from public;

-- -----------------------------------------------------------------------------
-- Reservas de inventario: la FK al pedido que esperaba desde la F4 (D-F4-01).
-- -----------------------------------------------------------------------------
alter table public.inventory_reservations
  add constraint inventory_reservations_order_fk
  foreign key (store_id, order_id) references public.orders (store_id, id) on delete restrict;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
create trigger customer_addresses_set_updated_at before update on public.customer_addresses
  for each row execute function app.set_updated_at();
create trigger shipping_zones_set_updated_at before update on public.shipping_zones
  for each row execute function app.set_updated_at();
create trigger shipping_rates_set_updated_at before update on public.shipping_rates
  for each row execute function app.set_updated_at();
create trigger discounts_set_updated_at before update on public.discounts
  for each row execute function app.set_updated_at();
create trigger carts_set_updated_at before update on public.carts
  for each row execute function app.set_updated_at();
create trigger cart_items_set_updated_at before update on public.cart_items
  for each row execute function app.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
  for each row execute function app.set_updated_at();
create trigger order_items_set_updated_at before update on public.order_items
  for each row execute function app.set_updated_at();
create trigger discount_redemptions_set_updated_at before update on public.discount_redemptions
  for each row execute function app.set_updated_at();
create trigger payment_accounts_set_updated_at before update on public.payment_accounts
  for each row execute function app.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
  for each row execute function app.set_updated_at();

create trigger customer_addresses_prevent_tenant_change before update on public.customer_addresses
  for each row execute function app.prevent_tenant_change();
create trigger shipping_zones_prevent_tenant_change before update on public.shipping_zones
  for each row execute function app.prevent_tenant_change();
create trigger shipping_rates_prevent_tenant_change before update on public.shipping_rates
  for each row execute function app.prevent_tenant_change();
create trigger discounts_prevent_tenant_change before update on public.discounts
  for each row execute function app.prevent_tenant_change();
create trigger carts_prevent_tenant_change before update on public.carts
  for each row execute function app.prevent_tenant_change();
create trigger cart_items_prevent_tenant_change before update on public.cart_items
  for each row execute function app.prevent_tenant_change();
create trigger orders_prevent_tenant_change before update on public.orders
  for each row execute function app.prevent_tenant_change();
create trigger order_items_prevent_tenant_change before update on public.order_items
  for each row execute function app.prevent_tenant_change();
create trigger discount_redemptions_prevent_tenant_change before update on public.discount_redemptions
  for each row execute function app.prevent_tenant_change();
create trigger payment_accounts_prevent_tenant_change before update on public.payment_accounts
  for each row execute function app.prevent_tenant_change();
create trigger payments_prevent_tenant_change before update on public.payments
  for each row execute function app.prevent_tenant_change();

create trigger shipping_rates_immutable before update on public.shipping_rates
  for each row execute function app.prevent_column_change('zone_id');
create trigger cart_items_immutable before update on public.cart_items
  for each row execute function app.prevent_column_change('cart_id', 'variant_id');
create trigger customer_addresses_immutable before update on public.customer_addresses
  for each row execute function app.prevent_column_change('customer_id');
create trigger payment_accounts_immutable before update on public.payment_accounts
  for each row execute function app.prevent_column_change('provider');
create trigger discounts_guard before update on public.discounts
  for each row execute function app.discounts_guard();
create trigger discount_redemptions_guard before update on public.discount_redemptions
  for each row execute function app.discount_redemptions_guard();
create trigger payments_guard before update on public.payments
  for each row execute function app.payments_guard();
create trigger orders_guard before update on public.orders
  for each row execute function app.orders_guard();
create trigger orders_log_transitions after update on public.orders
  for each row execute function app.orders_log_transitions();
create trigger order_items_guard before update on public.order_items
  for each row execute function app.order_items_guard();

-- Nunca se borran (§44.9) ni se reescribe el historial.
create trigger orders_no_delete before delete on public.orders
  for each row execute function app.forbid_mutation();
create trigger order_items_no_delete before delete on public.order_items
  for each row execute function app.forbid_mutation();
create trigger order_events_append_only before update or delete on public.order_events
  for each row execute function app.forbid_mutation();
create trigger payments_no_delete before delete on public.payments
  for each row execute function app.forbid_mutation();
create trigger discount_redemptions_no_delete before delete on public.discount_redemptions
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- RLS (§12.3): lectura del staff por permiso; ninguna escritura directa.
-- Carritos: solo funciones `storefront.*` (sin grants).
-- -----------------------------------------------------------------------------
alter table public.customer_addresses enable row level security;
alter table public.customer_addresses force row level security;
alter table public.shipping_zones enable row level security;
alter table public.shipping_zones force row level security;
alter table public.shipping_rates enable row level security;
alter table public.shipping_rates force row level security;
alter table public.discounts enable row level security;
alter table public.discounts force row level security;
alter table public.carts enable row level security;
alter table public.carts force row level security;
alter table public.cart_items enable row level security;
alter table public.cart_items force row level security;
alter table public.orders enable row level security;
alter table public.orders force row level security;
alter table public.order_items enable row level security;
alter table public.order_items force row level security;
alter table public.order_events enable row level security;
alter table public.order_events force row level security;
alter table public.discount_redemptions enable row level security;
alter table public.discount_redemptions force row level security;
alter table public.payment_accounts enable row level security;
alter table public.payment_accounts force row level security;
alter table public.payments enable row level security;
alter table public.payments force row level security;

revoke all on table public.customer_addresses, public.shipping_zones, public.shipping_rates, public.discounts,
  public.carts, public.cart_items, public.orders, public.order_items, public.order_events,
  public.discount_redemptions, public.payment_accounts, public.payments
  from public, anon, authenticated, service_role;

grant select on table public.customer_addresses, public.shipping_zones, public.shipping_rates, public.discounts,
  public.order_items, public.order_events, public.discount_redemptions, public.payments to authenticated;
-- Pedido sin datos de contacto ni el hash del token del invitado (D-F6-01).
grant select (id, store_id, number, display_number, source, customer_id, requires_shipping, currency,
              prices_include_tax, tax_rate_bps, tax_applies_to_shipping, shipping_rate_id, shipping_snapshot,
              discount_snapshot, subtotal, discount_total, shipping_total, tax_total, total, paid_total,
              refunded_total, status, payment_status, fulfillment_status, needs_attention, cancel_reason,
              placed_at, paid_at, cancelled_at, completed_at, snapshot_version, created_at, updated_at)
  on public.orders to authenticated;
-- Cuenta de pago sin referencias a secretos.
grant select (id, store_id, provider, mode, status, display_name, public_config, enabled_methods,
              created_at, updated_at)
  on public.payment_accounts to authenticated;

create policy customer_addresses_select on public.customer_addresses for select to authenticated
  using (app.has_store_permission(store_id, 'customers.pii.read'));
create policy shipping_zones_select on public.shipping_zones for select to authenticated
  using (app.has_store_permission(store_id, 'store.read'));
create policy shipping_rates_select on public.shipping_rates for select to authenticated
  using (app.has_store_permission(store_id, 'store.read'));
create policy discounts_select on public.discounts for select to authenticated
  using (app.has_store_permission(store_id, 'discounts.read'));
create policy orders_select on public.orders for select to authenticated
  using (app.has_store_permission(store_id, 'orders.read'));
create policy order_items_select on public.order_items for select to authenticated
  using (app.has_store_permission(store_id, 'orders.read'));
create policy order_events_select on public.order_events for select to authenticated
  using (app.has_store_permission(store_id, 'orders.read'));
create policy discount_redemptions_select on public.discount_redemptions for select to authenticated
  using (app.has_store_permission(store_id, 'orders.read'));
create policy payment_accounts_select on public.payment_accounts for select to authenticated
  using (app.has_store_permission(store_id, 'payments.read'));
create policy payments_select on public.payments for select to authenticated
  using (app.has_store_permission(store_id, 'payments.read'));
