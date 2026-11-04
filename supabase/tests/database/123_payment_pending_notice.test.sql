-- =============================================================================
-- ADR-056: aviso «pendiente de pago» (OXXO, transferencia, cajero). Solo el
-- worker lo pide; solo con el interruptor de la tienda; una vez por intento;
-- nunca si el pedido ya se pagó; el trabajo queda en la tienda del pedido.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
select is(system.mercadopago_attach_account(tests.fx('store_a'), '5151', 'test'), 'active', 'cuenta de A');
select tests.set_fx('acct', (select id from public.payment_accounts
                              where store_id = tests.fx('store_a') and provider = 'mercadopago'));

insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                           requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                           subtotal, total)
values (tests.fx('store_a'), 3001, '#3001', 'test-' || gen_random_uuid(), 'c@example.test', 'C', false, 'MXN', true, 0,
        false, 10000, 10000);
select tests.set_fx('o1', (select id from public.orders where store_id = tests.fx('store_a') and number = 3001));
insert into public.payments (store_id, order_id, payment_account_id, provider, provider_checkout_id, amount, currency,
                             idempotency_key, status)
values (tests.fx('store_a'), tests.fx('o1'), tests.fx('acct'), 'mercadopago', '5151-pref0001', 10000, 'MXN',
        'pay-' || gen_random_uuid(), 'pending');
select tests.set_fx('p1', (select id from public.payments where order_id = tests.fx('o1')));

create function pg_temp.jobs() returns integer language sql as $$
  select count(*)::int from system.jobs where type = 'payment.pending' and payload ->> 'payment_id' = tests.fx('p1')::text
$$;

select ok(not has_function_privilege('authenticated', 'system.request_payment_pending_notice(uuid,text)', 'execute')
          and not has_function_privilege('anon', 'system.request_payment_pending_notice(uuid,text)', 'execute'),
          'ningún usuario lo pide: solo el worker');
select is(system.request_payment_pending_notice(tests.fx('p1'), 'ticket'), false, 'interruptor apagado: no se avisa');

insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
values ('payment_pending_email', 'store', tests.fx('store_a'), true, 'pgTAP ADR-056');
select is(system.request_payment_pending_notice(tests.fx('p1'), 'credit_card'), false, 'tarjeta: no es diferido');
select is(system.request_payment_pending_notice(tests.fx('p1'), 'ticket'), true, 'OXXO con el interruptor: se avisa');
select lives_ok(format($$ select system.request_payment_pending_notice(%L, 'ticket') $$, tests.fx('p1')),
                'el webhook repetido no falla');
select is(pg_temp.jobs(), 1, 'un solo aviso por intento');
select is((select store_id from system.jobs where type = 'payment.pending'
            and payload ->> 'payment_id' = tests.fx('p1')::text), tests.fx('store_a'),
          'el trabajo queda en la tienda del pedido');
select ok(not app.flag_enabled('payment_pending_email', tests.fx('store_b')), 'encendido en A, apagado en B');

update public.orders set payment_status = 'paid', status = 'open', paid_at = now(), paid_total = 10000
 where id = tests.fx('o1');
delete from system.jobs where type = 'payment.pending' and payload ->> 'payment_id' = tests.fx('p1')::text;
select is(system.request_payment_pending_notice(tests.fx('p1'), 'ticket'), false, 'pedido ya pagado: no se avisa');

select * from finish();
rollback;
