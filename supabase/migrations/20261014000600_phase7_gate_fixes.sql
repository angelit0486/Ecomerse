-- =============================================================================
-- Gate F7 · Correcciones de la revisión adversarial (base de datos y dinero;
-- capa de aplicación). Ver docs/phases/PHASE-07-REPORT.md.
--
-- DB-H1/M1  Pago que llega sobre un pedido cancelado por la tienda (o con el
--           intento cancelado): se registra, el pedido sigue cancelado, queda en
--           atención y se reembolsa automáticamente; nunca reabre ni falla.
--           Pago tardío sin existencias: también reembolso automático.
-- DB-H2     Unidades de reembolsos pendientes cuentan para el límite;
-- DB-M3     sin partidas repetidas; returned ≤ fulfilled (CHECK).
-- DB-M2     Un cobro duplicado no se "olvida": la atención solo la cierra el staff.
-- DB-M4     Cerrar lo no enviado de un pedido parcial (libera la reserva).
-- DB-L1..L6 Resultado NULL falla; claves de idempotencia ligadas al pedido;
--           cancelar con reembolso pendiente total; completar sin reembolsos
--           pendientes ni atención; entrega con bloqueo.
-- APP-H1    Reembolsos de Stripe pendientes: se guarda el re_ y se reconcilian.
-- APP-M1/M3 Cuenta desautorizada → error; webhooks de cuentas desactivadas.
-- APP-L4/L7 Rechazos de webhook registrados con límite de frecuencia.
-- =============================================================================

-- Unidades que no se enviarán (cerradas por la tienda): expand, default 0.
alter table public.order_items add column cancelled_quantity integer not null default 0
  check (cancelled_quantity >= 0);
alter table public.order_items add constraint order_items_resolved_le_quantity
  check (fulfilled_quantity + cancelled_quantity <= quantity and returned_quantity <= fulfilled_quantity);

create or replace function app.order_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable text[] := array['fulfilled_quantity', 'refunded_quantity', 'returned_quantity', 'cancelled_quantity', 'variant_id',
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
    or (old.status in ('expired', 'failed') and new.status = 'succeeded')
    -- El proveedor cobró un intento que la tienda canceló (Gate F7): se registra la realidad.
    or (old.status = 'cancelled' and new.status = 'succeeded')) then
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
                        or (p_from in ('expired', 'failed', 'voided') and p_to = 'paid' and p_actor = 'system')
    when 'fulfillment' then (p_from, p_to) in (('unfulfilled', 'partially_fulfilled'), ('unfulfilled', 'fulfilled'),
                                               ('partially_fulfilled', 'fulfilled'),
                                               ('partially_fulfilled', 'partially_returned'),
                                               ('fulfilled', 'partially_returned'), ('fulfilled', 'returned'),
                                               ('partially_returned', 'returned'))
    else false
  end
$$;

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

    -- Pedido cancelado por la tienda (o intento cancelado): la decisión se respeta.
    -- El dinero cobrado se registra, el pedido queda en atención y se reembolsa.
    if v_order.status = 'cancelled'
       and (v_order.cancel_reason is distinct from 'payment_expired' or v_pay.status = 'cancelled') then
      update public.payments set status = 'succeeded', method = coalesce(p_payment ->> 'method', method)
       where id = v_pay.id;
      update public.orders set payment_status = 'paid', paid_total = total, paid_at = now(), needs_attention = true
       where id = v_order.id;
      insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, metadata)
      values (v_order.store_id, v_order.id, 'payment.after_cancel',
              'El pago llegó después de cancelar el pedido: se reembolsará', true, 'system',
              jsonb_build_object('payment_id', v_pay.id));
      select * into v_order from public.orders o where o.id = v_order.id;
      perform app.request_refund(v_order, v_order.paid_total - v_order.refunded_total, '[]'::jsonb, false,
                                 'Pago recibido después de la cancelación', 'after_cancel_' || v_pay.id);
      perform app.enqueue_job('payment.after_cancel', jsonb_build_object('order_id', v_order.id),
                              v_order.store_id, 'payment.after_cancel:' || v_pay.id);
      return jsonb_build_object('outcome', 'paid_after_cancel');
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
      select * into v_order from public.orders o where o.id = v_order.id;
      perform app.request_refund(v_order, v_order.paid_total - v_order.refunded_total, '[]'::jsonb, false,
                                 'Pago tardío sin existencias', 'late_nostock_' || v_pay.id);
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
   where (p.status in ('created', 'pending', 'authorized')
          -- Intentos cancelados por la tienda con la sesión de Stripe aún abierta (≤ 2 días).
          or (p.status = 'cancelled' and p.created_at > now() - interval '2 days'))
     and p.provider = 'stripe'
     and p.provider_checkout_id is not null and p.created_at < now() - interval '15 minutes'
     and o.status in ('pending_payment', 'cancelled')
     and (p.last_synced_at is null or p.last_synced_at < now() - interval '10 minutes')
   order by p.created_at
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

