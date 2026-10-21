-- Pulido: copiar categorías, páginas, políticas y menús de otra tienda de la
-- MISMA organización (`store_copy_structure`). Sin borrar nada en el destino,
-- sin referencias a datos de la tienda de origen y con permisos por parte.
begin;
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
select tests.create_user('cat', 'cat@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_store('a2', 'org_a');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a2', 'cat', 'catalog_manager');

-- Origen (tienda a): Proteínas > Whey, página «Nosotros» con un bloque de
-- preguntas y otro de productos, aviso de privacidad completo y publicado, y
-- menú principal con categoría, página, producto y enlace.
do $$
declare v_root uuid; v_child uuid; v_page uuid; v_menu uuid; v_product uuid;
begin
  insert into public.categories (store_id, name, slug, description, seo_title)
  values (tests.fx('store_a'), 'Proteínas', 'proteinas', 'Polvos de proteína.', 'Proteínas en polvo')
  returning id into v_root;
  insert into public.categories (store_id, parent_id, name, slug)
  values (tests.fx('store_a'), v_root, 'Whey', 'whey') returning id into v_child;
  insert into public.store_pages (store_id, type, slug, title, body_html, draft_sections)
  values (tests.fx('store_a'), 'content', 'nosotros', 'Nosotros', '<p>Somos PRUVA.</p>',
          jsonb_build_array(
            jsonb_build_object('id', '00000000-0000-4000-8000-000000000001', 'type', 'faq', 'enabled', true,
              'props', jsonb_build_object('title', 'Preguntas',
                'items', jsonb_build_array(jsonb_build_object('question', '¿Envían?', 'answer', 'Sí.')))),
            jsonb_build_object('id', '00000000-0000-4000-8000-000000000002', 'type', 'featured_products',
              'enabled', true, 'props', jsonb_build_object('title', 'De esta categoría',
                'source', jsonb_build_object('type', 'category', 'id', v_root),
                'limit', 4, 'show_view_all', true))))
  returning id into v_page;
  update public.store_pages
     set body_html = '<h2>Responsable</h2><p>PRUVA SA de CV, Mazatlán.</p>', is_published = true,
         published_at = now()
   where store_id = tests.fx('store_a') and type = 'policy_privacy';
  insert into public.products (store_id, title, slug, status) values (tests.fx('store_a'), 'Whey 1 kg', 'whey-1kg', 'draft')
  returning id into v_product;
  select id into v_menu from public.menus where store_id = tests.fx('store_a') and handle = 'main';
  insert into public.menu_items (store_id, menu_id, label, link_type, target_id, url, position) values
    (tests.fx('store_a'), v_menu, 'Proteínas', 'category', v_root, null, 0),
    (tests.fx('store_a'), v_menu, 'Nosotros', 'page', v_page, null, 1),
    (tests.fx('store_a'), v_menu, 'Whey 1 kg', 'product', v_product, null, 2),
    (tests.fx('store_a'), v_menu, 'Blog', 'url', null, 'https://blog.pruva.mx', 3);
end $$;

create function tests.dest() returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'paths', (select jsonb_agg(c.path order by c.path) from public.categories c
               where c.store_id = tests.fx('store_a2') and c.deleted_at is null),
    'desc', (select c.description from public.categories c where c.store_id = tests.fx('store_a2') and c.slug = 'proteinas'),
    'page', (select jsonb_build_object('published', p.is_published,
               'blocks', (select jsonb_agg(s ->> 'type') from jsonb_array_elements(p.draft_sections) s))
               from public.store_pages p where p.store_id = tests.fx('store_a2') and p.slug = 'nosotros'),
    'privacy', (select jsonb_build_object('published', p.is_published,
                  'copied', position('PRUVA SA de CV' in p.body_html) > 0)
                  from public.store_pages p where p.store_id = tests.fx('store_a2') and p.type = 'policy_privacy'),
    'menu', (select jsonb_agg(mi.label || ':' || mi.link_type order by mi.position)
               from public.menu_items mi join public.menus m on m.id = mi.menu_id
              where m.store_id = tests.fx('store_a2') and m.handle = 'main'),
    'menu_targets_local', (select bool_and(
               mi.target_id is null
               or exists (select 1 from public.categories c where c.store_id = mi.store_id and c.id = mi.target_id)
               or exists (select 1 from public.store_pages p where p.store_id = mi.store_id and p.id = mi.target_id))
               from public.menu_items mi where mi.store_id = tests.fx('store_a2'))) $$;
