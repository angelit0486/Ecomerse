-- =============================================================================
-- Fase 7 · Notificaciones de pedidos (F7-T04): destinatarios de la tienda y
-- datos del pedido para las plantillas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set contact_email = 'hola@a.io' where id = tests.fx('store_a');
select tests.set_fx('order_a', tests.order(tests.fx('store_a')));

-- ============================================================================ Permisos
select tests.login('viewer');
select throws_ok(format($$ select public.notifications_update(%L, '{x@a.io}', true, true) $$, tests.fx('store_a')),
  '42501', 'forbidden', 'viewer no configura notificaciones');
select is_empty($$ select 1 from public.store_notification_settings $$, 'viewer no lee la configuración');
select tests.logout();
select tests.login('owner_b');
select throws_ok(format($$ select public.notifications_update(%L, '{x@b.io}', true, true) $$, tests.fx('store_a')),
  '42501', 'forbidden', 'B no configura las notificaciones de A');
select tests.logout();

-- ============================================================================ Validación
select tests.login('owner');
select throws_ok(format($$ select public.notifications_update(%L, '{no-es-email}', true, true) $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'email inválido: rechazado');
select throws_ok(format($$ select public.notifications_update(%L, '{a@a.io,b@a.io,c@a.io,d@a.io,e@a.io,f@a.io}', true, true) $$,
  tests.fx('store_a')), 'P0001', 'validation_failed', 'más de 5 destinatarios: rechazado');
select throws_ok(format($$ select public.notifications_update(%L, '{"Ana <a@a.io>"}', true, true) $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'sin nombres ni ángulos (cabeceras)');
select lives_ok(format($$ select public.notifications_update(%L, '{" Ventas@A.io ",ventas@a.io,"",bodega@a.io}', true, false) $$,
  tests.fx('store_a')), 'normaliza, deduplica y descarta vacíos');
select is((select staff_emails::text || '/' || notify_paid from public.store_notification_settings
            where store_id = tests.fx('store_a')), '{bodega@a.io,ventas@a.io}/false', 'guardado normalizado');
select throws_ok($$ update public.store_notification_settings set notify_paid = true $$, '42501', null,
  'sin UPDATE directo: solo la RPC');
select tests.logout();

-- ============================================================================ Datos para la plantilla
select ok(not has_function_privilege('storefront_gateway', 'system.order_notification(uuid,uuid,uuid)', 'execute')
       and not has_function_privilege('authenticated', 'system.order_notification(uuid,uuid,uuid)', 'execute'),
  'solo el worker lee datos de notificación');
select is((system.order_notification(tests.fx('order_a')) -> 'staff' -> 'emails'), '["bodega@a.io", "ventas@a.io"]'::jsonb,
  'destinatarios configurados');
select is((system.order_notification(tests.fx('order_a')) -> 'staff' ->> 'notify_paid')::boolean, false, 'preferencias');
delete from public.store_notification_settings where store_id = tests.fx('store_a');
select is((system.order_notification(tests.fx('order_a')) -> 'staff' -> 'emails'), '["hola@a.io"]'::jsonb,
  'sin configuración: el email de contacto de la tienda');
select is(system.order_notification(gen_random_uuid()), null, 'pedido inexistente: null');

-- Misión vendible F1.5: la dirección completa llega a la plantilla, sin teléfono.
select is(system.order_notification(tests.fx('order_a')) -> 'order' -> 'shipping_address', 'null'::jsonb,
          'sin envío: sin dirección');
create function pg_temp.ship(p_order uuid) returns void language plpgsql as $$
begin
  -- Pedido de prueba con envío (fuera de las funciones de checkout, solo para leerlo).
  alter table public.orders disable trigger user;
  update public.orders set requires_shipping = true,
         shipping_address = '{"recipient_name":"Ana López","line1":"Av. Juárez 10","line2":"Col. Centro",
                              "postal_code":"82000","city":"Mazatlán","region":"Sinaloa","country":"MX",
                              "phone":"6690000000"}'
   where id = p_order;
  alter table public.orders enable trigger user;
end $$;
select pg_temp.ship(tests.fx('order_a'));
select is(system.order_notification(tests.fx('order_a')) -> 'order' -> 'shipping_address',
          '{"recipient_name":"Ana López","line1":"Av. Juárez 10","line2":"Col. Centro","postal_code":"82000",
            "city":"Mazatlán","region":"Sinaloa","country":"MX"}'::jsonb,
          'con envío: dirección completa y nunca el teléfono');

select * from finish();
rollback;
