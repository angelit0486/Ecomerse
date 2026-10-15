-- =============================================================================
-- Fase 9 · F9-T02 — Portada por secciones (F9-DESIGN §3, §13 M1, M4): la tienda
-- muestra solo las secciones habilitadas, resueltas, en su orden; omite las que
-- perdieron su referencia; la vista previa muestra el borrador; la revisión de
-- cumplimiento oculta una sección con un término prohibido.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('padmin', 'admin@plataforma.io');
select tests.create_tenant('a', 'owner');
select tests.make_platform_staff('padmin', 'platform_admin');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

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
          'image/png', 100, 1600, 600, 'Imagen ' || p_owner)
  returning id $$;
create function pg_temp.sec(p_n integer, p_type text, p_props jsonb, p_enabled boolean default true)
returns jsonb language sql as $$
  select jsonb_build_object('id', '00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'),
                            'type', p_type, 'enabled', p_enabled, 'props', p_props)
$$;
grant execute on all functions in schema tests to authenticated;

select tests.set_fx('banner', tests.media('banner'));
select tests.set_fx('banner2', tests.media('banner'));
select tests.set_fx('logo1', tests.media('store_branding'));
select tests.set_fx('logo2', tests.media('store_branding'));
insert into public.brands (store_id, name, slug, logo_media_id) values
  (tests.fx('store_a'), 'Marca Uno', 'marca-uno', tests.fx('logo1')),
  (tests.fx('store_a'), 'Marca Dos', 'marca-dos', tests.fx('logo2'));
select tests.set_fx('marca1', (select id from public.brands where slug = 'marca-uno' and store_id = tests.fx('store_a')));
select tests.set_fx('marca2', (select id from public.brands where slug = 'marca-dos' and store_id = tests.fx('store_a')));

select tests.login('owner');
select tests.set_fx('objetivo', public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Objetivo","values":[{"label":"Energía"},{"label":"Fuerza"}]}'));
select tests.set_fx('energia', (select id from public.attribute_values where attribute_id = tests.fx('objetivo') and key = 'energia'));
create function pg_temp.product(p_title text, p_slug text) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object('title', p_title, 'slug', p_slug,
          'variants', '[{"price":19900}]'::jsonb)) ->> 'id')::uuid;
  perform public.catalog_publish_product(tests.fx('store_a'), v);
  return v;
end $$;
select tests.set_fx('cafeina', pg_temp.product('Cafeína', 'cafeina'));
select tests.set_fx('creatina', pg_temp.product('Creatina', 'creatina'));
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('cafeina'), array[tests.fx('energia')]);

-- Sin secciones: la plantilla del tema.
select tests.logout();
-- Con existencias: la portada no muestra agotados (Gate F9, prueba 57).
update public.product_variants set track_inventory = false where store_id = tests.fx('store_a');
select ok(pg_temp.gw('get_home') ? 'featured' and pg_temp.gw('get_home') -> 'sections' = 'null'::jsonb,
          'sin secciones publicadas: productos recientes y categorías (plantilla del tema)');

select tests.login('owner');
select public.appearance_save_home_draft(tests.fx('store_a'), jsonb_build_array(
  pg_temp.sec(1, 'hero', jsonb_build_object('heading', 'Todo para tu objetivo', 'align', 'center',
                                             'image_media_id', tests.fx('banner'),
                                             'cta', jsonb_build_object('label', 'Comprar', 'link', '/productos'))),
  pg_temp.sec(2, 'featured_products', jsonb_build_object('title', 'Energía', 'limit', 8, 'show_view_all', true,
                'source', jsonb_build_object('type', 'attribute_value', 'id', tests.fx('energia')))),
  pg_temp.sec(3, 'rich_text', '{"html":"<p>Oculta</p>"}', false),
  pg_temp.sec(4, 'promo_banner', jsonb_build_object('image_media_id', tests.fx('banner2'), 'heading', '2x1')),
  pg_temp.sec(5, 'brand_logos', jsonb_build_object('title', 'Marcas',
                'brand_ids', jsonb_build_array(tests.fx('marca2'), tests.fx('marca1')))),
  pg_temp.sec(6, 'testimonials', '{"title":"Opiniones","items":[{"quote":"Llegó rapidísimo","author":"Ana"}]}')),
  tests.theme_rev(tests.fx('store_a')));
select tests.logout();

