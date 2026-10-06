-- =============================================================================
-- Fase 7 · Envíos, entrega, cancelación y reembolsos (F7-T03).
-- Contrato: GATE0 §9.2 (shipments), §16.4, §18.6; §44.9 (nada se borra).
--
-- * Surtir (parcial) consume la reserva confirmada (app.inventory_fulfill).
-- * Cancelar: sin pagar → libera reserva y cupón; pagado y sin unidades enviadas →
--   cancela, libera la reserva y solicita el reembolso total.
-- * Reembolso: solicitud `pending` → job refund.execute (proveedor) →
--   system.apply_refund_result. El dinero y las cantidades solo cambian al
--   confirmarse. Reponer existencias aplica a unidades ENVIADAS (movimiento
--   `return`); las no enviadas se resuelven cancelando el pedido (D-F7-03).
-- =============================================================================

create table public.shipments (
  id              uuid primary key default app.uuid_v7(),
  store_id        uuid not null references public.stores (id) on delete restrict,
  order_id        uuid not null,
  status          text not null default 'shipped'
                  check (status in ('pending', 'shipped', 'delivered', 'returned', 'cancelled')),
  carrier         text check (carrier is null or char_length(carrier) <= 80),
  tracking_number text check (tracking_number is null or tracking_number ~ '^[A-Za-z0-9 -]{3,60}$'),
  tracking_url    text check (tracking_url is null or (tracking_url ~ '^https://[^\s<>"]+$' and char_length(tracking_url) <= 500)),
  shipped_at      timestamptz,
  delivered_at    timestamptz,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 100),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, idempotency_key),
  foreign key (store_id, order_id) references public.orders (store_id, id) on delete restrict
);
create index shipments_order_idx on public.shipments (store_id, order_id);

create table public.shipment_items (
  store_id      uuid not null references public.stores (id) on delete restrict,
  shipment_id   uuid not null,
  order_item_id uuid not null,
  quantity      integer not null check (quantity between 1 and 999),
  primary key (shipment_id, order_item_id),
  foreign key (store_id, shipment_id) references public.shipments (store_id, id) on delete restrict,
  foreign key (store_id, order_item_id) references public.order_items (store_id, id) on delete restrict
);

create table public.refunds (
  id                 uuid primary key default app.uuid_v7(),
  store_id           uuid not null references public.stores (id) on delete restrict,
  order_id           uuid not null,
  payment_id         uuid not null,
  amount             bigint not null check (amount > 0),
  items              jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  restock            boolean not null default false,
  reason             text check (reason is null or char_length(reason) <= 500),
  status             text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  provider_refund_id text check (provider_refund_id is null or char_length(provider_refund_id) <= 200),
  failure_code       text check (failure_code is null or char_length(failure_code) <= 100),
  idempotency_key    text not null check (char_length(idempotency_key) between 16 and 100),
  requested_by       uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, idempotency_key),
  foreign key (store_id, order_id) references public.orders (store_id, id) on delete restrict,
  foreign key (store_id, payment_id) references public.payments (store_id, id) on delete restrict
);
create index refunds_order_idx on public.refunds (store_id, order_id);

-- pending → succeeded | failed; el resto es inmutable.
create or replace function app.refunds_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (old.status = 'pending' and new.status in ('succeeded', 'failed')) then
    raise exception using errcode = '23514', message = 'invalid_transition', detail = format('refund %s → %s', old.status, new.status);
  end if;
  if (to_jsonb(new) - array['status', 'provider_refund_id', 'failure_code', 'updated_at'])
     is distinct from (to_jsonb(old) - array['status', 'provider_refund_id', 'failure_code', 'updated_at']) then
    raise exception using errcode = '42501', message = 'immutable', detail = 'refunds';
  end if;
  return new;
end
$$;
revoke all on function app.refunds_guard() from public;

create trigger shipments_set_updated_at before update on public.shipments for each row execute function app.set_updated_at();
create trigger refunds_set_updated_at before update on public.refunds for each row execute function app.set_updated_at();
create trigger shipments_prevent_tenant_change before update on public.shipments
  for each row execute function app.prevent_tenant_change();
