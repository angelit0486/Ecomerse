-- =============================================================================
-- ADR-043: contracargo o reembolso hecho fuera de la plataforma sobre un cobro
-- ya aprobado. El pedido queda en atención, con el motivo en su historial, se
-- avisa a la tienda y la salud lo cuenta. No cambia dinero, estados ni inventario.
-- Un reembolso pedido desde la plataforma no se marca. Aislado por tienda.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now(), prices_include_tax = true, tax_rate_bps = 0
 where id = tests.fx('store_a');

create function tests.variant() returns uuid language sql as
  $$ select id from public.product_variants where sku = 'REV-1' and deleted_at is null $$;
create function tests.pay_of(p_order uuid) returns public.payments language sql as
  $$ select p.* from public.payments p where p.order_id = p_order order by p.created_at desc limit 1 $$;
create function tests.paid_order(p_key text) returns uuid language plpgsql as $$
declare v jsonb; tok text := rpad(p_key, 43, 'x'); v_order uuid;
begin
  perform storefront.cart_add_item(tests.fx('store_a'), tok, tests.variant(), 1);
  v := storefront.place_order(tests.fx('store_a'), tok,
         jsonb_build_object('email', p_key || '@x.io', 'customer_name', 'C', 'payment_account_id', tests.fx('stripe')),
         10000, 'idem-' || p_key || '-000000000', sha256(convert_to(p_key, 'UTF8')));
  v_order := (v ->> 'order_id')::uuid;
  perform storefront.record_checkout_result(tests.fx('store_a'), (v -> 'payment' ->> 'id')::uuid, true,
                                            'cs_test_' || md5(p_key));
  perform tests.result(v_order, 'succeeded', null);
  return v_order;
end $$;
-- Lo que manda el webhook tras re-consultar al proveedor.
create function tests.result(p_order uuid, p_status text, p_reversal text) returns jsonb language sql as $$
  select system.apply_payment_status(p.id, jsonb_build_object('status', p_status, 'amount', p.amount, 'currency', 'MXN',
           'provider_payment_id', 'pi_' || md5(p.id::text), 'external_reference', p.id::text, 'method', 'card',
           'reversal', p_reversal))
    from public.payments p where p.id = (tests.pay_of(p_order)).id $$;
create function tests.events(p_order uuid) returns bigint language sql as
  $$ select count(*) from public.order_events where order_id = p_order and type = 'payment.external_reversal' $$;
grant execute on all functions in schema tests to authenticated;

select tests.login('owner');
select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Taza","variants":[{"price":10000,"sku":"REV-1","requires_shipping":false}]}') ->> 'id')::uuid);
select public.inventory_adjust(tests.fx('store_a'), tests.variant(), 'adjustment', 20, 'Inicial');
select tests.logout();
insert into public.payment_accounts (store_id, provider, status, display_name, public_config) values
  (tests.fx('store_a'), 'stripe', 'active', 'Tarjeta', '{"stripe_account_id":"acct_REV000000001"}')
  returning tests.set_fx('stripe', id);

-- ============================================================================ Reembolso desde el panel del proveedor
select tests.set_fx('o1', tests.paid_order('rev1'));
select is((select payment_status from public.orders where id = tests.fx('o1')), 'paid', 'el pedido está pagado');
create temp table before_inv as select on_hand, reserved from public.inventory_levels where variant_id = tests.variant();

select is(tests.result(tests.fx('o1'), 'refunded', 'refund') ->> 'outcome', 'external_reversal',
  'un reembolso hecho en el proveedor ya no se ignora');
select is((select needs_attention from public.orders where id = tests.fx('o1')), true, 'el pedido queda en atención');
select results_eq(
  $$ select payment_status, paid_total, refunded_total from public.orders where id = tests.fx('o1') $$,
  $$ values ('paid'::text, 10000::bigint, 0::bigint) $$,
  'no cambia el estado de pago ni los totales: lo decide una persona');
select results_eq(
  $$ select on_hand, reserved from public.inventory_levels where variant_id = tests.variant() $$,
  $$ select on_hand, reserved from before_inv $$,
  'no mueve inventario');
select is((select metadata ->> 'reason' from public.order_events
            where order_id = tests.fx('o1') and type = 'payment.external_reversal'), 'refund',
  'el historial dice el motivo');
select is((select count(*)::int from system.jobs
            where dedupe_key = 'payment.external_reversal:' || (tests.pay_of(tests.fx('o1'))).id
              and payload ->> 'reason' = 'refund'), 1, 'avisa a la tienda (un trabajo, deduplicado)');
select is(tests.result(tests.fx('o1'), 'refunded', 'refund') ->> 'outcome', 'ignored', 'el aviso repetido no repite nada');
select is(tests.events(tests.fx('o1')), 1::bigint, 'un solo registro en el historial');

-- ============================================================================ Contracargo
select tests.set_fx('o2', tests.paid_order('rev2'));
select is(tests.result(tests.fx('o2'), 'refunded', 'chargeback') ->> 'outcome', 'external_reversal', 'contracargo');
select alike((select message from public.order_events
              where order_id = tests.fx('o2') and type = 'payment.external_reversal'), '%contracargo%',
  'el historial dice que es un contracargo');

-- ============================================================================ Reembolso pedido desde la plataforma
select tests.set_fx('o3', tests.paid_order('rev3'));
select app.request_refund((select o from public.orders o where o.id = tests.fx('o3')), 10000, '[]'::jsonb, false,
                          'Pedido por la tienda', 'rev3-refund-0000000001');
select is(tests.result(tests.fx('o3'), 'refunded', 'refund') ->> 'outcome', 'ignored',
  'un reembolso pedido desde la plataforma no se marca como externo');

-- ============================================================================ Salud y aislamiento
select ok(system.platform_health() -> 'issues' @> '[{"code":"payment_reversals","severity":"warning"}]'
          and (system.platform_health() -> 'payments' ->> 'reversals_24h')::int >= 2,
  'la salud de la plataforma cuenta los reembolsos externos');
select tests.login('owner_b');
select is((select count(*)::int from public.order_events where type = 'payment.external_reversal'), 0,
  'otra tienda no ve el historial de la tienda A');
select tests.logout();

select * from finish();
rollback;
