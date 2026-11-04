-- =============================================================================
-- ADR-056 (aprobado 2026-11-04): correo «pendiente de pago» cuando el comprador
-- elige en Mercado Pago un medio diferido (OXXO, transferencia o cajero).
--
-- No toca system.apply_payment_status ni apply_mercadopago_payment: el webhook y
-- la conciliación, después de aplicar el cobro ya re-consultado, piden el aviso
-- con esta función. Solo encola si el pedido sigue sin pagar, el medio es
-- diferido y la tienda tiene el interruptor encendido. Una vez por intento.
--
-- Reversa: `update public.feature_flags set kill_switch = true where key =
-- 'payment_pending_email'` (no sale ningún aviso nuevo; lo encolado se descarta
-- en el worker si el pedido ya no está pendiente).
-- =============================================================================

insert into public.feature_flags (key, description, default_enabled, owner) values
  ('payment_pending_email',
   'Correo «pendiente de pago» para OXXO, transferencia o cajero de Mercado Pago (ADR-056)', false,
   'plataforma')
on conflict (key) do nothing;

create or replace function system.request_payment_pending_notice(p_payment_id uuid, p_method text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay   public.payments;
  v_order public.orders;
begin
  if p_method is null or p_method not in ('ticket', 'bank_transfer', 'atm') then
    return false;
  end if;
  select * into v_pay from public.payments p where p.id = p_payment_id and p.provider = 'mercadopago';
  if v_pay.id is null or v_pay.status not in ('created', 'pending') then
    return false;
  end if;
  select * into v_order from public.orders o where o.store_id = v_pay.store_id and o.id = v_pay.order_id;
  if v_order.id is null or v_order.status <> 'pending_payment'
     or v_order.payment_status not in ('unpaid', 'pending') then
    return false;
  end if;
  if not app.flag_enabled('payment_pending_email', v_order.store_id) then
    return false;
  end if;
  perform app.enqueue_job('payment.pending',
                          jsonb_build_object('order_id', v_order.id, 'payment_id', v_pay.id, 'method', p_method),
                          v_order.store_id, 'payment.pending:' || v_pay.id);
  return true;
end
$$;

revoke all on function system.request_payment_pending_notice(uuid, text) from public;
grant execute on function system.request_payment_pending_notice(uuid, text) to system_worker;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261104000300'::text
$$;