create trigger refunds_prevent_tenant_change before update on public.refunds
  for each row execute function app.prevent_tenant_change();
create trigger shipments_immutable before update on public.shipments
  for each row execute function app.prevent_column_change('order_id', 'idempotency_key', 'shipped_at');
create trigger shipment_items_append_only before update or delete on public.shipment_items
  for each row execute function app.forbid_mutation();
create trigger shipments_no_delete before delete on public.shipments for each row execute function app.forbid_mutation();
create trigger refunds_no_delete before delete on public.refunds for each row execute function app.forbid_mutation();
create trigger refunds_guard before update on public.refunds for each row execute function app.refunds_guard();

alter table public.shipments enable row level security;
alter table public.shipments force row level security;
alter table public.shipment_items enable row level security;
alter table public.shipment_items force row level security;
alter table public.refunds enable row level security;
alter table public.refunds force row level security;
revoke all on table public.shipments, public.shipment_items, public.refunds from public, anon, authenticated, service_role;
grant select on table public.shipments, public.shipment_items, public.refunds to authenticated;
create policy shipments_select on public.shipments for select to authenticated
  using (app.has_store_permission(store_id, 'orders.read'));
create policy shipment_items_select on public.shipment_items for select to authenticated
  using (app.has_store_permission(store_id, 'orders.read'));
create policy refunds_select on public.refunds for select to authenticated
  using (app.has_store_permission(store_id, 'orders.read'));

-- -----------------------------------------------------------------------------
-- Surtir (parcial): una llamada = un envío.
-- p_items: [{order_item_id, quantity}]
-- -----------------------------------------------------------------------------
create or replace function public.orders_fulfill(p_store_id uuid, p_order_id uuid, p_items jsonb,
                                                 p_carrier text, p_tracking_number text, p_tracking_url text,
                                                 p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    public.orders;
  v_ship     uuid;
  v_res      uuid;
  v_line     record;
  v_inv      jsonb := '[]'::jsonb;
  v_pending  integer;
begin
  perform app.require_store_permission(p_store_id, 'orders.fulfill');
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,100}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'idempotency_key';
  end if;
  select * into v_order from public.orders o where o.store_id = p_store_id and o.id = p_order_id for update;
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  select s.id into v_ship from public.shipments s where s.store_id = p_store_id and s.idempotency_key = p_idempotency_key;
  if v_ship is not null then
    return v_ship;   -- repetición idempotente
  end if;
  if v_order.status <> 'open' or v_order.payment_status not in ('paid', 'partially_refunded') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'order_not_fulfillable';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0
     or exists (select 1 from jsonb_array_elements(p_items) x
                 where coalesce(jsonb_typeof(x -> 'quantity'), '') <> 'number' or (x ->> 'quantity')::numeric <= 0
                    or (x ->> 'quantity')::numeric <> floor((x ->> 'quantity')::numeric)
                    or coalesce(x ->> 'order_item_id', '') !~ '^[0-9a-f-]{36}$') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
  end if;

  begin
    insert into public.shipments (store_id, order_id, carrier, tracking_number, tracking_url, shipped_at, idempotency_key)
    values (p_store_id, v_order.id, nullif(btrim(p_carrier), ''), nullif(btrim(p_tracking_number), ''),
            nullif(btrim(p_tracking_url), ''), now(), p_idempotency_key)
    returning id into v_ship;
  exception when check_violation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'tracking';
  end;

  for v_line in
    select i.id, i.variant_id, i.quantity, i.fulfilled_quantity, i.refunded_quantity, sum((x ->> 'quantity')::integer)::integer as q
      from jsonb_array_elements(p_items) x
      join public.order_items i on i.store_id = p_store_id and i.order_id = v_order.id and i.id = (x ->> 'order_item_id')::uuid
     group by i.id
  loop
    if v_line.q > v_line.quantity - v_line.fulfilled_quantity then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'quantity';
    end if;
    insert into public.shipment_items (store_id, shipment_id, order_item_id, quantity)
    values (p_store_id, v_ship, v_line.id, v_line.q);
    update public.order_items set fulfilled_quantity = fulfilled_quantity + v_line.q where id = v_line.id;
    if v_line.variant_id is not null then
      v_inv := v_inv || jsonb_build_object('variant_id', v_line.variant_id, 'quantity', v_line.q);
    end if;
  end loop;
  if (select count(*) from public.shipment_items si where si.shipment_id = v_ship)
     <> (select count(distinct x ->> 'order_item_id') from jsonb_array_elements(p_items) x) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';   -- partida de otro pedido
  end if;

  select r.id into v_res from public.inventory_reservations r
   where r.store_id = p_store_id and r.order_id = v_order.id and r.status in ('committed', 'fulfilled');
  if v_res is not null and jsonb_array_length(v_inv) > 0 then
    perform app.inventory_fulfill(p_store_id, v_res, v_ship, v_inv);
  end if;

  select coalesce(sum(i.quantity - i.fulfilled_quantity), 0) into v_pending
    from public.order_items i where i.store_id = p_store_id and i.order_id = v_order.id;
  perform app.set_order_actor('staff');
  update public.orders set fulfillment_status = case when v_pending = 0 then 'fulfilled' else 'partially_fulfilled' end
   where id = v_order.id and fulfillment_status in ('unfulfilled', 'partially_fulfilled');
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, actor_user_id, metadata)
  values (p_store_id, v_order.id, 'order.shipped', 'Pedido enviado', true, 'staff', auth.uid(),
          jsonb_build_object('shipment_id', v_ship, 'carrier', nullif(btrim(p_carrier), ''),
                             'tracking_number', nullif(btrim(p_tracking_number), ''),
                             'tracking_url', nullif(btrim(p_tracking_url), '')));
  perform app.enqueue_job('order.shipped', jsonb_build_object('order_id', v_order.id, 'shipment_id', v_ship),
                          p_store_id, 'order.shipped:' || v_ship);
  perform audit.record('order.fulfilled', 'order', v_order.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('shipment_id', v_ship, 'items', p_items));
  return v_ship;
