-- =============================================================================
-- ADR-061: devoluciones. Interruptor, enlace del pedido, plazo, unidades,
-- una abierta por pedido, estados que solo avanzan, permisos, aislamiento entre
-- tiendas y reembolso por el flujo de siempre (con reposición de inventario).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

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
create function tests.on_hand() returns integer language sql as
  $$ select l.on_hand from public.inventory_levels l where l.variant_id = tests.variant('TAZA-R') $$;
create function tests.new_order(p_key text, p_qty int) returns uuid language plpgsql as $$
declare v jsonb; tok text := rpad(p_key, 43, 'x');
begin
  perform storefront.cart_add_item(tests.fx('store_a'), tok, tests.variant('TAZA-R'), p_qty);
  v := storefront.place_order(tests.fx('store_a'), tok,
         jsonb_build_object('email', p_key || '@x.io', 'customer_name', 'C', 'payment_account_id', tests.fx('fake')),
         10000 * p_qty, 'idem-' || p_key || '-000000000', sha256(convert_to(p_key, 'UTF8')));
  perform system.fake_payment_result((v -> 'payment' ->> 'id')::uuid, 'succeeded');
  return (v ->> 'order_id')::uuid;
end $$;
create function tests.item(p_order uuid) returns uuid language sql security definer as
  $$ select id from public.order_items where order_id = p_order limit 1 $$;
create function tests.tok(p_order uuid) returns bytea language sql security definer as
  $$ select guest_access_token_hash from public.orders where id = p_order $$;
create function tests.req(p_order uuid, p_qty int, p_reason text default 'damaged') returns jsonb language sql
security definer as $$
  select jsonb_build_object('reason', p_reason, 'note', 'Llegó rota',
                            'items', jsonb_build_array(jsonb_build_object('order_item_id', tests.item(p_order), 'quantity', p_qty)))
$$;
create function tests.ret(p_order uuid) returns uuid language sql security definer as
  $$ select id from public.return_requests where order_id = p_order order by requested_at desc, id desc limit 1 $$;
grant execute on all functions in schema tests to authenticated, storefront_gateway;

select tests.login('owner');
select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Taza","variants":[{"price":10000,"sku":"TAZA-R","requires_shipping":false}]}') ->> 'id')::uuid);
select public.inventory_adjust(tests.fx('store_a'), tests.variant('TAZA-R'), 'adjustment', 20, 'Inicial');
select tests.logout();
insert into public.payment_accounts (store_id, provider, status, display_name) values
  (tests.fx('store_a'), 'fake', 'active', 'Prueba') returning tests.set_fx('fake', id);
select tests.set_fx('o1', tests.new_order('uno', 3));
select tests.set_fx('o2', tests.new_order('dos', 1));
select tests.set_fx('o3', tests.new_order('tres', 1));

-- 1-2. Con el interruptor apagado no hay devoluciones.
select is(storefront.return_options(tests.fx('store_a'), tests.fx('o1'), tests.tok(tests.fx('o1'))), null,
  'apagado: el pedido no ofrece devolución');
select throws_ok(format($$ select storefront.request_return(%L, %L, %L, %L) $$, tests.fx('store_a'), tests.fx('o1'),
  tests.tok(tests.fx('o1')), tests.req(tests.fx('o1'), 1)), 'P0001', 'not_found', 'apagado: no se puede pedir');

insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
values ('returns', 'store', tests.fx('store_a'), true, 'pgTAP 131');

-- 3-4. Antes de enviar no hay plazo.
select is((storefront.return_options(tests.fx('store_a'), tests.fx('o1'), tests.tok(tests.fx('o1'))) ->> 'open')::boolean,
  false, 'sin envío: todavía no se puede devolver');
select throws_ok(format($$ select storefront.request_return(%L, %L, %L, %L) $$, tests.fx('store_a'), tests.fx('o1'),
  tests.tok(tests.fx('o1')), tests.req(tests.fx('o1'), 1)), 'P0001', 'conflict', 'sin envío: se rechaza');

