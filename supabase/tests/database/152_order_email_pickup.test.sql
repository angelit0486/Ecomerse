-- =============================================================================
-- Retiro en tienda en los correos del pedido (20261117000400): system.order_notification
-- dice el tipo de la forma de envío copiada al pedido y, si es «Recoger en tienda»,
-- la dirección y el horario del contacto PUBLICADO de la tienda. Sin dirección no
-- hay nada (aunque haya horario); un envío normal no cambia. Mismos permisos.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

-- Pedido con su snapshot de envío (como lo guarda storefront.place_order: la
-- opción elegida de app.calculate_cart sin 'status', con 'type').
create function pg_temp.order_with(p_store uuid, p_number integer, p_snapshot jsonb) returns uuid
language sql as $$
  insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                             requires_shipping, shipping_address, shipping_snapshot, currency, prices_include_tax,
                             tax_rate_bps, tax_applies_to_shipping, subtotal, total)
  values (p_store, p_number, '#' || p_number, 'idem-' || gen_random_uuid(), 'ana@cliente.test', 'Ana', true,
          '{"recipient_name":"Ana","line1":"Calle del comprador 9","city":"Mazatlán","country":"MX"}',
          p_snapshot, 'MXN', true, 0, false, 10000, 10000)
  returning id
$$;

select tests.set_fx('pickup_a', pg_temp.order_with(tests.fx('store_a'), 8001,
  '{"name":"Recoger en tienda","type":"pickup","price":0,"free_over_subtotal":null,"est_days_min":null,"est_days_max":null}'));
select tests.set_fx('flat_a', pg_temp.order_with(tests.fx('store_a'), 8002,
  '{"name":"Estándar","type":"flat","price":9900,"free_over_subtotal":null,"est_days_min":2,"est_days_max":5}'));
select tests.set_fx('pickup_b', pg_temp.order_with(tests.fx('store_b'), 8001,
  '{"name":"Recoger en tienda","type":"pickup","price":0,"free_over_subtotal":null,"est_days_min":null,"est_days_max":null}'));
select tests.set_fx('none_a', tests.order(tests.fx('store_a')));

-- La tienda A declaró dirección (dos líneas) y horario en su tema publicado.
update public.store_themes
   set settings = '{"contact":{"address":"Av. Juárez 10\nCentro, Puebla","hours":"L-V 9 a 18"}}'
 where store_id = tests.fx('store_a');

-- ============================================================================ Retiro con dirección
select is(system.order_notification(tests.fx('pickup_a')) #>> '{order,shipping_type}', 'pickup',
          'el tipo de la forma de envío sale del snapshot del pedido');
select is(system.order_notification(tests.fx('pickup_a')) #> '{order,pickup}',
          jsonb_build_object('address', E'Av. Juárez 10\nCentro, Puebla', 'hours', 'L-V 9 a 18'),
          'retiro: dirección (multilínea) y horario del contacto de la tienda');

update public.store_themes set settings = '{"contact":{"address":"Av. Juárez 10"}}'
 where store_id = tests.fx('store_a');
select is(system.order_notification(tests.fx('pickup_a')) #> '{order,pickup}',
          '{"address":"Av. Juárez 10","hours":null}'::jsonb, 'sin horario: solo la dirección');

-- ============================================================================ Retiro sin dirección
update public.store_themes set settings = '{"contact":{"hours":"L-V 9 a 18","whatsapp":"+525512345678"}}'
 where store_id = tests.fx('store_a');
select is(system.order_notification(tests.fx('pickup_a')) #> '{order,pickup}', 'null'::jsonb,
          'sin dirección no se dice nada, aunque haya horario');
select is(system.order_notification(tests.fx('pickup_a')) #>> '{order,shipping_type}', 'pickup',
          'pero sigue diciendo que es retiro (para no prometer un envío)');
select is(system.order_notification(tests.fx('pickup_b')) #> '{order,pickup}', 'null'::jsonb,
          'tienda sin contacto: pickup null');

-- Solo el tema publicado: una dirección en el borrador no sale en el correo.
update public.store_themes set draft_settings = '{"contact":{"address":"Borrador 1"}}',
                               draft_home_sections = coalesce(home_sections, '[]'::jsonb)
 where store_id = tests.fx('store_b');
select is(system.order_notification(tests.fx('pickup_b')) #> '{order,pickup}', 'null'::jsonb,
          'el borrador del tema no cuenta');

-- La dirección es la de SU tienda: la de A nunca sale en un pedido de B.
update public.store_themes set settings = '{"contact":{"address":"Av. Juárez 10"}}'
 where store_id = tests.fx('store_a');
select is(system.order_notification(tests.fx('pickup_b')) #> '{order,pickup}', 'null'::jsonb,
          'la dirección de otra tienda no se cuela');

-- ============================================================================ Envío normal sin cambios
select is(system.order_notification(tests.fx('flat_a')) #>> '{order,shipping_type}', 'flat', 'envío normal: su tipo');
select is(system.order_notification(tests.fx('flat_a')) #> '{order,pickup}', 'null'::jsonb,
          'envío normal: sin retiro aunque la tienda tenga dirección');
select is(system.order_notification(tests.fx('flat_a')) #> '{order,estimated_days}', '{"min":2,"max":5}'::jsonb,
          'envío normal: la entrega estimada sigue igual');
select is(system.order_notification(tests.fx('flat_a')) #>> '{order,shipping_address,line1}', 'Calle del comprador 9',
          'envío normal: la dirección del comprador sigue igual');
select ok(system.order_notification(tests.fx('none_a')) -> 'order' -> 'shipping_type' = 'null'::jsonb
          and system.order_notification(tests.fx('none_a')) -> 'order' -> 'pickup' = 'null'::jsonb,
          'pedido sin envío: ni tipo ni retiro');

-- ============================================================================ Permisos (create or replace los conserva)
select ok(has_function_privilege('system_worker', 'system.order_notification(uuid,uuid,uuid)', 'execute'),
          'el worker la ejecuta');
select ok(not has_function_privilege('anon', 'system.order_notification(uuid,uuid,uuid)', 'execute')
          and not has_function_privilege('authenticated', 'system.order_notification(uuid,uuid,uuid)', 'execute')
          and not has_function_privilege('storefront_gateway', 'system.order_notification(uuid,uuid,uuid)', 'execute'),
          'anon, authenticated y la tienda no la ejecutan');
select is((select prosecdef::text || proconfig::text from pg_proc
            where oid = 'system.order_notification(uuid,uuid,uuid)'::regprocedure),
          'true{"search_path=\"\""}', 'SECURITY DEFINER con search_path vacío');

select * from finish();
rollback;
