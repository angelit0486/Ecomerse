-- Lo que pide el panel de la tienda grande, como la dueña (RLS activo).
\timing on
begin;
select tests.login('owner');
select current_user, (select count(*) from public.orders) as visibles;
select '== lista: todos' as q;
select count(*) from (select id from public.orders where store_id = tests.fx('store_big') order by placed_at desc, id desc limit 51) x;
select '== lista: por surtir (más antiguo primero)' as q;
select count(*) from (select id from public.orders where store_id = tests.fx('store_big') and status = 'open' and fulfillment_status in ('unfulfilled','partially_fulfilled') order by placed_at asc, id asc limit 51) x;
select '== lista: pagados' as q;
select count(*) from (select id from public.orders where store_id = tests.fx('store_big') and status = 'open' order by placed_at desc, id desc limit 51) x;
select '== lista: requieren atención' as q;
select count(*) from (select id from public.orders where store_id = tests.fx('store_big') and needs_attention order by placed_at desc, id desc limit 51) x;
select '== lista: cancelados' as q;
select count(*) from (select id from public.orders where store_id = tests.fx('store_big') and status = 'cancelled' order by placed_at desc, id desc limit 51) x;
select '== avisos: por surtir (conteo)' as q;
select count(*) from public.orders where store_id = tests.fx('store_big') and status = 'open' and fulfillment_status in ('unfulfilled','partially_fulfilled');
select '== avisos: requieren atención (conteo)' as q;
select count(*) from public.orders where store_id = tests.fx('store_big') and needs_attention;
select '== inicio: indicadores de 30 días' as q;
select (public.dashboard_kpis(tests.fx('store_big'), null, null) ->> 'orders') as pedidos_30_dias;
select '== inicio: indicadores de 365 días' as q;
select (public.dashboard_kpis(tests.fx('store_big'), (current_date - 364), current_date) ->> 'orders') as pedidos_365;
rollback;