-- La tienda envía 2 de las 3 tazas de o1 y la de o2 y o3.
select tests.login('owner');
select public.orders_fulfill(tests.fx('store_a'), tests.fx('o1'),
  jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o1')), 'quantity', 2)),
  null, null, null, 'envio-ret-0000000001');
select public.orders_fulfill(tests.fx('store_a'), tests.fx('o2'),
  jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o2')), 'quantity', 1)),
  null, null, null, 'envio-ret-0000000002');
select public.orders_fulfill(tests.fx('store_a'), tests.fx('o3'),
  jsonb_build_array(jsonb_build_object('order_item_id', tests.item(tests.fx('o3')), 'quantity', 1)),
  null, null, null, 'envio-ret-0000000003');
select tests.logout();

-- 5-6. Abierto y con las unidades enviadas.
create temp table opts as
select storefront.return_options(tests.fx('store_a'), tests.fx('o1'), tests.tok(tests.fx('o1'))) as o;
select is((select (o ->> 'open')::boolean from opts), true, 'enviado: se puede devolver');
select is((select (o -> 'lines' -> 0 ->> 'available')::int from opts), 2, 'solo las 2 unidades enviadas');

-- 7-11. Validaciones.
select throws_ok(format($$ select storefront.return_options(%L, %L, %L) $$, tests.fx('store_a'), tests.fx('o1'),
  sha256('otro'::bytea)), 'P0001', 'not_found', 'con otro enlace no se ve');
select throws_ok(format($$ select storefront.request_return(%L, %L, %L, %L) $$, tests.fx('store_a'), tests.fx('o1'),
  tests.tok(tests.fx('o1')), tests.req(tests.fx('o1'), 3)), 'P0001', 'validation_failed', 'no más de lo enviado');
select throws_ok(format($$ select storefront.request_return(%L, %L, %L, %L) $$, tests.fx('store_a'), tests.fx('o1'),
  tests.tok(tests.fx('o1')), tests.req(tests.fx('o1'), 1, 'porque_si')), 'P0001', 'validation_failed',
  'el motivo es de la lista');
select throws_ok(format($$ select storefront.request_return(%L, %L, %L, %L) $$, tests.fx('store_a'), tests.fx('o1'),
  tests.tok(tests.fx('o1')), jsonb_build_object('reason', 'damaged', 'items', jsonb_build_array(
    jsonb_build_object('order_item_id', tests.item(tests.fx('o1')), 'quantity', 1),
    jsonb_build_object('order_item_id', tests.item(tests.fx('o1')), 'quantity', 1)))),
  'P0001', 'validation_failed', 'un renglón no se repite');
select throws_ok(format($$ select storefront.request_return(%L, %L, %L, %L) $$, tests.fx('store_a'), tests.fx('o1'),
  tests.tok(tests.fx('o1')), tests.req(tests.fx('o2'), 1)), 'P0001', 'validation_failed',
  'una partida de otro pedido no entra');

-- 12-15. Solicitud válida (como el gateway de la tienda).
select tests.as_role('storefront_gateway');
select set_config('tests.r1', storefront.request_return(tests.fx('store_a'), tests.fx('o1'), tests.tok(tests.fx('o1')),
  tests.req(tests.fx('o1'), 2)) ->> 'status', true);
select tests.logout();
select is(current_setting('tests.r1'), 'requested', 'el cliente la pide');
select ok(exists (select 1 from public.order_events where order_id = tests.fx('o1') and type = 'return.requested'
                   and customer_visible), 'queda en la historia del pedido, visible al cliente');
select ok(exists (select 1 from system.jobs where type = 'return.requested'
                   and payload ->> 'return_id' = tests.ret(tests.fx('o1'))::text), 'y avisa por correo');
