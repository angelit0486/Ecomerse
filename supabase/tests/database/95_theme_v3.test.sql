-- =============================================================================
-- Tema v3 (misión Portada/Marcas, Paso 3): barra de anuncio apagada, portada
-- principal con foto de fondo, imagen del celular y hasta 3 portadas extra que
-- rotan. Las imágenes solo valen si son banners listos de la misma tienda y
-- los textos de las portadas extra pasan por la revisión de cumplimiento.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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
          'image/png', 100, 1600, 640, 'Portada')
  returning id $$;
create function pg_temp.hero(p_props jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000001', 'type', 'hero',
           'enabled', true,
           'props', jsonb_build_object('heading', 'Tu mejor versión', 'align', 'left') || p_props))
$$;
create function pg_temp.save_home(p_props jsonb) returns text language plpgsql as $$
declare v_hint text;
begin
  perform public.appearance_save_home_draft(tests.fx('store_a'), pg_temp.hero(p_props),
                                            tests.theme_rev(tests.fx('store_a')));
  return 'ok';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlerrm || coalesce(':' || nullif(v_hint, ''), '');
end $$;
create function pg_temp.save_theme(p_patch jsonb) returns text language plpgsql as $$
begin
  perform public.appearance_save_theme_draft(tests.fx('store_a'), p_patch, tests.theme_rev(tests.fx('store_a')));
  return 'ok';
exception when others then
  return sqlerrm;
end $$;
grant execute on all functions in schema tests to authenticated;

select tests.set_fx('img', tests.banner_in('store_a'));
select tests.set_fx('cel', tests.banner_in('store_a'));
select tests.set_fx('s1', tests.banner_in('store_a'));
select tests.set_fx('ajena', tests.banner_in('store_b'));

select tests.login('owner');

-- 1. Barra de anuncio apagada: se guarda con su texto; `hidden` debe ser booleano.
select is(pg_temp.save_theme('{"header":{"announcement":{"text":"Buen Fin","background":"#111827","foreground":"#ffffff","hidden":true}}}'),
          'ok', 'la barra se guarda apagada sin perder su texto');
select is(pg_temp.save_theme('{"header":{"announcement":{"text":"Buen Fin","background":"#111827","foreground":"#ffffff","hidden":"si"}}}'),
          'validation_failed', '«hidden» que no es booleano se rechaza');

-- 2. Validación de la portada principal v3.
select is(pg_temp.save_home(jsonb_build_object('layout', 'diagonal')), 'validation_failed',
          'solo «split» o «background»');
select is(pg_temp.save_home(jsonb_build_object('autoplay', 'sí')), 'validation_failed', 'autoplay es booleano');
select is(pg_temp.save_home(jsonb_build_object('slides', '[]'::jsonb)), 'validation_failed',
          'una lista de portadas vacía se rechaza');
select is(pg_temp.save_home(jsonb_build_object('slides', jsonb_build_array(
            '{"heading":"1"}'::jsonb, '{"heading":"2"}'::jsonb, '{"heading":"3"}'::jsonb, '{"heading":"4"}'::jsonb))),
          'validation_failed', 'máximo 3 portadas extra');
select is(pg_temp.save_home(jsonb_build_object('slides', '[{"heading":"x","html":"<script>alert(1)</script>"}]'::jsonb)),
          'validation_failed', 'una portada extra no acepta llaves fuera del esquema');
select is(pg_temp.save_home(jsonb_build_object('slides', '[{"heading":"x","cta":{"label":"Ver","link":"javascript:alert(1)"}}]'::jsonb)),
          'validation_failed', 'ni enlaces javascript:');
select ok(pg_temp.save_home(jsonb_build_object('mobile_image_media_id', tests.fx('ajena'))) like 'validation_failed%',
          'la imagen del celular de otra tienda se rechaza');
select ok(pg_temp.save_home(jsonb_build_object('slides', jsonb_build_array(
            jsonb_build_object('heading', 'x', 'image_media_id', tests.fx('ajena'))))) like 'validation_failed%',
          'la imagen de una portada extra de otra tienda se rechaza');

-- 3. Portada completa: foto de fondo, imagen del celular y 2 portadas extra.
select is(pg_temp.save_home(jsonb_build_object('layout', 'background', 'autoplay', true,
            'image_media_id', tests.fx('img'), 'mobile_image_media_id', tests.fx('cel'),
            'slides', jsonb_build_array(
              jsonb_build_object('heading', 'Proteínas', 'image_media_id', tests.fx('s1'),
                                 'cta', '{"label":"Ver proteínas","link":"/categoria/proteinas"}'::jsonb),
              '{"heading":"Envío gratis desde $999","subheading":"A todo México"}'::jsonb))),
          'ok', 'la portada v3 se guarda con imágenes de la propia tienda');
select public.appearance_publish_theme(tests.fx('store_a'), tests.theme_rev(tests.fx('store_a')));
select tests.logout();

select is(pg_temp.gw() #>> '{sections,0,layout}', 'background', 'la presentación viaja a la tienda');
select is((pg_temp.gw() #>> '{sections,0,autoplay}')::boolean, true, 'y si rotan solas');
select ok(pg_temp.gw() #>> '{sections,0,mobile_image,path}' like tests.fx('store_a') || '/%',
          'la imagen del celular sale con la ruta de la tienda');
select is((select array_agg(s ->> 'heading')
             from jsonb_array_elements(pg_temp.gw() #> '{sections,0,slides}') s),
          array['Proteínas', 'Envío gratis desde $999'], 'las portadas extra, en su orden');

-- 4. Cumplimiento: los textos de las portadas extra también se revisan.
select ok(app.home_section_text(pg_temp.hero('{"slides":[{"heading":"Cura todo","cta":{"label":"Milagroso","link":"/"}}]}') -> 0)
            like '%Cura todo%Milagroso%',
          'el título y el botón de las portadas extra se revisan');

-- 5. La función nueva no se concede a nadie.
select ok(not has_function_privilege('authenticated', 'app.home_hero_slide_valid(jsonb)', 'execute')
          and not has_function_privilege('anon', 'app.home_hero_slide_valid(jsonb)', 'execute')
          and not has_function_privilege('storefront_gateway', 'app.home_hero_slide_valid(jsonb)', 'execute'),
          'app.home_hero_slide_valid no se expone');

select * from finish();
rollback;
