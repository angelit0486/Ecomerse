-- =============================================================================
-- ADR-028 · Corrección de la revisión adversarial: dos cobros aprobados distintos
-- del mismo intento que llegan a la vez. Antes se leía el intento sin bloquear:
-- ambos veían «no pagado», el primero pagaba y el segundo caía en «ignorado»
-- sin quedar marcado para reembolso. Ahora se bloquea pedido → intento (el
-- mismo orden que apply_payment_status) antes de decidir.
-- =============================================================================
create or replace function system.apply_mercadopago_payment(p_payment_id uuid, p_payment jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay   public.payments;
  v_order public.orders;
  v_mp_id text := nullif(p_payment ->> 'provider_payment_id', '');
begin
  select * into v_pay from public.payments p where p.id = p_payment_id and p.provider = 'mercadopago';
  if v_pay.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'payment';
  end if;
  select * into v_order from public.orders o where o.store_id = v_pay.store_id and o.id = v_pay.order_id for update;
  select * into v_pay from public.payments p where p.id = p_payment_id for update;
  if v_pay.status = 'succeeded' and p_payment ->> 'status' = 'succeeded' and v_mp_id is not null
     and v_pay.provider_payment_id is not null and v_pay.provider_payment_id <> v_mp_id
     and coalesce(p_payment ->> 'external_reference', '') = v_pay.id::text then
    if not exists (select 1 from public.order_events e
                    where e.order_id = v_order.id and e.type = 'payment.duplicate'
                      and e.metadata ->> 'provider_payment_id' = v_mp_id) then
      perform app.set_order_actor('system');
      update public.orders set needs_attention = true where id = v_order.id;
      insert into public.order_events (store_id, order_id, type, message, actor_type, metadata)
      values (v_order.store_id, v_order.id, 'payment.duplicate', 'Cobro adicional: requiere reembolso', 'system',
              jsonb_build_object('payment_id', v_pay.id, 'provider_payment_id', left(v_mp_id, 200)));
    end if;
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  return system.apply_payment_status(
    p_payment_id,
    case when p_payment ->> 'status' in ('succeeded', 'refunded', 'partially_refunded') then p_payment
         else p_payment - 'provider_payment_id' end);
end
$$;

revoke all on function system.apply_mercadopago_payment(uuid, jsonb) from public;
grant execute on function system.apply_mercadopago_payment(uuid, jsonb) to system_worker;