-- Cuentas de la tienda para el webhook: también desactivadas o con error (sus
-- pagos ya cobrados deben aplicarse); solo no ofrecen checkouts nuevos.
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
$$;

-- La tienda retiró el acceso de la plataforma en Stripe: deja de cobrar.
create or replace function system.stripe_mark_deauthorized(p_account_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct public.payment_accounts;
begin
  select * into v_acct from public.payment_accounts a
   where a.provider = 'stripe' and a.public_config ->> 'stripe_account_id' = p_account_id for update;
  if v_acct.id is null or v_acct.status = 'error' then
    return;
  end if;
  update public.payment_accounts set status = 'error' where id = v_acct.id;
  perform audit.record('payments.stripe_status_changed', 'payment_account', v_acct.id,
                       (select s.organization_id from public.stores s where s.id = v_acct.store_id),
                       v_acct.store_id, jsonb_build_object('status', v_acct.status),
                       jsonb_build_object('status', 'error', 'reason', 'deauthorized'));
  perform system.record_security_event('payment.account_deauthorized', 'warning', null, v_acct.store_id,
                                       null, null, null, jsonb_build_object('provider', 'stripe'));
end
$$;

-- Rechazos del webhook (firma, formato, cuenta): se registran con límite de
-- frecuencia para que un tercero no pueda inflar la tabla de eventos.
create or replace function system.record_webhook_rejection(p_type text, p_provider text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_type !~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'type';
  end if;
  if app.rate_limit_take('webhook_rejection:' || p_type, 30, 60) then
    perform system.record_security_event(p_type, 'warning', null, null, null, null, null,
                                         jsonb_build_object('provider', left(p_provider, 40)));
  end if;
end
$$;

-- Sesión abierta de un intento cancelado (para expirarla en el proveedor).
create or replace function system.payment_for_expiry(p_payment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('checkout_id', p.provider_checkout_id, 'status', p.status,
                            'account', jsonb_build_object('id', a.id, 'provider', a.provider, 'mode', a.mode,
                                                          'public_config', a.public_config))
    from public.payments p
    join public.payment_accounts a on a.store_id = p.store_id and a.id = p.payment_account_id
   where p.id = p_payment_id and p.provider = 'stripe' and p.provider_checkout_id is not null
$$;

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
  select r.id into v_id from public.refunds r
   where r.store_id = p_order.store_id and r.idempotency_key = p_key;
  if v_id is not null then
    -- Doble solicitud con la misma clave: el mismo reembolso, solo del mismo pedido.
    if not exists (select 1 from public.refunds r where r.id = v_id and r.order_id = p_order.id) then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'idempotency_key';
    end if;
    return v_id;
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
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
                 where coalesce(jsonb_typeof(x -> 'quantity'), '') <> 'number'
                    or (x ->> 'quantity')::numeric <> floor((x ->> 'quantity')::numeric))
     -- Una partida por renglón: dos entradas del mismo renglón romperían el libro de inventario.
     or (select count(*) from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)))
        <> (select count(distinct x ->> 'order_item_id') from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
  end if;
  for v_line in
    select i.id, i.quantity, i.refunded_quantity, i.fulfilled_quantity, i.returned_quantity,
           (x ->> 'quantity')::integer as q,
           -- Unidades ya comprometidas en reembolsos pendientes del mismo renglón.
           (select coalesce(sum((y ->> 'quantity')::integer), 0) from public.refunds r, jsonb_array_elements(r.items) y
             where r.store_id = p_order.store_id and r.order_id = p_order.id and r.status = 'pending'
               and y ->> 'order_item_id' = i.id::text) as pending_q,
           (select coalesce(sum((y ->> 'quantity')::integer), 0) from public.refunds r, jsonb_array_elements(r.items) y
             where r.store_id = p_order.store_id and r.order_id = p_order.id and r.status = 'pending' and r.restock
               and y ->> 'order_item_id' = i.id::text) as pending_restock_q
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
      left join public.order_items i on i.store_id = p_order.store_id and i.order_id = p_order.id
                                    and i.id::text = x ->> 'order_item_id'
  loop
    if v_line.id is null or v_line.q is null or v_line.q <= 0
       or v_line.q > v_line.fulfilled_quantity - v_line.refunded_quantity - v_line.pending_q
       or (p_restock and v_line.q > v_line.fulfilled_quantity - v_line.returned_quantity - v_line.pending_restock_q) then
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

-- ¿Hay un cobro duplicado posterior a la última resolución del staff?
create or replace function app.order_has_open_duplicate(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.order_events e
                  where e.order_id = p_order_id and e.type = 'payment.duplicate'
                    and e.created_at > coalesce((select max(r.created_at) from public.order_events r
                                                  where r.order_id = p_order_id and r.type = 'attention.resolved'),
                                                '-infinity'))
$$;
revoke all on function app.order_has_open_duplicate(uuid) from public;

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
  -- Falla cerrado: un estado desconocido o NULL nunca cuenta como éxito.
  if p_status is null or p_status not in ('succeeded', 'failed', 'pending') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
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
         -- Un cobro duplicado sin resolver mantiene la atención (DB-M2): la cierra el staff.
         needs_attention = case when v_new >= paid_total and not app.order_has_open_duplicate(v_order.id) then false
                                else needs_attention end
   where id = v_order.id;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, metadata)
  values (v_order.store_id, v_order.id, 'refund.succeeded', 'Reembolso realizado', true, 'system',
          jsonb_build_object('refund_id', v_ref.id, 'amount', v_ref.amount));
  perform app.enqueue_job('refund.succeeded', jsonb_build_object('order_id', v_order.id, 'refund_id', v_ref.id),
                          v_order.store_id, 'refund.succeeded:' || v_ref.id);
  return jsonb_build_object('status', 'succeeded', 'replayed', false);
