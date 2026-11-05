-- =============================================================================
-- Paso 20: textos de la tienda en los correos del comprador. Permisos,
-- validación, volver al texto de siempre, aislamiento entre tiendas y el
-- interruptor (apagado, el worker no recibe nada).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_user('viewer_a', 'viewer@a.io');
select tests.create_tenant('a', 'owner_a');
select tests.add_store_member('a', 'viewer_a', 'viewer');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

-- 1-3. Permisos.
select is(tests.sqlstate_as('anon', format($$ select public.email_texts_save(%L, 'order_shipped', 'x', null) $$,
  tests.fx('store_a'))), '42501', 'anon no guarda textos');
select tests.login('viewer_a');
select throws_ok(format($$ select public.email_texts_save(%L, 'order_shipped', 'x', null) $$, tests.fx('store_a')),
  '42501', 'forbidden', 'quien solo ve la tienda no los cambia');
select tests.logout();
select tests.login('owner_b');
select throws_ok(format($$ select public.email_texts_save(%L, 'order_shipped', 'x', null) $$, tests.fx('store_a')),
  '42501', 'forbidden', 'la dueña de B no cambia los de A');
select tests.logout();

-- 4-8. Validación y guardado.
select tests.login('owner_a');
select throws_ok(format($$ select public.email_texts_save(%L, 'staff_order_new', 'x', null) $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'solo los correos del comprador');
select throws_ok(format($$ select public.email_texts_save(%L, 'order_shipped', %L, null) $$, tests.fx('store_a'),
  repeat('a', 151)), 'P0001', 'validation_failed', 'asunto de hasta 150 caracteres');
select lives_ok(format($$ select public.email_texts_save(%L, 'order_shipped', E'¡{nombre}, ya salió!\r\n', E'Gracias por tu compra.\r\nVuelve pronto\x07') $$,
  tests.fx('store_a')), 'la dueña guarda asunto y mensaje');
select is((select subject from public.store_email_texts where store_id = tests.fx('store_a')),
  '¡{nombre}, ya salió!', 'el asunto queda en una sola línea, sin caracteres de control');
select is((select note from public.store_email_texts where store_id = tests.fx('store_a')),
  E'Gracias por tu compra.\nVuelve pronto', 'el mensaje conserva sus renglones y nada más');
select tests.logout();

-- 9-10. Aislamiento de lectura.
select tests.login('owner_b');
select is((select count(*)::int from public.store_email_texts), 0, 'B no ve los textos de A');
select tests.logout();
select tests.login('viewer_a');
select is((select count(*)::int from public.store_email_texts), 1, 'quien ve la tienda los ve');
select tests.logout();

-- 11-13. El worker solo los recibe con el interruptor encendido.
select tests.as_role('system_worker');
select set_config('tests.off', system.store_email_texts(tests.fx('store_a'))::text, true);
select tests.logout();
select is(current_setting('tests.off'), '{}', 'apagado: el worker usa los textos de siempre');
insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
values ('email_texts', 'store', tests.fx('store_a'), true, 'pgTAP 133');
select tests.as_role('system_worker');
select set_config('tests.on', system.store_email_texts(tests.fx('store_a'))::text, true);
select set_config('tests.b', system.store_email_texts(tests.fx('store_b'))::text, true);
select tests.logout();
select is(current_setting('tests.on')::jsonb -> 'order_shipped' ->> 'subject', '¡{nombre}, ya salió!',
  'encendido: recibe el texto de A');
select is(current_setting('tests.b'), '{}', 'y nada para B');

-- 14-15. Volver al texto de siempre y auditoría.
select tests.login('owner_a');
select public.email_texts_save(tests.fx('store_a'), 'order_shipped', '  ', '');
select tests.logout();
select is((select count(*)::int from public.store_email_texts where store_id = tests.fx('store_a')), 0,
  'con los dos campos vacíos vuelve al texto de siempre');
select is((select count(*)::int from audit.audit_logs where action = 'store.email_text_changed'
            and store_id = tests.fx('store_a')), 2, 'cada cambio queda en la actividad');

select * from finish();
rollback;
