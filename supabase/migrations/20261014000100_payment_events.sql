-- =============================================================================
-- Fase 7 · Eventos de pago, estado verificado y reconciliación (F7-T02).
-- Contrato: GATE0 §18.3-18.5, §34.4, CF-04; A-01 (Stripe Connect).
--
-- * El webhook verifica la firma, registra el evento (deduplicado por cuenta)
--   y RE-CONSULTA al proveedor; solo lo re-consultado llega aquí.
-- * system.apply_payment_status: transición monótona del intento, validación de
--   referencia, monto y moneda (discrepancia → needs_attention, nunca pagado) y
--   pago tardío sobre un pedido vencido (CF-04): con existencias → re-reserva y
--   se reabre; sin existencias → queda cancelado, pagado y en atención (reembolso).
-- * Proveedor `stripe` (Connect, cargos directos): la cuenta guarda solo el
--   `stripe_account_id` en public_config; ningún secreto por tienda (A-01).
-- =============================================================================

alter table public.payment_accounts drop constraint payment_accounts_provider_check;
alter table public.payment_accounts
  add constraint payment_accounts_provider_check check (provider in ('manual', 'fake', 'stripe'));
alter table public.payments drop constraint payments_provider_check;
alter table public.payments add constraint payments_provider_check check (provider in ('manual', 'fake', 'stripe'));
alter table public.payment_accounts
  add constraint payment_accounts_stripe_config check (
    provider <> 'stripe' or coalesce(public_config ->> 'stripe_account_id', '') ~ '^acct_[A-Za-z0-9]{8,64}$');
-- Una cuenta conectada pertenece a una sola tienda de la plataforma.
create unique index payment_accounts_stripe_uq on public.payment_accounts ((public_config ->> 'stripe_account_id'))
  where provider = 'stripe' and status <> 'disabled';
create index payments_checkout_idx on public.payments (payment_account_id, provider_checkout_id)
  where provider_checkout_id is not null;

-- -----------------------------------------------------------------------------
-- payment_events (§18.3): crudo y verificado; deduplicado por cuenta.
-- -----------------------------------------------------------------------------
create table public.payment_events (
  id                 uuid primary key default app.uuid_v7(),
  store_id           uuid not null references public.stores (id) on delete restrict,
  payment_account_id uuid not null,
  provider_event_id  text not null check (char_length(provider_event_id) between 1 and 255),
  type               text not null check (char_length(type) between 1 and 100),
  signed_at          timestamptz not null,
  received_at        timestamptz not null default now(),
  payload            jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 262144),
  processed_at       timestamptz,
  processing_error   text check (processing_error is null or char_length(processing_error) <= 500),
  attempts           integer not null default 0 check (attempts >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (store_id, id),
  unique (payment_account_id, provider_event_id),
  foreign key (store_id, payment_account_id) references public.payment_accounts (store_id, id) on delete restrict
);
create index payment_events_unprocessed_idx on public.payment_events (received_at) where processed_at is null;

create trigger payment_events_set_updated_at before update on public.payment_events
  for each row execute function app.set_updated_at();
create trigger payment_events_prevent_tenant_change before update on public.payment_events
  for each row execute function app.prevent_tenant_change();
create trigger payment_events_immutable before update on public.payment_events
  for each row execute function app.prevent_column_change('payment_account_id', 'provider_event_id', 'type',
                                                          'signed_at', 'payload');
create trigger payment_events_no_delete before delete on public.payment_events
  for each row execute function app.forbid_mutation();

alter table public.payment_events enable row level security;
alter table public.payment_events force row level security;
revoke all on table public.payment_events from public, anon, authenticated, service_role;
grant select (id, store_id, payment_account_id, provider_event_id, type, signed_at, received_at, processed_at,
              processing_error, attempts, created_at) on public.payment_events to authenticated;
create policy payment_events_select on public.payment_events for select to authenticated
  using (app.has_store_permission(store_id, 'payments.read'));

