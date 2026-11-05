-- =============================================================================
-- Resumen semanal (paso 19): ventana del lunes 8:00 (México), solo tiendas con el
-- interruptor, cifras de la propia tienda (aislamiento), destinatarios y solo
-- el worker puede leerlo.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Ventana: lunes 2026-11-09 a las 7:59 y 8:00 en Ciudad de México (UTC−6).
select is(system.weekly_summary_window('2026-11-09 13:59:00+00'), null, 'lunes 7:59: todavía no');
select is(system.weekly_summary_window('2026-11-09 14:00:00+00'), '2026-S46', 'lunes 8:00: semana 46');
select is(system.weekly_summary_window('2026-11-12 03:00:00+00'), '2026-S46', 'el resto de la semana, la misma');

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now(), contact_email = 'hola@a.test'
 where id in (tests.fx('store_a'), tests.fx('store_b'));

-- A: 2 pagados esta semana (10 000 + 20 000), 1 la anterior (5 000), 1 por surtir en atención.
-- B: 1 pagado esta semana (99 000): no debe aparecer en A.
insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                           requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                           subtotal, total, status, payment_status, fulfillment_status, placed_at, paid_at, paid_total,
                           needs_attention)
values (tests.fx('store_a'), 1, '#1', 'ws-a-1-000000000000', 'c@x.io', 'C', false, 'MXN', true, 0, false,
        10000, 10000, 'open', 'paid', 'unfulfilled', now() - interval '1 day', now() - interval '1 day', 10000, true),
       (tests.fx('store_a'), 2, '#2', 'ws-a-2-000000000000', 'c@x.io', 'C', false, 'MXN', true, 0, false,
        20000, 20000, 'open', 'paid', 'fulfilled', now() - interval '2 days', now() - interval '2 days', 20000, false),
       (tests.fx('store_a'), 3, '#3', 'ws-a-3-000000000000', 'c@x.io', 'C', false, 'MXN', true, 0, false,
        5000, 5000, 'open', 'paid', 'fulfilled', now() - interval '9 days', now() - interval '9 days', 5000, false),
       (tests.fx('store_b'), 1, '#1', 'ws-b-1-000000000000', 'c@x.io', 'C', false, 'MXN', true, 0, false,
        99000, 99000, 'open', 'paid', 'unfulfilled', now() - interval '1 day', now() - interval '1 day', 99000, false);

create function pg_temp.summary(p_store uuid) returns jsonb language sql as $$
  select x from system.weekly_summaries(null, 200) x where x -> 'store' ->> 'id' = p_store::text
$$;

select is(pg_temp.summary(tests.fx('store_a')), null, 'apagado: la tienda no recibe resumen');

insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
values ('weekly_summary', 'store', tests.fx('store_a'), true, 'pgTAP paso 19');

select is((pg_temp.summary(tests.fx('store_a')) ->> 'sales')::bigint, 30000::bigint, 'ventas de 7 días de A');
select is((pg_temp.summary(tests.fx('store_a')) ->> 'orders')::int, 2, 'pedidos de 7 días de A');
select is((pg_temp.summary(tests.fx('store_a')) ->> 'sales_prev')::bigint, 5000::bigint, 'semana anterior de A');
select is((pg_temp.summary(tests.fx('store_a')) ->> 'to_fulfill')::int, 1, 'por surtir de A (sin los de B)');
select is((pg_temp.summary(tests.fx('store_a')) ->> 'needs_attention')::int, 1, 'en atención de A');
select is(pg_temp.summary(tests.fx('store_a')) -> 'recipients', '["hola@a.test"]'::jsonb,
          'sin destinatarios configurados, al correo de contacto');
select is(pg_temp.summary(tests.fx('store_b')), null, 'B no lo encendió: no aparece');

select ok(not has_function_privilege('authenticated', 'system.weekly_summaries(uuid,integer)', 'execute')
          and has_function_privilege('system_worker', 'system.weekly_summaries(uuid,integer)', 'execute'),
          'solo el worker lee los resúmenes');

select * from finish();
rollback;
