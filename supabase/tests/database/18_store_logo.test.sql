-- =============================================================================
-- Fase 3 · Logo de la tienda (F3-T06).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('cat', 'cat@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'cat', 'catalog_manager');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

-- Medios: logo listo de A, logo pendiente de A, imagen de producto de A, logo de B.
create function tests.media(p_store text, p_owner text, p_status text) returns uuid
language sql security definer set search_path = '' as $$
  insert into public.media (store_id, owner_type, product_id, status, storage_path, mime_type, bytes)
  values (tests.fx('store_' || p_store), p_owner,
          case when p_owner = 'product' then
            (select id from public.products where store_id = tests.fx('store_' || p_store) limit 1) end,
          p_status, tests.fx('store_' || p_store) || '/' || p_owner || '/x/' || gen_random_uuid() || '/original.png',
          'image/png', 100)
  returning id $$;
create function tests.theme(p_store text) returns public.store_themes
language sql security definer set search_path = '' as
  $$ select * from public.store_themes where store_id = tests.fx('store_' || p_store) $$;
grant execute on all functions in schema tests to authenticated;

select tests.login('owner');
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"P","variants":[{"price":100}]}');
select tests.logout();
select tests.set_fx('logo', tests.media('a', 'store_branding', 'ready'));
select tests.set_fx('pending', tests.media('a', 'store_branding', 'pending'));
select tests.set_fx('product_img', tests.media('a', 'product', 'ready'));
select tests.set_fx('logo_b', tests.media('b', 'store_branding', 'ready'));

select fk_ok('public', 'store_themes', array['store_id', 'logo_media_id'], 'public', 'media', array['store_id', 'id'],
  'FK compuesta del logo publicado');
select fk_ok('public', 'store_themes', array['store_id', 'draft_logo_media_id'], 'public', 'media',
  array['store_id', 'id'], 'FK compuesta del logo del borrador');

select tests.login('owner');
select lives_ok(format($$ select public.appearance_set_logo_draft(%1$L, %2$L, tests.theme_rev(%1$L)) $$, tests.fx('store_a'), tests.fx('logo')),
  'el dueño elige un logo listo de su tienda');
select is((tests.theme('a')).draft_logo_media_id, tests.fx('logo'), 'queda en el borrador');
select is((tests.theme('a')).logo_media_id, null, 'no se publica hasta publicar el tema');
select throws_ok(format($$ select public.appearance_set_logo_draft(%1$L, %2$L, tests.theme_rev(%1$L)) $$, tests.fx('store_a'), tests.fx('pending')),
  'P0001', 'validation_failed', 'un medio sin procesar no es logo');
select throws_ok(format($$ select public.appearance_set_logo_draft(%1$L, %2$L, tests.theme_rev(%1$L)) $$, tests.fx('store_a'), tests.fx('product_img')),
  'P0001', 'validation_failed', 'una imagen de producto no es logo');
select throws_ok(format($$ select public.appearance_set_logo_draft(%1$L, %2$L, tests.theme_rev(%1$L)) $$, tests.fx('store_a'), tests.fx('logo_b')),
  'P0001', 'validation_failed', 'el logo de otra tienda no sirve');

select lives_ok(format($$ select public.appearance_save_theme_draft(%1$L,
  '{"colors":{"primary":"#111111","accent":"#0055aa","background":"#ffffff","foreground":"#111111","muted":"#555555"}}', tests.theme_rev(%1$L)) $$,
  tests.fx('store_a')), 'guardar colores con el borrador abierto');
select is((tests.theme('a')).draft_logo_media_id, tests.fx('logo'), 'guardar colores conserva el logo del borrador');
select lives_ok(format($$ select public.appearance_publish_theme(%1$L, tests.theme_rev(%1$L)) $$, tests.fx('store_a')), 'publicar el tema');
select is((tests.theme('a')).logo_media_id, tests.fx('logo'), 'el logo se publica con el tema');
select tests.logout();

select is((storefront.get_store_public(tests.fx('store_a')) -> 'logo' ->> 'path'),
  (select storage_path from public.media where id = tests.fx('logo')), 'el storefront ve el logo publicado');

select tests.login('cat');
select throws_ok(format($$ select public.appearance_set_logo_draft(%1$L, null, tests.theme_rev(%1$L)) $$, tests.fx('store_a')),
  '42501', 'forbidden', 'sin appearance.manage no se cambia el logo');
select tests.logout(); select tests.login('owner');
select lives_ok(format($$ select public.media_delete(%L, %L) $$, tests.fx('store_a'), tests.fx('logo')),
  'borrar el medio del logo');
select tests.logout();
select is((storefront.get_store_public(tests.fx('store_a')) -> 'logo'), 'null'::jsonb,
  'un logo borrado deja de mostrarse y sale del tema');

select * from finish();
rollback;
