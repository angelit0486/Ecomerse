-- =============================================================================
-- Fase 6 · Pagos manual/fake y expiración (F6-T04). Contrato: GATE0 §16.4,
-- §17.5, §18.2; CF-04 (pago tardío) queda para la F7 con apply_payment_status.
--
-- * app.confirm_order_payment: confirmación de un intento (reserva → committed,
--   cupón → confirmed, contadores, totales). La usan la confirmación manual del
--   staff y el proveedor `fake`; la F7 la reutiliza desde el webhook verificado.
-- * system.expire_orders: pedidos `pending_payment` con la reserva vencida →
--   cancelados (`payment_expired`), reserva liberada, cupón liberado.
-- * `fake` solo funciona con el ajuste de plataforma `payments.allow_fake`.
-- =============================================================================

create or replace function app.fake_payments_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value ->> 'enabled')::boolean from public.platform_settings s
                    where s.key = 'payments.allow_fake'), false)
$$;
revoke all on function app.fake_payments_allowed() from public;

create or replace function app.set_order_actor(p_actor text)
returns void
language sql
set search_path = ''
as $$
  select set_config('app.order_actor', p_actor, true)
$$;
revoke all on function app.set_order_actor(text) from public;

-- -----------------------------------------------------------------------------
-- Confirmación de un intento de pago (§18.4 paso 6, sin la parte de proveedor).
-- -----------------------------------------------------------------------------
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

  update public.customers set orders_count = orders_count + 1, total_spent = total_spent + v_order.total
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
revoke all on function app.confirm_order_payment(uuid, text, text) from public;

-- -----------------------------------------------------------------------------
-- Resultado de createCheckout (§17.5, pasos 15-16).
-- -----------------------------------------------------------------------------
create or replace function system.mark_payment_pending(p_payment_id uuid, p_provider_checkout_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments;
begin
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

-- Nuevo intento sobre el mismo pedido mientras la reserva esté vigente.
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
  return jsonb_build_object('id', v_id, 'provider', v_last.provider, 'status', 'created',
                            'expires_at', v_res.expires_at - interval '2 minutes', 'replayed', false);
end
$$;

-- Datos que el adaptador necesita para createCheckout (sin secretos en la F6).
create or replace function system.payment_for_checkout(p_payment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'payment', jsonb_build_object('id', p.id, 'amount', p.amount, 'currency', p.currency, 'status', p.status,
                                  'expires_at', p.expires_at, 'provider', p.provider),
    'account', jsonb_build_object('id', a.id, 'provider', a.provider, 'mode', a.mode, 'status', a.status,
                                  'public_config', a.public_config),
    'order', jsonb_build_object('id', o.id, 'store_id', o.store_id, 'display_number', o.display_number,
                                'email', o.email, 'customer_name', o.customer_name),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('title', i.product_title, 'quantity', i.quantity,
                                                           'unit_price', i.unit_price) order by i.position), '[]')
                from public.order_items i where i.store_id = o.store_id and i.order_id = o.id))
    from public.payments p
    join public.payment_accounts a on a.store_id = p.store_id and a.id = p.payment_account_id
    join public.orders o on o.store_id = p.store_id and o.id = p.order_id
   where p.id = p_payment_id
$$;

