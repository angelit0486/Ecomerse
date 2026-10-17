-- =============================================================================
-- Fase 7 · Envíos, entrega, cancelación y reembolsos (F7-T03).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now(), prices_include_tax = true, tax_rate_bps = 0
 where id = tests.fx('store_a');
insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
on conflict (key) do update set value = excluded.value;

create function tests.variant(p_sku text) returns uuid language sql as
  $$ select id from public.product_variants where sku = p_sku and deleted_at is null $$;
create function tests.level() returns public.inventory_levels language sql as
  $$ select l.* from public.inventory_levels l where l.variant_id = tests.variant('TAZA-1') $$;
-- Pedido de p_qty tazas; pagado con fake si p_pay.
create function tests.new_order(p_key text, p_qty int, p_pay boolean) returns uuid language plpgsql as $$
declare v jsonb; tok text := rpad(p_key, 43, 'x');
begin
  perform storefront.cart_add_item(tests.fx('store_a'), tok, tests.variant('TAZA-1'), p_qty);
  v := storefront.place_order(tests.fx('store_a'), tok,
         jsonb_build_object('email', p_key || '@x.io', 'customer_name', 'C', 'payment_account_id', tests.fx('fake'),
                            'discount_code', case when p_key = 'cupon' then 'MIL' end),
         10000 * p_qty - case when p_key = 'cupon' then 1000 else 0 end, 'idem-' || p_key || '-000000000',
         sha256(convert_to(p_key, 'UTF8')));
  if p_pay then
    perform system.fake_payment_result((v -> 'payment' ->> 'id')::uuid, 'succeeded');
  end if;
  return (v ->> 'order_id')::uuid;
end $$;
create function tests.item(p_order uuid) returns uuid language sql as
  $$ select id from public.order_items where order_id = p_order limit 1 $$;
create function tests.refund_of(p_order uuid) returns uuid language sql as
  $$ select id from public.refunds where order_id = p_order order by created_at desc limit 1 $$;
grant execute on all functions in schema tests to authenticated;

select tests.login('owner');
select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Taza","variants":[{"price":10000,"sku":"TAZA-1","requires_shipping":false}]}') ->> 'id')::uuid);
select public.inventory_adjust(tests.fx('store_a'), tests.variant('TAZA-1'), 'adjustment', 20, 'Inicial');
select tests.logout();
insert into public.payment_accounts (store_id, provider, status, display_name) values
  (tests.fx('store_a'), 'fake', 'active', 'Prueba') returning tests.set_fx('fake', id);
insert into public.discounts (store_id, code, type, value) values (tests.fx('store_a'), 'MIL', 'fixed_amount', 1000);

select tests.set_fx('o1', tests.new_order('uno', 3, true));
select tests.set_fx('o_unpaid', tests.new_order('dos', 1, false));
select tests.set_fx('o2', tests.new_order('cupon', 2, true));
select tests.set_fx('o3', tests.new_order('tres', 1, true));