end
$$;

create or replace function system.refund_for_execution(p_refund_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', r.id, 'status', r.status, 'amount', r.amount, 'store_id', r.store_id,
                            'provider_refund_id', r.provider_refund_id, 'created_at', r.created_at,
                            'provider', p.provider, 'provider_payment_id', p.provider_payment_id,
                            'currency', p.currency,
                            'account', jsonb_build_object('id', a.id, 'provider', a.provider, 'mode', a.mode,
                                                          'public_config', a.public_config))
    from public.refunds r
    join public.payments p on p.store_id = r.store_id and p.id = r.payment_id
    join public.payment_accounts a on a.store_id = p.store_id and a.id = p.payment_account_id
   where r.id = p_refund_id
$$;

-- Id del reembolso en el proveedor mientras sigue pendiente (APP-H1): se consulta
-- con GET en lugar de repetir la creación.
create or replace function system.record_refund_provider_ref(p_refund_id uuid, p_provider_refund_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.refunds set provider_refund_id = left(p_provider_refund_id, 200)
   where id = p_refund_id and status = 'pending' and provider_refund_id is null
     and p_provider_refund_id ~ '^re_[A-Za-z0-9_]{6,200}$'
$$;

-- Reembolsos de Stripe pendientes sin job activo (reconciliación cada 10 min).
create or replace function system.refunds_to_reconcile(p_limit integer default 100)
returns table (refund_id uuid, provider_refund_id text, age_hours numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.provider_refund_id, extract(epoch from now() - r.created_at) / 3600
    from public.refunds r
    join public.payments p on p.store_id = r.store_id and p.id = r.payment_id
   where r.status = 'pending' and p.provider = 'stripe' and r.created_at < now() - interval '15 minutes'
     and not exists (select 1 from system.jobs j
                      where j.dedupe_key = 'refund.execute:' || r.id and j.status in ('queued', 'running'))
   order by r.created_at
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

-- Reembolso sin estado confirmable (sin id del proveedor tras 23 h): el pedido
-- queda en atención una vez; nunca se reintenta la creación (se duplicaría).
create or replace function system.flag_refund_stuck(p_refund_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref public.refunds;
begin
  select * into v_ref from public.refunds r where r.id = p_refund_id;
  if v_ref.id is null or v_ref.status <> 'pending'
     or exists (select 1 from public.order_events e where e.order_id = v_ref.order_id and e.type = 'refund.stuck'
                                                     and e.metadata ->> 'refund_id' = v_ref.id::text) then
    return;
  end if;
  perform app.set_order_actor('system');
  update public.orders set needs_attention = true where id = v_ref.order_id;
  insert into public.order_events (store_id, order_id, type, message, actor_type, metadata)
  values (v_ref.store_id, v_ref.order_id, 'refund.stuck',
          'No pudimos confirmar el reembolso con el proveedor: revísalo en su panel', 'system',
          jsonb_build_object('refund_id', v_ref.id));
end
$$;

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
    if not exists (select 1 from public.shipments s where s.id = v_ship and s.order_id = v_order.id) then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'idempotency_key';
    end if;
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
    select i.id, i.variant_id, i.quantity, i.fulfilled_quantity, i.cancelled_quantity, sum((x ->> 'quantity')::integer)::integer as q
      from jsonb_array_elements(p_items) x
      join public.order_items i on i.store_id = p_store_id and i.order_id = v_order.id and i.id = (x ->> 'order_item_id')::uuid
     group by i.id
  loop
    if v_line.q > v_line.quantity - v_line.fulfilled_quantity - v_line.cancelled_quantity then
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

  select coalesce(sum(i.quantity - i.fulfilled_quantity - i.cancelled_quantity), 0) into v_pending
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
  -- Con el pedido bloqueado se vuelve a leer el envío (dos clics simultáneos).
  select * into v_ship from public.shipments s where s.id = v_ship.id for update;
  if v_ship.status = 'delivered' then
    return;
  end if;
  if v_ship.status <> 'shipped' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'shipment_not_shipped';
  end if;
  update public.shipments set status = 'delivered', delivered_at = now() where id = v_ship.id;
  perform app.set_order_actor('staff');
  if v_order.status = 'open' and v_order.fulfillment_status = 'fulfilled' and not v_order.needs_attention
     and not exists (select 1 from public.refunds r where r.order_id = v_order.id and r.status = 'pending')
     and not exists (select 1 from public.shipments s where s.order_id = v_order.id and s.status = 'shipped') then
    update public.orders set status = 'completed', completed_at = now() where id = v_order.id;
  end if;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, actor_user_id)
  values (p_store_id, v_order.id, 'order.delivered', 'Pedido entregado', true, 'staff', auth.uid());
end
$$;

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
     where o.status = 'open' and o.fulfillment_status = 'fulfilled' and not o.needs_attention
       and not exists (select 1 from public.refunds r where r.order_id = o.id and r.status = 'pending')
       and (select max(s.shipped_at) from public.shipments s where s.order_id = o.id) < now() - interval '30 days'
    returning 1
  ) select count(*)::integer into v_count from done;
  return v_count;
end
$$;

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
  -- ≤ 90: la clave del reembolso es 'cancel_' || clave (máximo 100).
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,90}$' then
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
  -- Las sesiones abiertas en el proveedor se expiran fuera de la transacción (job).
  perform app.enqueue_job('payment.expire_checkout', jsonb_build_object('payment_id', p.id), p_store_id,
                          'payment.expire_checkout:' || p.id)
     from public.payments p
    where p.store_id = p_store_id and p.order_id = v_order.id and p.provider = 'stripe'
      and p.provider_checkout_id is not null and p.status in ('created', 'pending', 'authorized');
  update public.payments set status = 'cancelled'
   where store_id = p_store_id and order_id = v_order.id and status in ('created', 'pending', 'authorized');
  update public.orders
     set status = 'cancelled', cancel_reason = v_reason, cancelled_at = now(),
         payment_status = case when payment_status in ('unpaid', 'pending', 'failed') then 'expired'
                               when payment_status = 'authorized' then 'voided' else payment_status end
   where id = v_order.id;
  if v_order.payment_status in ('paid', 'partially_refunded')
     and v_order.paid_total > v_order.refunded_total
                              + (select coalesce(sum(r.amount), 0) from public.refunds r
                                  where r.order_id = v_order.id and r.status = 'pending') then
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

