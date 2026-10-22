-- =============================================================================
-- Fase 9 · Theme schema v1 y su borrador (F9-DESIGN §2–§4 y §13). La forma de
-- cada clave y cada sección la cubre la prueba de paridad con Zod
-- (tests/integration/theme-schema-parity.test.ts); aquí, lo que depende de la
-- tienda: borrador atómico, parche, revisión, contraste, referencias,
-- cumplimiento de la portada, publicación, permisos y auditoría.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '') || coalesce('/' || nullif(v_hint, ''), '');
end $$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('cat', 'cat@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('padmin', 'admin@plataforma.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'cat', 'catalog_manager');
select tests.make_platform_staff('padmin', 'platform_admin');

create function tests.media(p_store text, p_owner text) returns uuid
language sql security definer set search_path = '' as $$
  insert into public.media (store_id, owner_type, product_id, status, storage_path, mime_type, bytes, alt_text)
  values (tests.fx('store_' || p_store), p_owner,
          case when p_owner = 'product' then
            (select id from public.products where store_id = tests.fx('store_' || p_store) limit 1) end,
          'ready', tests.fx('store_' || p_store) || '/' || p_owner || '/x/' || gen_random_uuid() || '/original.png',
          'image/png', 100, 'Imagen')
  returning id $$;
create function tests.theme(p_store text) returns public.store_themes
language sql security definer set search_path = '' as
  $$ select * from public.store_themes where store_id = tests.fx('store_' || p_store) $$;
create function tests.rev(p_store text) returns integer language sql as
  $$ select tests.theme_rev(tests.fx('store_' || p_store)) $$;
grant execute on all functions in schema tests to authenticated;

-- Lo que la portada referencia: imágenes, categorías, marcas y valores de atributo.
select tests.login('owner');
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"P","variants":[{"price":100}]}');
select tests.set_fx('objetivo', public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Objetivo","values":[{"label":"Energía"}]}'));
select tests.set_fx('sabor', public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Sabor","is_filterable":false,"values":[{"label":"Chocolate"}]}'));
select tests.logout();
select tests.login('owner_b');
select tests.set_fx('objetivo_b', public.catalog_save_attribute(tests.fx('store_b'),
  '{"name":"Objetivo","values":[{"label":"Energía"}]}'));
select tests.logout();
select tests.set_fx('banner', tests.media('a', 'banner'));
select tests.set_fx('branding', tests.media('a', 'store_branding'));
select tests.set_fx('product_img', tests.media('a', 'product'));
select tests.set_fx('banner_b', tests.media('b', 'banner'));
select tests.set_fx('energia', (select id from public.attribute_values where attribute_id = tests.fx('objetivo')));
select tests.set_fx('chocolate', (select id from public.attribute_values where attribute_id = tests.fx('sabor')));
select tests.set_fx('energia_b', (select id from public.attribute_values where attribute_id = tests.fx('objetivo_b')));
insert into public.categories (store_id, name, slug, is_visible) values (tests.fx('store_a'), 'Oculta', 'oculta', false)
returning tests.set_fx('oculta', id);
insert into public.brands (store_id, name, slug) values (tests.fx('store_a'), 'Sin logo', 'sin-logo')
returning tests.set_fx('sin_logo', id);
insert into public.brands (store_id, name, slug, logo_media_id) values (tests.fx('store_a'), 'Con logo', 'con-logo', tests.fx('branding'))
returning tests.set_fx('con_logo', id);

-- -----------------------------------------------------------------------------
-- Esquema
-- -----------------------------------------------------------------------------
select has_column('public', 'store_themes', 'draft_revision', 'revisión del borrador (ediciones simultáneas)');
select ok(exists (select 1 from pg_constraint where conname = 'store_themes_draft_atomic'),
          'el borrador es atómico: tema y portada se siembran juntos');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
            where p.pronamespace = 'app'::regnamespace
              and p.proname in ('theme_settings_valid', 'home_sections_valid', 'home_section_props_valid',
                                'home_cta_valid', 'theme_text_valid', 'theme_hex_valid', 'theme_uuid_valid',
                                'theme_link_valid', 'theme_social_url_valid', 'theme_keys_ok', 'theme_font_keys',
                                'theme_payment_methods', 'theme_social_networks', 'theme_enum_list_valid',
                                'theme_uuid_list_valid')
              and p.provolatile <> 'i'), null,
          'las funciones de los CHECK son immutable (§13 H3)');
