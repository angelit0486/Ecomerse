-- =============================================================================
-- Portada de imágenes (`image_carousel`, interruptor hero_image_carousel): solo
-- imágenes con texto alternativo obligatorio, punto focal, destino y fechas
-- opcionales. Las imágenes solo valen si son banners listos de la MISMA tienda
-- y el interruptor nace apagado y se enciende tienda por tienda.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

create function pg_temp.gw() returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'storefront_gateway', true);
  v := storefront.get_home(tests.fx('store_a'));
  perform set_config('role', 'none', true);
  return v;
end $$;
create function tests.banner_in(p_store text) returns uuid
language sql security definer set search_path = '' as $$
  insert into public.media (store_id, owner_type, status, storage_path, mime_type, bytes, width, height, alt_text)
  values (tests.fx(p_store), 'banner', 'ready',
          tests.fx(p_store) || '/banner/x/' || gen_random_uuid() || '/original.png',
          'image/png', 100, 2400, 1028, 'Portada')
  returning id $$;
create function pg_temp.carousel(p_props jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-0000000000c1', 'type', 'image_carousel',
           'enabled', true, 'props', p_props))
$$;
create function pg_temp.slide(p_media uuid, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('image_media_id', p_media, 'alt', 'Proteínas con 20 % de descuento') || p_extra
$$;
create function pg_temp.save_home(p_props jsonb) returns text language plpgsql as $$
declare v_hint text;
begin
  perform public.appearance_save_home_draft(tests.fx('store_a'), pg_temp.carousel(p_props),
                                            tests.theme_rev(tests.fx('store_a')));
  return 'ok';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlerrm || coalesce(':' || nullif(v_hint, ''), '');
end $$;
grant execute on all functions in schema tests to authenticated;

select tests.set_fx('img', tests.banner_in('store_a'));
select tests.set_fx('cel', tests.banner_in('store_a'));
select tests.set_fx('img2', tests.banner_in('store_a'));
select tests.set_fx('ajena', tests.banner_in('store_b'));

-- 1. Interruptor: nace apagado y es por tienda.
select is((select default_enabled from public.feature_flags where key = 'hero_image_carousel'), false,
          'el interruptor nace apagado');
insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
values ('hero_image_carousel', 'store', tests.fx('store_a'), true, 'Tienda de pruebas de la parte B');
select ok(app.flag_enabled('hero_image_carousel', tests.fx('store_a'))
          and not app.flag_enabled('hero_image_carousel', tests.fx('store_b')),
          'encendido en la tienda A no lo enciende en la B');

select tests.login('owner');

-- 2. Validación.
select is(pg_temp.save_home(jsonb_build_object('slides', '[]'::jsonb)), 'validation_failed',
          'al menos una diapositiva');
select is(pg_temp.save_home(jsonb_build_object('slides', (select jsonb_agg(pg_temp.slide(tests.fx('img')))
                                                             from generate_series(1, 11)))),
          'validation_failed', 'máximo 10 diapositivas');
select is(pg_temp.save_home(jsonb_build_object('slides', jsonb_build_array(
            jsonb_build_object('image_media_id', tests.fx('img'))))),
          'validation_failed', 'el texto alternativo es obligatorio');
select is(pg_temp.save_home(jsonb_build_object('slides', jsonb_build_array(
            pg_temp.slide(tests.fx('img'), '{"heading":"Texto visible"}')))),
          'validation_failed', 'sin texto visible: no acepta título');
select is(pg_temp.save_home(jsonb_build_object('slides', jsonb_build_array(
            pg_temp.slide(tests.fx('img'), '{"link":"javascript:alert(1)"}')))),
          'validation_failed', 'ni enlaces javascript:');
select is(pg_temp.save_home(jsonb_build_object('slides', jsonb_build_array(
            pg_temp.slide(tests.fx('img'), '{"focal":{"x":120,"y":50}}')))),
          'validation_failed', 'el punto focal va de 0 a 100');
select is(pg_temp.save_home(jsonb_build_object('interval_seconds', 1,
            'slides', jsonb_build_array(pg_temp.slide(tests.fx('img'))))),
          'validation_failed', 'el avance va de 3 a 10 segundos');
select is(pg_temp.save_home(jsonb_build_object('transition', 'zoom',
            'slides', jsonb_build_array(pg_temp.slide(tests.fx('img'))))),
          'validation_failed', 'transición: deslizar o desvanecer');
select is(pg_temp.save_home(jsonb_build_object('slides', jsonb_build_array(
            pg_temp.slide(tests.fx('img'), '{"starts_at":"2026-12-01T00:00:00Z","ends_at":"2026-11-01T00:00:00Z"}')))),
          'validation_failed', 'las fechas de una diapositiva deben ir en orden');
select ok(pg_temp.save_home(jsonb_build_object('slides', jsonb_build_array(pg_temp.slide(tests.fx('ajena')))))
            like 'validation_failed%', 'la imagen de otra tienda se rechaza (aislamiento)');
select ok(pg_temp.save_home(jsonb_build_object('slides', jsonb_build_array(
            pg_temp.slide(tests.fx('img'), jsonb_build_object('mobile_image_media_id', tests.fx('ajena'))))))
            like 'validation_failed%', 'también la del celular');

-- 3. Portada completa: dos vigentes y una que empieza en el futuro.
select is(pg_temp.save_home(jsonb_build_object('interval_seconds', 4, 'transition', 'fade', 'show_arrows', true,
            'aspect_desktop', '21:9', 'aspect_mobile', '4:5',
            'slides', jsonb_build_array(
              pg_temp.slide(tests.fx('img'), jsonb_build_object('mobile_image_media_id', tests.fx('cel'),
                            'link', '/categoria/proteinas', 'focal', '{"x":30,"y":40}'::jsonb,
                            'mobile_focal', '{"x":50,"y":20}'::jsonb)),
              pg_temp.slide(tests.fx('img2'), '{"link":"/ofertas"}'),
              pg_temp.slide(tests.fx('img'), jsonb_build_object('starts_at', to_char(now() + interval '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))))),
          'ok', 'la portada de imágenes se guarda con imágenes de la propia tienda');
select public.appearance_publish_theme(tests.fx('store_a'), tests.theme_rev(tests.fx('store_a')));
select tests.logout();

select is(jsonb_array_length(pg_temp.gw() #> '{sections,0,slides}'), 2,
          'solo las diapositivas vigentes llegan a la tienda');
select is(pg_temp.gw() #>> '{sections,0,slides,0,link}', '/categoria/proteinas', 'con su destino');
select ok(pg_temp.gw() #>> '{sections,0,slides,0,mobile_image,path}' like tests.fx('store_a') || '/%',
          'la imagen del celular sale con la ruta de la tienda');
select is(pg_temp.gw() #>> '{sections,0,interval_seconds}' || '/' || (pg_temp.gw() #>> '{sections,0,transition}'),
          '4/fade', 'avance y transición viajan a la tienda');

-- 4. Cumplimiento: el texto alternativo también se revisa.
select ok(app.home_section_text(pg_temp.carousel(jsonb_build_object('slides', jsonb_build_array(
            jsonb_build_object('image_media_id', tests.fx('img'), 'alt', 'Cura todo milagroso')))) -> 0)
            like '%Cura todo milagroso%', 'el texto alternativo pasa por la revisión de cumplimiento');

-- 5. Las funciones nuevas no se conceden a nadie.
select ok(not has_function_privilege('authenticated', 'app.home_image_carousel_valid(jsonb)', 'execute')
          and not has_function_privilege('anon', 'app.home_image_slide_valid(jsonb)', 'execute')
          and not has_function_privilege('storefront_gateway', 'app.home_section_props_valid_v5(text,jsonb)', 'execute'),
          'las funciones nuevas no se exponen');

select * from finish();
rollback;