grant execute on all functions in schema tests to authenticated;

-- 1. Validación y aislamiento.
select tests.login('owner');
select is(pg_temp.err(format('select public.store_copy_structure(%L, %L, %L)', tests.fx('store_a2'),
            tests.fx('store_a2'), '{categories}')), 'validation_failed/source', 'no se copia de sí misma');
select is(pg_temp.err(format('select public.store_copy_structure(%L, %L, %L)', tests.fx('store_a2'),
            tests.fx('store_a'), '{productos}')), 'validation_failed/parts', 'solo partes conocidas');
select is(pg_temp.err(format('select public.store_copy_structure(%L, %L, %L)', tests.fx('store_a2'),
            tests.fx('store_b'), '{categories}')), 'forbidden', 'no se copia de otra organización');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.err(format('select public.store_copy_structure(%L, %L, %L)', tests.fx('store_b'),
            tests.fx('store_a'), '{categories}')), 'forbidden', 'B no copia la estructura de A');
select tests.logout();

-- 2. Permisos por parte: Catálogo copia categorías, no páginas.
select tests.login('cat');
select is(pg_temp.err(format('select public.store_copy_structure(%L, %L, %L)', tests.fx('store_a2'),
            tests.fx('store_a'), '{pages}')), 'forbidden', 'Catálogo no copia páginas');
select tests.logout();

-- 3. La dueña copia todo.
select tests.login('owner');
select is(public.store_copy_structure(tests.fx('store_a2'), tests.fx('store_a'),
            '{categories,pages,policies,menus}') - 'skipped',
          '{"categories": 2, "pages": 1, "policies": 1, "menu_items": 3}'::jsonb,
          'copia 2 categorías, 1 página, 1 política y 3 entradas del menú');
select is(tests.dest() -> 'paths', '["proteinas", "proteinas/whey"]'::jsonb, 'categorías con su jerarquía');
select is(tests.dest() ->> 'desc', 'Polvos de proteína.', 'con su descripción');
select is(tests.dest() -> 'page', '{"published": false, "blocks": ["faq"]}'::jsonb,
          'la página llega en borrador y sin el bloque de productos de la otra tienda');
select is(tests.dest() -> 'privacy', '{"published": false, "copied": true}'::jsonb,
          'la política completa llega como borrador');
select is(tests.dest() -> 'menu', '["Proteínas:category", "Nosotros:page", "Blog:url"]'::jsonb,
          'el menú omite el producto de la otra tienda');
select ok((tests.dest() ->> 'menu_targets_local')::boolean, 'cada entrada apunta a datos de la tienda nueva');

-- 4. Repetir no duplica ni pisa.
select is(public.store_copy_structure(tests.fx('store_a2'), tests.fx('store_a'),
            '{categories,pages,policies,menus}') - 'skipped',
          '{"categories": 0, "pages": 0, "policies": 0, "menu_items": 0}'::jsonb,
          'una segunda copia no agrega nada');
select is(jsonb_array_length(tests.dest() -> 'menu'), 3, 'ni duplica el menú');
select tests.logout();

-- 5. Auditoría y RLS: B no ve nada de lo copiado.
select is((select count(*)::int from audit.audit_logs where store_id = tests.fx('store_a2')
             and action = 'store.structure_copied'), 2, 'cada copia queda en la auditoría');
select tests.login('owner_b');
select is((select count(*)::int from public.categories where store_id = tests.fx('store_a2')), 0,
          'otra organización no ve las categorías copiadas');
select tests.logout();

select * from finish();
rollback;
