-- =============================================================================
-- ADR-034 · Tema v2: favicon, bloques nuevos, visibilidad por dispositivo y
-- vigencia. Las referencias (productos elegidos, objetivos, favicon) solo
-- valen dentro de la misma tienda; la portada pública respeta la vigencia y
-- nunca muestra agotados ni opiniones sin publicar.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

create function pg_temp.gw(p_fn text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'storefront_gateway', true);
  execute format('select storefront.%I(%L)', p_fn, tests.fx('store_a')) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function tests.media_in(p_store text, p_owner text, p_w integer, p_h integer) returns uuid
language sql security definer set search_path = '' as $$
  insert into public.media (store_id, owner_type, status, storage_path, mime_type, bytes, width, height, alt_text)
  values (tests.fx(p_store), p_owner, 'ready',
          tests.fx(p_store) || '/' || p_owner || '/x/' || gen_random_uuid() || '/original.png',
          'image/png', 100, p_w, p_h, 'Imagen')
  returning id $$;
create function pg_temp.sec(p_n integer, p_type text, p_props jsonb, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('id', '00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'),
                            'type', p_type, 'enabled', true, 'props', p_props) || p_extra
$$;
create function pg_temp.save_home(p_sections jsonb) returns text language plpgsql as $$
begin
  perform public.appearance_save_home_draft(tests.fx('store_a'), p_sections, tests.theme_rev(tests.fx('store_a')));
  return 'ok';
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.save_theme(p_patch jsonb) returns text language plpgsql as $$
declare v_detail text;
begin
  perform public.appearance_save_theme_draft(tests.fx('store_a'), p_patch, tests.theme_rev(tests.fx('store_a')));
  return 'ok';
exception when others then
  get stacked diagnostics v_detail = pg_exception_hint;
  return sqlerrm || ':' || coalesce(v_detail, '');
end $$;
create function pg_temp.types() returns text[] language sql as $$
  select array_agg(e ->> 'type' order by o)
    from jsonb_array_elements(pg_temp.gw('get_home') -> 'sections') with ordinality x(e, o)
$$;
grant execute on all functions in schema tests to authenticated;

-- Datos: favicon cuadrado y uno rectangular en A; uno cuadrado en B.
select tests.set_fx('fav_ok', tests.media_in('store_a', 'store_branding', 512, 512));
select tests.set_fx('fav_wide', tests.media_in('store_a', 'store_branding', 600, 200));
select tests.set_fx('fav_b', tests.media_in('store_b', 'store_branding', 512, 512));

create function pg_temp.product(p_store text, p_title text, p_slug text) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.catalog_upsert_product(tests.fx(p_store), jsonb_build_object('title', p_title, 'slug', p_slug,
          'variants', '[{"price":19900}]'::jsonb)) ->> 'id')::uuid;
  perform public.catalog_publish_product(tests.fx(p_store), v);
  return v;
end $$;
select tests.login('owner_b');
select tests.set_fx('ajena', pg_temp.product('store_b', 'Ajena', 'ajena'));
select tests.set_fx('obj_b', public.catalog_save_attribute(tests.fx('store_b'),
  '{"name":"Objetivo","values":[{"label":"Energía"}]}'));
select tests.set_fx('energia_b', (select id from public.attribute_values where attribute_id = tests.fx('obj_b')));
select tests.logout();