-- Cerrar lo que no se enviará de un pedido surtido en parte (DB-M4): libera la
-- reserva restante, marca esas unidades y, si se pide, reembolsa su parte del
-- importe del renglón (sin envío). El pedido puede completarse después.
create or replace function public.orders_close_unshipped(p_store_id uuid, p_order_id uuid, p_refund boolean,
                                                         p_note text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  public.orders;
  v_res    uuid;
  v_amount bigint;
  v_refund uuid;
  v_avail  bigint;
begin
  perform app.require_store_permission(p_store_id, 'orders.cancel');
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,90}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'idempotency_key';
  end if;
  select * into v_order from public.orders o where o.store_id = p_store_id and o.id = p_order_id for update;
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  if v_order.status <> 'open'
     or not exists (select 1 from public.order_items i where i.order_id = v_order.id and i.fulfilled_quantity > 0)
     or not exists (select 1 from public.order_items i
                     where i.order_id = v_order.id and i.quantity - i.fulfilled_quantity - i.cancelled_quantity > 0) then
    if exists (select 1 from public.order_events e where e.order_id = v_order.id and e.type = 'order.unshipped_closed') then
      return jsonb_build_object('order_id', v_order.id, 'replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'nothing_to_close';
  end if;

  select coalesce(sum((i.line_total * (i.quantity - i.fulfilled_quantity - i.cancelled_quantity)) / i.quantity), 0)::bigint
    into v_amount from public.order_items i where i.order_id = v_order.id;
  perform app.set_order_actor('staff');
  update public.order_items set cancelled_quantity = quantity - fulfilled_quantity
   where order_id = v_order.id and store_id = p_store_id and quantity - fulfilled_quantity - cancelled_quantity > 0;
  select r.id into v_res from public.inventory_reservations r
   where r.store_id = p_store_id and r.order_id = v_order.id and r.status = 'committed';
  if v_res is not null then
    perform app.inventory_release(p_store_id, v_res, 'released');
  end if;
  update public.orders set fulfillment_status = 'fulfilled'
   where id = v_order.id and fulfillment_status = 'partially_fulfilled';
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, actor_user_id, metadata)
  values (p_store_id, v_order.id, 'order.unshipped_closed', left(nullif(btrim(p_note), ''), 1000), true, 'staff',
          auth.uid(), jsonb_build_object('amount', v_amount));
  if coalesce(p_refund, false) and v_amount > 0 and v_order.payment_status in ('paid', 'partially_refunded') then
    select * into v_order from public.orders o where o.id = v_order.id;
    v_avail := v_order.paid_total - v_order.refunded_total
               - (select coalesce(sum(r.amount), 0) from public.refunds r where r.order_id = v_order.id and r.status = 'pending');
    if least(v_amount, v_avail) > 0 then
      v_refund := app.request_refund(v_order, least(v_amount, v_avail), '[]'::jsonb, false,
                                     coalesce(nullif(btrim(p_note), ''), 'Unidades no enviadas'),
                                     'unshipped_' || p_idempotency_key);
    end if;
  end if;
  perform audit.record('order.unshipped_closed', 'order', v_order.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('amount', v_amount, 'refund_id', v_refund));
  return jsonb_build_object('order_id', v_order.id, 'amount', v_amount, 'refund_id', v_refund, 'replayed', false);