select ok(not has_function_privilege('authenticated', 'app.theme_lock_draft(uuid, integer)', 'execute')
          and not has_function_privilege('anon', 'public.appearance_publish_theme(uuid, integer)', 'execute'),
          'los auxiliares del borrador no se ejecutan desde fuera');

-- -----------------------------------------------------------------------------
-- Borrador: siembra, parche y revisión
-- -----------------------------------------------------------------------------
select tests.login('owner');
select is(public.appearance_save_theme_draft(tests.fx('store_a'),
            '{"header":{"announcement":{"text":"Envío gratis desde $999","background":"#111827","foreground":"#ffffff"}}}',
            tests.rev('a')), 1, 'guardar devuelve la revisión nueva');
select is((tests.theme('a')).draft_home_sections, '[]'::jsonb, 'la primera edición siembra también la portada');
select lives_ok(format($$ select public.appearance_save_theme_draft(%L, '{"colors":{"primary":"#0f766e"}}', 1) $$,
                       tests.fx('store_a')), 'un parche de colores');
select is((tests.theme('a')).draft_settings #>> '{header,announcement,text}', 'Envío gratis desde $999',
          'el parche conserva lo que no se mandó (§13 C2)');
select is(pg_temp.err(format($$ select public.appearance_save_theme_draft(%L, '{"seo":{"title":"X"}}', 1) $$,
                             tests.fx('store_a'))),
          'conflict/draft_revision/2', 'otra persona ya guardó: conflict con la revisión actual (§13 H1)');
select lives_ok(format($$ select public.appearance_save_theme_draft(%L, '{"header":null}', 2) $$, tests.fx('store_a')),
          'null quita una clave');
select is((tests.theme('a')).draft_settings, '{"colors":{"primary":"#0f766e"}}'::jsonb, 'y queda sin encabezado');
select is(pg_temp.err(format($$ select public.appearance_save_theme_draft(%L, '{"css":"body{}"}', 3) $$, tests.fx('store_a'))),
          'validation_failed/settings', 'una clave fuera del esquema no se guarda');
select is(pg_temp.err(format($$ select public.appearance_save_theme_draft(%L,
            '{"header":{"announcement":{"text":"Hola","background":"#ffffff","foreground":"#777777"}}}', 3) $$,
            tests.fx('store_a'))),
          'validation_failed/contrast/announcement', 'la barra de anuncio exige 4.5:1');
select is(pg_temp.err(format($$ select public.appearance_save_theme_draft(%L,
            '{"colors":{"primary":"#949494"},"shape":{"button_style":"outline"}}', 3) $$, tests.fx('store_a'))),
          'validation_failed/contrast/primary', 'un botón outline exige 4.5:1 (§13 M5)');
select is(pg_temp.err(format($$ select public.appearance_save_theme_draft(%L, %L, 3) $$, tests.fx('store_a'),
            jsonb_build_object('seo', jsonb_build_object('image_media_id', tests.fx('banner_b'))))),
          'validation_failed/references/seo.image_media_id', 'la imagen social de otra tienda no sirve');
select is(pg_temp.err(format($$ select public.appearance_save_theme_draft(%L, %L, 3) $$, tests.fx('store_a'),
            jsonb_build_object('seo', jsonb_build_object('title', 'Mi tienda', 'image_media_id', tests.fx('banner'))))),
          'ok', 'una imagen social propia y lista, sí');

-- -----------------------------------------------------------------------------
-- Portada: referencias y HTML
-- -----------------------------------------------------------------------------
create function pg_temp.home(p_sections jsonb) returns text language sql as $$
  select pg_temp.err(format('select public.appearance_save_home_draft(%L, %L, %s)', tests.fx('store_a'), p_sections,
                            tests.rev('a')))
$$;
create function pg_temp.sec(p_n integer, p_type text, p_props jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'),
                                              'type', p_type, 'enabled', true, 'props', p_props))
$$;
select is(pg_temp.home(pg_temp.sec(1, 'hero', jsonb_build_object('heading', 'Hola', 'align', 'center',
                                                                  'image_media_id', tests.fx('product_img')))),
          'validation_failed/references/00000000-0000-4000-8000-000000000001:image_media_id',
          'una imagen de producto no es un banner');
select is(pg_temp.home(pg_temp.sec(2, 'featured_products', jsonb_build_object('title', 'Energía', 'limit', 8,
            'show_view_all', true, 'source', jsonb_build_object('type', 'attribute_value', 'id', tests.fx('energia_b'))))),
          'validation_failed/references/00000000-0000-4000-8000-000000000002:source',
          'un valor de atributo de otra tienda no sirve');