select tests.login('owner');
select tests.set_fx('uno', pg_temp.product('store_a', 'Uno', 'uno'));
select tests.set_fx('dos', pg_temp.product('store_a', 'Dos', 'dos'));
select tests.set_fx('agotado', pg_temp.product('store_a', 'Agotado', 'agotado'));
select tests.set_fx('obj', public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Objetivo","values":[{"label":"Energía"},{"label":"Fuerza"}]}'));
select tests.set_fx('fuerza', (select id from public.attribute_values where attribute_id = tests.fx('obj') and key = 'fuerza'));
select tests.set_fx('energia', (select id from public.attribute_values where attribute_id = tests.fx('obj') and key = 'energia'));
select tests.logout();
update public.product_variants set track_inventory = false
 where store_id = tests.fx('store_a') and product_id <> tests.fx('agotado');

-- 1. Tema: favicon, sombras, densidad y anuncio con vigencia.
select tests.login('owner');
select is(pg_temp.save_theme(jsonb_build_object('favicon_media_id', tests.fx('fav_ok'),
            'shape', '{"shadow":"soft","density":"spacious"}'::jsonb,
            'header', '{"announcement":{"text":"Buen Fin","background":"#111827","foreground":"#ffffff","starts_at":"2026-11-13T00:00:00-06:00","ends_at":"2026-11-17T23:59:59-06:00"},"quick_links":[{"label":"Ofertas","link":"/ofertas"}]}'::jsonb)),
          'ok', 'favicon cuadrado, sombra, densidad, anuncio con vigencia y accesos rápidos');
select is(pg_temp.save_theme(jsonb_build_object('favicon_media_id', tests.fx('fav_wide'))),
          'validation_failed:favicon_media_id', 'un favicon que no es cuadrado se rechaza');
select is(pg_temp.save_theme(jsonb_build_object('favicon_media_id', tests.fx('fav_b'))),
          'validation_failed:favicon_media_id', 'el favicon de otra tienda se rechaza');
select is(pg_temp.save_theme('{"header":{"announcement":{"text":"x","background":"#111827","foreground":"#ffffff","starts_at":"2026-11-17T00:00Z","ends_at":"2026-11-13T00:00Z"}}}'),
          'validation_failed:', 'un anuncio que termina antes de empezar se rechaza');

-- 2. Bloques v2 con referencias de la tienda.
select is(pg_temp.save_home(jsonb_build_array(
  pg_temp.sec(1, 'featured_products', jsonb_build_object('title', 'Favoritos', 'limit', 4, 'show_view_all', false,
                'layout', 'carousel',
                'source', jsonb_build_object('type', 'manual',
                            'product_ids', jsonb_build_array(tests.fx('dos'), tests.fx('agotado'), tests.fx('uno'))))),
  pg_temp.sec(2, 'goals', jsonb_build_object('title', 'Tu objetivo',
                'value_ids', jsonb_build_array(tests.fx('fuerza'), tests.fx('energia')))),
  pg_temp.sec(3, 'faq', '{"title":"Preguntas","items":[{"question":"¿Envían?","answer":"Sí."}]}',
              '{"visibility":"mobile"}'),
  pg_temp.sec(4, 'benefits', '{"items":[{"icon":"truck","title":"Envío gratis"}]}', '{"visibility":"desktop"}'),
  pg_temp.sec(5, 'video', '{"provider":"youtube","video_id":"dQw4w9WgXcQ","title":"Cómo se usa"}'),
  pg_temp.sec(6, 'contact_map', '{"title":"Visítanos","show_whatsapp":true}'),
  pg_temp.sec(7, 'reviews', '{"title":"Opiniones","limit":3}'),
  pg_temp.sec(8, 'rich_text', '{"html":"<p>Ya terminó</p>"}', '{"ends_at":"2020-01-01T00:00:00Z"}'),
  pg_temp.sec(9, 'rich_text', '{"html":"<p>Aún no empieza</p>"}', '{"starts_at":"2099-01-01T00:00:00Z"}'),
  pg_temp.sec(10, 'rich_text', '{"html":"<p>Vigente</p>"}',
              '{"starts_at":"2020-01-01T00:00:00Z","ends_at":"2099-01-01T00:00:00Z"}'))),
  'ok', 'la portada v2 se guarda con referencias de la propia tienda');
select ok(pg_temp.save_home(jsonb_build_array(pg_temp.sec(1, 'featured_products',
            jsonb_build_object('title', 'x', 'limit', 4, 'show_view_all', false,
              'source', jsonb_build_object('type', 'manual', 'product_ids', jsonb_build_array(tests.fx('ajena')))))))
          like 'validation_failed%', 'un producto de otra tienda se rechaza');
select ok(pg_temp.save_home(jsonb_build_array(pg_temp.sec(1, 'goals',
            jsonb_build_object('title', 'x', 'value_ids', jsonb_build_array(tests.fx('energia_b')))))) like 'validation_failed%',
          'un objetivo de otra tienda se rechaza');
select ok(pg_temp.save_home(jsonb_build_array(pg_temp.sec(1, 'video',
            '{"provider":"youtube","video_id":"<script>","title":"x"}'))) like 'validation_failed%',
          'un video con código que no es un id se rechaza');
select public.appearance_publish_theme(tests.fx('store_a'), tests.theme_rev(tests.fx('store_a')));
select tests.logout();

-- 3. Lo que ve la tienda.
select is(pg_temp.types(),
          array['featured_products', 'goals', 'faq', 'benefits', 'video', 'contact_map', 'rich_text'],
          'sin opiniones publicadas el bloque no sale; tampoco los bloques fuera de vigencia');
select is(pg_temp.gw('get_home') #>> '{sections,6,html}', '<p>Vigente</p>', 'el bloque vigente sí se muestra');
select is((select array_agg(i ->> 'slug') from jsonb_array_elements(pg_temp.gw('get_home') #> '{sections,0,items}') i),
          array['dos', 'uno'], 'elegidos a mano: en el orden elegido y sin agotados');
select is(pg_temp.gw('get_home') #>> '{sections,0,layout}', 'carousel', 'con su diseño');
select is((select array_agg(g ->> 'label') from jsonb_array_elements(pg_temp.gw('get_home') #> '{sections,1,goals}') g),
          array['Fuerza', 'Energía'], 'objetivos en el orden elegido');
select is(pg_temp.gw('get_home') #>> '{sections,2,visibility}', 'mobile', 'la visibilidad viaja a la tienda');
select is(pg_temp.gw('get_home') #>> '{sections,4,visibility}', 'all', 'sin visibilidad: en todos los dispositivos');
select is(pg_temp.gw('get_home') #>> '{sections,4,video_id}', 'dQw4w9WgXcQ', 'el video viaja como id, no como URL');
select is((select t.settings #>> '{shape,density}' from public.store_themes t where t.store_id = tests.fx('store_a')),
          'spacious', 'el tema publicado guarda la densidad');
select is((select theme_version from public.store_themes where store_id = tests.fx('store_a')), 2,
          'las tiendas quedan en el tema v2');

-- 4. Cumplimiento: los términos prohibidos también se buscan en las preguntas y los beneficios.
select ok(app.home_section_text(pg_temp.sec(1, 'faq',
            '{"title":"P","items":[{"question":"¿Cura?","answer":"Te cura rapidísimo"}]}')) like '%rapidísimo%',
          'el texto de las preguntas frecuentes se revisa');
select ok(app.home_section_text(pg_temp.sec(1, 'benefits',
            '{"items":[{"icon":"star","title":"Milagroso","text":"Resultados garantizados"}]}')) like '%Milagroso%garantizados%',
          'el de los beneficios también');
select ok(app.home_section_text(pg_temp.sec(1, 'video',
            '{"provider":"youtube","video_id":"dQw4w9WgXcQ","title":"Video","caption":"Cura todo"}')) like '%Cura todo%',
          'y el pie del video');

-- 5. Permisos: las funciones nuevas no se exponen.
select ok(not has_function_privilege('authenticated', 'app.home_product_cards(uuid, uuid[])', 'execute')
          and not has_function_privilege('storefront_gateway', 'app.home_product_cards(uuid, uuid[])', 'execute')
          and not has_function_privilege('anon', 'app.theme_instant_valid(jsonb)', 'execute'),
          'las funciones nuevas no se conceden a nadie');

select * from finish();
rollback;
