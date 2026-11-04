-- Tienda grande (200 000 pedidos en ~2 años) y 50 tiendas de ruido (2 000 cada una).
select tests.create_user('owner', 'owner@big.io');
select tests.create_tenant('big', 'owner');
do $$
declare i int;
begin
  for i in 1..50 loop
    perform tests.create_user('n' || i, 'n' || i || '@noise.io');
    perform tests.create_tenant('n' || i, 'n' || i);
  end loop;
end $$;

create temp table gen as
select s.id as store_id, g as n,
       now() - make_interval(secs => g * (case when s.id = tests.fx('store_big') then 315 else 31536 end)) as placed_at,
       case when g <= 30 then 'pending_payment'           -- recientes sin pagar
            when g <= 130 then 'open'                      -- recientes pagados por surtir
            when (g % 20) = 0 then 'cancelled'
            when g <= 400 then 'open'                      -- enviados, no entregados
            else 'completed' end as status
  from public.stores s
  cross join lateral generate_series(1, case when s.id = tests.fx('store_big') then 200000 else 2000 end) g;

insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                           requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                           subtotal, total, status, payment_status, fulfillment_status, placed_at, paid_at,
                           paid_total, cancelled_at, cancel_reason, needs_attention)
select store_id, n, '#' || (1000 + n), 'bench-' || store_id || '-' || n, 'c' || n || '@example.test', 'Cliente ' || n,
       false, 'MXN', true, 1600, false, 34800, 34800, status,
       case status when 'pending_payment' then 'pending' when 'cancelled' then 'expired' else 'paid' end,
       case when status = 'open' and n <= 130 then 'unfulfilled' when status in ('open', 'completed') then 'fulfilled'
            else 'unfulfilled' end,
       placed_at,
       case when status in ('open', 'completed') then placed_at + interval '3 minutes' end,
       case when status in ('open', 'completed') then 34800 else 0 end,
       case when status = 'cancelled' then placed_at + interval '1 day' end,
       case when status = 'cancelled' then 'payment_expired' end,
       (n % 4000) = 7
  from gen;
-- Como en producción tras el autovacuum: mapa de visibilidad al día (si no,
-- Postgres evita las lecturas solo-índice y el rango de 365 días sale ~4× más lento).
vacuum analyze;
select count(*) as pedidos, count(*) filter (where store_id = tests.fx('store_big')) as tienda_grande from public.orders;