end
$$;

-- Entregado; con todo surtido y entregado, el pedido se completa (§16.4).
create or replace function public.orders_mark_delivered(p_store_id uuid, p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ship  public.shipments;
  v_order public.orders;
begin
  perform app.require_store_permission(p_store_id, 'orders.fulfill');
  select * into v_ship from public.shipments s where s.store_id = p_store_id and s.id = p_shipment_id;
  if v_ship.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'shipment';
  end if;
  select * into v_order from public.orders o where o.id = v_ship.order_id for update;
  if v_ship.status = 'delivered' then
    return;
  end if;
  if v_ship.status <> 'shipped' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'shipment_not_shipped';
  end if;
  update public.shipments set status = 'delivered', delivered_at = now() where id = v_ship.id;
  perform app.set_order_actor('staff');
  if v_order.status = 'open' and v_order.fulfillment_status = 'fulfilled'
     and not exists (select 1 from public.shipments s where s.order_id = v_order.id and s.status = 'shipped') then
    update public.orders set status = 'completed', completed_at = now() where id = v_order.id;
  end if;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, actor_user_id)
  values (p_store_id, v_order.id, 'order.delivered', 'Pedido entregado', true, 'staff', auth.uid());
end
$$;

-- Pedidos surtidos hace 30 días sin entrega registrada → completados (§16.4).
create or replace function system.complete_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform app.set_order_actor('system');
  with done as (
    update public.orders o set status = 'completed', completed_at = now()
     where o.status = 'open' and o.fulfillment_status = 'fulfilled'
       and (select max(s.shipped_at) from public.shipments s where s.order_id = o.id) < now() - interval '30 days'
    returning 1
  ) select count(*)::integer into v_count from done;
  return v_count;
end
$$;

