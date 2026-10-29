-- =============================================================================
-- Misión vendible F4: Consola → Métricas. Solo dueña y administración de la
-- plataforma; ventas = cobrado − reembolsado de pedidos pagados en la ventana.
-- =============================================================================
begin;
select plan(13);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('padmin', 'admin@plataforma.io');
select tests.create_user('psupport', 'soporte@plataforma.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');
select tests.make_platform_staff('padmin', 'platform_admin');
select tests.make_platform_staff('psupport', 'platform_support');

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
-- Pedido cobrado hace p_days_ago días por p_paid centavos, con p_refunded reembolsado.
create function pg_temp.paid_order(p_store text, p_paid bigint, p_refunded bigint, p_days_ago integer)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                             requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                             subtotal, discount_total, shipping_total, tax_total, total)
  values (tests.fx('store_' || p_store),
          (select coalesce(max(number), 5000) + 1 from public.orders where store_id = tests.fx('store_' || p_store)),
          'X', 'idem-' || gen_random_uuid(), 'secreto@cliente.io', 'Cliente Secreto', false, 'MXN', true, 1600, true,
          p_paid, 0, 0, 0, p_paid)
  returning id into v;
  -- Como en la realidad: primero se cobra y después se reembolsa (transiciones válidas).
  update public.orders
     set paid_total = p_paid, payment_status = 'paid', paid_at = now() - make_interval(days => p_days_ago)
   where id = v;
  if p_refunded > 0 then
    update public.orders set refunded_total = p_refunded, payment_status = 'partially_refunded' where id = v;
  end if;
  return v;
end $$;

select pg_temp.paid_order('a', 50000, 0, 1);
select pg_temp.paid_order('a', 30000, 10000, 2);
select pg_temp.paid_order('b', 20000, 0, 3);
select pg_temp.paid_order('b', 99900, 0, 60);  -- fuera de la ventana de 30 días
-- Un pedido sin pagar no cuenta.
insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                           requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                           subtotal, discount_total, shipping_total, tax_total, total)
values (tests.fx('store_a'), 9999, 'X', 'idem-' || gen_random_uuid(), 'c@a.io', 'C', false, 'MXN', true, 1600, true,
        7000, 0, 0, 0, 7000);

create function pg_temp.m(p_days integer default 30) returns jsonb language sql as $$
  select public.platform_metrics(p_days)
$$;

-- Permisos.
select tests.login('owner_a');
select is(pg_temp.err('select public.platform_metrics(30)'), 'forbidden',
          'la dueña de una tienda no ve las métricas de la plataforma');
select tests.logout();
select tests.login('psupport');
select is(pg_temp.err('select public.platform_metrics(30)'), 'forbidden',
          'soporte tampoco: son ventas de todas las tiendas');
select tests.logout();
select is(pg_temp.err('select public.platform_metrics(30)'), 'unauthenticated', 'sin sesión, nada');

select tests.login('padmin');
select is(pg_temp.err('select public.platform_metrics(15)'), 'validation_failed/days',
          'solo ventanas de 7, 30, 90 o 365 días');

select is((pg_temp.m() -> 'sales' -> 0 ->> 'orders')::int, 3, 'cuenta los 3 pedidos cobrados en 30 días');
select is((pg_temp.m() -> 'sales' -> 0 ->> 'net')::bigint, 90000::bigint,
          'ventas netas = 500 + 300 − 100 + 200 pesos (en centavos)');
select is((pg_temp.m() -> 'sales' -> 0 ->> 'refunded')::bigint, 10000::bigint, 'y lo reembolsado aparte');
select is((pg_temp.m(90) -> 'sales' -> 0 ->> 'net')::bigint, 189900::bigint, 'a 90 días entra el pedido de hace 60');
select is(pg_temp.m() -> 'top_stores' -> 0 ->> 'handle', 'tienda-a',
          'la tienda con más ventas va primero');
select is((pg_temp.m() -> 'stores' ->> 'with_sales')::int, 2, 'dos tiendas vendieron en la ventana');
select ok((pg_temp.m() -> 'organizations' ->> 'total')::int >= 2, 'cuenta las organizaciones');
select ok(pg_temp.m() -> 'subscriptions' ? 'active', 'suscripciones por estado');
select ok(pg_temp.m()::text !~ 'secreto@cliente\.io|Cliente Secreto', 'ningún dato de clientes sale en las métricas');
select tests.logout();

select * from finish();
rollback;
