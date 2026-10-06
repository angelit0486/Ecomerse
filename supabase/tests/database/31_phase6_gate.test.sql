-- =============================================================================
-- Gate F6 · regresiones de la revisión adversarial (20261013000600).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
update public.stores set status = 'active', launched_at = now(), prices_include_tax = true, tax_rate_bps = 0,
                         timezone = 'America/Mexico_City'
 where id = tests.fx('store_a');

create function tests.gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'storefront_gateway', true);
  execute format('select to_jsonb(t.x) from (%s) t(x)', p_sql) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function tests.tok(p text) returns text language sql as $$ select rpad(p, 43, 'x') $$;
create function tests.variant(p_sku text) returns uuid language sql as
  $$ select id from public.product_variants where sku = p_sku and deleted_at is null $$;
create function tests.add(p_cart text, p_sku text) returns jsonb language sql as $$
  select tests.gw(format('select storefront.cart_add_item(%L, %L, %L, 1)', tests.fx('store_a'), p_cart, tests.variant(p_sku)))
$$;
create function tests.place(p_cart text, p_account uuid, p_expected bigint, p_extra jsonb default '{}') returns jsonb
language sql as $$
  select tests.gw(format('select storefront.place_order(%L, %L, %L, %s, %L, %L)', tests.fx('store_a'), p_cart,
    jsonb_build_object('email', 'ana@x.io', 'customer_name', 'Ana', 'payment_account_id', p_account) || p_extra,
    p_expected, 'idem-' || p_cart, sha256(convert_to('g-' || p_cart, 'UTF8'))))
$$;
grant execute on all functions in schema tests to storefront_gateway, authenticated;

-- Productos sin envío (digitales no: físicos que no requieren envío) para no depender de tarifas.
select tests.login('owner');
select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Taza","variants":[{"price":10000,"sku":"TAZA-1","requires_shipping":false}]}') ->> 'id')::uuid);
select public.inventory_adjust(tests.fx('store_a'), tests.variant('TAZA-1'), 'adjustment', 20, 'Inicial');
select tests.logout();
insert into public.payment_accounts (store_id, provider, status, display_name) values
  (tests.fx('store_a'), 'fake', 'active', 'Prueba') returning tests.set_fx('fake', id);
insert into public.payment_accounts (store_id, provider, status, display_name) values
  (tests.fx('store_a'), 'manual', 'active', 'Transferencia') returning tests.set_fx('manual', id);
insert into public.discounts (store_id, code, type, value, status) values
  (tests.fx('store_a'), 'APAGADO', 'percentage', 5000, 'disabled');
insert into public.discounts (store_id, code, type, value, starts_at) values
  (tests.fx('store_a'), 'FUTURO', 'fixed_amount', 3000, now() + interval '1 day');
insert into public.discounts (store_id, code, type, value) values
  (tests.fx('store_a'), 'ENVIOGRATIS', 'free_shipping', 0);
insert into public.discounts (store_id, code, type, value, usage_limit_per_customer) values
  (tests.fx('store_a'), 'UNAVEZ', 'fixed_amount', 1000, 1);

-- ============================================================================ M2: códigos sin revelar datos
select tests.add(tests.tok('c1'), 'TAZA-1');
select is(tests.gw(format('select storefront.cart_set_details(%L, %L, ''{"discount_code":"APAGADO"}'') -> ''discount''',
  tests.fx('store_a'), tests.tok('c1'))), '{"code":"APAGADO","amount":0,"status":"not_found","min_subtotal":null}'::jsonb,
  'un código desactivado se ve como inexistente, sin tipo ni valor');
select is(tests.gw(format('select storefront.cart_set_details(%L, %L, ''{"discount_code":"FUTURO"}'') -> ''discount'' ->> ''status''',
  tests.fx('store_a'), tests.tok('c1'))), to_jsonb('not_found'::text), 'una promoción no iniciada no se revela');
select is(tests.gw(format('select storefront.cart_set_details(%L, %L, ''{"discount_code":"ENVIOGRATIS"}'') -> ''discount'' ->> ''status''',
  tests.fx('store_a'), tests.tok('c1'))), to_jsonb('not_applicable'::text),
  'envío gratis en un pedido sin envío: no aplica (no consume un uso)');
select is((select count(*)::int from generate_series(1, 31) i
            where (tests.gw(format('select storefront.discount_guard(%L, %L)', tests.fx('store_a'), repeat('c', 64))))::boolean),
  30, 'códigos: 30 intentos por IP y tienda por hora, aunque se abran carritos nuevos');

-- ============================================================================ M3: consentimiento solo con pago
select tests.set_fx('o1', (tests.place(tests.tok('c1'), tests.fx('manual'), 10000,
  '{"accepts_marketing":true,"discount_code":null}') ->> 'order_id')::uuid);
select is((select accepts_marketing from public.customers where store_id = tests.fx('store_a') and email = 'ana@x.io'),
  false, 'un pedido impago no suscribe el email');
select is((select accepts_marketing from public.orders where id = tests.fx('o1')), true,
  'el consentimiento queda en el pedido');