-- -----------------------------------------------------------------------------
-- Proveedor `fake` (pruebas y desarrollo): resultado simulado.
-- -----------------------------------------------------------------------------
create or replace function system.fake_payment_result(p_payment_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments;
begin
  if not app.fake_payments_allowed() then
    raise exception using errcode = '42501', message = 'forbidden', detail = 'fake_payments_disabled';
  end if;
  select * into v_pay from public.payments p where p.id = p_payment_id;
  if v_pay.id is null or v_pay.provider <> 'fake' then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'payment';
  end if;
  if p_outcome = 'succeeded' then
    return app.confirm_order_payment(p_payment_id, 'provider', 'fake');
  elsif p_outcome = 'failed' then
    perform system.mark_payment_failed(p_payment_id, 'fake_declined');
    return jsonb_build_object('order_id', v_pay.order_id, 'replayed', false);
  end if;
  raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'outcome';
end
$$;

-- -----------------------------------------------------------------------------
-- Confirmación manual por el staff (transferencia, efectivo…), auditada.
-- -----------------------------------------------------------------------------
create or replace function public.orders_mark_paid_manual(p_store_id uuid, p_order_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay    public.payments;
  v_result jsonb;
begin
  perform app.require_store_permission(p_store_id, 'orders.update');
  select p.* into v_pay from public.payments p
    join public.orders o on o.store_id = p.store_id and o.id = p.order_id
   where p.store_id = p_store_id and p.order_id = p_order_id and p.provider = 'manual'
     and p.status in ('created', 'pending', 'authorized')
   order by p.created_at desc limit 1;
  if v_pay.id is null then
    if exists (select 1 from public.orders o where o.store_id = p_store_id and o.id = p_order_id) then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'order_not_payable';
    end if;
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  v_result := app.confirm_order_payment(v_pay.id, 'staff', 'manual');
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, actor_user_id)
  values (p_store_id, p_order_id, 'payment.confirmed_manually', left(nullif(btrim(p_note), ''), 1000), false,
          'staff', auth.uid());
  perform audit.record('order.payment_confirmed_manually', 'order', p_order_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('payment_id', v_pay.id, 'amount', v_pay.amount));
  return v_result;
end
$$;

-- -----------------------------------------------------------------------------
-- Expiración (§17.6 «Abandono»): cada minuto, por lotes y sin bloquear al resto.
-- -----------------------------------------------------------------------------
create or replace function system.expire_orders(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_count integer := 0;
begin
  for v_order in
    select o.id, o.store_id, r.id as reservation_id
      from public.orders o
      join public.inventory_reservations r on r.store_id = o.store_id and r.order_id = o.id and r.status = 'active'
     where o.status = 'pending_payment' and r.expires_at <= now()
     order by r.expires_at
     limit least(greatest(coalesce(p_limit, 200), 1), 1000)
       for update of o skip locked
  loop
    perform app.set_order_actor('system');
    perform app.inventory_release(v_order.store_id, v_order.reservation_id, 'expired');
    update public.payments set status = 'expired'
     where store_id = v_order.store_id and order_id = v_order.id and status in ('created', 'pending', 'authorized');
    update public.orders
       set status = 'cancelled', cancel_reason = 'payment_expired', cancelled_at = now(),
           payment_status = case when payment_status in ('unpaid', 'pending', 'failed') then 'expired'
                                 when payment_status = 'authorized' then 'voided' else payment_status end
     where id = v_order.id;
    update public.discounts d set times_reserved = d.times_reserved - 1
      from public.discount_redemptions dr
     where dr.order_id = v_order.id and dr.status = 'reserved' and d.store_id = dr.store_id and d.id = dr.discount_id;
    update public.discount_redemptions set status = 'released' where order_id = v_order.id and status = 'reserved';
    v_count := v_count + 1;
  end loop;

  -- Carritos activos vencidos → abandonados.
  update public.carts set status = 'abandoned'
   where id in (select c.id from public.carts c where c.status = 'active' and c.expires_at <= now()
                 limit 1000 for update skip locked);
  return v_count;
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
  -- Expiración de pedidos sin pagar: como mucho uno por minuto (§17.6).
  perform app.enqueue_job('orders.expire', '{}'::jsonb, null,
                          'orders.expire:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'), now(), 3);
end
$$;

-- -----------------------------------------------------------------------------
-- Envoltorios para el flujo público (storefront_gateway): siempre acotados a un
-- pago de ESA tienda; las funciones system.* quedan para el worker y la F7.
-- -----------------------------------------------------------------------------
create or replace function storefront.payment_for_checkout(p_store_id uuid, p_payment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select system.payment_for_checkout(p.id) from public.payments p
   where p.store_id = p_store_id and p.id = p_payment_id
$$;

create or replace function storefront.record_checkout_result(p_store_id uuid, p_payment_id uuid, p_ok boolean,
                                                             p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.payments p where p.store_id = p_store_id and p.id = p_payment_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'payment';
  end if;
  if p_ok then
    perform system.mark_payment_pending(p_payment_id, p_reference);
  else
    perform system.mark_payment_failed(p_payment_id, coalesce(p_reference, 'provider_error'));
  end if;
end
$$;

create or replace function storefront.fake_payment_result(p_store_id uuid, p_payment_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.payments p where p.store_id = p_store_id and p.id = p_payment_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'payment';
  end if;
  return system.fake_payment_result(p_payment_id, p_outcome);
end
$$;

revoke all on function storefront.payment_for_checkout(uuid, uuid) from public;
revoke all on function storefront.record_checkout_result(uuid, uuid, boolean, text) from public;
revoke all on function storefront.fake_payment_result(uuid, uuid, text) from public;
grant execute on function storefront.payment_for_checkout(uuid, uuid) to storefront_gateway;
grant execute on function storefront.record_checkout_result(uuid, uuid, boolean, text) to storefront_gateway;
grant execute on function storefront.fake_payment_result(uuid, uuid, text) to storefront_gateway;

revoke all on function system.mark_payment_pending(uuid, text) from public;
revoke all on function system.mark_payment_failed(uuid, text) from public;
revoke all on function system.payment_for_checkout(uuid) from public;
revoke all on function system.fake_payment_result(uuid, text) from public;
revoke all on function system.expire_orders(integer) from public;
revoke all on function system.enqueue_maintenance() from public;
revoke all on function storefront.retry_payment(uuid, uuid, bytea) from public;
revoke all on function public.orders_mark_paid_manual(uuid, uuid, text) from public;
grant execute on function system.mark_payment_pending(uuid, text) to system_worker;
grant execute on function system.mark_payment_failed(uuid, text) to system_worker;
grant execute on function system.payment_for_checkout(uuid) to system_worker;
grant execute on function system.fake_payment_result(uuid, text) to system_worker;
grant execute on function system.expire_orders(integer) to system_worker;
grant execute on function system.enqueue_maintenance() to system_worker;
grant execute on function storefront.retry_payment(uuid, uuid, bytea) to storefront_gateway;
grant execute on function public.orders_mark_paid_manual(uuid, uuid, text) to authenticated;
