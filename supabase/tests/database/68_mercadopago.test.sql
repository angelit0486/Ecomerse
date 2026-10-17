-- =============================================================================
-- Fase 5 · Mercado Pago (ADR-028): conectar solo desde el servidor, un collector
-- por tienda, permisos, método en la tienda, cuenta del webhook, reconciliación
-- y un segundo cobro aprobado → atención (nunca se ignora).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

-- ============================================================================ Permisos
select tests.login('viewer');
select throws_ok(format($$ select public.payments_get_mercadopago(%L) $$, tests.fx('store_a')), '42501', 'forbidden',
  'viewer no ve la configuración de Mercado Pago');
select tests.logout();
select tests.login('owner');
select is(public.payments_get_mercadopago(tests.fx('store_a')) -> 'account', 'null'::jsonb, 'sin cuenta conectada');
select tests.logout();
select ok(not has_function_privilege('authenticated', 'system.mercadopago_attach_account(uuid,text,text)', 'execute')
       and not has_function_privilege('authenticated', 'system.apply_mercadopago_payment(uuid,jsonb)', 'execute'),
  'ningún usuario conecta una cuenta ni aplica cobros: solo el worker');

-- ============================================================================ Conectar (worker)
select throws_ok(format($$ select system.mercadopago_attach_account(%L, 'abc', 'test') $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'collector inválido: rechazado');
select is(system.mercadopago_attach_account(tests.fx('store_a'), '4444', 'test'), 'active', 'cuenta conectada');
select is(system.mercadopago_attach_account(tests.fx('store_a'), '4444', 'test'), 'active', 'repetir es idempotente');
select is((select count(*)::int from public.payment_accounts
            where store_id = tests.fx('store_a') and provider = 'mercadopago'), 1, 'una sola cuenta');
select throws_ok(format($$ select system.mercadopago_attach_account(%L, '4444', 'test') $$, tests.fx('store_b')),
  'P0001', 'conflict', 'otra tienda no puede usar el mismo collector');
select ok(exists (select 1 from jsonb_array_elements(storefront.payment_methods(tests.fx('store_a'))) m
                   where m ->> 'provider' = 'mercadopago'), 'la tienda ofrece Mercado Pago');
select is((select a.store_id from system.payment_account_for_webhook('mercadopago', '4444') a), tests.fx('store_a'),
  'el webhook encuentra la cuenta por su collector');
select is((select count(*)::int from system.payment_account_for_webhook('stripe', '4444')), 0,
  'el collector no se confunde con una cuenta de Stripe');

select tests.login('owner');
select is(public.payments_set_mercadopago_enabled(tests.fx('store_a'), false), 'disabled', 'la tienda lo desactiva');
select tests.logout();
select ok(not exists (select 1 from jsonb_array_elements(storefront.payment_methods(tests.fx('store_a'))) m
                       where m ->> 'provider' = 'mercadopago'), 'desactivado: ya no se ofrece');
select tests.login('owner');
select is(public.payments_set_mercadopago_enabled(tests.fx('store_a'), true), 'active', 'y lo reactiva');
select tests.logout();
select tests.login('owner_b');
select throws_ok(format($$ select public.payments_set_mercadopago_enabled(%L, false) $$, tests.fx('store_a')),
  '42501', 'forbidden', 'B no cambia los pagos de A');
select tests.logout();

-- ============================================================================ Cobros
select tests.set_fx('acct', (select id from public.payment_accounts
                              where store_id = tests.fx('store_a') and provider = 'mercadopago'));
insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                           requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                           subtotal, total)
values (tests.fx('store_a'), 2001, '#2001', 'test-' || gen_random_uuid(), 'c@example.test', 'C', false, 'MXN', true, 0, false,
        10000, 10000);
select tests.set_fx('o1', (select id from public.orders where store_id = tests.fx('store_a') and number = 2001));
insert into public.payments (store_id, order_id, payment_account_id, provider, provider_checkout_id, amount, currency,
                             idempotency_key, created_at)
values (tests.fx('store_a'), tests.fx('o1'), tests.fx('acct'), 'mercadopago', '4444-pref0001', 10000, 'MXN',
        'pay_mp_test_000000000001', now() - interval '1 hour');
select tests.set_fx('p1', (select id from public.payments where order_id = tests.fx('o1')));

select ok(exists (select 1 from system.payments_to_reconcile(500) r where r.payment_id = tests.fx('p1')),
  'un intento abierto de Mercado Pago entra a la reconciliación');

select system.apply_mercadopago_payment(tests.fx('p1'), jsonb_build_object(
  'status', 'failed', 'amount', 10000, 'currency', 'MXN', 'provider_payment_id', '9001',
  'external_reference', tests.fx('p1')::text, 'failure_code', 'cc_rejected_other_reason'));
select is((select provider_payment_id from public.payments where id = tests.fx('p1')), null,
  'un cobro rechazado no fija el id que se reembolsaría');

-- Se simula el intento ya cobrado por el cobro 9002.
update public.payments set status = 'succeeded', provider_payment_id = '9002' where id = tests.fx('p1');
select is(system.apply_mercadopago_payment(tests.fx('p1'), jsonb_build_object(
  'status', 'succeeded', 'amount', 10000, 'currency', 'MXN', 'provider_payment_id', '9002',
  'external_reference', tests.fx('p1')::text)) ->> 'outcome', 'ignored', 'el mismo cobro otra vez no cambia nada');
select is(system.apply_mercadopago_payment(tests.fx('p1'), jsonb_build_object(
  'status', 'succeeded', 'amount', 10000, 'currency', 'MXN', 'provider_payment_id', '9003',
  'external_reference', tests.fx('p1')::text)) ->> 'outcome', 'duplicate', 'un segundo cobro aprobado se detecta');
select ok((select needs_attention from public.orders where id = tests.fx('o1'))
          and (select count(*) = 1 from public.order_events
                where order_id = tests.fx('o1') and type = 'payment.duplicate'),
  'el pedido queda en atención para reembolsar, con un solo evento');

select * from finish();
rollback;
