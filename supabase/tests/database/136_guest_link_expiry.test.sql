-- =============================================================================
-- ADR-062 A: el enlace del pedido de invitado vale 180 días desde la última
-- actividad; vencido, se pide uno nuevo (solo al correo del pedido, uno por
-- hora) y el anterior deja de servir. Una tienda nunca ve pedidos de otra.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

-- Pedido de A con el token del checkout (generación 0).
select tests.set_fx('o_a', tests.order(tests.fx('store_a')));
set local session_replication_role = replica;
update public.orders set guest_access_token_hash = sha256('tok-0'::bytea) where id = tests.fx('o_a');
set local session_replication_role = origin;

-- ------------------------------------------------------------------ 1. Vigente
select is(app.guest_order_access(tests.fx('store_a'), tests.fx('o_a'), sha256('tok-0'::bytea)), 'ok',
  'un pedido reciente con su token: vigente');
select is(app.guest_order_access(tests.fx('store_a'), tests.fx('o_a'), sha256('otro'::bytea)), null,
  'otro token: no coincide (sin pistas)');
select is(app.guest_order_access(tests.fx('store_a'), tests.fx('o_a'), null), null, 'sin token: nada');
select is(app.guest_order_access(tests.fx('store_b'), tests.fx('o_a'), sha256('tok-0'::bytea)), null,
  'aislamiento: el pedido de A no existe para la tienda B, ni con su token');
select ok(storefront.get_order_for_guest(tests.fx('store_a'), tests.fx('o_a'), sha256('tok-0'::bytea)) is not null,
  'vigente: la página del pedido lo muestra');
select is(storefront.guest_link_renewal(tests.fx('store_a'), tests.fx('o_a'), sha256('tok-0'::bytea)), null,
  'vigente: no hay nada que renovar');
select is(storefront.renew_guest_link(tests.fx('store_a'), tests.fx('o_a'), sha256('tok-0'::bytea),
                                      sha256('tok-1'::bytea), 1), 'ok',
  'vigente: renovar no cambia nada');

-- ------------------------------------------------------------------ 2. Vencido
set local session_replication_role = replica;
update public.orders set created_at = now() - interval '200 days', updated_at = now() - interval '181 days'
 where id = tests.fx('o_a');
set local session_replication_role = origin;
select is(app.guest_order_access(tests.fx('store_a'), tests.fx('o_a'), sha256('tok-0'::bytea)), 'expired',
  '181 días sin actividad: vencido');
select is(storefront.get_order_for_guest(tests.fx('store_a'), tests.fx('o_a'), sha256('tok-0'::bytea)), null,
  'vencido: la página ya no muestra el pedido');
select is(jsonb_array_length(coalesce(storefront.order_reviewables(tests.fx('store_a'), tests.fx('o_a'),
                                                                   sha256('tok-0'::bytea)), '[]'::jsonb)), 0,
  'vencido: tampoco se puede opinar');
select is(storefront.guest_link_renewal(tests.fx('store_a'), tests.fx('o_a'), sha256('tok-0'::bytea)) ->> 'generation',
  '1', 'vencido: la siguiente generación es la 1');
select is(storefront.guest_link_renewal(tests.fx('store_a'), tests.fx('o_a'), sha256('otro'::bytea)), null,
  'con otro token no se obtiene la clave');
select is(storefront.guest_link_renewal(tests.fx('store_b'), tests.fx('o_a'), sha256('tok-0'::bytea)), null,
  'aislamiento: la tienda B no obtiene la clave del pedido de A');

-- ------------------------------------------------------------------ 3. Renovar
select throws_ok(format($$ select storefront.renew_guest_link(%L, %L, sha256('tok-0'::bytea), sha256('tok-x'::bytea), 5) $$,
                        tests.fx('store_a'), tests.fx('o_a')),
  'P0001', 'conflict', 'una generación que no es la siguiente se rechaza');
select throws_ok(format($$ select storefront.renew_guest_link(%L, %L, sha256('tok-0'::bytea), '\x00'::bytea, 1) $$,
                        tests.fx('store_a'), tests.fx('o_a')),
  'P0001', 'validation_failed', 'un hash que no es sha256 se rechaza');
select is(storefront.renew_guest_link(tests.fx('store_b'), tests.fx('o_a'), sha256('tok-0'::bytea),
                                      sha256('tok-1'::bytea), 1), null,
  'aislamiento: la tienda B no renueva el enlace de A');
select is(storefront.renew_guest_link(tests.fx('store_a'), tests.fx('o_a'), sha256('tok-0'::bytea),
                                      sha256('tok-1'::bytea), 1), 'sent', 'vencido: se renueva');
select is(app.guest_order_access(tests.fx('store_a'), tests.fx('o_a'), sha256('tok-1'::bytea)), 'ok',
  'el enlace nuevo está vigente (la renovación es actividad)');
select is(app.guest_order_access(tests.fx('store_a'), tests.fx('o_a'), sha256('tok-0'::bytea)), 'replaced',
  'el anterior queda reemplazado: ya no muestra el pedido');
select is(storefront.get_order_for_guest(tests.fx('store_a'), tests.fx('o_a'), sha256('tok-0'::bytea)), null,
  'reemplazado: la página no muestra el pedido');
select is((select count(*)::int from system.jobs j
            where j.type = 'order.link_renewed' and j.payload ->> 'order_id' = tests.fx('o_a')::text
              and j.payload ->> 'generation' = '1'), 1, 'se encola el correo con el enlace nuevo');
select is((select count(*)::int from audit.audit_logs l
            where l.action = 'order.guest_link_renewed' and l.entity_id = tests.fx('o_a')), 1,
  'y queda en la auditoría');
select is(storefront.renew_guest_link(tests.fx('store_a'), tests.fx('o_a'), sha256('tok-0'::bytea),
                                      sha256('tok-2'::bytea), 2), 'too_soon',
  'otro enlace nuevo en la misma hora: espera');
select is(system.order_notification(tests.fx('o_a')) #>> '{order,guest_link_generation}', '1',
  'los correos del pedido usan la generación vigente');

-- ------------------------------------------------- 4. Quién ve la tabla y las funciones
select tests.login('owner_b');
select is((select count(*)::int from public.order_guest_links), 0, 'la dueña de B no ve los enlaces de A');
select tests.logout();
select tests.login('owner_a');
select is((select count(*)::int from public.order_guest_links), 1, 'la dueña de A ve el de su pedido (orders.read)');
select tests.logout();
select ok(has_function_privilege('storefront_gateway', 'storefront.renew_guest_link(uuid, uuid, bytea, bytea, integer)', 'execute')
          and has_function_privilege('storefront_gateway', 'storefront.guest_link_state(uuid, uuid, bytea)', 'execute')
          and not has_function_privilege('anon', 'storefront.renew_guest_link(uuid, uuid, bytea, bytea, integer)', 'execute')
          and not has_function_privilege('authenticated', 'app.guest_order_access(uuid, uuid, bytea)', 'execute')
          and not has_function_privilege('storefront_gateway', 'app.order_last_activity(uuid, uuid)', 'execute'),
  'solo la puerta de la tienda ejecuta las funciones nuevas; las de app no se exponen');

select * from finish();
rollback;