-- -----------------------------------------------------------------------------
-- Cuenta del webhook (§18.4.1): por la cuenta externa del proveedor.
-- -----------------------------------------------------------------------------
create or replace function system.payment_account_for_webhook(p_provider text, p_external_account text)
returns table (id uuid, store_id uuid, status text, mode text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.store_id, a.status, a.mode
    from public.payment_accounts a
   where a.provider = p_provider and p_provider = 'stripe'
     and a.public_config ->> 'stripe_account_id' = p_external_account
     and a.status <> 'disabled'
$$;

-- Registra el evento; si ya existía devuelve si se procesó (§18.4.3).
create or replace function system.record_payment_event(p_account_id uuid, p_event_id text, p_type text,
                                                       p_signed_at timestamptz, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid;
  v_processed timestamptz;
begin
  insert into public.payment_events (store_id, payment_account_id, provider_event_id, type, signed_at, payload)
  select a.store_id, a.id, p_event_id, p_type, p_signed_at, p_payload
    from public.payment_accounts a where a.id = p_account_id
  on conflict (payment_account_id, provider_event_id) do nothing
  returning id into v_id;
  if v_id is null then
    select e.id, e.processed_at into v_id, v_processed from public.payment_events e
     where e.payment_account_id = p_account_id and e.provider_event_id = p_event_id;
    if v_id is null then
      raise exception using errcode = 'P0001', message = 'not_found', detail = 'payment_account';
    end if;
  end if;
  update public.payment_events set attempts = attempts + 1 where id = v_id;
  return jsonb_build_object('id', v_id, 'processed', v_processed is not null);
end
$$;

create or replace function system.finish_payment_event(p_event_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_events
     set processed_at = case when p_error is null then now() end,
         processing_error = left(p_error, 500)
   where id = p_event_id and processed_at is null
$$;

-- Intento de pago por su referencia del proveedor (sesión de checkout), en la cuenta del evento.
create or replace function system.payment_for_provider_ref(p_account_id uuid, p_checkout_id text, p_reference uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'order_id', p.order_id, 'store_id', p.store_id, 'status', p.status,
                            'provider_checkout_id', p.provider_checkout_id,
                            'account', jsonb_build_object('id', a.id, 'provider', a.provider, 'mode', a.mode,
                                                          'public_config', a.public_config))
    from public.payments p
    join public.payment_accounts a on a.store_id = p.store_id and a.id = p.payment_account_id
   where p.payment_account_id = p_account_id
     and ((p_checkout_id is not null and p.provider_checkout_id = p_checkout_id)
          or (p_checkout_id is null and p.id = p_reference))
   limit 1
$$;

-- -----------------------------------------------------------------------------
-- Cierre de un pedido pagado: pago, pedido, cupón, contadores y job. La reserva
-- ya debe estar confirmada por quien llama.
-- -----------------------------------------------------------------------------
create or replace function app.finalize_paid_order(p_order_id uuid, p_payment_id uuid, p_method text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  update public.payments set status = 'succeeded', method = coalesce(p_method, method), last_synced_at = now()
   where id = p_payment_id and status <> 'succeeded';
  update public.orders
     set status = 'open', payment_status = 'paid', paid_total = total, paid_at = now(),
         cancel_reason = null, cancelled_at = null
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
end
$$;
revoke all on function app.finalize_paid_order(uuid, uuid, text) from public;

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
  -- Un pago verificado por el proveedor (actor system) puede llegar tras un
  -- intento marcado como fallido o vencido.
  if v_order.status <> 'pending_payment'
     or not (v_pay.status in ('created', 'pending', 'authorized')
             or (p_actor = 'system' and v_pay.status in ('failed', 'expired'))) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'order_not_payable';
  end if;
  select r.id into v_res from public.inventory_reservations r
   where r.store_id = v_order.store_id and r.order_id = v_order.id and r.status = 'active';
  if v_res is null then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'reservation_expired';
  end if;

  perform app.set_order_actor(p_actor);
  perform app.inventory_commit(v_order.store_id, v_res);
  perform app.finalize_paid_order(v_order.id, v_pay.id, p_method);
  return jsonb_build_object('order_id', v_order.id, 'replayed', false);
end
$$;

-- -----------------------------------------------------------------------------
-- Estado verificado (§18.4.5-6). p_payment: {status, amount, currency,
-- provider_payment_id?, external_reference, method?, failure_code?}.
-- Devuelve {outcome}: paid | late_paid | late_without_stock | pending | failed |
-- closed | ignored | mismatch.
-- -----------------------------------------------------------------------------
create or replace function system.apply_payment_status(p_payment_id uuid, p_payment jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay    public.payments;
  v_order  public.orders;
  v_status text := p_payment ->> 'status';
  v_res    uuid;
  v_items  jsonb;
  v_ttl    integer;
begin
  select * into v_pay from public.payments p where p.id = p_payment_id;
  if v_pay.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'payment';
  end if;
  -- Orden de bloqueo: pedido → pago (como el resto del ciclo).
  select * into v_order from public.orders o where o.store_id = v_pay.store_id and o.id = v_pay.order_id for update;
  select * into v_pay from public.payments p where p.id = p_payment_id for update;
  perform app.set_order_actor('system');

  -- 5. Lo re-consultado debe ser ESTE intento, por ESTE monto y moneda.
  if coalesce(p_payment ->> 'external_reference', '') <> v_pay.id::text
     or (p_payment ->> 'amount') is null or (p_payment ->> 'amount')::numeric <> v_pay.amount
     or upper(coalesce(p_payment ->> 'currency', '')) <> v_pay.currency then
    update public.orders set needs_attention = true where id = v_order.id;
    insert into public.order_events (store_id, order_id, type, message, actor_type, metadata)
    values (v_order.store_id, v_order.id, 'payment.mismatch', 'El proveedor reportó datos que no coinciden', 'system',
            jsonb_build_object('payment_id', v_pay.id, 'status', v_status));
    perform system.record_security_event('payment.mismatch', 'critical', null, v_order.store_id, null, null, null,
                                         jsonb_build_object('payment_id', v_pay.id,
                                                            'amount', p_payment -> 'amount',
                                                            'currency', p_payment -> 'currency'));
    return jsonb_build_object('outcome', 'mismatch');
  end if;
  if nullif(p_payment ->> 'provider_payment_id', '') is not null and v_pay.provider_payment_id is null then
    update public.payments set provider_payment_id = left(p_payment ->> 'provider_payment_id', 200) where id = v_pay.id;
  end if;
  update public.payments set last_synced_at = now() where id = v_pay.id;

  if v_pay.status = 'succeeded' then
    return jsonb_build_object('outcome', 'ignored');   -- monótono: nada retrocede ni se repite
  end if;

  if v_status = 'succeeded' then
    select r.id into v_res from public.inventory_reservations r
     where r.store_id = v_order.store_id and r.order_id = v_order.id and r.status = 'active';
    if v_order.status = 'pending_payment' and v_res is not null then
      perform app.confirm_order_payment(v_pay.id, 'system', p_payment ->> 'method');
      return jsonb_build_object('outcome', 'paid');
    end if;
    if v_order.status not in ('pending_payment', 'cancelled') or v_order.payment_status in ('paid', 'refunded',
                                                                                             'partially_refunded') then
      -- Otro intento ya cobró este pedido: el dinero de este debe devolverse.
      update public.payments set status = 'succeeded', method = coalesce(p_payment ->> 'method', method)
       where id = v_pay.id and not exists (select 1 from public.payments x where x.order_id = v_order.id
                                                                             and x.status = 'succeeded');
      update public.orders set needs_attention = true where id = v_order.id;
      insert into public.order_events (store_id, order_id, type, message, actor_type, metadata)
      values (v_order.store_id, v_order.id, 'payment.duplicate', 'Cobro adicional: requiere reembolso', 'system',
              jsonb_build_object('payment_id', v_pay.id));
      return jsonb_build_object('outcome', 'duplicate');
    end if;

    -- CF-04: pago tardío sobre un pedido vencido (o con la reserva vencida).
    v_ttl := (select s.reservation_ttl_minutes from public.stores s where s.id = v_order.store_id);
    select jsonb_agg(jsonb_build_object('variant_id', i.variant_id, 'quantity', i.quantity))
      into v_items from public.order_items i
     where i.store_id = v_order.store_id and i.order_id = v_order.id and i.variant_id is not null;
    if v_res is not null then
      perform app.inventory_release(v_order.store_id, v_res, 'expired');
    end if;
    begin
      v_res := case when v_items is null then null
                    else app.inventory_reserve(v_order.store_id, v_order.id, v_items, now() + make_interval(mins => v_ttl)) end;
    exception when sqlstate 'P0001' then
      if sqlerrm not in ('insufficient_stock', 'not_found') then
        raise;
      end if;
      -- Sin existencias: el dinero se cobró; el pedido queda cancelado, pagado y
      -- en atención para reembolsar (nunca se vende lo que no hay).
      update public.payments set status = 'succeeded', method = coalesce(p_payment ->> 'method', method)
       where id = v_pay.id;
      update public.orders set payment_status = 'paid', paid_total = total, paid_at = now(), needs_attention = true
       where id = v_order.id;
      insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, metadata)
      values (v_order.store_id, v_order.id, 'payment.late_without_stock',
              'El pago llegó después de vencer el pedido y ya no hay existencias: se reembolsará', true, 'system',
              jsonb_build_object('payment_id', v_pay.id));
      perform app.enqueue_job('payment.late_without_stock', jsonb_build_object('order_id', v_order.id),
                              v_order.store_id, 'payment.late_without_stock:' || v_order.id);
      return jsonb_build_object('outcome', 'late_without_stock');
    end;
    if v_res is not null then
      perform app.inventory_commit(v_order.store_id, v_res);
    end if;
    -- El cupón liberado al vencer no se vuelve a contar (el precio pagado se respeta).
    perform app.finalize_paid_order(v_order.id, v_pay.id, p_payment ->> 'method');
    insert into public.order_events (store_id, order_id, type, message, actor_type, metadata)
    values (v_order.store_id, v_order.id, 'payment.late', 'Pago recibido después del vencimiento: pedido reabierto',
            'system', jsonb_build_object('payment_id', v_pay.id));
    return jsonb_build_object('outcome', 'late_paid');
  end if;

  if v_status in ('pending', 'authorized') then
    if v_pay.status = 'created' or (v_status = 'authorized' and v_pay.status = 'pending') then
      update public.payments set status = v_status where id = v_pay.id;
    end if;
    if v_order.status = 'pending_payment' then
      update public.orders set payment_status = v_status
       where id = v_order.id and payment_status in ('unpaid', 'pending', 'failed')
         and app.order_transition_allowed('payment', payment_status, v_status, 'system');
    end if;
    return jsonb_build_object('outcome', 'pending');
  end if;

  if v_status = 'failed' then
    if v_pay.status in ('created', 'pending', 'authorized') then
      update public.payments set status = 'failed', failure_code = left(coalesce(p_payment ->> 'failure_code',
                                                                                 'provider_declined'), 100)
       where id = v_pay.id;
      update public.orders set payment_status = 'failed'
       where id = v_order.id and status = 'pending_payment' and payment_status in ('unpaid', 'pending');
      perform app.enqueue_job('payment.failed', jsonb_build_object('order_id', v_order.id, 'payment_id', v_pay.id),
                              v_order.store_id, 'payment.failed:' || v_pay.id);
    end if;
    return jsonb_build_object('outcome', 'failed');
  end if;

  if v_status in ('expired', 'cancelled') then
    if v_pay.status in ('created', 'pending', 'authorized') then
      update public.payments set status = v_status where id = v_pay.id;
    end if;
    return jsonb_build_object('outcome', 'closed');
  end if;

  -- refunded / partially_refunded: los aplica el flujo de reembolsos (F7-T03).
  return jsonb_build_object('outcome', 'ignored');
end
$$;

-- -----------------------------------------------------------------------------
-- Reconciliación (§18.5): intentos abiertos con más de 15 minutos.
-- -----------------------------------------------------------------------------
create or replace function system.payments_to_reconcile(p_limit integer default 100)
returns table (payment_id uuid, account jsonb, provider_checkout_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, jsonb_build_object('id', a.id, 'provider', a.provider, 'mode', a.mode,
                                  'public_config', a.public_config), p.provider_checkout_id
    from public.payments p
    join public.payment_accounts a on a.store_id = p.store_id and a.id = p.payment_account_id
    join public.orders o on o.store_id = p.store_id and o.id = p.order_id
   where p.status in ('created', 'pending', 'authorized') and p.provider = 'stripe'
     and p.provider_checkout_id is not null and p.created_at < now() - interval '15 minutes'
     and o.status in ('pending_payment', 'cancelled')
     and (p.last_synced_at is null or p.last_synced_at < now() - interval '10 minutes')
   order by p.created_at
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
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
  -- Reconciliación cada 10 minutos (§18.5).
  perform app.enqueue_job('payments.reconcile', '{}'::jsonb, null,
                          'payments.reconcile:' || to_char(date_trunc('hour', now() at time zone 'utc')
                            + floor(extract(minute from now() at time zone 'utc') / 10) * interval '10 minutes',
                            'YYYY-MM-DD"T"HH24:MI'), now(), 3);
end
$$;

revoke all on function system.payment_account_for_webhook(text, text) from public;
revoke all on function system.record_payment_event(uuid, text, text, timestamptz, jsonb) from public;
revoke all on function system.finish_payment_event(uuid, text) from public;
revoke all on function system.payment_for_provider_ref(uuid, text, uuid) from public;
revoke all on function system.apply_payment_status(uuid, jsonb) from public;
revoke all on function system.payments_to_reconcile(integer) from public;
revoke all on function system.enqueue_maintenance() from public;
grant execute on function system.payment_account_for_webhook(text, text) to system_worker;
grant execute on function system.record_payment_event(uuid, text, text, timestamptz, jsonb) to system_worker;
grant execute on function system.finish_payment_event(uuid, text) to system_worker;
grant execute on function system.payment_for_provider_ref(uuid, text, uuid) to system_worker;
grant execute on function system.apply_payment_status(uuid, jsonb) to system_worker;
grant execute on function system.payments_to_reconcile(integer) to system_worker;
grant execute on function system.enqueue_maintenance() to system_worker;
