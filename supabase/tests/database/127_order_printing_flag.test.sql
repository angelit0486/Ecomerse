-- =============================================================================
-- Notas de empaque (paso 21): el interruptor nace apagado, la tienda lo cambia
-- desde Ajustes → Funciones y encenderlo en una tienda no lo enciende en otra.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

select is((select default_enabled from public.feature_flags where key = 'order_printing'), false,
          'nace apagado');
select is((select store_toggle from public.feature_flags where key = 'order_printing'), true,
          'la tienda lo puede cambiar');
select tests.login('owner_a');
select is(public.store_set_feature(tests.fx('store_a'), 'order_printing', true), true, 'A lo enciende');
select tests.logout();
select ok(app.flag_enabled('order_printing', tests.fx('store_a'))
          and not app.flag_enabled('order_printing', tests.fx('store_b')),
          'encendido en A, apagado en B (aislamiento)');

select * from finish();
rollback;
