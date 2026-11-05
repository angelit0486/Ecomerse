-- =============================================================================
-- Ajustes → Funciones: la tienda enciende o apaga solo las funciones marcadas
-- `store_toggle`, solo en SU tienda, con permiso y con auditoría; el kill switch
-- de la plataforma manda. La portada de imágenes nace encendida.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function pg_temp.on_(p_store uuid, p_key text) returns boolean language sql as $$
  select app.flag_enabled(p_key, p_store)
$$;

select ok(pg_temp.on_(tests.fx('store_a'), 'hero_image_carousel')
          and pg_temp.on_(tests.fx('store_b'), 'hero_image_carousel'),
          'la portada de imágenes nace encendida en todas las tiendas');
select is((select count(*)::int from public.feature_flags where store_toggle), 12,
          'doce funciones que la tienda puede cambiar (theme_personality, ADR-063)');

select tests.login('viewer');
select throws_ok(format($$ select public.store_set_feature(%L, 'hero_image_carousel', false) $$, tests.fx('store_a')),
                 '42501', 'forbidden', 'sin store.update no se cambia');
select lives_ok(format($$ select * from public.store_features(%L) $$, tests.fx('store_a')),
                'con lectura sí se ve la lista');
select tests.logout();

select tests.login('owner');
select is(public.store_set_feature(tests.fx('store_a'), 'hero_image_carousel', false), false, 'A la apaga');
select is(public.store_set_feature(tests.fx('store_a'), 'mobile_input_size', true), true, 'A enciende otra');
select throws_ok(format($$ select public.store_set_feature(%L, 'stripe_provider', true) $$, tests.fx('store_a')),
                 'P0001', 'not_found', 'una función de plataforma no se puede tocar');
select throws_ok(format($$ select public.store_set_feature(%L, 'hero_image_carousel', true) $$, tests.fx('store_b')),
                 '42501', 'forbidden', 'A no cambia las funciones de B');
select tests.logout();

select ok(not pg_temp.on_(tests.fx('store_a'), 'hero_image_carousel')
          and pg_temp.on_(tests.fx('store_b'), 'hero_image_carousel'),
          'apagada en A, sigue encendida en B (aislamiento)');
select ok(exists (select 1 from audit.audit_logs where action = 'store.feature_changed'
                   and store_id = tests.fx('store_a') and after ->> 'key' = 'hero_image_carousel'),
          'queda en la auditoría');

update public.feature_flags set kill_switch = true where key = 'mobile_input_size';
select tests.login('owner');
select throws_ok(format($$ select public.store_set_feature(%L, 'mobile_input_size', true) $$, tests.fx('store_a')),
                 'P0001', 'conflict', 'con el kill switch de la plataforma no se enciende');
select is((select locked from public.store_features(tests.fx('store_a')) where key = 'mobile_input_size'), true,
          'la pantalla lo muestra bloqueado');
select tests.logout();

select * from finish();
rollback;