select is(pg_temp.home(pg_temp.sec(2, 'featured_products', jsonb_build_object('title', 'Chocolate', 'limit', 8,
            'show_view_all', true, 'source', jsonb_build_object('type', 'attribute_value', 'id', tests.fx('chocolate'))))),
          'validation_failed/references/00000000-0000-4000-8000-000000000002:source',
          'ni uno de un atributo que no filtra');
select is(pg_temp.home(pg_temp.sec(3, 'brand_logos', jsonb_build_object('title', 'Marcas',
            'brand_ids', jsonb_build_array('00000000-0000-4000-8000-0000000000ff', tests.fx('con_logo'))))),
          'validation_failed/references/00000000-0000-4000-8000-000000000003:brand_ids',
          -- Tema v4: una marca sin logo sí vale (iniciales, pgTAP 97); una que no existe, no.
          'una marca que no existe se rechaza');
select is(pg_temp.home(pg_temp.sec(4, 'category_grid', jsonb_build_object('title', 'Categorías',
            'category_ids', jsonb_build_array(tests.fx('oculta'))))),
          'validation_failed/references/00000000-0000-4000-8000-000000000004:category_ids',
          'una categoría oculta no va en la portada');
select is(pg_temp.home(pg_temp.sec(5, 'rich_text', '{"html":"<p onclick=\"x()\">Hola</p>"}')),
          'validation_failed/html', 'HTML con eventos no se guarda (defensa adicional al saneado)');
select is(pg_temp.home('[{"type":"hero"}]'), 'validation_failed/sections', 'una sección mal formada no se guarda');
select is(pg_temp.home(
            pg_temp.sec(1, 'hero', jsonb_build_object('heading', 'Todo para tu objetivo', 'align', 'center',
                                                       'image_media_id', tests.fx('banner')))
            || pg_temp.sec(2, 'featured_products', jsonb_build_object('title', 'Energía', 'limit', 8,
                 'show_view_all', true, 'source', jsonb_build_object('type', 'attribute_value', 'id', tests.fx('energia'))))),
          'ok', 'hero con banner propio y "comprar por objetivo"');

-- -----------------------------------------------------------------------------
-- Publicar y descartar (§13 C1)
-- -----------------------------------------------------------------------------
select lives_ok(format($$ select public.appearance_set_logo_draft(%L, %L, %s) $$, tests.fx('store_a'),
                       tests.fx('branding'), tests.rev('a')), 'logo en el borrador');
-- 6 ediciones aceptadas hasta aquí (las rechazadas no cuentan): publicar deja la 7.
select is((public.appearance_publish_theme(tests.fx('store_a'), 6) ->> 'revision')::integer, 7,
          'publicar devuelve la revisión nueva');
select is(pg_temp.home(pg_temp.sec(9, 'rich_text', '{"html":"<p>Envíos a todo México</p>"}')), 'ok',
          'después, solo se edita la portada');
select lives_ok(format($$ select public.appearance_publish_theme(%L, %s) $$, tests.fx('store_a'), tests.rev('a')),
          'y se publica solo la portada');