-- ============================================================================ Surtir
select tests.login('viewer');
select throws_ok(format($$ select public.orders_fulfill(%L, %L, %L, null, null, null, 'envio-000000000000001') $$,
  tests.fx('store_a'), tests.fx('o1'), jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o1')), 'quantity', 1))),
  '42501', 'forbidden', 'viewer no surte');
select tests.logout();
select tests.login('owner');
select tests.set_fx('s1', public.orders_fulfill(tests.fx('store_a'), tests.fx('o1'),
  jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o1')), 'quantity', 1)),
  'Estafeta', 'ABC123', 'https://rastreo.example.com/ABC123', 'envio-000000000000001'));
select is((select fulfillment_status from public.orders where id = tests.fx('o1')), 'partially_fulfilled', 'envío parcial');
select is(((tests.level()).on_hand || '/' || (tests.level()).reserved), '19/6',
  'sale 1 unidad: en mano 19; reservadas 7 − 1 (pedidos de 3, 1, 2 y 1)');
select is(public.orders_fulfill(tests.fx('store_a'), tests.fx('o1'),
  jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o1')), 'quantity', 1)),
  null, null, null, 'envio-000000000000001'), tests.fx('s1'), 'misma clave: el mismo envío');
select is((tests.level()).on_hand, 19, 'sin doble descuento');
select throws_ok(format($$ select public.orders_fulfill(%L, %L, %L, null, null, null, 'envio-000000000000002') $$,
  tests.fx('store_a'), tests.fx('o1'), jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o1')), 'quantity', 3))),
  'P0001', 'validation_failed', 'no se surte más de lo pendiente');
select throws_ok(format($$ select public.orders_fulfill(%L, %L, %L, null, null, null, 'envio-000000000000003') $$,
  tests.fx('store_a'), tests.fx('o1'), jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o_unpaid')), 'quantity', 1))),
  'P0001', 'validation_failed', 'una partida de otro pedido no entra en el envío');
select throws_ok(format($$ select public.orders_fulfill(%L, %L, %L, null, null, null, 'envio-000000000000004') $$,
  tests.fx('store_a'), tests.fx('o_unpaid'), jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o_unpaid')), 'quantity', 1))),
  'P0001', 'conflict', 'un pedido sin pagar no se surte');
select throws_ok(format($$ select public.orders_fulfill(%L, %L, %L, null, null, 'http://inseguro', 'envio-000000000000005') $$,
  tests.fx('store_a'), tests.fx('o1'), jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o1')), 'quantity', 1))),
  'P0001', 'validation_failed', 'el rastreo exige https');

-- ============================================================================ Reembolsos
select throws_ok(format($$ select public.orders_request_refund(%L, %L, 40000, '[]', false, null, 'reemb-00000000000001') $$,
  tests.fx('store_a'), tests.fx('o1')), 'P0001', 'validation_failed', 'reembolso mayor que lo cobrado: rechazado');
select throws_ok(format($$ select public.orders_request_refund(%L, %L, 10000, %L, true, null, 'reemb-00000000000002') $$,
  tests.fx('store_a'), tests.fx('o1'), jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o1')), 'quantity', 2))),
  'P0001', 'validation_failed', 'no se reponen unidades no enviadas');
select tests.set_fx('r1', public.orders_request_refund(tests.fx('store_a'), tests.fx('o1'), 10000,
  jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o1')), 'quantity', 1)), true, 'Devolución',
  'reemb-00000000000003'));
select is(public.orders_request_refund(tests.fx('store_a'), tests.fx('o1'), 10000, '[]', false, null, 'reemb-00000000000003'),
  tests.fx('r1'), 'doble solicitud con la misma clave: el mismo reembolso');
select throws_ok(format($$ select public.orders_request_refund(%L, %L, 25000, '[]', false, null, 'reemb-00000000000004') $$,
  tests.fx('store_a'), tests.fx('o1')), 'P0001', 'validation_failed', 'lo pendiente cuenta para el límite');
select is((select refunded_total from public.orders where id = tests.fx('o1')), 0::bigint,
  'el dinero no cambia hasta que el reembolso se confirma');
select tests.logout();
select ok(exists (select 1 from system.jobs where dedupe_key = 'refund.execute:' || tests.fx('r1')), 'job refund.execute');
select is(system.apply_refund_result(tests.fx('r1'), 'succeeded', 'fake_r1', null) ->> 'status', 'succeeded',
  'reembolso confirmado');
select is((select refunded_total || '/' || payment_status || '/' || fulfillment_status from public.orders
            where id = tests.fx('o1')), '10000/partially_refunded/partially_returned', 'totales y estados del reembolso');
select is((tests.level()).on_hand, 20, 'la unidad devuelta vuelve al inventario (return)');
select is((system.apply_refund_result(tests.fx('r1'), 'succeeded', 'fake_r1', null) ->> 'replayed')::boolean, true,
  'aplicar dos veces no duplica');
select is((select refunded_total from public.orders where id = tests.fx('o1')), 10000::bigint, 'sin doble reembolso');

-- ============================================================================ Cancelar
select tests.login('owner');
select throws_ok(format($$ select public.orders_cancel(%L, %L, 'staff', null, 'cancel-0000000000001') $$,
  tests.fx('store_a'), tests.fx('o1')), 'P0001', 'conflict', 'con unidades enviadas no se cancela');
select lives_ok(format($$ select public.orders_cancel(%L, %L, 'customer', 'Lo pidió el cliente', 'cancel-0000000000002') $$,
  tests.fx('store_a'), tests.fx('o2')), 'cancelar un pedido pagado sin enviar');
select is((select status || '/' || cancel_reason || '/' || payment_status from public.orders where id = tests.fx('o2')),
  'cancelled/customer/paid', 'cancelado; sigue pagado hasta confirmar el reembolso');
select is((select status from public.inventory_reservations where order_id = tests.fx('o2')), 'released',
  'la reserva confirmada se libera');
select is((select amount from public.refunds where order_id = tests.fx('o2')), 19000::bigint,
  'se solicitó el reembolso total');
select tests.logout();
select system.apply_refund_result(tests.refund_of(tests.fx('o2')), 'succeeded', 'fake_r2', null);
select is((select payment_status from public.orders where id = tests.fx('o2')), 'refunded', 'cancelado y reembolsado');

select tests.login('owner');
select lives_ok(format($$ select public.orders_cancel(%L, %L, 'staff', null, 'cancel-0000000000003') $$,
  tests.fx('store_a'), tests.fx('o_unpaid')), 'cancelar uno sin pagar');
select is((select status || '/' || payment_status from public.orders where id = tests.fx('o_unpaid')), 'cancelled/expired',
  'sin pagar: cancelado sin reembolso');
select tests.logout();
select tests.login('owner_b');
select throws_ok(format($$ select public.orders_cancel(%L, %L, 'staff', null, 'cancel-0000000000004') $$,
  tests.fx('store_b'), tests.fx('o1')), 'P0001', 'not_found', 'B no cancela pedidos de A');
select tests.logout();

-- ============================================================================ Entrega y reembolso fallido
select tests.login('owner');
select tests.set_fx('s3', public.orders_fulfill(tests.fx('store_a'), tests.fx('o3'),
  jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o3')), 'quantity', 1)), null, null, null,
  'envio-000000000000010'));
select public.orders_mark_delivered(tests.fx('store_a'), tests.fx('s3'));
select is((select status || '/' || fulfillment_status from public.orders where id = tests.fx('o3')), 'completed/fulfilled',
  'surtido y entregado: completado');
select public.orders_mark_delivered(tests.fx('store_a'), tests.fx('s3'));
select tests.logout();
select is((select count(*)::int from system.jobs where type = 'order.delivered'
            and payload ->> 'shipment_id' = tests.fx('s3')::text), 1,
  'entregado: se encola una vez el aviso con la invitación a opinar (ADR-029), aunque se marque dos veces');
select is((select dedupe_key from system.jobs where type = 'order.delivered'
            and payload ->> 'shipment_id' = tests.fx('s3')::text), 'order.delivered:' || tests.fx('s3'),
  'con clave por envío');
select tests.login('owner');
select tests.set_fx('r3', public.orders_request_refund(tests.fx('store_a'), tests.fx('o3'), 500, '[]', false, null,
  'reemb-00000000000010'));
select tests.logout();
select system.apply_refund_result(tests.fx('r3'), 'failed', null, 'card_expired');
select is((select needs_attention from public.orders where id = tests.fx('o3')), true, 'reembolso fallido: en atención');

select * from finish();
rollback;