-- -----------------------------------------------------------------------------
-- Reembolsos (§18.6)
-- -----------------------------------------------------------------------------
create or replace function app.request_refund(p_order public.orders, p_amount bigint, p_items jsonb, p_restock boolean,
                                              p_reason text, p_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_pay     uuid;
  v_pending bigint;
  v_line    record;
begin
  select r.id into v_id from public.refunds r where r.store_id = p_order.store_id and r.idempotency_key = p_key;
  if v_id is not null then
    return v_id;   -- doble solicitud con la misma clave: el mismo reembolso
  end if;
  select p.id into v_pay from public.payments p
   where p.store_id = p_order.store_id and p.order_id = p_order.id and p.status = 'succeeded';
  if v_pay is null or p_order.payment_status not in ('paid', 'partially_refunded') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'order_not_refundable';
  end if;
  select coalesce(sum(r.amount), 0) into v_pending from public.refunds r
   where r.store_id = p_order.store_id and r.order_id = p_order.id and r.status = 'pending';
  if p_amount is null or p_amount <= 0 or p_amount > p_order.paid_total - p_order.refunded_total - v_pending then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'amount';
  end if;
  -- Partidas: solo unidades ENVIADAS y no reembolsadas; con reposición, además no
  -- devueltas. Las no enviadas se resuelven cancelando el pedido (D-F7-03).
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
  end if;
  for v_line in
    select i.id, i.quantity, i.refunded_quantity, i.fulfilled_quantity, i.returned_quantity,
           sum((x ->> 'quantity')::integer)::integer as q
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
      left join public.order_items i on i.store_id = p_order.store_id and i.order_id = p_order.id
                                    and i.id::text = x ->> 'order_item_id'
     group by i.id, i.quantity, i.refunded_quantity, i.fulfilled_quantity, i.returned_quantity
  loop
    if v_line.id is null or v_line.q is null or v_line.q <= 0
       or v_line.q > v_line.fulfilled_quantity - v_line.refunded_quantity
       or (p_restock and v_line.q > v_line.fulfilled_quantity - v_line.returned_quantity) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
    end if;
  end loop;
  insert into public.refunds (store_id, order_id, payment_id, amount, items, restock, reason, idempotency_key, requested_by)
  values (p_order.store_id, p_order.id, v_pay, p_amount, coalesce(p_items, '[]'::jsonb), coalesce(p_restock, false),
          nullif(btrim(p_reason), ''), p_key, auth.uid())
  returning id into v_id;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, actor_user_id, metadata)
  values (p_order.store_id, p_order.id, 'refund.requested', 'Reembolso solicitado', false,
          case when auth.uid() is null then 'system' else 'staff' end, auth.uid(),
          jsonb_build_object('refund_id', v_id, 'amount', p_amount));
  perform app.enqueue_job('refund.execute', jsonb_build_object('refund_id', v_id), p_order.store_id,
                          'refund.execute:' || v_id);
  return v_id;
end
$$;
revoke all on function app.request_refund(public.orders, bigint, jsonb, boolean, text, text) from public;

create or replace function public.orders_request_refund(p_store_id uuid, p_order_id uuid, p_amount bigint, p_items jsonb,
                                                        p_restock boolean, p_reason text, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_id    uuid;
begin
  perform app.require_store_permission(p_store_id, 'orders.refund');
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,100}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'idempotency_key';
  end if;
  select * into v_order from public.orders o where o.store_id = p_store_id and o.id = p_order_id for update;
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  v_id := app.request_refund(v_order, p_amount, p_items, p_restock, p_reason, p_idempotency_key);
  perform audit.record('order.refund_requested', 'order', v_order.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('refund_id', v_id, 'amount', p_amount, 'restock', p_restock));
  return v_id;
end
$$;

