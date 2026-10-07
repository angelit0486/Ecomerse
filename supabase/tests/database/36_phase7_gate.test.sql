-- =============================================================================
-- Gate F7 · Regresiones de la revisión adversarial (ver PHASE-07-REPORT.md).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
update public.stores set status = 'active', launched_at = now(), prices_include_tax = true, tax_rate_bps = 0
 where id = tests.fx('store_a');
insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
on conflict (key) do update set value = excluded.value;

create function tests.variant() returns uuid language sql as
  $$ select id from public.product_variants where sku = 'GATE-1' and deleted_at is null $$;
create function tests.level() returns public.inventory_levels language sql as
  $$ select l.* from public.inventory_levels l where l.variant_id = tests.variant() $$;
create function tests.pay_of(p_order uuid) returns public.payments language sql as
  $$ select p.* from public.payments p where p.order_id = p_order order by p.created_at desc limit 1 $$;
-- Pedido de p_qty unidades con la cuenta indicada; Stripe queda con su sesión registrada.
create function tests.new_order(p_key text, p_qty int, p_account text) returns uuid language plpgsql as $$
declare v jsonb; tok text := rpad(p_key, 43, 'x');
begin
  perform storefront.cart_add_item(tests.fx('store_a'), tok, tests.variant(), p_qty);
  v := storefront.place_order(tests.fx('store_a'), tok,
         jsonb_build_object('email', p_key || '@x.io', 'customer_name', 'C', 'payment_account_id', tests.fx(p_account)),
         10000 * p_qty, 'idem-' || p_key || '-000000000', sha256(convert_to(p_key, 'UTF8')));
  if p_account = 'stripe' then
    perform storefront.record_checkout_result(tests.fx('store_a'), (v -> 'payment' ->> 'id')::uuid, true,
                                              'cs_test_' || md5(p_key));
  end if;
  return (v ->> 'order_id')::uuid;
end $$;
-- Resultado de Stripe ya re-consultado (lo que hace el webhook).
create function tests.stripe_result(p_order uuid, p_status text) returns jsonb language sql as $$
  select system.apply_payment_status(p.id, jsonb_build_object('status', p_status, 'amount', p.amount, 'currency', 'MXN',
           'provider_payment_id', 'pi_' || md5(p.id::text), 'external_reference', p.id::text, 'method', 'card'))
    from public.payments p where p.id = (tests.pay_of(p_order)).id $$;
create function tests.paid_fake(p_key text, p_qty int) returns uuid language plpgsql as $$
declare v_order uuid := tests.new_order(p_key, p_qty, 'fake');
begin
  perform system.fake_payment_result((tests.pay_of(v_order)).id, 'succeeded');
  return v_order;
end $$;
create function tests.item(p_order uuid) returns uuid language sql as
  $$ select id from public.order_items where order_id = p_order limit 1 $$;
create function tests.items(p_order uuid, p_qty int) returns jsonb language sql as
  $$ select jsonb_build_array(jsonb_build_object('order_item_id', tests.item(p_order), 'quantity', p_qty)) $$;
grant execute on all functions in schema tests to authenticated;

select tests.login('owner');
select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Vela","variants":[{"price":10000,"sku":"GATE-1","requires_shipping":false}]}') ->> 'id')::uuid);
select public.inventory_adjust(tests.fx('store_a'), tests.variant(), 'adjustment', 50, 'Inicial');
select tests.logout();
insert into public.payment_accounts (store_id, provider, status, display_name) values
  (tests.fx('store_a'), 'fake', 'active', 'Prueba') returning tests.set_fx('fake', id);
insert into public.payment_accounts (store_id, provider, status, display_name, public_config) values
  (tests.fx('store_a'), 'stripe', 'active', 'Tarjeta', '{"stripe_account_id":"acct_GATE00000001"}')
  returning tests.set_fx('stripe', id);

-- ============================================================================ DB-H1 / M1
select tests.set_fx('o_cancel', tests.new_order('cancelado', 2, 'stripe'));
select tests.login('owner');
select public.orders_cancel(tests.fx('store_a'), tests.fx('o_cancel'), 'fraud', null, 'cancel-gate-000000001');
select tests.logout();
select ok(exists (select 1 from system.jobs where dedupe_key = 'payment.expire_checkout:' || (tests.pay_of(tests.fx('o_cancel'))).id),
  'cancelar expira la sesión abierta en Stripe (job)');
select ok(exists (select 1 from system.payments_to_reconcile(500) r where r.payment_id = (tests.pay_of(tests.fx('o_cancel'))).id)
          or (tests.pay_of(tests.fx('o_cancel'))).created_at > now() - interval '15 minutes',
  'el intento cancelado sigue siendo reconciliable');
select is(tests.stripe_result(tests.fx('o_cancel'), 'succeeded') ->> 'outcome', 'paid_after_cancel',
  'pago sobre un pedido cancelado por la tienda: no falla');
select is((select status || '/' || cancel_reason || '/' || payment_status || '/' || needs_attention
             from public.orders where id = tests.fx('o_cancel')), 'cancelled/fraud/paid/true',
  'el pedido sigue cancelado (la decisión se respeta), pagado y en atención');
