-- =============================================================================
-- Paso 4 · Rol Diseño, redirecciones 301 y SEO/imagen de categoría: permisos,
-- validación (sin redirección abierta, sin cadenas, rutas reservadas) y
-- aislamiento entre tiendas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

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
select tests.create_user('designer', 'design@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'designer', 'designer');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

create function tests.media_in(p_store text, p_owner text) returns uuid language sql security definer
set search_path = '' as $$
  insert into public.media (store_id, owner_type, status, storage_path, mime_type, bytes, width, height, alt_text)
  values (tests.fx('store_' || p_store), p_owner, 'ready',
          tests.fx('store_' || p_store) || '/' || p_owner || '/x/' || gen_random_uuid() || '/original.png',
          'image/png', 100, 800, 800, 'Categoría')
  returning id $$;
grant execute on all functions in schema tests to authenticated;

create function pg_temp.redirect(p_store text, p_from text, p_to text) returns text language plpgsql as $$
begin
  return pg_temp.err(format('select public.seo_upsert_redirect(%L, %L, %L)', tests.fx('store_' || p_store), p_from, p_to));
end $$;
create function pg_temp.gw_redirects(p_store text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform set_config('role', 'storefront_gateway', true);
  select count(*) into v from storefront.store_redirects(tests.fx('store_' || p_store));
  perform set_config('role', 'none', true);
  return v;
end $$;

-- 1. Rol Diseño.
select ok(exists (select 1 from public.roles where key = 'designer' and is_system), 'existe el rol Diseño');
select set_eq($$ select rp.permission_key from public.role_permissions rp join public.roles r on r.id = rp.role_id
                 where r.key = 'designer' and r.organization_id is null $$,
              array['store.read', 'products.read', 'appearance.manage', 'content.manage', 'seo.manage'],
              'Diseño: apariencia, páginas, SEO y lectura');
select tests.login('designer');
select ok(app.has_store_permission(tests.fx('store_a'), 'appearance.manage'), 'Diseño edita la apariencia');
select ok(not app.has_store_permission(tests.fx('store_a'), 'orders.read'), 'pero no ve pedidos');
select ok(not app.has_store_permission(tests.fx('store_a'), 'products.update'), 'ni edita productos');

-- 2. Redirecciones.
select is(pg_temp.redirect('a', '/Productos/Proteina-Vieja', '/productos/proteina'), 'ok',
          'Diseño crea una redirección (el origen se guarda en minúsculas)');
select is((select from_path from public.store_redirects where store_id = tests.fx('store_a')),
          '/productos/proteina-vieja', 'el origen queda en minúsculas');
select is(pg_temp.redirect('a', '/promo', 'https://otro-sitio.com'), 'validation_failed/to_path',
          'sin redirección a otro sitio');
select is(pg_temp.redirect('a', '/promo', '//otro-sitio.com'), 'validation_failed/to_path',
          'ni con // al inicio');
select is(pg_temp.redirect('a', '/checkout', '/'), 'validation_failed/from_path', 'el checkout no se puede tapar');
select is(pg_temp.redirect('a', '/promo', '/promo'), 'validation_failed/to_path', 'no a sí misma');
select is(pg_temp.redirect('a', '/productos/proteina', '/categorias/x'), 'validation_failed/chain',
          'un destino no puede ser origen de otra (sin cadenas)');
select is(pg_temp.redirect('a', '/vieja', '/productos/proteina-vieja'), 'validation_failed/chain',
          'ni apuntar a un origen');
select tests.logout();
select is(pg_temp.gw_redirects('a'), 1::bigint, 'el proxy lee el mapa de su tienda');

-- 3. Aislamiento.
select tests.login('owner_b');
select is((select count(*)::int from public.store_redirects), 0, 'B no ve las redirecciones de A');
select is(pg_temp.err(format('select public.seo_delete_redirect(%L, %L)', tests.fx('store_b'),
            (select id from public.store_redirects limit 1))), 'not_found/redirect',
          'ni las borra con su tienda');
select is(pg_temp.redirect('a', '/x', '/y'), 'forbidden', 'ni crea en la tienda de A');
select tests.logout();

-- 4. Categoría: SEO e imagen.
select tests.set_fx('img_a', tests.media_in('a', 'category'));
select tests.set_fx('img_b', tests.media_in('b', 'category'));
select tests.login('owner');
select tests.set_fx('cat', public.catalog_upsert_category(tests.fx('store_a'),
  jsonb_build_object('name', 'Proteínas', 'seo_title', 'Proteínas en polvo', 'image_media_id', tests.fx('img_a'))));
select is(pg_temp.err(format('select public.catalog_upsert_category(%L, %L)', tests.fx('store_a'),
            jsonb_build_object('id', tests.fx('cat'), 'name', 'Proteínas', 'image_media_id', tests.fx('img_b')))),
          'validation_failed/image_media_id', 'la imagen de otra tienda se rechaza');
select public.catalog_upsert_category(tests.fx('store_a'), jsonb_build_object('id', tests.fx('cat'), 'name', 'Proteína'));
select tests.logout();
select is((select seo_title from public.categories where id = tests.fx('cat')), 'Proteínas en polvo',
          'guardar sin los campos SEO los conserva');
select is((select image_media_id from public.categories where id = tests.fx('cat')), tests.fx('img_a'),
          'y la imagen también');

select * from finish();
rollback;
