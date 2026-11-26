-- =============================================================================
-- Consola → «Mis clientes» (platform_store_overview): una fila por tienda con
-- las señales para el semáforo. Solo dueña y administración de la plataforma;
-- cada conteo es de su tienda (dos tiendas con datos distintos); sin datos
-- personales de compradores.
-- =============================================================================
begin;
select plan(23);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('padmin', 'admin@plataforma.io');
select tests.create_user('psupport', 'soporte@plataforma.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');
select tests.create_store('c', 'org_b');
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

-- Pedido de la tienda p_store creado hace p_hours horas; devuelve su id.
create function pg_temp.order_(p_store text, p_hours integer, p_ship boolean default false)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                             requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                             subtotal, discount_total, shipping_total, tax_total, total, placed_at, created_at,
                             shipping_address)
  values (tests.fx('store_' || p_store),
          (select coalesce(max(number), 5000) + 1 from public.orders where store_id = tests.fx('store_' || p_store)),
          'X', 'idem-' || gen_random_uuid(), 'secreto@cliente.io', 'Cliente Secreto', p_ship, 'MXN', true, 1600, true,
          10000, 0, 0, 0, 10000,
          now() - make_interval(hours => p_hours), now() - make_interval(hours => p_hours),
          case when p_ship then '{"line1": "Calle 1", "city": "Hermosillo", "country": "MX"}'::jsonb end)
  returning id into v;
  return v;
end $$;
create function pg_temp.pay(p_order uuid, p_days_ago integer) returns void language sql as $$
  update public.orders set paid_total = total, payment_status = 'paid', status = 'open',
                           paid_at = now() - make_interval(days => p_days_ago)
   where id = p_order
$$;

-- Tienda A: dos ventas recientes (una sin enviar desde hace 5 días), una
-- transferencia sin confirmar de hace 2 días y un pedido marcado para revisión.
select pg_temp.pay(pg_temp.order_('a', 30), 1);
select pg_temp.pay(pg_temp.order_('a', 150, true), 5);
select pg_temp.order_('a', 48);
-- (Primero se crea; un UPDATE no ve filas creadas dentro de su propia subconsulta.)
select tests.set_fx('revisar_a', pg_temp.order_('a', 2));
update public.orders set needs_attention = true where id = tests.fx('revisar_a');
-- Tienda B: una venta vieja (60 días), una transferencia de hace 1 h (aún a
-- tiempo) y un trabajo agotado.
select pg_temp.pay(pg_temp.order_('b', 1500), 60);
select pg_temp.order_('b', 1);
insert into system.jobs (store_id, type, payload, status, attempts, max_attempts, finished_at, last_error)
values (tests.fx('store_b'), 'media.process', '{}', 'dead', 5, 5, now(), 'agotado');
-- Tienda C (de la organización B): cerrada, no aparece.
update public.stores set status = 'closed', closed_at = now() where id = tests.fx('store_c');
-- Último acceso: el equipo de A entró ayer; el de B nunca.
update auth.users set last_sign_in_at = now() - interval '1 day' where id = tests.fx('owner_a');
update auth.users set last_sign_in_at = null where id = tests.fx('owner_b');

create function pg_temp.row_(p_store text) returns record language sql as $$
  select (o.*)::record from public.platform_store_overview() o where o.store_id = tests.fx('store_' || p_store)
$$;

-- Permisos.
select tests.login('owner_a');
select is(pg_temp.err('select * from public.platform_store_overview()'), 'forbidden',
          'la dueña de una tienda no ve el estado de las demás');
select tests.logout();
select tests.login('psupport');
select is(pg_temp.err('select * from public.platform_store_overview()'), 'forbidden',
          'soporte tampoco: trae ventas de todas las tiendas');
select tests.logout();
select is(pg_temp.err('select * from public.platform_store_overview()'), 'unauthenticated', 'sin sesión, nada');

select tests.login('padmin');
create temp table ov as select * from public.platform_store_overview();

select is((select count(*)::int from ov where store_id in (tests.fx('store_a'), tests.fx('store_b'))), 2,
          'una fila por tienda abierta');
select is((select count(*)::int from ov where store_id = tests.fx('store_c')), 0, 'la tienda cerrada no aparece');

-- Cada conteo es de su tienda.
select is((select paid_orders_30d from ov where store_id = tests.fx('store_a')), 2, 'A: dos ventas en 30 días');
select is((select paid_orders_30d from ov where store_id = tests.fx('store_b')), 0,
          'B: su venta de hace 60 días no cuenta en 30 días (ni se mezcla con A)');
select ok((select last_paid_at from ov where store_id = tests.fx('store_b')) < now() - interval '59 days',
   'B: la última venta conserva su fecha');
select is((select stale_pending_payments from ov where store_id = tests.fx('store_a')), 1,
          'A: transferencia sin confirmar después de 24 h');
select is((select stale_pending_payments from ov where store_id = tests.fx('store_b')), 0,
          'B: una transferencia de hace 1 h aún está a tiempo');
select is((select unshipped_paid from ov where store_id = tests.fx('store_a')), 1,
          'A: pedido pagado sin enviar después de 3 días');
select is((select orders_need_attention from ov where store_id = tests.fx('store_a')), 1,
          'A: un pedido marcado para revisión');
select is((select dead_jobs_7d from ov where store_id = tests.fx('store_b')), 1, 'B: un trabajo agotado');
select is((select dead_jobs_7d from ov where store_id = tests.fx('store_a')), 0, 'A: sin trabajos agotados');
select ok((select last_staff_sign_in_at from ov where store_id = tests.fx('store_a'))
     between now() - interval '25 hours' and now() - interval '23 hours',
   'A: último acceso del equipo, ayer');
select ok((select last_staff_sign_in_at from ov where store_id = tests.fx('store_b')) is null,
   'B: el equipo nunca ha entrado');
-- Búsqueda (en la base: PostgREST corta respuestas largas) y orden por urgencia.
select is((select array_agg(store_id) from public.platform_store_overview('tienda-a', 300)),
          array[tests.fx('store_a')], 'buscar por la dirección de la tienda trae solo esa tienda');
select is((select count(*)::int from public.platform_store_overview('Org B', 300)
            where store_id = tests.fx('store_b')), 1, 'buscar por la organización también encuentra sus tiendas');
select is((select count(*)::int from public.platform_store_overview('100%_raro', 300)), 0,
          'los comodines de la búsqueda se toman como texto');
-- Con límite 1, entre A (tres motivos rojos) y B (uno), sale primero A.
select is((select store_id from public.platform_store_overview('Tienda ', 1)), tests.fx('store_a'),
          'con límite, primero la tienda con más motivos urgentes');
select is((select total_count from public.platform_store_overview('Tienda ', 1)),
          2, 'total_count dice cuántas coinciden antes del límite (A y B; C está cerrada)');
select tests.logout();

-- Sin datos personales de compradores: solo conteos y fechas.
select ok(pg_get_function_result('public.platform_store_overview(text,integer)'::regprocedure)
            !~* '(customer|phone|address|buyer)',
          'el resultado no expone datos de compradores');
select is(public.app_schema_version(), '20261126000100', 'versión de la base');

select * from finish();
rollback;