select is((tests.theme('a')).logo_media_id, tests.fx('branding'), 'publicar solo la portada conserva el logo');
select is((tests.theme('a')).settings #>> '{seo,title}', 'Mi tienda', 'y el tema');
select is((tests.theme('a')).home_sections #>> '{0,type}', 'rich_text', 'y publica la portada nueva');
select is(pg_temp.err(format($$ select public.appearance_publish_theme(%L, %s) $$, tests.fx('store_a'), tests.rev('a'))),
          'validation_failed/no_draft', 'sin borrador no hay nada que publicar');
select lives_ok(format($$ select public.appearance_save_theme_draft(%L, '{"colors":{"primary":"#000000"}}', %s) $$,
                       tests.fx('store_a'), tests.rev('a')), 'un borrador nuevo');
select lives_ok(format($$ select public.appearance_discard_draft(%L, %s) $$, tests.fx('store_a'), tests.rev('a')),
          'se descarta');
select ok((tests.theme('a')).draft_settings is null and (tests.theme('a')).draft_home_sections is null
          and (tests.theme('a')).settings #>> '{colors,primary}' = '#0f766e',
          'descartar vacía el borrador y no toca lo publicado');

-- Una imagen borrada entre guardar y publicar bloquea la publicación.
select lives_ok(format($$ select public.appearance_save_home_draft(%L, %L, %s) $$, tests.fx('store_a'),
                       pg_temp.sec(1, 'hero', jsonb_build_object('heading', 'Hola', 'align', 'center',
                                                                  'image_media_id', tests.fx('banner'))),
                       tests.rev('a')), 'portada con banner');
select tests.logout();
update public.media set deleted_at = now() where id = tests.fx('banner');
select tests.login('owner');
select is(pg_temp.err(format($$ select public.appearance_publish_theme(%L, %s) $$, tests.fx('store_a'), tests.rev('a'))),
          'validation_failed/references/seo.image_media_id,00000000-0000-4000-8000-000000000001:image_media_id',
          'publicar revalida las referencias');
select tests.logout();

-- -----------------------------------------------------------------------------
-- Cumplimiento de la portada (D-F9-03)
-- -----------------------------------------------------------------------------
update public.media set deleted_at = null where id = tests.fx('banner');
select tests.set_fx('profile', (select id from public.compliance_profiles
                                 where country = 'MX' and category_key = 'dietary_supplement'));
select tests.retire_compliance_rules(tests.fx('profile'));
select tests.login('padmin');
select public.platform_compliance_rule_save(tests.fx('profile'),
  '{"kind":"forbidden_term","key":"no_cura","label":"Afirmación curativa","body":"cura"}');
select public.platform_compliance_profile_set_status(tests.fx('profile'),
  'active', 'Asesoría de prueba', null);
select tests.logout();
select tests.login('owner');
select public.compliance_set_store_category(tests.fx('store_a'), 'dietary_supplement', true);
select public.appearance_discard_draft(tests.fx('store_a'), tests.rev('a'));
select public.appearance_save_home_draft(tests.fx('store_a'),
  pg_temp.sec(7, 'testimonials', '{"title":"Opiniones","items":[{"quote":"Es la cura del cansancio","author":"Ana"}]}')
  || pg_temp.sec(8, 'rich_text', '{"html":"<p>La c&uacute;ra natural</p>"}'),
  tests.rev('a'));
select is(pg_temp.err(format($$ select public.appearance_publish_theme(%L, %s) $$, tests.fx('store_a'), tests.rev('a'))),
          'validation_failed/compliance/compliance_forbidden_term:no_cura@00000000-0000-4000-8000-000000000007,'
          || 'compliance_forbidden_term:no_cura@00000000-0000-4000-8000-000000000008',
          'un término prohibido en la portada de una tienda regulada bloquea publicar (también en HTML con entidades)');
select tests.logout();
select tests.login('owner_b');
select public.appearance_save_home_draft(tests.fx('store_b'),
  pg_temp.sec(7, 'testimonials', '{"title":"Opiniones","items":[{"quote":"Es la cura del cansancio","author":"Ana"}]}'),
  tests.rev('b'));
select lives_ok(format($$ select public.appearance_publish_theme(%L, %s) $$, tests.fx('store_b'), tests.rev('b')),
          'una tienda que no vende productos regulados no tiene esas reglas');
select tests.logout();

-- -----------------------------------------------------------------------------
-- Permisos y auditoría
-- -----------------------------------------------------------------------------
select tests.login('cat');
select is(pg_temp.err(format($$ select public.appearance_save_home_draft(%L, '[]', %s) $$, tests.fx('store_a'), tests.rev('a'))),
          'forbidden', 'catalog_manager no edita la portada');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.err(format($$ select public.appearance_publish_theme(%L, %s) $$, tests.fx('store_a'), tests.rev('a'))),
          'forbidden', 'otra tienda no publica la apariencia de A');
select tests.logout();
select tests.login('owner', 'aal1');
select is(pg_temp.err(format($$ select public.appearance_discard_draft(%L, %s) $$, tests.fx('store_a'), tests.rev('a'))),
          'mfa_required', 'exige 2FA');
select is(tests.sqlstate_as('authenticated', format('update public.store_themes set draft_revision = 0 where store_id = %L',
                                                    tests.fx('store_a'))), '42501',
          'la revisión no se toca por tabla');
select tests.logout();
select is((select a.after ->> 'home_sections' is not null and a.before ? 'logo_media_id' from audit.audit_logs a
            where a.action = 'theme.published' and a.store_id = tests.fx('store_a') order by a.occurred_at desc limit 1),
          true, 'la publicación audita antes y después completos (§13 M6)');

select * from finish();
rollback;