select is((select amount from public.refunds where order_id = tests.fx('o_cancel') and status = 'pending'), 20000::bigint,
  'se solicita el reembolso total automáticamente');
select is((tests.pay_of(tests.fx('o_cancel'))).status, 'succeeded', 'el cobro queda registrado');
select ok(exists (select 1 from system.jobs where dedupe_key like 'payment.after_cancel:%'
                                               and payload ->> 'order_id' = tests.fx('o_cancel')::text),
  'aviso a la tienda');

select tests.set_fx('o_fraud', tests.new_order('fallido', 1, 'stripe'));
select tests.stripe_result(tests.fx('o_fraud'), 'failed');
select tests.login('owner');
select public.orders_cancel(tests.fx('store_a'), tests.fx('o_fraud'), 'fraud', null, 'cancel-gate-000000002');
select tests.logout();
select is(tests.stripe_result(tests.fx('o_fraud'), 'succeeded') ->> 'outcome', 'paid_after_cancel',
  'pago tardío tras cancelar por fraude: no reabre el pedido');
select is((select status || '/' || cancel_reason from public.orders where id = tests.fx('o_fraud')), 'cancelled/fraud',
  'el motivo de cancelación se conserva');

-- ============================================================================ DB-H2 / M3
select tests.set_fx('o_ref', tests.paid_fake('reembolso', 2));
select tests.set_fx('o_otro', tests.paid_fake('otro', 1));
select tests.login('owner');
select public.orders_fulfill(tests.fx('store_a'), tests.fx('o_ref'), tests.items(tests.fx('o_ref'), 1), null, null, null,
  'envio-gate-000000001');
select public.orders_request_refund(tests.fx('store_a'), tests.fx('o_ref'), 1000, tests.items(tests.fx('o_ref'), 1), true,
  null, 'reemb-gate-0000000001');
select throws_ok(format($$ select public.orders_request_refund(%L, %L, 1000, %L, true, null, 'reemb-gate-0000000002') $$,
  tests.fx('store_a'), tests.fx('o_ref'), tests.items(tests.fx('o_ref'), 1)), 'P0001', 'validation_failed',
  'la unidad de un reembolso pendiente no se puede reclamar otra vez');
select throws_ok(format($$ select public.orders_request_refund(%L, %L, 1000, %L, false, null, 'reemb-gate-0000000003') $$,
  tests.fx('store_a'), tests.fx('o_ref'),
  jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o_ref')), 'quantity', 1),
                    jsonb_build_object('order_item_id', tests.item(tests.fx('o_ref')), 'quantity', 1))),
  'P0001', 'validation_failed', 'partidas repetidas del mismo renglón: rechazadas');
select throws_ok(format($$ select public.orders_request_refund(%L, %L, 1000, '[]', false, null, 'reemb-gate-0000000001') $$,
  tests.fx('store_a'), tests.fx('o_otro')), 'P0001', 'conflict',
  'una clave de idempotencia de otro pedido no devuelve ese reembolso');
select tests.logout();
select throws_ok($$ update public.order_items set returned_quantity = fulfilled_quantity + 1
                     where id = (select id from public.order_items limit 1) $$, '23514', null,
  'returned ≤ fulfilled (CHECK)');
select throws_ok(format($$ select system.apply_refund_result(%L, null, null, null) $$,
  (select id from public.refunds where order_id = tests.fx('o_ref'))), 'P0001', 'validation_failed',
  'un resultado NULL nunca cuenta como éxito');

-- ============================================================================ DB-L5: completar con reembolso pendiente
select tests.login('owner');
select public.orders_fulfill(tests.fx('store_a'), tests.fx('o_ref'), tests.items(tests.fx('o_ref'), 1), null, null, null,
  'envio-gate-000000002');
select public.orders_mark_delivered(tests.fx('store_a'), s.id) from public.shipments s where s.order_id = tests.fx('o_ref');
select tests.logout();
select is((select status from public.orders where id = tests.fx('o_ref')), 'open',
  'con un reembolso pendiente el pedido no se completa');
select system.apply_refund_result(id, 'succeeded', 'fake_r', null) from public.refunds where order_id = tests.fx('o_ref');
select is((select returned_quantity from public.order_items where id = tests.item(tests.fx('o_ref'))), 1,
  'una sola unidad devuelta al inventario');

-- ============================================================================ DB-M4: cerrar lo no enviado
select tests.set_fx('o_part', tests.paid_fake('parcial', 3));
select tests.login('owner');
select public.orders_fulfill(tests.fx('store_a'), tests.fx('o_part'), tests.items(tests.fx('o_part'), 1), null, null, null,
  'envio-gate-000000003');
select tests.logout();
create temp table before_close as select (tests.level()).reserved as reserved;
select tests.login('viewer');
select throws_ok(format($$ select public.orders_close_unshipped(%L, %L, true, null, 'cerrar-gate-0000000001') $$,
  tests.fx('store_a'), tests.fx('o_part')), '42501', 'forbidden', 'viewer no cierra unidades');
