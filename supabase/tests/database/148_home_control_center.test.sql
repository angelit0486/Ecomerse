-- =============================================================================
-- Inicio como centro de control (Orden 1): carritos recuperables (mismos
-- criterios que el recordatorio de ADR-048) y clientes nuevos vs. recurrentes;
-- permisos por rol y aislamiento entre DOS tiendas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('catalog', 'catalog@a.io');
select tests.create_user('agent', 'agent@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'catalog', 'catalog_manager'); -- analytics.read, sin customers.read
select tests.add_store_member('a', 'agent', 'support_agent');     -- customers.read, sin analytics.read
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set timezone = 'America/Mexico_City' where id = tests.fx('store_a');

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics v_msg = message_text; return v_msg; end $$;

-- ------------------------------------------------------------ Carritos
insert into public.products (store_id, title, slug, status) values
  (tests.fx('store_a'), 'Taza roja', 'taza', 'draft'),
  (tests.fx('store_b'), 'Vela', 'vela', 'draft');
insert into public.product_variants (store_id, product_id, sku, price, option_signature)
select p.store_id, p.id, 'SKU-' || p.slug, case when p.slug = 'taza' then 15000 else 99900 end, ''
  from public.products p where p.store_id in (tests.fx('store_a'), tests.fx('store_b'));

-- Carrito con `p_qty` unidades de la presentación de su tienda (0 = sin artículos).
create function pg_temp.cart(p_store text, p_email text, p_hours_ago integer, p_qty integer default 2,
                             p_sent boolean default false)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.carts (store_id, token_hash, email, last_activity_at, recovery_sent_at, recovery_token_hash)
  values (tests.fx('store_' || p_store), sha256(convert_to(gen_random_uuid()::text, 'UTF8')), p_email,
          now() - make_interval(hours => p_hours_ago),
          case when p_sent then now() - make_interval(hours => p_hours_ago - 3) end,
          case when p_sent then sha256(convert_to(gen_random_uuid()::text, 'UTF8')) end)
  returning id into v;
  if p_qty > 0 then
    insert into public.cart_items (store_id, cart_id, variant_id, quantity)
    select tests.fx('store_' || p_store), v, pv.id, p_qty from public.product_variants pv
     where pv.store_id = tests.fx('store_' || p_store) limit 1;
  end if;
  return v;
end $$;

select pg_temp.cart('a', 'ana@cliente.io', 4);                    -- cuenta: 2 × 15000
select pg_temp.cart('a', 'beto@cliente.io', 1);                   -- muy reciente: no
select pg_temp.cart('a', 'carla@cliente.io', 72);                 -- viejo y sin recordatorio: no
select pg_temp.cart('a', 'dora@cliente.io', 72, 1, true);         -- recordatorio enviado sin usar: 1 × 15000
select pg_temp.cart('a', 'dani@cliente.io', 4, 0);                -- sin artículos: no
select pg_temp.cart('a', null, 4);                                -- sin correo: no
select pg_temp.cart('a', 'eva@cliente.io', 4);                    -- se dio de baja: no
insert into public.cart_recovery_optouts (store_id, email_hash)
values (tests.fx('store_a'), app.email_hash('eva@cliente.io'));
select tests.set_fx('c_paid', pg_temp.cart('a', 'fer@cliente.io', 4)); -- ya tiene pedido: no
select tests.set_fx('o_cart', tests.order(tests.fx('store_a')));
set local session_replication_role = replica;
update public.orders set cart_id = tests.fx('c_paid') where id = tests.fx('o_cart');
set local session_replication_role = origin;
select pg_temp.cart('b', 'gil@cliente.io', 4);                    -- otra tienda: nunca en A

select tests.login('catalog');
create temp table rc as select public.dashboard_recoverable_carts(tests.fx('store_a')) as v;
select is((select (v ->> 'count')::int from rc), 2, 'carritos recuperables: los mismos criterios del recordatorio');
select is((select (v ->> 'amount')::bigint from rc), 45000::bigint, 'monto estimado con el precio actual (2×15000 + 15000)');
select is((select (v ->> 'enabled')::boolean from rc), false, 'recordatorio apagado (como nace la tienda)');
select tests.logout();

insert into public.store_notification_settings (store_id, cart_recovery) values (tests.fx('store_a'), true)
on conflict (store_id) do update set cart_recovery = true;
select tests.login('catalog');
select is((public.dashboard_recoverable_carts(tests.fx('store_a')) ->> 'enabled')::boolean, true,
          'con el recordatorio encendido lo dice');
select tests.logout();

select tests.login('owner_b');
select is((public.dashboard_recoverable_carts(tests.fx('store_b')) ->> 'count')::int, 1, 'B ve solo su carrito');
select is((public.dashboard_recoverable_carts(tests.fx('store_b')) ->> 'amount')::bigint, 199800::bigint,
          'B: su monto, sin nada de A');
select is(pg_temp.err(format('select public.dashboard_recoverable_carts(%L)', tests.fx('store_a'))), 'forbidden',
          'el dueño de B no lee los carritos de A');
select tests.logout();

select tests.login('agent');
select is(pg_temp.err(format('select public.dashboard_recoverable_carts(%L)', tests.fx('store_a'))), 'forbidden',
          'sin analytics.read no hay carritos');
select tests.logout();

-- ------------------------------------------------------------ Clientes
create function pg_temp.customer(p_store text, p_email text) returns uuid language sql as $$
  insert into public.customers (store_id, email) values (tests.fx('store_' || p_store), p_email) returning id $$;
create function pg_temp.paid(p_store text, p_customer uuid, p_at timestamptz) returns uuid language plpgsql as $$
declare v uuid := tests.order(tests.fx('store_' || p_store));
begin
  set local session_replication_role = replica;
  update public.orders set customer_id = p_customer, subtotal = 1000, total = 1000, paid_total = case when p_at is null then 0 else 1000 end, paid_at = p_at,
                           status = case when p_at is null then 'pending_payment' else 'open' end,
                           payment_status = case when p_at is null then 'pending' else 'paid' end
   where id = v;
  set local session_replication_role = origin;
  return v;
end $$;

select tests.set_fx('cu_ret', pg_temp.customer('a', 'ret@cliente.io'));
select tests.set_fx('cu_new', pg_temp.customer('a', 'new@cliente.io'));
select tests.set_fx('cu_edge', pg_temp.customer('a', 'edge@cliente.io'));
select tests.set_fx('cu_later', pg_temp.customer('a', 'later@cliente.io'));
select tests.set_fx('cu_unpaid', pg_temp.customer('a', 'unpaid@cliente.io'));
select tests.set_fx('cu_b', pg_temp.customer('b', 'b@cliente.io'));
-- Periodo: 2026-03-10 en CDMX (UTC−6) = [06:00Z del 10, 06:00Z del 11).
select pg_temp.paid('a', tests.fx('cu_ret'), '2026-03-01 18:00:00+00');   -- antes
select pg_temp.paid('a', tests.fx('cu_ret'), '2026-03-10 18:00:00+00');   -- en el periodo → recurrente
select pg_temp.paid('a', tests.fx('cu_new'), '2026-03-10 07:00:00+00');   -- primer pedido en el periodo
select pg_temp.paid('a', tests.fx('cu_new'), '2026-03-10 20:00:00+00');   -- otro: cuenta una sola vez
select pg_temp.paid('a', tests.fx('cu_edge'), '2026-03-10 05:59:59+00');  -- 23:59:59 del 9 en CDMX: antes
select pg_temp.paid('a', tests.fx('cu_edge'), '2026-03-11 05:59:59+00');  -- 23:59:59 del 10: en el periodo
select pg_temp.paid('a', tests.fx('cu_later'), '2026-03-12 18:00:00+00'); -- después: no cuenta
select pg_temp.paid('a', tests.fx('cu_unpaid'), null);                    -- sin pagar: no cuenta
select pg_temp.paid('b', tests.fx('cu_b'), '2026-03-10 18:00:00+00');     -- otra tienda

select tests.login('owner');
create temp table mix as select public.dashboard_customer_mix(tests.fx('store_a'), '2026-03-10', '2026-03-10') as v;
select is((select (v ->> 'new')::int from mix), 1, 'nuevos: su primer pedido pagado cae en el periodo');
select is((select (v ->> 'returning')::int from mix), 2,
          'recurrentes: ya tenían un pedido pagado antes (frontera de zona horaria incluida)');
select is((select v ->> 'from' from mix), '2026-03-10', 'devuelve el rango calculado');
select is((public.dashboard_customer_mix(tests.fx('store_a'), '2026-03-01', '2026-03-31') ->> 'new')::int, 4,
          'en todo marzo los 4 clientes con pedido pagado son nuevos');
select is((public.dashboard_customer_mix(tests.fx('store_a'), '2026-03-01', '2026-03-31') ->> 'returning')::int, 0,
          'y ninguno recurrente');
select is((public.dashboard_customer_mix(tests.fx('store_a'), '2026-04-01', '2026-04-30') ->> 'new')::int, 0,
          'periodo sin pedidos: cero nuevos (dato real, no un fallo)');
select throws_ok(format($$ select public.dashboard_customer_mix(%L, '2025-01-01', '2026-03-10') $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'más de 366 días: rechazado, como dashboard_kpis');
select tests.logout();

select tests.login('owner_b');
select is((public.dashboard_customer_mix(tests.fx('store_b'), '2026-03-10', '2026-03-10') ->> 'new')::int, 1,
          'B: solo su cliente');
select is((public.dashboard_customer_mix(tests.fx('store_b'), '2026-03-10', '2026-03-10') ->> 'returning')::int, 0,
          'B: ningún recurrente de A');
select is(pg_temp.err(format('select public.dashboard_customer_mix(%L, null, null)', tests.fx('store_a'))), 'forbidden',
          'el dueño de B no lee los clientes de A');
select tests.logout();

select tests.login('catalog');
select is(pg_temp.err(format('select public.dashboard_customer_mix(%L, null, null)', tests.fx('store_a'))), 'forbidden',
          'con analytics.read pero sin customers.read: nada');
select tests.logout();
select tests.login('agent');
select is(pg_temp.err(format('select public.dashboard_customer_mix(%L, null, null)', tests.fx('store_a'))), 'forbidden',
          'con customers.read pero sin analytics.read: nada');
select tests.logout();

-- ------------------------------------------------------------ Sin sesión / grants
select ok(not has_function_privilege('anon', 'public.dashboard_customer_mix(uuid, date, date)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.dashboard_recoverable_carts(uuid)', 'EXECUTE'),
          'anon no ejecuta ninguna de las dos');

select * from finish();
rollback;
