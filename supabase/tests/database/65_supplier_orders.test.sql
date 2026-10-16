-- =============================================================================
-- ADR-025 paso 2 · Despachos por proveedor: nacen al confirmarse el pago a partir
-- de la reserva (solo lo que salió del proveedor), idempotentes, con estados
-- propios y transiciones válidas, cancelación con el pedido, permisos
-- (orders.read / orders.update), aislamiento, nada se borra, y el plazo del
-- proveedor en la ficha (solo cuando no hay existencias propias).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

create function pg_temp.order_with_line(p_store uuid, p_variant uuid, p_qty integer) returns uuid
language plpgsql as $$
declare v_order uuid := tests.order(p_store);
begin
  insert into public.order_items (store_id, order_id, variant_id, product_id, product_title, variant_title, sku,
                                  product_type, requires_shipping, unit_price, quantity, line_total)
  select p_store, v_order, v.id, v.product_id, 'Proteína', 'Vainilla', v.sku, 'physical', true, v.price, p_qty,
         v.price * p_qty
    from public.product_variants v where v.id = p_variant;
  return v_order;
end $$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'viewer', 'viewer');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

select tests.login('owner');
select tests.set_fx('prod', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Proteína","slug":"proteina","variants":[{"price":89900,"sku":"PRO-1"}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('prod'));
select tests.set_fx('var', (select id from public.product_variants where sku = 'PRO-1'));
select public.inventory_adjust(tests.fx('store_a'), tests.fx('var'), 'adjustment', 1, 'Inventario inicial');
select tests.set_fx('sup', public.suppliers_save(tests.fx('store_a'),
  '{"name":"Distribuidora Norte","lead_time_min_days":2,"lead_time_max_days":4}'));
select public.suppliers_set_variant(tests.fx('store_a'), tests.fx('sup'), tests.fx('var'),
  '{"supplier_sku":"DN-778","unit_cost":45000,"availability":"available","quantity":5}');
select tests.logout();

-- ============================================================================ Ficha
select is((select v -> 'ships_in_days' from jsonb_array_elements(
             storefront.get_product(tests.fx('store_a'), 'proteina') -> 'variants') v), 'null'::jsonb,
          'con existencias propias no se muestra plazo del proveedor');

-- ============================================================================ Alta al pagar
-- Pedido de 3: 1 propia + 2 del proveedor.
select tests.set_fx('o1', pg_temp.order_with_line(tests.fx('store_a'), tests.fx('var'), 3));
select tests.set_fx('r1', app.inventory_reserve(tests.fx('store_a'), tests.fx('o1'),
  jsonb_build_array(jsonb_build_object('variant_id', tests.fx('var'), 'quantity', 3)), now() + interval '30 minutes'));
select is((select count(*)::integer from public.supplier_orders where order_id = tests.fx('o1')), 0,
          'reservar no crea despachos (el pago aún no se confirma)');

select is((select v -> 'ships_in_days' from jsonb_array_elements(
             storefront.get_product(tests.fx('store_a'), 'proteina') -> 'variants') v), '{"min": 2, "max": 4}'::jsonb,
          'sin existencias propias libres: el plazo capturado del proveedor');
select ok(storefront.get_product(tests.fx('store_a'), 'proteina')::text !~* 'distribuidora|DN-778|45000',
          'la ficha no publica el proveedor, su SKU ni su costo');

select app.inventory_commit(tests.fx('store_a'), tests.fx('r1'));
select is((select so.status || '|' || i.quantity || '|' || i.supplier_sku || '|' || i.product_title || '|' || i.sku
             from public.supplier_orders so join public.supplier_order_items i on i.supplier_order_id = so.id
            where so.order_id = tests.fx('o1')), 'pending|2|DN-778|Proteína|PRO-1',
          'al confirmarse el pago nace el despacho con lo que sale del proveedor (2), su SKU y el título del pedido');
select is((select i.order_item_id from public.supplier_order_items i
             join public.supplier_orders so on so.id = i.supplier_order_id where so.order_id = tests.fx('o1')),
          (select id from public.order_items where order_id = tests.fx('o1')), 'ligado al renglón del pedido');
select is((select count(*)::integer from public.order_events
            where order_id = tests.fx('o1') and type = 'supplier_order.created' and not customer_visible), 1,
          'queda en el historial interno del pedido');
select app.inventory_commit(tests.fx('store_a'), tests.fx('r1'));
select app.supplier_orders_ensure(tests.fx('store_a'), tests.fx('r1'));
select is((select count(*)::integer from public.supplier_orders where order_id = tests.fx('o1')), 1,
          'confirmar otra vez no duplica');
select tests.set_fx('so1', (select id from public.supplier_orders where order_id = tests.fx('o1')));

-- Pedido solo con existencias propias: sin despacho.
select tests.login('owner');
select public.inventory_adjust(tests.fx('store_a'), tests.fx('var'), 'adjustment', 5, 'Llegó mercancía');
select tests.logout();
select tests.set_fx('o2', pg_temp.order_with_line(tests.fx('store_a'), tests.fx('var'), 1));
select tests.set_fx('r2', app.inventory_reserve(tests.fx('store_a'), tests.fx('o2'),
  jsonb_build_array(jsonb_build_object('variant_id', tests.fx('var'), 'quantity', 1)), now() + interval '30 minutes'));
select app.inventory_commit(tests.fx('store_a'), tests.fx('r2'));
select is((select count(*)::integer from public.supplier_orders where order_id = tests.fx('o2')), 0,
          'lo que sale de la bodega propia no genera despacho');

-- ============================================================================ Estados
select tests.login('viewer');
select is(jsonb_array_length(public.orders_supplier_orders(tests.fx('store_a'), tests.fx('o1'))), 1,
          'con orders.read se ve el despacho del pedido');
select is(public.orders_supplier_orders(tests.fx('store_a'), tests.fx('o1')) -> 0 -> 'supplier' ->> 'name',
          'Distribuidora Norte', 'con el nombre del proveedor');
select ok((public.orders_supplier_orders(tests.fx('store_a'), tests.fx('o1')))::text !~ '45000',
          'nunca con el costo');
select is(pg_temp.err(format($$select public.supplier_orders_set_status(%L, %L, 'requested')$$,
            tests.fx('store_a'), tests.fx('so1'))), 'forbidden', 'sin orders.update no se cambia el estado');
select tests.logout();

select tests.login('owner');
select is(public.supplier_orders_set_status(tests.fx('store_a'), tests.fx('so1'), 'requested',
            '{"external_reference":"PO-1001","note":"Pedido por WhatsApp"}') ->> 'status', 'requested',
          'la dueña registra que lo pidió al proveedor');
select ok((select requested_at is not null and confirmed_at is null from public.supplier_orders where id = tests.fx('so1')),
          'con su hora');
select is(public.supplier_orders_set_status(tests.fx('store_a'), tests.fx('so1'), 'requested',
            '{"external_reference":"PO-1001"}') ->> 'external_reference', 'PO-1001', 'repetir no cambia nada');
select is((select count(*)::integer from public.order_events
            where order_id = tests.fx('o1') and type = 'supplier_order.updated'), 1, 'un solo evento');
select is(pg_temp.err(format($$select public.supplier_orders_set_status(%L, %L, 'shipped', '{"tracking_url":"http://x.io"}')$$,
            tests.fx('store_a'), tests.fx('so1'))), 'validation_failed/tracking_url', 'la guía solo con https');
select is(public.supplier_orders_set_status(tests.fx('store_a'), tests.fx('so1'), 'shipped',
            '{"carrier":"Estafeta","tracking_number":"EST 123456"}') ->> 'status', 'shipped',
          'se pueden adelantar pasos (de solicitado a enviado)');
select ok((select confirmed_at is not null and shipped_at is not null from public.supplier_orders where id = tests.fx('so1')),
          'y se completan las horas intermedias');
select is(pg_temp.err(format($$select public.supplier_orders_set_status(%L, %L, 'requested')$$,
            tests.fx('store_a'), tests.fx('so1'))), 'conflict/invalid_transition', 'no se regresa de estado');
select is(public.supplier_orders_set_status(tests.fx('store_a'), tests.fx('so1'), 'delivered') ->> 'status', 'delivered',
          'entregado');
select is(pg_temp.err(format($$select public.supplier_orders_set_status(%L, %L, 'cancelled')$$,
            tests.fx('store_a'), tests.fx('so1'))), 'conflict/invalid_transition', 'un despacho entregado es final');
select is((public.supplier_orders_list(tests.fx('store_a'), 'open') -> 'items'), '[]'::jsonb,
          'la bandeja de pendientes queda vacía');
select is((public.supplier_orders_list(tests.fx('store_a'), 'all') -> 'counts' ->> 'delivered'), '1', 'con su conteo');
select tests.logout();

-- ============================================================================ Cancelación del pedido
select tests.login('owner');
-- 6 propias con 2 reservadas: se fijan en 2 (nada libre en la bodega).
select public.inventory_adjust(tests.fx('store_a'), tests.fx('var'), 'adjustment', 2, 'Se agotó la bodega', 'set');
select tests.logout();
select tests.set_fx('o3', pg_temp.order_with_line(tests.fx('store_a'), tests.fx('var'), 1));
select tests.set_fx('r3', app.inventory_reserve(tests.fx('store_a'), tests.fx('o3'),
  jsonb_build_array(jsonb_build_object('variant_id', tests.fx('var'), 'quantity', 1)), now() + interval '30 minutes'));
select app.inventory_commit(tests.fx('store_a'), tests.fx('r3'));
update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'staff' where id = tests.fx('o3');
select is((select status from public.supplier_orders where order_id = tests.fx('o3')), 'cancelled',
          'un despacho que nunca se pidió se cancela con el pedido');

-- ============================================================================ Integridad y aislamiento
select throws_ok(format('delete from public.supplier_orders where id = %L', tests.fx('so1')), '42501', null,
                 'los despachos nunca se borran');
select throws_ok(format('update public.supplier_order_items set quantity = 9 where supplier_order_id = %L', tests.fx('so1')),
                 '42501', null, 'sus renglones son inmutables');
select tests.login('owner_b');
select is(pg_temp.err(format('select public.orders_supplier_orders(%L, %L)', tests.fx('store_a'), tests.fx('o1'))),
          'forbidden', 'otra tienda no ve los despachos');
select is(tests.row_count('select * from public.supplier_orders'), 0::bigint, 'ni por RLS');
select tests.logout();

select * from finish();
rollback;