-- Cancelar (§16.4, §18.6).
create or replace function public.orders_cancel(p_store_id uuid, p_order_id uuid, p_reason text, p_note text,
                                                p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  public.orders;
  v_res    public.inventory_reservations;
  v_refund uuid;
  v_reason text := coalesce(p_reason, 'staff');
begin
  perform app.require_store_permission(p_store_id, 'orders.cancel');
  if v_reason not in ('customer', 'staff', 'fraud', 'out_of_stock', 'other') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reason';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,100}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'idempotency_key';
  end if;
  select * into v_order from public.orders o where o.store_id = p_store_id and o.id = p_order_id for update;
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  if v_order.status = 'cancelled' then
    return jsonb_build_object('order_id', v_order.id, 'replayed', true);
  end if;
  if v_order.status not in ('pending_payment', 'open')
     or exists (select 1 from public.order_items i where i.order_id = v_order.id and i.fulfilled_quantity > 0) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'order_not_cancellable';
  end if;

  perform app.set_order_actor('staff');
  select * into v_res from public.inventory_reservations r
   where r.store_id = p_store_id and r.order_id = v_order.id and r.status in ('active', 'committed');
  if v_res.id is not null then
    perform app.inventory_release(p_store_id, v_res.id, 'released');
  end if;
  update public.discounts d set times_reserved = d.times_reserved - 1
    from public.discount_redemptions dr
   where dr.order_id = v_order.id and dr.status = 'reserved' and d.store_id = dr.store_id and d.id = dr.discount_id;
  update public.discount_redemptions set status = 'released' where order_id = v_order.id and status = 'reserved';
  update public.payments set status = 'cancelled'
   where store_id = p_store_id and order_id = v_order.id and status in ('created', 'pending', 'authorized');
  update public.orders
     set status = 'cancelled', cancel_reason = v_reason, cancelled_at = now(),
         payment_status = case when payment_status in ('unpaid', 'pending', 'failed') then 'expired'
                               when payment_status = 'authorized' then 'voided' else payment_status end
   where id = v_order.id;
  if v_order.payment_status in ('paid', 'partially_refunded') and v_order.paid_total > v_order.refunded_total then
    select * into v_order from public.orders o where o.id = v_order.id;
    v_refund := app.request_refund(v_order,
                  (v_order.paid_total - v_order.refunded_total
                    - (select coalesce(sum(r.amount), 0) from public.refunds r
                        where r.order_id = v_order.id and r.status = 'pending'))::bigint,
                  '[]'::jsonb, false, coalesce(nullif(btrim(p_note), ''), 'Cancelación'), 'cancel_' || p_idempotency_key);
  end if;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, actor_user_id)
  values (p_store_id, v_order.id, 'order.cancelled', left(nullif(btrim(p_note), ''), 1000), true, 'staff', auth.uid());
  perform app.enqueue_job('order.cancelled', jsonb_build_object('order_id', v_order.id), p_store_id,
                          'order.cancelled:' || v_order.id);
  perform audit.record('order.cancelled', 'order', v_order.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('reason', v_reason, 'refund_id', v_refund));
  return jsonb_build_object('order_id', v_order.id, 'refund_id', v_refund, 'replayed', false);
end
$$;

-- Datos del reembolso para el job (sin secretos).
create or replace function system.refund_for_execution(p_refund_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', r.id, 'status', r.status, 'amount', r.amount, 'store_id', r.store_id,
                            'provider', p.provider, 'provider_payment_id', p.provider_payment_id,
                            'currency', p.currency,
                            'account', jsonb_build_object('id', a.id, 'provider', a.provider, 'mode', a.mode,
                                                          'public_config', a.public_config))
    from public.refunds r
    join public.payments p on p.store_id = r.store_id and p.id = r.payment_id
    join public.payment_accounts a on a.store_id = p.store_id and a.id = p.payment_account_id
   where r.id = p_refund_id
$$;

