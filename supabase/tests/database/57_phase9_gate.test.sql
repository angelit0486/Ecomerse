-- =============================================================================
-- Gate F9 — correcciones de la revisión adversarial de base de datos
-- (migración 20261017000600): G9-1 categoría bajo un padre oculto, G9-2 vista
-- previa con borrador vacío, G9-3 `limit` no entero, G9-4 revisión NULL,
-- G9-5 ids en mayúsculas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

create function pg_temp.gw(p_fn text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'storefront_gateway', true);
  execute format('select storefront.%I(%L)', p_fn, tests.fx('store_a')) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function pg_temp.sec(p_n integer, p_type text, p_props jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', '00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'),
                            'type', p_type, 'enabled', true, 'props', p_props)
$$;
grant execute on all functions in schema tests to authenticated;

insert into public.categories (store_id, name, slug, path, is_visible) values
  (tests.fx('store_a'), 'Padre oculto', 'padre', 'padre', false),
  (tests.fx('store_a'), 'Visible', 'visible', 'visible', true);
insert into public.categories (store_id, parent_id, name, slug, path)
select tests.fx('store_a'), id, 'Hija visible', 'hija', 'x' from public.categories
 where store_id = tests.fx('store_a') and slug = 'padre';
select tests.set_fx('hija', (select id from public.categories where store_id = tests.fx('store_a') and slug = 'hija'));
select tests.set_fx('visible', (select id from public.categories where store_id = tests.fx('store_a') and slug = 'visible'));

-- G9-1
select ok(cardinality(app.theme_reference_issues(tests.fx('store_a'), '{}',
            jsonb_build_array(pg_temp.sec(1, 'category_grid',
              jsonb_build_object('title', 'C', 'category_ids', jsonb_build_array(tests.fx('hija'))))))) = 1,
          'una categoría bajo un padre oculto no es una referencia válida');
select ok(cardinality(app.theme_reference_issues(tests.fx('store_a'), '{}',
            jsonb_build_array(pg_temp.sec(1, 'featured_products', jsonb_build_object('title', 'P', 'limit', 4,
              'show_view_all', true, 'source', jsonb_build_object('type', 'category', 'id', tests.fx('hija'))))))) = 1,
          'ni como fuente de productos');
select is(jsonb_array_length(app.home_resolve(tests.fx('store_a'),
            jsonb_build_array(pg_temp.sec(1, 'category_grid',
              jsonb_build_object('title', 'C', 'category_ids', jsonb_build_array(tests.fx('hija'), tests.fx('visible'))))))
            -> 0 -> 'categories'), 1,
          'la portada omite la categoría bajo un padre oculto (si se ocultó después de publicar)');
select is((select array_agg(c ->> 'name') from jsonb_array_elements(app.home_template(tests.fx('store_a')) -> 'categories') c),
          array['Visible'], 'la plantilla solo muestra raíces visibles');

-- G9-2
update public.store_themes set home_sections = jsonb_build_array(pg_temp.sec(1, 'rich_text', '{"html":"<p>Publicado</p>"}')),
                               draft_settings = '{}', draft_home_sections = '[]'
 where store_id = tests.fx('store_a');
select is(pg_temp.gw('get_home_preview') -> 'sections', 'null'::jsonb,
          'un borrador que vacía la portada se ve en la vista previa como la plantilla');
select is(pg_temp.gw('get_home') #>> '{sections,0,type}', 'rich_text', 'la tienda pública sigue con lo publicado');

-- G9-3
select ok(not app.home_sections_valid(jsonb_build_array(pg_temp.sec(1, 'featured_products',
            '{"title":"P","limit":4.0,"show_view_all":true,"source":{"type":"newest"}}'))),
          '`limit` debe ser un entero literal (4.0 no)');
select lives_ok(format($q$select app.home_resolve(%L, %L)$q$, tests.fx('store_a'),
            jsonb_build_array(pg_temp.sec(1, 'featured_products',
              '{"title":"P","limit":4.0,"show_view_all":true,"source":{"type":"newest"}}'))),
          'una fila antigua con 4.0 no rompe la portada');

-- G9-4
select tests.login('owner');
select throws_ok(format('select public.appearance_publish_theme(%L, null)', tests.fx('store_a')),
                 'P0001', 'conflict', 'publicar sin revisión es un conflicto');
select throws_ok(format('select public.appearance_discard_draft(%L, null)', tests.fx('store_a')),
                 'P0001', 'conflict', 'descartar sin revisión es un conflicto');
select tests.logout();

-- G9-5
select is(jsonb_array_length(app.home_resolve(tests.fx('store_a'),
            jsonb_build_array(pg_temp.sec(1, 'category_grid',
              jsonb_build_object('title', 'C', 'category_ids', jsonb_build_array(upper(tests.fx('visible')::text))))))
            -> 0 -> 'categories'), 1,
          'un id en mayúsculas se resuelve igual que en minúsculas');
select ok(not app.theme_uuid_list_valid(jsonb_build_array(tests.fx('visible')::text, upper(tests.fx('visible')::text)), 1, 12),
          'el mismo id con distinta caja cuenta como repetido');

-- Revisión de diseño: porciones en las tarjetas y portada sin agotados.
update public.stores set status = 'active' where id = tests.fx('store_a');
select tests.login('owner');
create function pg_temp.product(p_slug text) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object('title', p_slug, 'slug', p_slug,
          'variants', '[{"price":19900}]'::jsonb)) ->> 'id')::uuid;
  perform public.catalog_publish_product(tests.fx('store_a'), v);
  return v;
end $$;
select tests.set_fx('con_stock', pg_temp.product('con-stock'));
select tests.set_fx('agotado', pg_temp.product('agotado'));
select tests.logout();
update public.product_variants set track_inventory = false where product_id = tests.fx('con_stock');
insert into public.store_regulated_categories (store_id, category_key) values (tests.fx('store_a'), 'dietary_supplement');
insert into public.product_regulatory_info (store_id, product_id, category_key, data)
values (tests.fx('store_a'), tests.fx('con_stock'), 'dietary_supplement', '{"servings_per_container":30}');
select is((select (i ->> 'servings')::int from jsonb_array_elements(pg_temp.gw('list_products') -> 'items') i
            where i ->> 'slug' = 'con-stock'), 30, 'el listado trae las porciones (precio por porción en la tarjeta)');
select is((select array_agg(i ->> 'slug') from jsonb_array_elements(app.home_resolve(tests.fx('store_a'),
            jsonb_build_array(pg_temp.sec(1, 'featured_products',
              '{"title":"P","limit":4,"show_view_all":true,"source":{"type":"newest"}}'))) -> 0 -> 'items') i),
          array['con-stock'], 'las secciones de productos de la portada no muestran agotados');

select * from finish();
rollback;
