-- =============================================================================
-- Tema v5 (ADR-063, fase B-1): «Personalidad» del diseño. Solo valores fijos;
-- un tema v4 sigue siendo válido; viaja con el diseño portátil; interruptor
-- `theme_personality` apagado; una tienda no toca el tema de otra.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

create function pg_temp.save_theme(p_store uuid, p_patch jsonb) returns text language plpgsql as $$
declare v_detail text;
begin
  perform public.appearance_save_theme_draft(p_store, p_patch, tests.theme_rev(p_store));
  return 'ok';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlerrm || coalesce('/' || nullif(v_detail, ''), '');
end $$;
grant execute on all functions in schema tests to authenticated;

-- 1. El validador: todo opcional, valores fijos, nada más.
select ok(app.theme_settings_valid('{"personality":{}}'), 'una personalidad vacía es válida');
select ok(app.theme_settings_valid('{"personality":{"card_style":"flat","image_ratio":"4:5","image_fit":"cover","card_hover":"lift","card_align":"center","heading_case":"uppercase","heading_tracking":"wide","heading_weight":"regular","type_scale":"large","motion":"subtle"}}'),
          'todas las opciones con valores de la lista');
select ok(not app.theme_settings_valid('{"personality":{"card_style":"neon"}}'), 'un estilo de tarjeta desconocido no');
select ok(not app.theme_settings_valid('{"personality":{"image_ratio":"16:9"}}'), 'una proporción desconocida no');
select ok(not app.theme_settings_valid('{"personality":{"motion":true}}'), 'el movimiento no es booleano');
select ok(not app.theme_settings_valid('{"personality":{"css":"body{display:none}"}}'), 'sin claves libres (nada de CSS)');
select ok(not app.theme_settings_valid('{"personality":"flat"}'), 'la personalidad es un objeto');
select ok(app.theme_settings_valid('{"colors":{"primary":"#1d4ed8"},"shape":{"radius":"md"},"listing":{"columns_mobile":1}}'),
          'un tema v4 sigue siendo válido');

-- 2. La dueña la guarda en su borrador, la publica y llega a la tienda.
select tests.login('owner_a');
select is(pg_temp.save_theme(tests.fx('store_a'), '{"personality":{"card_style":"raised","heading_case":"uppercase","motion":"subtle"}}'),
          'ok', 'la dueña guarda la personalidad');
select is(pg_temp.save_theme(tests.fx('store_a'), '{"personality":{"heading_weight":"black"}}'),
          'validation_failed/settings', 'un peso desconocido se rechaza al guardar');
select public.appearance_publish_theme(tests.fx('store_a'), tests.theme_rev(tests.fx('store_a')));
select tests.logout();
select is(app.store_public_json(tests.fx('store_a'), false) #> '{theme,settings,personality}',
          '{"card_style":"raised","heading_case":"uppercase","motion":"subtle"}'::jsonb,
          'la tienda publicada recibe la personalidad');

-- 3. Viaja con el diseño portátil (se importa en otra tienda).
select tests.login('owner_b');
select ok(public.appearance_import_design(tests.fx('store_b'),
            '{"personality":{"image_ratio":"3:4","card_align":"center"}}', '[]',
            tests.theme_rev(tests.fx('store_b')), 'file') > 0, 'el diseño importado lleva la personalidad');
select is((select draft_settings -> 'personality' from public.store_themes where store_id = tests.fx('store_b')),
          '{"image_ratio":"3:4","card_align":"center"}'::jsonb, 'y queda en el borrador de B');

-- 4. Aislamiento: B no toca el tema de A.
select ok(pg_temp.save_theme(tests.fx('store_a'), '{"personality":{"card_style":"flat"}}') <> 'ok',
          'la dueña de B no puede guardar en el tema de A');
select tests.logout();
select is((select settings #>> '{personality,card_style}' from public.store_themes where store_id = tests.fx('store_a')),
          'raised', 'el tema de A sigue igual');

-- 5. Interruptor apagado y que la tienda puede encender; el validador no se expone.
select is((select default_enabled::text || '/' || store_toggle::text from public.feature_flags where key = 'theme_personality'),
          'false/true', 'theme_personality nace apagado y lo enciende la tienda');
select ok(not has_function_privilege('authenticated', 'app.theme_personality_valid(jsonb)', 'execute')
          and not has_function_privilege('anon', 'app.theme_personality_valid(jsonb)', 'execute')
          and not has_function_privilege('storefront_gateway', 'app.theme_personality_valid(jsonb)', 'execute'),
          'el validador nuevo no se concede a nadie');
select is(public.app_schema_version(), '20261111000200', 'versión de la base');

select * from finish();
rollback;