end
$$;

-- El staff da por resuelta la atención del pedido (con nota, auditado).
create or replace function public.orders_resolve_attention(p_store_id uuid, p_order_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_note  text := btrim(coalesce(p_note, ''));
begin
  perform app.require_store_permission(p_store_id, 'orders.update');
  if char_length(v_note) not between 3 and 1000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'note';
  end if;
  select * into v_order from public.orders o where o.store_id = p_store_id and o.id = p_order_id for update;
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  if not v_order.needs_attention then
    return;
  end if;
  perform app.set_order_actor('staff');
  update public.orders set needs_attention = false where id = v_order.id;
  insert into public.order_events (store_id, order_id, type, message, actor_type, actor_user_id)
  values (p_store_id, v_order.id, 'attention.resolved', v_note, 'staff', auth.uid());
  perform audit.record('order.attention_resolved', 'order', v_order.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('note_length', char_length(v_note)));
end
$$;

revoke all on function system.stripe_mark_deauthorized(text) from public;
revoke all on function system.record_webhook_rejection(text, text) from public;
revoke all on function system.payment_for_expiry(uuid) from public;
revoke all on function system.record_refund_provider_ref(uuid, text) from public;
revoke all on function system.refunds_to_reconcile(integer) from public;
revoke all on function system.flag_refund_stuck(uuid) from public;
revoke all on function public.orders_close_unshipped(uuid, uuid, boolean, text, text) from public;
revoke all on function public.orders_resolve_attention(uuid, uuid, text) from public;
grant execute on function system.stripe_mark_deauthorized(text) to system_worker;
grant execute on function system.record_webhook_rejection(text, text) to system_worker;
grant execute on function system.payment_for_expiry(uuid) to system_worker;
grant execute on function system.record_refund_provider_ref(uuid, text) to system_worker;
grant execute on function system.refunds_to_reconcile(integer) to system_worker;
grant execute on function system.flag_refund_stuck(uuid) to system_worker;
grant execute on function public.orders_close_unshipped(uuid, uuid, boolean, text, text) to authenticated;
grant execute on function public.orders_resolve_attention(uuid, uuid, text) to authenticated;