select throws_ok(format($$ select storefront.request_return(%L, %L, %L, %L) $$, tests.fx('store_a'), tests.fx('o1'),
  tests.tok(tests.fx('o1')), tests.req(tests.fx('o1'), 1)), 'P0001', 'conflict', 'una abierta por pedido');

-- 16-19. Aislamiento y permisos.
select tests.login('owner_b');
select is((select count(*)::int from public.return_requests), 0, 'la dueña de B no ve las devoluciones de A');
select throws_ok(format($$ select public.returns_list(%L, 'requested') $$, tests.fx('store_a')), '42501', 'forbidden',
  'ni con la lista');
select throws_ok(format($$ select public.returns_get(%L, %L) $$, tests.fx('store_a'), tests.ret(tests.fx('o1'))),
  '42501', 'forbidden', 'ni con el detalle');
select throws_ok(format($$ select public.returns_decide(%L, %L, true, null) $$, tests.fx('store_a'),
  tests.ret(tests.fx('o1'))), '42501', 'forbidden', 'ni las decide');
select tests.logout();
select tests.login('viewer');
select is((select count(*)::int from public.return_requests where store_id = tests.fx('store_a')), 1,
  'quien ve pedidos ve la solicitud');
select is((public.returns_list(tests.fx('store_a'), 'requested') -> 'counts' ->> 'requested')::int, 1,
  'la lista cuenta las solicitudes por revisar');
select is((public.returns_get(tests.fx('store_a'), tests.ret(tests.fx('o1'))) -> 'items' -> 0 ->> 'amount')::bigint,
  20000::bigint, 'el detalle sugiere la parte proporcional: 2 de 3 tazas de 100 pesos');
select throws_ok(format($$ select public.returns_decide(%L, %L, true, null) $$, tests.fx('store_a'),
  tests.ret(tests.fx('o1'))), '42501', 'forbidden', 'pero sin permiso de reembolso no la decide');
select tests.logout();

-- 20-23. Decidir.
select tests.login('owner');
select throws_ok(format($$ select public.returns_decide(%L, %L, false, '  ') $$, tests.fx('store_a'),
  tests.ret(tests.fx('o1'))), 'P0001', 'validation_failed', 'rechazar exige decir por qué');
select lives_ok(format($$ select public.returns_decide(%L, %L, true, 'Envíala a Av. Juárez 10 con tu número de pedido') $$,
  tests.fx('store_a'), tests.ret(tests.fx('o1'))), 'la dueña la aprueba con instrucciones');
select tests.logout();
select is((storefront.return_options(tests.fx('store_a'), tests.fx('o1'), tests.tok(tests.fx('o1'))) -> 'last'
           ->> 'customer_message'), 'Envíala a Av. Juárez 10 con tu número de pedido', 'el cliente ve las instrucciones');
select ok(exists (select 1 from system.jobs where dedupe_key = 'return.decided:' || tests.ret(tests.fx('o1'))
                   and type = 'return.approved'), 'y le llegan por correo');

-- 24-26. Lo pedido no se reescribe, el estado no retrocede y nada se borra.
select throws_ok(format($$ update public.return_requests set items = '[]' where id = %L $$, tests.ret(tests.fx('o1'))),
  '42501', 'append_only', 'las partidas no se cambian');
select throws_ok(format($$ update public.return_requests set status = 'requested' where id = %L $$,
  tests.ret(tests.fx('o1'))), 'P0001', 'conflict', 'el estado no retrocede');
select throws_ok(format($$ delete from public.return_requests where id = %L $$, tests.ret(tests.fx('o1'))),
  '42501', 'append_only', 'una devolución no se borra');

-- 27-33. Recibir y reembolsar con reposición.
select tests.login('owner');
select lives_ok(format($$ select public.returns_receive(%L, %L) $$, tests.fx('store_a'), tests.ret(tests.fx('o1'))),
  'la dueña registra que llegó');
