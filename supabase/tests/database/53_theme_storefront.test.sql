-- =============================================================================
-- Fase 9 · Lectura del tema en la tienda y en la vista previa del borrador
-- (F9-DESIGN §5, §6, §13 M8; D-F9-02). La pública nunca muestra el borrador; la
-- de vista previa sí, y solo la ejecuta storefront_gateway.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
update public.stores set contact_email = 'hola@tienda.mx', contact_phone = '55 1234 5678'
 where id = tests.fx('store_a');

create function pg_temp.gw(p_fn text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'storefront_gateway', true);
  execute format('select storefront.%I(%L)', p_fn, tests.fx('store_a')) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function tests.media(p_owner text) returns uuid
language sql security definer set search_path = '' as $$
  insert into public.media (store_id, owner_type, status, storage_path, mime_type, bytes, width, height, alt_text)
  values (tests.fx('store_a'), p_owner, 'ready',
          tests.fx('store_a') || '/' || p_owner || '/x/' || gen_random_uuid() || '/original.png',
          'image/png', 100, 1200, 630, 'Portada de la tienda')
  returning id $$;
grant execute on all functions in schema tests to authenticated;
select tests.set_fx('social', tests.media('banner'));
select tests.set_fx('logo', tests.media('store_branding'));

-- Publicado: SEO con imagen social.
select tests.login('owner');
select public.appearance_save_theme_draft(tests.fx('store_a'),
  jsonb_build_object('seo', jsonb_build_object('title', 'Suplementos para tu objetivo',
                                                'image_media_id', tests.fx('social'))),
  tests.theme_rev(tests.fx('store_a')));
select public.appearance_publish_theme(tests.fx('store_a'), tests.theme_rev(tests.fx('store_a')));
-- Borrador: otro color, otro logo y una barra de anuncio.
select public.appearance_save_theme_draft(tests.fx('store_a'),
  '{"colors":{"primary":"#0f766e"},"header":{"announcement":{"text":"Envío gratis","background":"#111827","foreground":"#ffffff"}}}',
  tests.theme_rev(tests.fx('store_a')));
select public.appearance_set_logo_draft(tests.fx('store_a'), tests.fx('logo'), tests.theme_rev(tests.fx('store_a')));
select tests.logout();

select is(pg_temp.gw('get_store_public') #>> '{theme,settings,seo,title}', 'Suplementos para tu objetivo',
          'la tienda pública muestra el SEO publicado');
select is(pg_temp.gw('get_store_public') #> '{theme,settings,header}', null, 'y nunca el borrador');
select is(pg_temp.gw('get_store_public') -> 'logo', 'null'::jsonb, 'ni el logo del borrador');
select is(pg_temp.gw('get_store_public') #>> '{seo_image,alt}', 'Portada de la tienda',
          'la imagen social llega con su texto alternativo');
select is(pg_temp.gw('get_store_public') -> 'contact', '{"email":"hola@tienda.mx","phone":"55 1234 5678"}'::jsonb,
          'el contacto comercial de la tienda');
select is(pg_temp.gw('get_store_public') #> '{theme,revision}', 'null'::jsonb,
          'la pública no expone la revisión del borrador');

select is(pg_temp.gw('get_store_preview') #>> '{theme,settings,header,announcement,text}', 'Envío gratis',
          'la vista previa muestra el borrador');
select is(pg_temp.gw('get_store_preview') #>> '{logo,path}',
          (select storage_path from public.media where id = tests.fx('logo')), 'con el logo del borrador');
select is((pg_temp.gw('get_store_preview') #>> '{theme,revision}')::integer, tests.theme_rev(tests.fx('store_a')),
          'y la revisión que está viendo');

select tests.login('owner');
select public.appearance_discard_draft(tests.fx('store_a'), tests.theme_rev(tests.fx('store_a')));
select tests.logout();
select is(pg_temp.gw('get_store_preview') -> 'theme' -> 'settings', pg_temp.gw('get_store_public') -> 'theme' -> 'settings',
          'sin borrador, la vista previa es lo publicado');

select ok(has_function_privilege('storefront_gateway', 'storefront.get_store_preview(uuid)', 'execute'),
          'storefront_gateway lee la vista previa');
select ok(not has_function_privilege('authenticated', 'storefront.get_store_preview(uuid)', 'execute')
          and not has_function_privilege('anon', 'storefront.get_store_preview(uuid)', 'execute')
          and not has_function_privilege('storefront_gateway', 'app.store_public_json(uuid, boolean)', 'execute'),
          'nadie más la ejecuta, ni la función interna');

select * from finish();
rollback;
