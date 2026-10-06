-- =============================================================================
-- Fase 5 · RPC del editor de páginas y menús (F5-T06).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('cat', 'cat@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'cat', 'catalog_manager');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
create function tests.page_id(p_store text, p_slug text) returns uuid
language sql security definer set search_path = '' as
  $$ select id from public.store_pages where store_id = tests.fx('store_' || p_store) and slug = p_slug
      and deleted_at is null $$;
grant execute on all functions in schema tests to authenticated;

-- ============================================================================ Páginas
select tests.login('owner');
select is((public.content_upsert_page(tests.fx('store_a'), '{"title":"Quiénes somos","body_html":"<p>Hola</p>"}')
  ->> 'slug'), 'quienes-somos', 'alta de página con slug derivado');
select throws_ok($$ select public.content_upsert_page(tests.fx('store_a'), '{"title":"Quiénes somos"}') $$,
  'P0001', 'validation_failed', 'slug repetido en la tienda');
select lives_ok(format($$ select public.content_set_page_published(%L, %L, true) $$, tests.fx('store_a'),
  tests.page_id('a', 'quienes-somos')), 'publicar');
select throws_ok(format($$ select public.content_upsert_page(%L, '{"id":"%s","title":"Quiénes somos","slug":"nosotros"}') $$,
  tests.fx('store_a'), tests.page_id('a', 'quienes-somos')), 'P0001', 'validation_failed',
  'una página publicada no cambia de dirección (sin 301 en el MVP)');
select lives_ok(format($$ select public.content_upsert_page(%L, '{"id":"%s","title":"Sobre nosotros","body_html":"<p>Hola de nuevo</p>"}') $$,
  tests.fx('store_a'), tests.page_id('a', 'quienes-somos')), 'editar el contenido conserva la dirección');
select is((select title from public.store_pages where id = tests.page_id('a', 'quienes-somos')), 'Sobre nosotros',
  'título actualizado');
select lives_ok(format($$ select public.content_set_page_published(%L, %L, true) $$, tests.fx('store_a'),
  tests.page_id('a', 'aviso-de-privacidad')), 'publicar una política');
select throws_ok(format($$ select public.content_delete_page(%L, %L) $$, tests.fx('store_a'),
  tests.page_id('a', 'aviso-de-privacidad')), 'P0001', 'conflict', 'las políticas no se borran');
select lives_ok(format($$ select public.content_delete_page(%L, %L) $$, tests.fx('store_a'),
  tests.page_id('a', 'quienes-somos')), 'borrar una página de contenido');
select is((select is_published from public.store_pages where store_id = tests.fx('store_a') and slug = 'quienes-somos'),
  false, 'borrada = despublicada');

-- Permisos y aislamiento
select tests.logout(); select tests.login('cat');
select throws_ok($$ select public.content_upsert_page(tests.fx('store_a'), '{"title":"X"}') $$, '42501', 'forbidden',
  'catalog_manager no edita páginas');
select throws_ok($$ select public.menu_set_items(tests.fx('store_a'), 'main', '[]') $$, '42501', 'forbidden',
  'ni menús');
select tests.logout(); select tests.login('owner_b');
select throws_ok(format($$ select public.content_set_page_published(%L, %L, true) $$, tests.fx('store_b'),
  tests.page_id('a', 'envios')), 'P0001', 'not_found', 'una página de A no existe para B');

-- ============================================================================ Menús
select tests.logout(); select tests.login('owner');
select tests.set_fx('cat_ropa', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Ropa"}'));
select lives_ok(format($$ select public.menu_set_items(%L, 'main', jsonb_build_array(
  jsonb_build_object('label', 'Inicio', 'link_type', 'home'),
  jsonb_build_object('label', 'Ropa', 'link_type', 'category', 'target_id', %L, 'children', jsonb_build_array(
    jsonb_build_object('label', 'Envíos', 'link_type', 'page', 'target_id', %L))),
  jsonb_build_object('label', 'Blog', 'link_type', 'url', 'url', 'https://blog.example.com'))) $$,
  tests.fx('store_a'), tests.fx('cat_ropa'), tests.page_id('a', 'envios')), 'guardar el menú principal');
select is((select count(*)::int from public.menu_items where store_id = tests.fx('store_a')), 4, '4 ítems (uno anidado)');
select lives_ok(format($$ select public.menu_set_items(%L, 'main', jsonb_build_array(
  jsonb_build_object('label', 'Inicio', 'link_type', 'home'))) $$, tests.fx('store_a')), 'reemplazar el menú');
select is((select count(*)::int from public.menu_items where store_id = tests.fx('store_a')), 1, 'el menú se reemplaza');
select tests.logout(); select tests.login('owner_b');
select throws_ok(format($$ select public.menu_set_items(%L, 'main', jsonb_build_array(
  jsonb_build_object('label', 'Robado', 'link_type', 'category', 'target_id', %L))) $$,
  tests.fx('store_b'), tests.fx('cat_ropa')), 'P0001', 'validation_failed',
  'un menú de B no enlaza una categoría de A');
select tests.logout(); select tests.login('owner');
select throws_ok(format($$ select public.menu_set_items(%L, 'main', jsonb_build_array(
  jsonb_build_object('label', 'X', 'link_type', 'url', 'url', 'javascript:alert(1)'))) $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'URL javascript: rechazada');
select throws_ok(format($$ select public.menu_set_items(%L, 'main', jsonb_build_array(
  jsonb_build_object('label', 'A', 'link_type', 'home', 'children', jsonb_build_array(
    jsonb_build_object('label', 'B', 'link_type', 'home', 'children', jsonb_build_array(
      jsonb_build_object('label', 'C', 'link_type', 'home'))))))) $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'máximo dos niveles');
select tests.logout();

select * from finish();
rollback;
