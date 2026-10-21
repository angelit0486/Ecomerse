-- =============================================================================
-- ADR-034 §3 · Páginas con bloques: borrador → publicar, la tienda solo ve lo
-- publicado (la vista previa de la misma tienda ve el borrador), las políticas
-- no llevan bloques, términos prohibidos y referencias se revisan al publicar,
-- y otra tienda no puede tocar la página.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

create function pg_temp.gw(p_slug text, p_preview boolean default false) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'storefront_gateway', true);
  if p_preview then perform set_config('pruva.preview_store', tests.fx('store_a')::text, true); end if;
  v := storefront.get_page(tests.fx('store_a'), p_slug);
  perform set_config('pruva.preview_store', '', true);
  perform set_config('role', 'none', true);
  return v;
end $$;
create function pg_temp.blocks(p_heading text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000001', 'type', 'faq',
           'enabled', true, 'props', jsonb_build_object('title', p_heading,
             'items', jsonb_build_array(jsonb_build_object('question', '¿Envían?', 'answer', 'Sí.')))))
$$;
create function tests.media_in(p_store text) returns uuid language sql security definer set search_path = '' as $$
  insert into public.media (store_id, owner_type, status, storage_path, mime_type, bytes, width, height, alt_text)
  values (tests.fx(p_store), 'banner', 'ready', tests.fx(p_store) || '/banner/x/' || gen_random_uuid() || '/original.png',
          'image/png', 100, 1200, 630, 'Social')
  returning id $$;
grant execute on all functions in schema tests to authenticated;

select tests.login('owner');
select tests.set_fx('page', (public.content_upsert_page(tests.fx('store_a'),
  '{"title":"Preguntas","slug":"preguntas","body_html":""}') ->> 'id')::uuid);
select tests.set_fx('privacy', (select id from public.store_pages
                                 where store_id = tests.fx('store_a') and type = 'policy_privacy'));

-- 1. Sin texto ni bloques no se publica; con bloques publicados, sí.
select is(pg_temp.err(format('select public.content_set_page_published(%L, %L, true)',
            tests.fx('store_a'), tests.fx('page'))), 'validation_failed/body_html',
          'una página vacía no se publica');
select is(pg_temp.err(format('select public.content_save_page_blocks(%L, %L, %L)',
            tests.fx('store_a'), tests.fx('page'), pg_temp.blocks('Dudas frecuentes'))), 'ok',
          'los bloques se guardan en el borrador');
select is(pg_temp.err(format('select public.content_set_page_published(%L, %L, true)',
            tests.fx('store_a'), tests.fx('page'))), 'validation_failed/body_html',
          'el borrador no cuenta como contenido publicado');
select is(pg_temp.err(format('select public.content_publish_page_blocks(%L, %L)',
            tests.fx('store_a'), tests.fx('page'))), 'ok', 'se publican los bloques');
select is(pg_temp.err(format('select public.content_set_page_published(%L, %L, true)',
            tests.fx('store_a'), tests.fx('page'))), 'ok', 'y la página ya se puede publicar');

-- 2. Lo que ve la tienda y lo que ve la vista previa.
select is(pg_temp.err(format('select public.content_save_page_blocks(%L, %L, %L)',
            tests.fx('store_a'), tests.fx('page'), pg_temp.blocks('Versión nueva'))), 'ok',
          'un cambio nuevo va al borrador');
select tests.logout();
select is(pg_temp.gw('preguntas') #>> '{sections,0,title}', 'Dudas frecuentes',
          'la tienda muestra lo publicado');
select is(pg_temp.gw('preguntas', true) #>> '{sections,0,title}', 'Versión nueva',
          'la vista previa de la tienda muestra el borrador');

-- 3. Las políticas no llevan bloques; HTML peligroso fuera.
select tests.login('owner');
select is(pg_temp.err(format('select public.content_save_page_blocks(%L, %L, %L)',
            tests.fx('store_a'), tests.fx('privacy'), pg_temp.blocks('x'))), 'validation_failed/policy_blocks',
          'una política no se arma con bloques');
select is(pg_temp.err(format('select public.content_save_page_blocks(%L, %L, %L)',
            tests.fx('store_a'), tests.fx('page'),
            '[{"id":"00000000-0000-4000-8000-000000000002","type":"rich_text","enabled":true,"props":{"html":"<p onclick=x()>a</p>"}}]')),
          'validation_failed/html', 'un texto con formato peligroso se rechaza');

-- 4. Imagen social: solo de la propia tienda.
select tests.set_fx('img_a', tests.media_in('store_a'));
select tests.set_fx('img_b', tests.media_in('store_b'));
select is(pg_temp.err(format('select public.content_upsert_page(%L, %L)', tests.fx('store_a'),
            jsonb_build_object('id', tests.fx('page'), 'title', 'Preguntas', 'body_html', '',
                               'seo_image_media_id', tests.fx('img_b')))),
          'validation_failed/seo_image_media_id', 'la imagen social de otra tienda se rechaza');
select is(pg_temp.err(format('select public.content_upsert_page(%L, %L)', tests.fx('store_a'),
            jsonb_build_object('id', tests.fx('page'), 'title', 'Preguntas', 'body_html', '',
                               'seo_image_media_id', tests.fx('img_a')))),
          'ok', 'la propia sí');
select public.content_upsert_page(tests.fx('store_a'),
  jsonb_build_object('id', tests.fx('page'), 'title', 'Preguntas frecuentes', 'body_html', ''));
select tests.logout();
select is(pg_temp.gw('preguntas') #>> '{seo_image,alt}', 'Social', 'la tienda recibe la imagen social');
select is(pg_temp.gw('preguntas') ->> 'title', 'Preguntas frecuentes',
          'guardar sin el campo de imagen la conserva');

-- 5. Otra tienda no toca la página.
select tests.login('owner_b');
select is(pg_temp.err(format('select public.content_save_page_blocks(%L, %L, %L)',
            tests.fx('store_b'), tests.fx('page'), pg_temp.blocks('x'))), 'not_found/page',
          'B no encuentra la página de A');
select is(pg_temp.err(format('select public.content_publish_page_blocks(%L, %L)',
            tests.fx('store_a'), tests.fx('page'))), 'forbidden',
          'ni la publica con el id de la tienda de A');
select tests.logout();

select * from finish();
rollback;
