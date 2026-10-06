-- =============================================================================
-- Fase 6 · Tablas de checkout (F6-T01): CHECK de totales, snapshot inmutable,
-- transiciones normativas (§16.4), historial append-only y pagos monótonos.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

-- Inserta un pedido con totales dados (como superusuario: las altas reales son de place_order).
create function tests.order_with(p_include boolean, p_sub bigint, p_disc bigint, p_ship bigint, p_tax bigint,
                                 p_total bigint) returns uuid language sql as $$
  insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                             requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                             subtotal, discount_total, shipping_total, tax_total, total)
  values (tests.fx('store_a'), (select coalesce(max(number), 5000) + 1 from public.orders where store_id = tests.fx('store_a')),
          'X', 'idem-' || gen_random_uuid(), 'c@a.io', 'Cliente', false, 'MXN', p_include, 1600, true,
          p_sub, p_disc, p_ship, p_tax, p_total)
  returning id
$$;

-- ============================================================================ Totales (§16.1)
select lives_ok($$ select tests.order_with(true, 10000, 1000, 500, 1310, 9500) $$,
  'impuesto incluido: total = subtotal − descuento + envío');
select throws_ok($$ select tests.order_with(true, 10000, 1000, 500, 1310, 10810) $$, '23514', null,
  'impuesto incluido: el impuesto no se suma');
select lives_ok($$ select tests.order_with(false, 10000, 0, 500, 1680, 12180) $$,
  'impuesto aparte: total = subtotal − descuento + envío + impuesto');
select throws_ok($$ select tests.order_with(false, 10000, 0, 500, 1680, 10500) $$, '23514', null,
  'impuesto aparte: el total debe sumarlo');
select throws_ok($$ select tests.order_with(true, 1000, 2000, 1000, 0, 0) $$, '23514', null,
  'el descuento no supera el subtotal');

select tests.set_fx('o1', tests.order_with(true, 10000, 0, 0, 0, 10000));
select throws_ok($$ update public.orders set paid_total = 20000, payment_status = 'paid' where id = tests.fx('o1') $$,
  '23514', null, 'lo pagado no supera el total');

-- ============================================================================ Snapshot inmutable
select throws_ok($$ update public.orders set total = 1 where id = tests.fx('o1') $$, '42501', 'immutable',
  'el total del pedido es inmutable');
select throws_ok($$ update public.orders set email = 'otro@a.io' where id = tests.fx('o1') $$, '42501', 'immutable',
  'el email del snapshot es inmutable');
insert into public.customers (store_id, email) values (tests.fx('store_a'), 'otra@a.io');
select throws_ok($$ update public.orders set customer_id = (select id from public.customers
                                                            where store_id = tests.fx('store_a') limit 1)
                     where id = tests.fx('o1') $$, '42501', 'immutable',
  'no se reasigna el cliente (solo SET NULL por borrado)');
select lives_ok($$ update public.orders set staff_note = 'Llamar antes' where id = tests.fx('o1') $$,
  'la nota interna sí cambia');

-- ============================================================================ Transiciones (§16.4)
select throws_ok($$ update public.orders set status = 'completed' where id = tests.fx('o1') $$, 'P0001',
  'invalid_transition', 'pending_payment → completed no existe');
select throws_ok($$ update public.orders set fulfillment_status = 'fulfilled' where id = tests.fx('o1') $$, 'P0001',
  'invalid_transition', 'no se surte sin pago');
select lives_ok($$ update public.orders set status = 'open', payment_status = 'paid', paid_total = 10000,
                     paid_at = now() where id = tests.fx('o1') $$, 'pago confirmado: open + paid');
select is((select array_agg(axis || ':' || from_value || '>' || to_value order by axis)
             from public.order_events where order_id = tests.fx('o1')),
  array['payment:unpaid>paid', 'status:pending_payment>open'], 'cada cambio de eje deja su evento');
select throws_ok($$ update public.orders set payment_status = 'pending' where id = tests.fx('o1') $$, 'P0001',
  'invalid_transition', 'el pago nunca vuelve de paid a pending');

select tests.set_fx('o2', tests.order_with(true, 10000, 0, 0, 0, 10000));
select lives_ok($$ update public.orders set status = 'cancelled', cancel_reason = 'payment_expired',
                     cancelled_at = now(), payment_status = 'expired' where id = tests.fx('o2') $$,
  'expirado: cancelled + expired');
