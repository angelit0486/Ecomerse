-- =============================================================================
-- Ayuda del panel (paso 22): el interruptor nace apagado, la tienda lo cambia
-- desde Ajustes → Funciones y encenderlo en una tienda no lo enciende en otra.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

select is((select default_enabled and store_toggle from public.feature_flags where key = 'panel_help'),
          false, 'nace apagado');
select tests.login('owner_a');
select is(public.store_set_feature(tests.fx('store_a'), 'panel_help', true), true, 'A la enciende');
select tests.logout();
select ok(app.flag_enabled('panel_help', tests.fx('store_a'))
          and not app.flag_enabled('panel_help', tests.fx('store_b')),
          'encendida en A, apagada en B (aislamiento)');

select * from finish();
rollback;
