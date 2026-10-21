-- Marcas con logo, portada, descripción y sitio (misión Portada/Marcas, Paso 2):
-- `catalog_set_brand_media` solo acepta medios de marca de la MISMA tienda,
-- respeta el permiso `brands.manage` y la tienda pública solo ve lo listo.
begin;
select plan(19);

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
select tests.create_user('ops', 'ops@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'ops', 'order_manager');
update public.stores set status = 'active', launched_at = now() where id in (tests.fx('store_a'), tests.fx('store_b'));

create function tests.media(p_store text, p_owner text, p_status text default 'ready') returns uuid
language sql security definer set search_path = '' as $$
  insert into public.media (store_id, owner_type, status, storage_path, mime_type, bytes, width, height, alt_text)
  values (tests.fx('store_' || p_store), p_owner, p_status,
          tests.fx('store_' || p_store) || '/' || p_owner || '/x/' || gen_random_uuid() || '/original.png',
          'image/png', 100, 256, 256, 'Logo')
  returning id $$;
create function tests.brand(p_store text) returns jsonb
language sql security definer set search_path = '' as $$
  select to_jsonb(b) - 'store_id' - 'created_at' - 'updated_at' - 'seo_title' - 'seo_description' - 'deleted_at'
    from public.brands b where b.store_id = tests.fx('store_' || p_store) and b.slug = 'ace' $$;
grant execute on all functions in schema tests to authenticated;

select tests.set_fx('logo_a', tests.media('a', 'brand'));
select tests.set_fx('cover_a', tests.media('a', 'brand'));
select tests.set_fx('pending_a', tests.media('a', 'brand', 'pending'));
select tests.set_fx('rejected_a', tests.media('a', 'brand', 'rejected'));
select tests.set_fx('banner_a', tests.media('a', 'banner'));
select tests.set_fx('logo_b', tests.media('b', 'brand'));

-- 1. Guardar con descripción y sitio; validaciones.
select tests.login('owner');
select tests.set_fx('brand_a', public.catalog_upsert_brand(tests.fx('store_a'),
  '{"name": "Ace", "description": "Marca de prueba.\r\nSegunda línea.", "website_url": "https://ace.example.com"}'));
select is(tests.brand('a') ->> 'description', E'Marca de prueba.\nSegunda línea.', 'descripción con saltos de línea normalizados');
select is(tests.brand('a') ->> 'website_url', 'https://ace.example.com', 'sitio web');
select is(pg_temp.err(format('select public.catalog_upsert_brand(%L, %L)', tests.fx('store_a'),
            '{"name": "X", "website_url": "http://x.example.com"}')), 'validation_failed/website_url',
          'el sitio debe ser https');
select is(pg_temp.err(format('select public.catalog_upsert_brand(%L, %L)', tests.fx('store_a'),
            '{"name": "X", "website_url": "javascript:alert(1)"}')), 'validation_failed/website_url',
          'nunca javascript:');
select is(pg_temp.err(format('select public.catalog_upsert_brand(%L, %L)', tests.fx('store_a'),
            jsonb_build_object('name', 'X', 'description', repeat('a', 1001)))), 'validation_failed/description',
          'descripción de hasta 1000 caracteres');
select lives_ok(format('select public.catalog_upsert_brand(%L, %L)', tests.fx('store_a'),
                  jsonb_build_object('id', tests.fx('brand_a'), 'name', 'Ace')),
                'guardar sin descripción ni sitio no los borra');
select is(tests.brand('a') ->> 'website_url', 'https://ace.example.com', 'el sitio sigue ahí');

-- 2. Logo y portada: solo medios de marca de la misma tienda.
select lives_ok(format('select public.catalog_set_brand_media(%L, %L, %L, %L)', tests.fx('store_a'),
                  tests.fx('brand_a'), 'logo', tests.fx('logo_a')), 'asigna el logo');
select lives_ok(format('select public.catalog_set_brand_media(%L, %L, %L, %L)', tests.fx('store_a'),
                  tests.fx('brand_a'), 'cover', tests.fx('cover_a')), 'asigna la portada');
select is(pg_temp.err(format('select public.catalog_set_brand_media(%L, %L, %L, %L)', tests.fx('store_a'),
            tests.fx('brand_a'), 'logo', tests.fx('logo_b'))), 'validation_failed/media',
          'un medio de otra tienda no se acepta');
select is(pg_temp.err(format('select public.catalog_set_brand_media(%L, %L, %L, %L)', tests.fx('store_a'),
            tests.fx('brand_a'), 'logo', tests.fx('banner_a'))), 'validation_failed/media',
          'un banner no es un logo de marca');
select is(pg_temp.err(format('select public.catalog_set_brand_media(%L, %L, %L, %L)', tests.fx('store_a'),
            tests.fx('brand_a'), 'logo', tests.fx('rejected_a'))), 'validation_failed/media',
          'una imagen rechazada no se acepta');
select is(pg_temp.err(format('select public.catalog_set_brand_media(%L, %L, %L, %L)', tests.fx('store_a'),
            tests.fx('brand_a'), 'banner', tests.fx('logo_a'))), 'validation_failed/kind', 'solo logo o portada');
select tests.logout();

-- 3. Permisos y aislamiento.
select tests.login('owner_b');
select is(pg_temp.err(format('select public.catalog_set_brand_media(%L, %L, %L, %L)', tests.fx('store_a'),
            tests.fx('brand_a'), 'logo', null)), 'forbidden', 'otra tienda no toca la marca');
select is(pg_temp.err(format('select public.catalog_set_brand_media(%L, %L, %L, %L)', tests.fx('store_b'),
            tests.fx('brand_a'), 'logo', tests.fx('logo_b'))), 'not_found/brand',
          'la marca de A no existe para B');
select tests.logout();
select tests.login('ops');
select is(pg_temp.err(format('select public.catalog_set_brand_media(%L, %L, %L, %L)', tests.fx('store_a'),
            tests.fx('brand_a'), 'logo', null)), 'forbidden', 'Operación de pedidos no administra marcas');
select tests.logout();

-- 4. Tienda pública: logo y portada solo cuando están listos; pendiente → sin imagen.
select tests.login('owner');
select public.catalog_set_brand_media(tests.fx('store_a'), tests.fx('brand_a'), 'cover', tests.fx('pending_a'));
select tests.logout();
select is((storefront.get_brand(tests.fx('store_a'), 'ace') -> 'logo' ->> 'width')::int, 256,
          'la página de la marca trae el logo');
select is(storefront.get_brand(tests.fx('store_a'), 'ace') -> 'cover', 'null'::jsonb,
          'una portada aún sin procesar no se muestra');

-- 5. Auditoría.
select is((select count(*)::int from audit.audit_logs where store_id = tests.fx('store_a')
             and action = 'brand.media_set'), 3, 'cada cambio de imagen queda en la auditoría');

select * from finish();
rollback;
