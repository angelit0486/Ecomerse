-- =============================================================================
-- Fase 5 · Contenido: menús, páginas y plantillas (F5-T01).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

select is((select string_agg(handle, ',' order by handle) from public.menus where store_id = tests.fx('store_a')),
  'footer,main', 'toda tienda nace con sus menús main y footer');
select is((select count(*)::int from public.store_pages where store_id = tests.fx('store_a') and type like 'policy_%'
            and not is_published), 4, 'y con cuatro políticas en borrador');
select ok((select bool_and(body_html like '%Plantilla en borrador%' and body_html like '%[%')
             from public.store_pages where store_id = tests.fx('store_a')),
  'las plantillas son guías con marcadores, no texto legal inventado');

-- Coherencia y profundidad de los menús (como postgres: la escritura llega por RPC en F5-T06).
select tests.set_fx('menu_a', (select id from public.menus where store_id = tests.fx('store_a') and handle = 'main'));
select throws_ok(format($$ insert into public.menu_items (store_id, menu_id, label, link_type, url)
  values (%L, %L, 'X', 'url', 'javascript:alert(1)') $$, tests.fx('store_a'), tests.fx('menu_a')),
  '23514', null, 'URL javascript: rechazada');
select throws_ok(format($$ insert into public.menu_items (store_id, menu_id, label, link_type, url)
  values (%L, %L, 'X', 'url', '//evil.example') $$, tests.fx('store_a'), tests.fx('menu_a')),
  '23514', null, 'URL relativa al protocolo rechazada');
select throws_ok(format($$ insert into public.menu_items (store_id, menu_id, label, link_type)
  values (%L, %L, 'X', 'category') $$, tests.fx('store_a'), tests.fx('menu_a')),
  '23514', null, 'un enlace a categoría necesita su destino');
select lives_ok(format($$ insert into public.menu_items (id, store_id, menu_id, label, link_type)
  values ('0190a0d0-0000-7000-8000-00000000a001', %L, %L, 'Inicio', 'home') $$, tests.fx('store_a'), tests.fx('menu_a')),
  'enlace al inicio');
select lives_ok(format($$ insert into public.menu_items (id, store_id, menu_id, parent_id, label, link_type, url)
  values ('0190a0d0-0000-7000-8000-00000000a002', %L, %L, '0190a0d0-0000-7000-8000-00000000a001', 'Ayuda', 'url', '/paginas/envios') $$,
  tests.fx('store_a'), tests.fx('menu_a')), 'subnivel');
select throws_ok(format($$ insert into public.menu_items (store_id, menu_id, parent_id, label, link_type)
  values (%L, %L, '0190a0d0-0000-7000-8000-00000000a002', 'Nieto', 'home') $$, tests.fx('store_a'), tests.fx('menu_a')),
  '23514', 'menu_too_deep', 'máximo dos niveles');
select throws_ok(format($$ insert into public.menu_items (store_id, menu_id, label, link_type)
  values (%L, %L, 'Robado', 'home') $$, tests.fx('store_b'), tests.fx('menu_a')),
  '23503', null, 'un ítem de B no entra en un menú de A (FK compuesta)');
select throws_ok(format($$ insert into public.store_pages (store_id, type, slug, title)
  values (%L, 'policy_privacy', 'otra-privacidad', 'Otra') $$, tests.fx('store_a')),
  '23505', null, 'una sola política de cada tipo por tienda');

-- RLS
select tests.login('owner_b');
select is((select count(*)::int from public.store_pages where store_id = tests.fx('store_a')), 0,
  'otro tenant no ve las páginas de A');
select is((select count(*)::int from public.menu_items where store_id = tests.fx('store_a')), 0,
  'ni sus menús');
select tests.logout();

select * from finish();
rollback;