select is(pg_temp.gw('get_home_preview') #>> '{sections,0,heading}', 'Todo para tu objetivo',
          'la vista previa muestra la portada del borrador');
select ok(pg_temp.gw('get_home') ? 'featured', 'la tienda pública sigue con lo publicado');

select tests.login('owner');
select public.appearance_publish_theme(tests.fx('store_a'), tests.theme_rev(tests.fx('store_a')));
select tests.logout();

select is((select array_agg(e ->> 'type' order by o) from jsonb_array_elements(pg_temp.gw('get_home') -> 'sections')
            with ordinality x(e, o)),
          array['hero', 'featured_products', 'promo_banner', 'brand_logos', 'testimonials'],
          'publicada: solo las habilitadas, en su orden');
select is(pg_temp.gw('get_home') #>> '{sections,0,image,alt}', 'Imagen banner', 'el hero con su imagen y texto alternativo');
select is((select array_agg(i ->> 'slug') from jsonb_array_elements(pg_temp.gw('get_home') #> '{sections,1,items}') i),
          array['cafeina'], '"comprar por objetivo": solo los productos de ese valor');
select is(pg_temp.gw('get_home') #> '{sections,1,source}', '{"type":"attribute_value","attribute":"objetivo","value":"energia"}'::jsonb,
          'con lo necesario para "ver todos"');
select is((select array_agg(b ->> 'slug') from jsonb_array_elements(pg_temp.gw('get_home') #> '{sections,3,brands}') b),
          array['marca-dos', 'marca-uno'], 'marcas en el orden elegido');

-- Referencias que desaparecen: la sección se omite, nunca se muestra rota.
update public.media set deleted_at = now() where id = tests.fx('banner2');
update public.media set deleted_at = now() where id = tests.fx('logo1');
select tests.login('owner');
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('cafeina'), '{}'::uuid[]);
select tests.logout();
select is((select array_agg(e ->> 'type' order by o) from jsonb_array_elements(pg_temp.gw('get_home') -> 'sections')
            with ordinality x(e, o)),
          array['hero', 'testimonials'],
          'sin banner, con una sola marca con logo o sin productos, la sección no se muestra');
update public.media set deleted_at = now() where id = tests.fx('banner');
select is(pg_temp.gw('get_home') #> '{sections,0,image}', 'null'::jsonb, 'un hero sin imagen sigue con su texto');

-- Revisión de cumplimiento de la portada publicada (§13 M1).
select tests.set_fx('profile', (select id from public.compliance_profiles
                                 where country = 'MX' and category_key = 'dietary_supplement'));
select tests.login('padmin');
select public.platform_compliance_rule_save(tests.fx('profile'),
  '{"kind":"forbidden_term","key":"no_rapidisimo","label":"Prueba","body":"rapidísimo"}');
select public.platform_compliance_profile_set_status(tests.fx('profile'), 'active', 'Asesoría de prueba', null);
select tests.logout();
select tests.login('owner');
select public.catalog_classify_active_unregulated(tests.fx('store_a'));
select public.compliance_set_store_category(tests.fx('store_a'), 'dietary_supplement', true);
select tests.logout();
create function pg_temp.recheck_home() returns uuid[] language plpgsql as $$
declare v uuid[];
begin
  perform tests.as_role('system_worker');
  v := system.compliance_recheck_home(null, tests.fx('store_a'));
  perform tests.logout();
  return v;
end $$;
select is(pg_temp.recheck_home()::text, array[tests.fx('store_a')]::text,
          'la revisión devuelve las tiendas cuya portada cambió');
select is((select array_agg(e ->> 'type') from jsonb_array_elements(pg_temp.gw('get_home') -> 'sections') e),
          array['hero'], 'y oculta la sección con el término prohibido');
select is((select a.reason from audit.audit_logs a where a.action = 'theme.home_sections_hidden'
            and a.store_id = tests.fx('store_a')), 'compliance', 'con auditoría y motivo');

select ok(has_function_privilege('storefront_gateway', 'storefront.get_home_preview(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'storefront.get_home_preview(uuid)', 'execute'),
          'la portada del borrador solo la lee storefront_gateway');
select ok(has_function_privilege('system_worker', 'system.compliance_recheck_home(uuid, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'system.compliance_recheck_home(uuid, uuid)', 'execute')
          and not has_function_privilege('storefront_gateway', 'app.home_resolve(uuid, jsonb)', 'execute'),
          'la revisión solo la ejecuta el worker');

select * from finish();
rollback;
