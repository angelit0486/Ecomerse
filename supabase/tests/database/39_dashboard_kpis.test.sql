-- =============================================================================
-- Fase 8 · Dashboard de KPIs (F8-T03): valores contra un seed conocido, rango en
-- la zona horaria de la tienda, permisos y aislamiento.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('catalog', 'catalog@a.io');
select tests.create_user('agent', 'agent@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'catalog', 'catalog_manager');
select tests.add_store_member('a', 'agent', 'support_agent');
select tests.create_user('mkt', 'mkt@a.io');
select tests.add_store_member('a', 'mkt', 'marketing_manager');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set timezone = 'America/Mexico_City' where id = tests.fx('store_a');

-- Pedido pagado (snapshot fijo) en un instante dado, con una partida.
create function tests.paid(p_store uuid, p_total bigint, p_at timestamptz, p_title text, p_qty int) returns uuid
language plpgsql as $$
declare v uuid := tests.order(p_store);
begin
  set local session_replication_role = replica;
  update public.orders set subtotal = p_total, total = p_total, paid_total = p_total, paid_at = p_at,
                           status = 'open', payment_status = 'paid' where id = v;
  insert into public.order_items (store_id, order_id, product_title, product_type, requires_shipping, unit_price,
                                  quantity, line_total)
  values (p_store, v, p_title, 'physical', false, p_total / p_qty, p_qty, p_total);
  set local session_replication_role = origin;
  return v;
end $$;

-- Seed: 3 pedidos dentro de 2026-03-10 (hora de CDMX, UTC−6) y 2 fuera.
select tests.paid(tests.fx('store_a'), 10000, '2026-03-10 06:00:00+00', 'Taza', 2);   -- 00:00 CDMX: dentro
select tests.paid(tests.fx('store_a'), 25000, '2026-03-10 18:30:00+00', 'Vela', 1);   -- dentro
select tests.set_fx('o3', tests.paid(tests.fx('store_a'), 5001, '2026-03-11 05:59:59+00', 'Taza', 1)); -- 23:59:59 CDMX: dentro
select tests.paid(tests.fx('store_a'), 99999, '2026-03-11 06:00:00+00', 'Lámpara', 1); -- 00:00 del 11: fuera
select tests.paid(tests.fx('store_a'), 77777, '2026-03-10 05:59:59+00', 'Lámpara', 1); -- 23:59:59 del 9: fuera
select tests.paid(tests.fx('store_b'), 50000, '2026-03-10 18:00:00+00', 'Otra tienda', 1);
insert into public.payment_accounts (store_id, provider, status, display_name) values
  (tests.fx('store_a'), 'manual', 'active', 'Transferencia');
insert into public.payments (store_id, order_id, payment_account_id, provider, amount, currency, idempotency_key, status)
select tests.fx('store_a'), tests.fx('o3'), id, 'manual', 5001, 'MXN', 'pago-kpi-0000000001', 'succeeded'
  from public.payment_accounts where store_id = tests.fx('store_a');
insert into public.refunds (store_id, order_id, payment_id, amount, idempotency_key, status, updated_at)
select tests.fx('store_a'), tests.fx('o3'), p.id, 2000, 'reemb-kpi-000000001', 'succeeded', '2026-03-10 20:00:00+00'
  from public.payments p where p.idempotency_key = 'pago-kpi-0000000001';

select tests.login('catalog');
create temp table k as select public.dashboard_kpis(tests.fx('store_a'), '2026-03-10', '2026-03-10') as v;
select is((select (v ->> 'orders')::int from k), 3, 'pedidos pagados del día (frontera de zona horaria incluida)');
select is((select (v ->> 'gross_sales')::bigint from k), 40001::bigint, 'ventas: 10000 + 25000 + 5001');
select is((select (v ->> 'refunds')::bigint from k), 2000::bigint, 'reembolsos confirmados en el rango');
select is((select (v ->> 'net_sales')::bigint from k), 38001::bigint, 'ventas netas');
select is((select (v ->> 'average_ticket')::bigint from k), 13334::bigint, 'ticket promedio redondeado (40001 / 3)');
select is((select v -> 'top_products' -> 0 ->> 'title' from k), 'Taza', 'más vendido por unidades');
select is((select (v -> 'top_products' -> 0 ->> 'quantity')::int from k), 3, 'Taza: 2 + 1 unidades');
select is((select jsonb_array_length(v -> 'series') from k), 1, 'una entrada por día del rango');
select is((select v -> 'low_stock' from k), '[]'::jsonb, 'con inventory.read: lista de existencias bajas');
select ok((select v ->> 'top_products' from k) not like '%Otra tienda%', 'nada de la tienda B');
select is((public.dashboard_kpis(tests.fx('store_a'), '2026-03-09', '2026-03-11') ->> 'orders')::int, 5,
  'rango de 3 días: los 5 pedidos de A');
select is(jsonb_array_length(public.dashboard_kpis(tests.fx('store_a'), '2026-03-09', '2026-03-11') -> 'series'), 3,
  'serie diaria completa (incluye días sin ventas)');
select throws_ok(format($$ select public.dashboard_kpis(%L, '2025-01-01', '2026-03-10') $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'más de 366 días: rechazado');
select tests.logout();

select tests.login('mkt');
select is(public.dashboard_kpis(tests.fx('store_a'), '2026-03-10', '2026-03-10') -> 'low_stock', 'null'::jsonb,
  'sin inventory.read no se muestran existencias');
select tests.logout();
select tests.login('agent');
select throws_ok(format($$ select public.dashboard_kpis(%L, null, null) $$, tests.fx('store_a')), '42501', 'forbidden',
  'sin analytics.read no hay KPIs');
select tests.logout();
select tests.login('owner_b');
select throws_ok(format($$ select public.dashboard_kpis(%L, null, null) $$, tests.fx('store_a')), '42501', 'forbidden',
  'B no ve los KPIs de A');
select tests.logout();

select * from finish();
rollback;