select tests.logout();
select tests.login('owner');
select is((public.orders_close_unshipped(tests.fx('store_a'), tests.fx('o_part'), true, 'Sin existencias del proveedor',
  'cerrar-gate-0000000001') ->> 'amount')::bigint, 20000::bigint, 'se calcula el importe de las 2 unidades no enviadas');
select is((public.orders_close_unshipped(tests.fx('store_a'), tests.fx('o_part'), true, null, 'cerrar-gate-0000000001')
  ->> 'replayed')::boolean, true, 'repetir: sin efecto');
select tests.logout();
select is((select reserved from before_close) - (tests.level()).reserved, 2, 'se liberan las 2 unidades reservadas');
select is((select fulfillment_status from public.orders where id = tests.fx('o_part')), 'fulfilled',
  'el pedido queda surtido (puede completarse)');
select is((select amount from public.refunds where order_id = tests.fx('o_part') and status = 'pending'), 20000::bigint,
  'reembolso de esas unidades solicitado');

-- ============================================================================ DB-M2: duplicado
select tests.set_fx('o_dup', tests.new_order('duplicado', 1, 'stripe'));
select tests.stripe_result(tests.fx('o_dup'), 'succeeded');
insert into public.payments (store_id, order_id, payment_account_id, provider, amount, currency, idempotency_key)
values (tests.fx('store_a'), tests.fx('o_dup'), tests.fx('stripe'), 'stripe', 10000, 'MXN', 'pago-dup-gate-00001');
select is(system.apply_payment_status((select id from public.payments where idempotency_key = 'pago-dup-gate-00001'),
  jsonb_build_object('status', 'succeeded', 'amount', 10000, 'currency', 'MXN',
    'external_reference', (select id from public.payments where idempotency_key = 'pago-dup-gate-00001')::text)) ->> 'outcome',
  'duplicate', 'segundo cobro: duplicado');
select tests.login('owner');
select public.orders_request_refund(tests.fx('store_a'), tests.fx('o_dup'), 10000, '[]', false, null, 'reemb-gate-0000000010');
select tests.logout();
select system.apply_refund_result(id, 'succeeded', 're_x', null) from public.refunds where order_id = tests.fx('o_dup');
select is((select needs_attention from public.orders where id = tests.fx('o_dup')), true,
  'un reembolso total no borra la alerta del cobro duplicado');
select tests.login('viewer');
select throws_ok(format($$ select public.orders_resolve_attention(%L, %L, 'Reembolsado en Stripe') $$,
  tests.fx('store_a'), tests.fx('o_dup')), '42501', 'forbidden', 'viewer no resuelve la atención');
select tests.logout();
select tests.login('owner');
select lives_ok(format($$ select public.orders_resolve_attention(%L, %L, 'Reembolsado en el panel de Stripe') $$,
  tests.fx('store_a'), tests.fx('o_dup')), 'el staff la resuelve con nota');
select tests.logout();
select is((select needs_attention from public.orders where id = tests.fx('o_dup')), false, 'atención cerrada');

-- ============================================================================ DB-L2 / L3
select tests.set_fx('o_full', tests.paid_fake('total', 1));
select tests.login('owner');
select throws_ok(format($$ select public.orders_cancel(%L, %L, 'staff', null, %L) $$,
  tests.fx('store_a'), tests.fx('o_dup'), repeat('k', 91)), 'P0001', 'validation_failed',
  'claves de cancelación de más de 90 caracteres: rechazadas');
select public.orders_request_refund(tests.fx('store_a'), tests.fx('o_full'), 10000, '[]', false, null, 'reemb-gate-0000000020');
select lives_ok(format($$ select public.orders_cancel(%L, %L, 'customer', null, 'cancel-gate-000000003') $$,
  tests.fx('store_a'), tests.fx('o_full')), 'con un reembolso total pendiente sí se cancela');
select tests.logout();

-- ============================================================================ APP-H1 / M1 / M3 / L7
select system.record_refund_provider_ref((select id from public.refunds where order_id = tests.fx('o_cancel')), 'no-es-re');
select is((select provider_refund_id from public.refunds where order_id = tests.fx('o_cancel')), null,
  'solo se guarda un id re_ válido');
select system.record_refund_provider_ref((select id from public.refunds where order_id = tests.fx('o_cancel')), 're_GATE123456');
select is((select provider_refund_id from public.refunds where order_id = tests.fx('o_cancel')), 're_GATE123456',
  'id del proveedor registrado mientras sigue pendiente');
update public.payment_accounts set status = 'disabled' where id = tests.fx('stripe');
select is((select status from system.payment_account_for_webhook('stripe', 'acct_GATE00000001')), 'disabled',
  'el webhook encuentra la cuenta desactivada (sus pagos se aplican)');
select system.stripe_mark_deauthorized('acct_GATE00000001');
select is((select status from public.payment_accounts where id = tests.fx('stripe')), 'error',
  'cuenta desautorizada en Stripe: error');
select system.record_webhook_rejection('payment.webhook_gate_test', 'stripe') from generate_series(1, 40);
select is((select count(*)::int from audit.security_events where type = 'payment.webhook_gate_test'), 30,
  'los rechazos se registran con límite de frecuencia');

select * from finish();
rollback;