create or replace function system.apply_refund_result(p_refund_id uuid, p_status text, p_provider_refund_id text,
                                                      p_failure_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref    public.refunds;
  v_order  public.orders;
  v_item   record;
  v_level  uuid;
  v_new    bigint;
  v_ful    integer;
  v_ret    integer;
begin
  select * into v_ref from public.refunds r where r.id = p_refund_id;
  if v_ref.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'refund';
  end if;
  select * into v_order from public.orders o where o.id = v_ref.order_id for update;
  select * into v_ref from public.refunds r where r.id = p_refund_id for update;
  if v_ref.status <> 'pending' or p_status = 'pending' then
    return jsonb_build_object('status', v_ref.status, 'replayed', true);
  end if;
  perform app.set_order_actor('system');
  if p_status = 'failed' then
    update public.refunds set status = 'failed', failure_code = left(coalesce(p_failure_code, 'provider_error'), 100)
     where id = v_ref.id;
    update public.orders set needs_attention = true where id = v_order.id;
    insert into public.order_events (store_id, order_id, type, message, actor_type, metadata)
    values (v_order.store_id, v_order.id, 'refund.failed', 'El reembolso falló', 'system',
            jsonb_build_object('refund_id', v_ref.id));
    return jsonb_build_object('status', 'failed', 'replayed', false);
  end if;
  if p_status <> 'succeeded' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;

  update public.refunds set status = 'succeeded', provider_refund_id = left(p_provider_refund_id, 200) where id = v_ref.id;
  v_new := v_order.refunded_total + v_ref.amount;
  for v_item in
    select (x ->> 'order_item_id')::uuid as id, (x ->> 'quantity')::integer as q
      from jsonb_array_elements(v_ref.items) x
  loop
    update public.order_items
       set refunded_quantity = refunded_quantity + v_item.q,
           returned_quantity = returned_quantity + case when v_ref.restock then v_item.q else 0 end
     where id = v_item.id and store_id = v_order.store_id;
    if v_ref.restock then
      select app.default_level(v_order.store_id, i.variant_id) into v_level
        from public.order_items i join public.product_variants v on v.store_id = i.store_id and v.id = i.variant_id
       where i.id = v_item.id and v.track_inventory;
      if v_level is not null then
        perform app.apply_inventory_movement(v_order.store_id, v_level, 'return', v_item.q, 0, null, 'refund', v_ref.id,
                                             'return:' || v_ref.id || ':' || v_item.id, 'system');
      end if;
    end if;
  end loop;

  select coalesce(sum(fulfilled_quantity), 0), coalesce(sum(returned_quantity), 0) into v_ful, v_ret
    from public.order_items where order_id = v_order.id;
  update public.orders
     set refunded_total = v_new,
         payment_status = case when v_new >= paid_total then 'refunded' else 'partially_refunded' end,
         fulfillment_status = case
           when v_ret = 0 then fulfillment_status
           when v_ret >= v_ful and fulfillment_status in ('fulfilled', 'partially_returned') then 'returned'
           when fulfillment_status in ('fulfilled', 'partially_fulfilled') then 'partially_returned'
           else fulfillment_status end,
         needs_attention = case when v_new >= paid_total then false else needs_attention end
   where id = v_order.id;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, metadata)
  values (v_order.store_id, v_order.id, 'refund.succeeded', 'Reembolso realizado', true, 'system',
          jsonb_build_object('refund_id', v_ref.id, 'amount', v_ref.amount));
  perform app.enqueue_job('refund.succeeded', jsonb_build_object('order_id', v_order.id, 'refund_id', v_ref.id),
                          v_order.store_id, 'refund.succeeded:' || v_ref.id);
  return jsonb_build_object('status', 'succeeded', 'replayed', false);
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
  perform app.enqueue_job('payments.reconcile', '{}'::jsonb, null,
                          'payments.reconcile:' || to_char(date_trunc('hour', now() at time zone 'utc')
                            + floor(extract(minute from now() at time zone 'utc') / 10) * interval '10 minutes',
                            'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  perform app.enqueue_job('orders.complete', '{}'::jsonb, null,
                          'orders.complete:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
end
$$;

revoke all on function public.orders_fulfill(uuid, uuid, jsonb, text, text, text, text) from public;
revoke all on function public.orders_mark_delivered(uuid, uuid) from public;
revoke all on function public.orders_request_refund(uuid, uuid, bigint, jsonb, boolean, text, text) from public;
revoke all on function public.orders_cancel(uuid, uuid, text, text, text) from public;
revoke all on function system.complete_orders() from public;
revoke all on function system.refund_for_execution(uuid) from public;
revoke all on function system.apply_refund_result(uuid, text, text, text) from public;
revoke all on function system.enqueue_maintenance() from public;
grant execute on function public.orders_fulfill(uuid, uuid, jsonb, text, text, text, text) to authenticated;
grant execute on function public.orders_mark_delivered(uuid, uuid) to authenticated;
grant execute on function public.orders_request_refund(uuid, uuid, bigint, jsonb, boolean, text, text) to authenticated;
grant execute on function public.orders_cancel(uuid, uuid, text, text, text) to authenticated;
grant execute on function system.complete_orders() to system_worker;
grant execute on function system.refund_for_execution(uuid) to system_worker;
grant execute on function system.apply_refund_result(uuid, text, text, text) to system_worker;
grant execute on function system.enqueue_maintenance() to system_worker;
