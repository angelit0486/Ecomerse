-- =============================================================================
-- Índices de escalabilidad del panel (migración 20261104000500): existen y las
-- consultas que aceleran (avisos, listas, indicadores, búsqueda por número)
-- siguen viendo solo los pedidos de la propia tienda.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select has_index('public', 'orders', 'orders_store_status_fulfillment_idx', 'índice de estado y surtido');
select has_index('public', 'orders', 'orders_store_attention_idx', 'índice de «requieren atención»');
select has_index('public', 'orders', 'orders_store_paid_idx', 'índice de fecha de pago');
select has_index('public', 'orders', 'orders_number_trgm_idx', 'índice de búsqueda por número');

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

-- A: 1 por surtir (pagado), 1 en atención. B: 3 por surtir pagados, 2 en atención.
insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                           requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                           subtotal, total, status, payment_status, fulfillment_status, placed_at, paid_at, paid_total,
                           needs_attention)
select s, n, '#' || (5000 + n), 'idx-' || s || '-' || n, 'c@example.test', 'C', false, 'MXN', true, 0, false,
       10000, 10000, 'open', 'paid', 'unfulfilled', now() - make_interval(hours => n), now() - make_interval(hours => n),
       10000, attention
  from (values (tests.fx('store_a'), 1, false), (tests.fx('store_a'), 2, true),
               (tests.fx('store_b'), 1, false), (tests.fx('store_b'), 2, false), (tests.fx('store_b'), 3, false),
               (tests.fx('store_b'), 4, true), (tests.fx('store_b'), 5, true)) v(s, n, attention);
update public.orders set fulfillment_status = 'fulfilled' where store_id = tests.fx('store_a') and number = 2;
update public.orders set fulfillment_status = 'fulfilled' where store_id = tests.fx('store_b') and number in (4, 5);

select tests.login('owner_a');
select is((select count(*)::int from public.orders where store_id = tests.fx('store_b')), 0,
          'A no ve pedidos de B');
select is((select count(*)::int from public.orders where store_id = tests.fx('store_a') and status = 'open'
             and fulfillment_status in ('unfulfilled', 'partially_fulfilled')), 1, 'A: uno por surtir');
select is((select count(*)::int from public.orders where store_id = tests.fx('store_a') and needs_attention), 1,
          'A: uno en atención');
select is((public.dashboard_kpis(tests.fx('store_a'), (current_date - 1), current_date) ->> 'orders')::int, 2,
          'los indicadores de A cuentan solo sus 2 pedidos pagados');
select is((select count(*)::int from public.orders where store_id = tests.fx('store_a')
             and display_number ilike '%500%'), 2, 'la búsqueda por número de A no trae los de B');
select tests.logout();

select * from finish();
rollback;
