-- =============================================================================
-- ADR-043 (aprobado el 2026-10-29): contracargos y reembolsos hechos fuera de la
-- plataforma. Antes, un aviso «refunded»/«charged_back» de un cobro ya aprobado se
-- ignoraba y el pedido seguía «pagado» sin que nadie se enterara. Ahora el pedido
-- queda en atención, con el motivo en su historial, y se avisa a la tienda.
-- No cambia dinero, estados de pago ni inventario: lo decide una persona.
-- Salud de la plataforma: conteo de 24 h y aviso «payment_reversals».
-- =============================================================================

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
  v_reason text;
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

  -- ADR-043: un cobro ya aprobado que el proveedor revirtió por fuera (contracargo
  -- o reembolso hecho en su panel). Si no lo pidió la plataforma, el pedido queda
  -- en atención y se avisa a la tienda; no se toca dinero, estados ni inventario.
  if v_pay.status = 'succeeded' and v_status in ('refunded', 'partially_refunded') then
    if exists (select 1 from public.refunds r
                where r.store_id = v_pay.store_id and r.payment_id = v_pay.id
                  and r.status in ('pending', 'succeeded'))
       or exists (select 1 from public.order_events e
                   where e.store_id = v_order.store_id and e.order_id = v_order.id
                     and e.type = 'payment.external_reversal'
                     and e.metadata ->> 'payment_id' = v_pay.id::text) then
      return jsonb_build_object('outcome', 'ignored');
    end if;
    v_reason := case when p_payment ->> 'reversal' = 'chargeback' then 'chargeback' else 'refund' end;
    update public.orders set needs_attention = true where id = v_order.id;
    insert into public.order_events (store_id, order_id, type, message, actor_type, metadata)
    values (v_order.store_id, v_order.id, 'payment.external_reversal',
            case v_reason when 'chargeback' then 'El comprador abrió un contracargo: el cobro fue revertido'
                          else 'El cobro se reembolsó desde el panel del proveedor, no desde la plataforma' end,
            'system', jsonb_build_object('payment_id', v_pay.id, 'reason', v_reason));
    perform app.enqueue_job('payment.external_reversal',
                            jsonb_build_object('order_id', v_order.id, 'reason', v_reason),
                            v_order.store_id, 'payment.external_reversal:' || v_pay.id);
    return jsonb_build_object('outcome', 'external_reversal');
  end if;

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

  -- refunded / partially_refunded sin cobro aprobado: nada que revertir.
  return jsonb_build_object('outcome', 'ignored');
end
$$;
revoke all on function system.apply_payment_status(uuid, jsonb) from public;

create or replace function system.platform_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_oldest_ready   numeric;
  v_stuck          integer;
  v_dead           integer;
  v_dead_types     jsonb;
  v_pay_errors     integer;
  v_pay_events     integer;
  v_rejected       integer;
  v_stale_payments integer;
  v_orders         integer;
  v_reversals      integer;
  v_issues         jsonb := '[]'::jsonb;
begin
  select extract(epoch from now() - min(j.run_after)) into v_oldest_ready
    from system.jobs j where j.status = 'queued' and j.run_after <= now();
  select count(*) into v_stuck from system.jobs j
   where j.status = 'running' and j.locked_at < now() - interval '15 minutes';
  select count(*) into v_dead from system.jobs j
   where j.status = 'dead' and j.finished_at > now() - interval '24 hours';
  select coalesce(jsonb_object_agg(t.type, t.n), '{}'::jsonb) into v_dead_types
    from (select j.type, count(*) as n from system.jobs j
           where j.status = 'dead' and j.finished_at > now() - interval '24 hours'
           group by j.type order by count(*) desc limit 5) t;
  select count(*) filter (where e.processing_error is not null), count(*)
    into v_pay_errors, v_pay_events
    from public.payment_events e where e.received_at > now() - interval '24 hours';
  select count(*) into v_rejected from audit.security_events s
   where s.type like 'payment.webhook\_%' and s.occurred_at > now() - interval '24 hours';
  select count(*) into v_stale_payments from public.payments p
   where p.provider in ('stripe', 'mercadopago') and p.status in ('created', 'pending', 'authorized')
     and p.provider_checkout_id is not null and p.created_at < now() - interval '2 hours'
     and p.created_at > now() - interval '7 days';
  select count(*) into v_orders from public.orders o where o.created_at > now() - interval '24 hours';
  select count(*) into v_reversals from public.order_events e
   where e.type = 'payment.external_reversal' and e.created_at > now() - interval '24 hours';

  if coalesce(v_oldest_ready, 0) > 600 then
    v_issues := v_issues || jsonb_build_object('code', 'queue_stalled', 'severity', 'critical',
                                               'value', round(v_oldest_ready / 60));
  end if;
  if v_stuck > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'jobs_stuck', 'severity', 'critical', 'value', v_stuck);
  end if;
  if v_pay_errors > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'payment_events', 'severity', 'critical',
                                               'value', v_pay_errors);
  end if;
  if v_dead > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'jobs_dead', 'severity', 'warning', 'value', v_dead);
  end if;
  if v_rejected >= 5 then
    v_issues := v_issues || jsonb_build_object('code', 'webhook_rejected', 'severity', 'warning',
                                               'value', v_rejected);
  end if;
  if v_reversals > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'payment_reversals', 'severity', 'warning',
                                               'value', v_reversals);
  end if;
  if v_stale_payments > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'payments_stale', 'severity', 'warning',
                                               'value', v_stale_payments);
  end if;

  return jsonb_build_object(
    'checked_at', now(),
    'status', case when v_issues @> '[{"severity":"critical"}]' then 'critical'
                   when jsonb_array_length(v_issues) > 0 then 'warning' else 'ok' end,
    'issues', v_issues,
    'queue', jsonb_build_object('oldest_ready_seconds', coalesce(round(v_oldest_ready), 0),
                                'stuck', v_stuck, 'dead_24h', v_dead, 'dead_by_type', v_dead_types),
    'payments', jsonb_build_object('events_24h', v_pay_events, 'events_failed_24h', v_pay_errors,
                                   'webhooks_rejected_24h', v_rejected, 'open_over_2h', v_stale_payments,
                                   'reversals_24h', v_reversals),
    'emails', jsonb_build_object(
      'sent_24h', (select count(*) from public.notification_deliveries d
                    where d.status = 'sent' and d.created_at > now() - interval '24 hours'),
      'suppressed_24h', (select count(*) from public.notification_deliveries d
                          where d.status = 'suppressed' and d.created_at > now() - interval '24 hours')),
    'orders_24h', v_orders);
end
$$;
revoke all on function system.platform_health() from public;
grant execute on function system.platform_health() to system_worker;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029000100'::text
$$;