select tests.login('owner');
select public.orders_mark_paid_manual(tests.fx('store_a'), tests.fx('o1'));
select tests.logout();
select is((select accepts_marketing::text || '/' || marketing_consent_source from public.customers
            where store_id = tests.fx('store_a') and email = 'ana@x.io'), 'true/checkout',
  'con el pago confirmado, el cliente queda suscrito');

-- ============================================================================ Límite por cliente vía place_order
select tests.add(tests.tok('c2'), 'TAZA-1');
select lives_ok(format($$ select tests.place(%L, %L, 9000, '{"discount_code":"UNAVEZ"}') $$, tests.tok('c2'),
  tests.fx('manual')), 'primer uso del código por cliente');
select tests.add(tests.tok('c3'), 'TAZA-1');
select throws_ok(format($$ select tests.place(%L, %L, 9000, '{"discount_code":"UNAVEZ"}') $$, tests.tok('c3'),
  tests.fx('manual')), 'P0001', 'discount_invalid', 'segundo uso con el mismo email en otro carrito: rechazado');

-- ============================================================================ M4: límite diario por email
select tests.add(tests.tok('c4'), 'TAZA-1');
select is((select coalesce(sum(hits), 0)::int from system.rate_limits where bucket like 'checkout:email:%'), 2,
  'cuentan los pedidos creados (2)');
select throws_ok(format($$ select tests.place(%L, %L, 1) $$, tests.tok('c4'), tests.fx('manual')), 'P0001',
  'price_changed', 'un intento fallido…');
select is((select coalesce(sum(hits), 0)::int from system.rate_limits where bucket like 'checkout:email:%'), 2,
  '…no consume el límite de ese email');
update system.rate_limits set hits = 20 where bucket like 'checkout:email:%';
select throws_ok(format($$ select tests.place(%L, %L, 10000) $$, tests.tok('c4'), tests.fx('manual')), 'P0001',
  'rate_limited', 'el pedido 21 del día con ese email se rechaza');

-- ============================================================================ L3: fallo → reintento → pago
insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
on conflict (key) do update set value = excluded.value;
delete from system.rate_limits;
select tests.add(tests.tok('c5'), 'TAZA-1');
select tests.set_fx('o5', (tests.gw(format('select storefront.place_order(%L, %L, %L, 10000, %L, %L)', tests.fx('store_a'),
  tests.tok('c5'), jsonb_build_object('email', 'bea@x.io', 'customer_name', 'Bea', 'payment_account_id', tests.fx('fake')),
  'idem-c5-0000000000', sha256('g5'::bytea))) ->> 'order_id')::uuid);
select tests.gw(format('select storefront.fake_payment_result(%L, %L, ''failed'')', tests.fx('store_a'),
  (select id from public.payments where order_id = tests.fx('o5'))));
select tests.set_fx('p5b', (tests.gw(format('select storefront.retry_payment(%L, %L, %L)', tests.fx('store_a'),
  tests.fx('o5'), sha256('g5'::bytea))) ->> 'id')::uuid);
select is((select payment_status from public.orders where id = tests.fx('o5')), 'pending',
  'reintento: el pedido vuelve a pending');
select lives_ok(format($$ select tests.gw(%L) $$, format('select storefront.fake_payment_result(%L, %L, ''succeeded'')',
  tests.fx('store_a'), tests.fx('p5b'))), 'el nuevo intento se aprueba');
select is((select status || '/' || payment_status from public.orders where id = tests.fx('o5')), 'open/paid',
  'pagado tras el reintento');

-- ============================================================================ L2: sin actor no hay transiciones de sistema
select tests.set_fx('o6', tests.order(tests.fx('store_a')));
update public.orders set status = 'cancelled', cancel_reason = 'payment_expired', cancelled_at = now(),
                         payment_status = 'expired' where id = tests.fx('o6');
select throws_ok($$ update public.orders set status = 'open' where id = tests.fx('o6') $$, 'P0001',
  'invalid_transition', 'sin app.order_actor no se reabre un pedido expirado');

-- ============================================================================ L5: fake oculto sin el ajuste
update public.platform_settings set value = '{"enabled": false}' where key = 'payments.allow_fake';
select is((select array_agg(m ->> 'provider') from jsonb_array_elements(
  tests.gw(format('select storefront.payment_methods(%L)', tests.fx('store_a')))) m), array['manual'],
  'sin payments.allow_fake, fake no se ofrece');

-- ============================================================================ L6: vigencia por día de la tienda
select tests.login('owner');
select tests.set_fx('d', public.discounts_upsert(tests.fx('store_a'),
  '{"code":"FINDE","type":"fixed_amount","value":100,"starts_on":"2026-11-01","ends_on":"2026-11-02"}'));
select tests.logout();
select is((select (starts_at at time zone 'America/Mexico_City')::text || ' → ' ||
                  (ends_at at time zone 'America/Mexico_City')::text from public.discounts where id = tests.fx('d')),
  '2026-11-01 00:00:00 → 2026-11-03 00:00:00', 'días en la zona de la tienda; «hasta» incluye el último día');

select * from finish();
rollback;