select throws_ok(format($$ select public.returns_refund(%L, %L, 999999, true, 'devolucion-ret-0000001') $$,
  tests.fx('store_a'), tests.ret(tests.fx('o1'))), 'P0001', 'validation_failed', 'no más de lo cobrado');
select tests.set_fx('ref1', public.returns_refund(tests.fx('store_a'), tests.ret(tests.fx('o1')), 20000, true,
  'devolucion-ret-0000001'));
select is(public.returns_refund(tests.fx('store_a'), tests.ret(tests.fx('o1')), 20000, true, 'devolucion-ret-0000001'),
  tests.fx('ref1'), 'repetir el formulario devuelve el mismo reembolso');
select tests.logout();
select ok((select status = 'closed' and resolution = 'refund' and refund_id = tests.fx('ref1') and restock
             from public.return_requests where id = tests.ret(tests.fx('o1'))), 'cerrada con su reembolso');
select is((select items from public.refunds where id = tests.fx('ref1')),
  (select items from public.return_requests where id = tests.ret(tests.fx('o1'))),
  'el reembolso lleva las partidas devueltas');
create temp table stock_before as select tests.on_hand() as n;
select system.apply_refund_result(tests.fx('ref1'), 'succeeded', 'fake_ret1', null);
select is(tests.on_hand(), (select n + 2 from stock_before), 'al confirmarse, las 2 tazas vuelven al inventario');
select is((select returned_quantity from public.order_items where id = tests.item(tests.fx('o1'))), 2,
  'y quedan como devueltas en el pedido');

-- 34-36. Cerrar con cambio, sin reembolso.
select tests.as_role('storefront_gateway');
select storefront.request_return(tests.fx('store_a'), tests.fx('o2'), tests.tok(tests.fx('o2')),
  tests.req(tests.fx('o2'), 1, 'wrong_item'));
select tests.logout();
select tests.login('owner');
select throws_ok(format($$ select public.returns_close(%L, %L, 'exchange', null) $$, tests.fx('store_a'),
  tests.ret(tests.fx('o2'))), 'P0001', 'conflict', 'antes de aprobarla no se cierra');
select public.returns_decide(tests.fx('store_a'), tests.ret(tests.fx('o2')), true, null);
select lives_ok(format($$ select public.returns_close(%L, %L, 'exchange', 'Te enviamos la talla correcta') $$,
  tests.fx('store_a'), tests.ret(tests.fx('o2'))), 'se cierra con un cambio');
select tests.logout();
select ok((select status = 'closed' and resolution = 'exchange' and refund_id is null
             from public.return_requests where id = tests.ret(tests.fx('o2'))), 'cerrada como cambio, sin dinero');

-- 37-40. Plazo de la tienda.
select tests.login('viewer');
select throws_ok(format($$ select public.returns_set_window(%L, 15) $$, tests.fx('store_a')), '42501', 'forbidden',
  'sin permiso no se cambia el plazo');
select tests.logout();
select tests.login('owner');
select throws_ok(format($$ select public.returns_set_window(%L, 0) $$, tests.fx('store_a')), 'P0001',
  'validation_failed', 'de 1 a 365 días');
select public.returns_set_window(tests.fx('store_a'), 7);
select tests.logout();
-- El envío de o3 salió hace 10 días: con 7 de plazo ya no se puede.
set local session_replication_role = replica;
update public.shipments set shipped_at = now() - interval '10 days' where order_id = tests.fx('o3');
set local session_replication_role = origin;
select is((storefront.return_options(tests.fx('store_a'), tests.fx('o3'), tests.tok(tests.fx('o3'))) ->> 'open')::boolean,
  false, 'fuera de plazo no se ofrece');
select throws_ok(format($$ select storefront.request_return(%L, %L, %L, %L) $$, tests.fx('store_a'), tests.fx('o3'),
  tests.tok(tests.fx('o3')), tests.req(tests.fx('o3'), 1)), 'P0001', 'conflict', 'ni se acepta');

select * from finish();
rollback;