select throws_ok($$ select set_config('app.order_actor', 'staff', true);
                    update public.orders set status = 'open' where id = tests.fx('o2') $$, 'P0001',
  'invalid_transition', 'solo el sistema reabre un pedido expirado (CF-04)');
select throws_ok($$ update public.orders set status = 'cancelled', cancel_reason = null where id = tests.fx('o1') $$,
  '23514', null, 'cancelar exige motivo y fecha');

-- ============================================================================ Nunca se borran
select throws_ok($$ delete from public.orders where id = tests.fx('o1') $$, '42501', 'append_only',
  'un pedido no se borra');
select throws_ok($$ update public.order_events set message = 'x' where order_id = tests.fx('o1') $$, '42501',
  'append_only', 'el historial no se reescribe');

-- ============================================================================ Partidas
select throws_ok(format($$ insert into public.order_items (store_id, order_id, product_title, product_type,
  requires_shipping, unit_price, quantity, discount_allocation, line_total)
  values (%L, %L, 'Taza', 'physical', true, 1000, 2, 100, 2000) $$, tests.fx('store_a'), tests.fx('o1')),
  '23514', null, 'line_total = precio × cantidad − descuento asignado');
insert into public.order_items (store_id, order_id, product_title, product_type, requires_shipping, unit_price,
                                quantity, discount_allocation, line_total)
values (tests.fx('store_a'), tests.fx('o1'), 'Taza', 'physical', true, 1000, 2, 100, 1900);
select throws_ok($$ update public.order_items set unit_price = 1 where order_id = tests.fx('o1') $$, '42501',
  'immutable', 'el precio de la partida es inmutable');
select lives_ok($$ update public.order_items set fulfilled_quantity = 1 where order_id = tests.fx('o1') $$,
  'los contadores sí cambian');

-- ============================================================================ Pagos
insert into public.payment_accounts (store_id, provider, status, display_name)
values (tests.fx('store_a'), 'manual', 'active', 'Transferencia');
insert into public.payments (store_id, order_id, payment_account_id, provider, amount, currency, idempotency_key, status)
select tests.fx('store_a'), tests.fx('o1'), id, 'manual', 10000, 'MXN', 'pago-0000000000001', 'succeeded'
  from public.payment_accounts where store_id = tests.fx('store_a');
select throws_ok($$ update public.payments set status = 'pending' where idempotency_key = 'pago-0000000000001' $$,
  '23514', 'invalid_transition', 'un pago exitoso no vuelve atrás');
select throws_ok($$ update public.payments set amount = 1 where idempotency_key = 'pago-0000000000001' $$,
  '42501', 'immutable', 'el monto del pago es inmutable');
select throws_ok($$ insert into public.payments (store_id, order_id, payment_account_id, provider, amount, currency,
                                                 idempotency_key, status)
                    select tests.fx('store_a'), tests.fx('o1'), id, 'manual', 10000, 'MXN', 'pago-0000000000002',
                           'succeeded' from public.payment_accounts where store_id = tests.fx('store_a') $$,
  '23505', null, 'un solo pago exitoso por pedido');

-- ============================================================================ Descuentos
insert into public.discounts (store_id, code, type, value, usage_limit, times_used)
values (tests.fx('store_a'), 'VERANO', 'percentage', 1500, 2, 1);
select throws_ok($$ update public.discounts set code = 'OTONO' where code = 'VERANO' $$, '23514',
  'discount_code_locked', 'el código no cambia después de usarse');
select throws_ok($$ update public.discounts set times_reserved = 2 where code = 'VERANO' $$, '23514', null,
  'reservados + usados nunca superan el límite');

-- ============================================================================ Aislamiento y PII
select throws_ok(format($$ insert into public.inventory_reservations (store_id, order_id, expires_at)
  values (%L, %L, now() + interval '1 hour') $$, tests.fx('store_b'), tests.fx('o1')), '23503', null,
  'una reserva de B no apunta a un pedido de A (FK compuesta, D-F4-01)');
select tests.login('owner');
select throws_ok($$ select email from public.orders limit 1 $$, '42501', null,
  'el contacto del pedido no se lee directo (solo por RPC con customers.pii.read)');
select tests.logout();

select * from finish();
rollback;
