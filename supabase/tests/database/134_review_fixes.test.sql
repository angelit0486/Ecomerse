-- =============================================================================
-- Revisión del 2026-11-05 (migración 20261105000900): anonimizar una tienda
-- borra también las notas de sus devoluciones; la tienda no reemplaza una
-- excepción de la plataforma; «stock bajo» del resumen en orden numérico.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

-- ---------------------------------------------------------------- 1. Anonimizar
select tests.set_fx('o_a', tests.order(tests.fx('store_a')));
insert into public.return_requests (id, store_id, order_id, reason, customer_note, items, status,
                                    customer_message, decided_at)
values (tests.set_fx('r_a', app.uuid_v7()), tests.fx('store_a'), tests.fx('o_a'), 'damaged',
        'Mi teléfono es 55 1234 5678', '[{"order_item_id":"00000000-0000-0000-0000-000000000000","quantity":1}]',
        'approved', 'Envíala a nombre de Ana Ruiz', now());

select throws_ok(format($$ update public.return_requests set customer_note = null where id = %L $$, tests.fx('r_a')),
  '42501', 'append_only', 'fuera de la anonimización, la nota del cliente no se toca');

update public.stores set status = 'closed', closed_at = now() - interval '31 days' where id = tests.fx('store_a');
select system.anonymize_closed_stores(5);
select ok((select customer_note is null and customer_message is null from public.return_requests
            where id = tests.fx('r_a')), 'al anonimizar la tienda se borran la nota y el mensaje');
select is((select status from public.return_requests where id = tests.fx('r_a')), 'approved',
  'el resto de la devolución se conserva');

-- ------------------------------------------------- 2. Excepciones de la plataforma
-- La plataforma apaga «notas de empaque» solo para B (motivo propio).
insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
values ('order_printing', 'store', tests.fx('store_b'), false, 'Soporte: revisión de impresión');
select tests.login('owner_b');
select throws_ok(format($$ select public.store_set_feature(%L, 'order_printing', true) $$, tests.fx('store_b')),
  'P0001', 'conflict', 'la dueña no reemplaza la excepción de la plataforma');
select is((select locked from public.store_features(tests.fx('store_b')) where key = 'order_printing'), true,
  'y la pantalla la muestra bloqueada');
select is((select locked from public.store_features(tests.fx('store_b')) where key = 'panel_help'), false,
  'las demás funciones siguen libres');
select is(public.store_set_feature(tests.fx('store_b'), 'panel_help', true), true, 'la dueña enciende otra');
select is(public.store_set_feature(tests.fx('store_b'), 'panel_help', false), false,
  'y la vuelve a apagar: su propia excepción no la bloquea');
select tests.logout();
select is((select reason from public.feature_flag_overrides
            where flag_key = 'order_printing' and scope_id = tests.fx('store_b')),
  'Soporte: revisión de impresión', 'la excepción de la plataforma sigue intacta');

-- -------------------------------------------------- 3. Resumen semanal: stock bajo
update public.stores set status = 'active', launched_at = now(), contact_email = 'hola@b.test'
 where id = tests.fx('store_b');
insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
values ('weekly_summary', 'store', tests.fx('store_b'), true, 'pgTAP 134');
select tests.login('owner_b');
select public.catalog_upsert_product(tests.fx('store_b'),
  jsonb_build_object('title', 'Producto ' || g,
                     'variants', jsonb_build_array(jsonb_build_object('price', 1000, 'sku', 'LOW-' || g))))
  from unnest(array[10, 2, 1]) g;
select public.inventory_adjust(tests.fx('store_b'), v.id, 'adjustment', replace(v.sku, 'LOW-', '')::int, 'Inicial')
  from public.product_variants v where v.store_id = tests.fx('store_b') and v.sku like 'LOW-%';
select tests.logout();
update public.inventory_levels set low_stock_threshold = 20 where store_id = tests.fx('store_b');

select tests.as_role('system_worker');
select set_config('tests.low', (select x -> 'low_stock' from system.weekly_summaries(null, 200) x
                                  where x -> 'store' ->> 'id' = tests.fx('store_b')::text)::text, true);
select tests.logout();
select is((select array_agg((e ->> 'available')::int order by n)
             from jsonb_array_elements(current_setting('tests.low')::jsonb) with ordinality t(e, n)),
  array[1, 2, 10], 'stock bajo de menor a mayor como número (antes 1, 10, 2)');
-- ---------------------------------------- 4. Devoluciones: ¿ya pasó el plazo?
insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
values ('returns', 'store', tests.fx('store_b'), true, 'pgTAP 134');
insert into public.orders (id, store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                           requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                           subtotal, total, status, payment_status, paid_at, paid_total, guest_access_token_hash)
values (tests.set_fx('o_b', app.uuid_v7()), tests.fx('store_b'), 9001, '#9001', 'ret-134-000000000000',
        'c@x.io', 'C', false, 'MXN', true, 0, false, 1000, 1000, 'open', 'paid', now(), 1000,
        sha256('tok-b'::bytea));
insert into public.shipments (store_id, order_id, status, shipped_at, idempotency_key)
values (tests.fx('store_b'), tests.fx('o_b'), 'shipped', now() - interval '2 days', 'envio-134-000000000001');
select is((storefront.return_options(tests.fx('store_b'), tests.fx('o_b'), sha256('tok-b'::bytea))
           ->> 'window_closed')::boolean, false, 'enviado hace 2 días: el plazo sigue vigente');
set local session_replication_role = replica;
update public.shipments set shipped_at = now() - interval '40 days' where order_id = tests.fx('o_b');
set local session_replication_role = origin;
select is((storefront.return_options(tests.fx('store_b'), tests.fx('o_b'), sha256('tok-b'::bytea))
           ->> 'window_closed')::boolean, true, 'enviado hace 40 días: el plazo ya pasó');
select is(public.app_schema_version(), '20261110000100', 'versión de la base');

select * from finish();
rollback;
