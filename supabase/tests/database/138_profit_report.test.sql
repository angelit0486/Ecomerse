-- =============================================================================
-- Reporte de rentabilidad (interruptor `profit_report`): utilidad contra un caso
-- calculado a mano, foto del costo al vender, permisos y aislamiento.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('orders', 'orders@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'orders', 'order_manager');
update public.stores set timezone = 'America/Mexico_City' where id in (tests.fx('store_a'), tests.fx('store_b'));

create function tests.variant(p_store uuid, p_slug text, p_cost bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_p uuid; v_v uuid;
begin
  insert into public.products (store_id, title, slug, status, published_at)
  values (p_store, initcap(p_slug), p_slug, 'active', now()) returning id into v_p;
  insert into public.product_variants (store_id, product_id, sku, price, option_signature)
  values (p_store, v_p, 'SKU-' || p_slug, 10000, '') returning id into v_v;
  if p_cost is not null then
    insert into public.variant_costs (store_id, variant_id, cost) values (p_store, v_v, p_cost);
  end if;
  return v_v;
end $$;

-- Pedido pagado con una partida. `p_snapshot` = venta nueva (el trigger guarda
-- la foto del costo); sin él, una venta anterior a la migración.
create function tests.sell(p_store uuid, p_at timestamptz, p_variant uuid, p_qty int, p_discount bigint,
                           p_tax bigint, p_refunded int, p_cancelled int, p_snapshot boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid := tests.order(p_store); v_item uuid; v_product uuid; v_title text;
begin
  select p.id, p.title into v_product, v_title from public.product_variants x
    join public.products p on p.id = x.product_id where x.id = p_variant;
  if not p_snapshot then
    set local session_replication_role = replica;
  end if;
  insert into public.order_items (store_id, order_id, variant_id, product_id, product_title, product_type,
                                  requires_shipping, unit_price, quantity, discount_allocation, tax_amount, line_total)
  values (p_store, v, p_variant, v_product, v_title, 'physical', false, 10000, p_qty, p_discount, p_tax,
          10000 * p_qty - p_discount)
  returning id into v_item;
  set local session_replication_role = replica;
  update public.orders set subtotal = 10000 * p_qty, discount_total = p_discount, tax_total = p_tax, total = 10000 * p_qty - p_discount,
                           paid_total = 10000 * p_qty - p_discount, paid_at = p_at, status = 'open',
                           payment_status = 'paid' where id = v;
  update public.order_items set refunded_quantity = p_refunded, cancelled_quantity = p_cancelled where id = v_item;
  set local session_replication_role = origin;
  return v;
end $$;
create function tests.snapshot_of(p_order uuid) returns bigint language sql security definer set search_path = '' as $$
  select c.unit_cost from public.order_item_costs c
    join public.order_items i on i.id = c.order_item_id where i.order_id = p_order $$;
grant execute on all functions in schema tests to authenticated;

select tests.set_fx('v1', tests.variant(tests.fx('store_a'), 'taza', 4000));
select tests.set_fx('v2', tests.variant(tests.fx('store_a'), 'vela', null));
select tests.set_fx('vb', tests.variant(tests.fx('store_b'), 'ajena', 1000));

-- Seed del 2026-03-10 (hora de CDMX).
select tests.set_fx('o1', tests.sell(tests.fx('store_a'), '2026-03-10 18:00+00', tests.fx('v1'), 2, 0, 0, 0, 0, true));
select tests.set_fx('o2', tests.sell(tests.fx('store_a'), '2026-03-10 18:01+00', tests.fx('v1'), 3, 3000, 3000, 1, 0, true));
select tests.set_fx('o3', tests.sell(tests.fx('store_a'), '2026-03-10 18:02+00', tests.fx('v2'), 1, 5000, 0, 0, 0, true));
select tests.set_fx('o4', tests.sell(tests.fx('store_a'), '2026-03-10 18:03+00', tests.fx('v1'), 2, 0, 0, 0, 1, true));
select tests.set_fx('o5', tests.sell(tests.fx('store_a'), '2026-03-10 18:04+00', tests.fx('v1'), 1, 0, 0, 0, 0, true));
select tests.set_fx('o6', tests.sell(tests.fx('store_a'), '2026-03-10 18:05+00', tests.fx('v1'), 1, 0, 0, 0, 0, false));
select tests.sell(tests.fx('store_a'), '2026-03-12 18:00+00', tests.fx('v1'), 5, 0, 0, 0, 0, true);  -- fuera del rango
select tests.sell(tests.fx('store_b'), '2026-03-10 18:00+00', tests.fx('vb'), 1, 0, 0, 0, 0, true);  -- otra tienda

set local session_replication_role = replica;
update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'customer' where id = tests.fx('o5');
-- o4: reembolso sin producto de 12000 (10000 de la unidad cancelada + 2000 de cortesía).
insert into public.payment_accounts (store_id, provider, status, display_name)
values (tests.fx('store_a'), 'manual', 'active', 'Transferencia');
insert into public.payments (store_id, order_id, payment_account_id, provider, amount, currency, idempotency_key, status)
select tests.fx('store_a'), tests.fx('o4'), id, 'manual', 20000, 'MXN', 'pago-util-0000000001', 'succeeded'
  from public.payment_accounts where store_id = tests.fx('store_a');
insert into public.refunds (store_id, order_id, payment_id, amount, idempotency_key, status)
select tests.fx('store_a'), tests.fx('o4'), p.id, 12000, 'reemb-util-00000001', 'succeeded'
  from public.payments p where p.idempotency_key = 'pago-util-0000000001';
set local session_replication_role = origin;

-- ------------------------------------------------ 1. La foto del costo
select is(tests.snapshot_of(tests.fx('o1')), 4000::bigint, 'al vender se guarda el costo de ese momento');
select is(tests.snapshot_of(tests.fx('o3')), null, 'sin costo capturado no hay foto');
select is(tests.snapshot_of(tests.fx('o6')), null, 'una venta anterior no tiene foto');
-- El costo sube DESPUÉS de vender: las ventas con foto no cambian.
update public.variant_costs set cost = 9999 where variant_id = tests.fx('v1');
select throws_ok($$ update public.order_item_costs set unit_cost = 1 $$, '42501', 'append_only', 'la foto no se edita');
select throws_ok($$ delete from public.order_item_costs $$, '42501', 'append_only', 'ni se borra');

-- ------------------------------------------------ 2. Interruptor y permisos
select tests.login('owner');
select is(pg_temp.err(format('select public.profit_report(%L, %L, %L)', tests.fx('store_a'), '2026-03-10', '2026-03-10')),
          'not_found/feature', 'con el interruptor apagado no hay reporte');
select public.store_set_feature(tests.fx('store_a'), 'profit_report', true);
create temp table k as select public.profit_report(tests.fx('store_a'), '2026-03-10', '2026-03-10') as v;
grant select on k to authenticated;

-- ------------------------------------------------ 3. El cálculo, al centavo
select is((select (v ->> 'orders')::int from k), 5, 'pedidos pagados del día, sin el cancelado');
select is((select (v ->> 'cancelled_orders')::int from k), 1, 'el cancelado se cuenta aparte');
select is((select (v ->> 'revenue')::bigint from k), 61000::bigint,
          'venta: 20000 + 16000 (2 de 3, sin impuesto) + 5000 + 10000 (1 de 2) + 10000');
select is((select (v ->> 'revenue_without_cost')::bigint from k), 5000::bigint, 'lo vendido sin costo capturado va aparte');
select is((select (v ->> 'units_without_cost')::int from k), 1, 'una unidad sin costo');
select is((select (v ->> 'cost')::bigint from k), 29999::bigint,
          'costo: 8000 + 8000 + 4000 con la foto, y 9999 (costo actual) en la venta anterior');
select is((select (v ->> 'units_current_cost')::int from k), 1, 'se avisa que una unidad usa el costo actual');
select is((select (v ->> 'other_refunds')::bigint from k), 2000::bigint,
          'otros reembolsos: 12000 menos los 10000 de la unidad cancelada');
select is((select (v ->> 'profit')::bigint from k), 24001::bigint, 'utilidad: 56000 − 29999 − 2000');
select is((select jsonb_array_length(v -> 'products') from k), 2, 'dos productos');
select is((select v #>> '{products,0,title}' from k), 'Taza', 'primero el que más deja');
select is((select (v #>> '{products,0,profit}')::bigint from k), 26001::bigint, 'Taza: 56000 − 29999');
select is((select v #> '{products,1,profit}' from k), 'null'::jsonb, 'sin costo no se inventa la utilidad');
select is((select (r ->> 'profit')::bigint from k, jsonb_array_elements(v -> 'order_rows') r
            where r ->> 'order_id' = tests.fx('o4')::text), 4000::bigint, 'pedido o4: 10000 − 4000 − 2000');
select is((select r -> 'profit' from k, jsonb_array_elements(v -> 'order_rows') r
            where r ->> 'order_id' = tests.fx('o3')::text), 'null'::jsonb, 'pedido sin costo: utilidad sin calcular');
select is(pg_temp.err(format('select public.profit_report(%L, %L, %L)', tests.fx('store_a'), '2025-01-01', '2026-03-10')),
          'validation_failed/range', 'el rango no pasa de un año');
select tests.logout();

-- ------------------------------------------------ 4. Quién lo ve
select tests.login('orders');
select is(pg_temp.err(format('select public.profit_report(%L, %L, %L)', tests.fx('store_a'), '2026-03-10', '2026-03-10')),
          'forbidden', 'sin permiso de ver costos no hay reporte');
select is((select count(*)::int from public.order_item_costs), 0, 'ni ve las fotos del costo');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.err(format('select public.profit_report(%L, %L, %L)', tests.fx('store_a'), '2026-03-10', '2026-03-10')),
          'forbidden', 'aislamiento: la dueña de B no ve la rentabilidad de A');
select is((select count(*)::int from public.order_item_costs), 1, 'y solo ve las fotos de su tienda');
select tests.logout();
select is(public.app_schema_version(), '20261112000100', 'versión de la base');

select * from finish();
rollback;
