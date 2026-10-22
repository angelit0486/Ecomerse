-- =============================================================================
-- Fotos de categorías (misión Panel, Paso A): imagen cuadrada y banner solo
-- con medios de categoría de la MISMA tienda y con el permiso de categorías;
-- cambiar o quitar borra la anterior; la tienda ve el banner y las miniaturas
-- solo de categorías públicas con imagen lista.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('inv', 'inv@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'inv', 'inventory_manager');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

create function tests.cat_media(p_store text, p_owner text, p_status text default 'ready') returns uuid
language sql security definer set search_path = '' as $$
  insert into public.media (store_id, owner_type, status, storage_path, mime_type, bytes, width, height, alt_text)
  values (tests.fx(p_store), p_owner, p_status,
          tests.fx(p_store) || '/' || p_owner || '/x/' || gen_random_uuid() || '/original.png',
          'image/png', 100, 600, 600, 'Foto de Proteínas')
  returning id $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
create function pg_temp.set(p_kind text, p_media uuid) returns text language sql as $$
  select pg_temp.err(format('select public.catalog_set_category_media(%L, %L, %L, %L)',
                            tests.fx('store_a'), tests.fx('cat'), p_kind, p_media)) $$;
create function pg_temp.cat() returns public.categories language sql security definer as $$
  select * from public.categories where id = tests.fx('cat') $$;
create function pg_temp.deleted(p_id uuid) returns boolean language sql security definer as $$
  select deleted_at is not null from public.media where id = p_id $$;
create function pg_temp.gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'storefront_gateway', true);
  execute p_sql into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
grant execute on all functions in schema tests to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

select tests.set_fx('img', tests.cat_media('store_a', 'category'));
select tests.set_fx('img2', tests.cat_media('store_a', 'category'));
select tests.set_fx('cover', tests.cat_media('store_a', 'category'));
select tests.set_fx('brand_img', tests.cat_media('store_a', 'brand'));
select tests.set_fx('img_b', tests.cat_media('store_b', 'category'));
select tests.set_fx('rejected', tests.cat_media('store_a', 'category', 'rejected'));

select tests.login('owner');
select tests.set_fx('cat', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Proteínas"}'));
select tests.set_fx('hidden', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Oculta","is_visible":false}'));

-- 1. Validación y aislamiento.
select is(pg_temp.set('image', tests.fx('img_b')), 'validation_failed/media', 'una imagen de otra tienda se rechaza');
select is(pg_temp.set('image', tests.fx('brand_img')), 'validation_failed/media', 'una imagen subida para marcas se rechaza');
select is(pg_temp.set('image', tests.fx('rejected')), 'validation_failed/media', 'una imagen rechazada no se usa');
select is(pg_temp.set('banner', tests.fx('img')), 'validation_failed/kind', 'solo «image» o «cover»');

-- 2. Asignar, reemplazar y quitar.
select is(pg_temp.set('image', tests.fx('img')), 'ok', 'la dueña asigna la imagen cuadrada');
select is(pg_temp.set('cover', tests.fx('cover')), 'ok', 'y el banner');
select is((pg_temp.cat()).cover_media_id, tests.fx('cover'), 'el banner queda guardado');
select is(pg_temp.set('image', tests.fx('img2')), 'ok', 'cambia la imagen');
select ok(pg_temp.deleted(tests.fx('img')), 'la imagen reemplazada queda borrada');

-- 3. Permisos: Inventario no cambia categorías; otra tienda no ve la categoría.
select tests.logout();
select tests.login('inv');
select is(pg_temp.set('image', null), 'forbidden', 'Inventario no puede cambiar fotos de categorías');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.err(format('select public.catalog_set_category_media(%L, %L, %L, null)',
                             tests.fx('store_b'), tests.fx('cat'), 'image')),
          'not_found/category', 'desde otra tienda la categoría no existe');
select tests.logout();

-- 4. Tienda: banner en la página y miniaturas solo de lo público.
select ok(pg_temp.gw(format('select storefront.get_category(%L, %L)', tests.fx('store_a'), 'proteinas'))
            #>> '{cover,path}' like tests.fx('store_a') || '/%', 'la página de la categoría trae su banner');
select is((select array_agg(k) from jsonb_object_keys(
             pg_temp.gw(format('select storefront.category_thumbs(%L)', tests.fx('store_a')))) k),
          array['proteinas'], 'miniaturas: solo categorías visibles con imagen lista');

-- 5. Borrar el medio quita el banner (B10).
select tests.login('owner');
select public.media_delete(tests.fx('store_a'), tests.fx('cover'));
select is((pg_temp.cat()).cover_media_id, null, 'borrar el medio limpia el banner');
select tests.logout();

-- 6. Permisos de las funciones nuevas.
select ok(not has_function_privilege('anon', 'public.catalog_set_category_media(uuid, uuid, text, uuid)', 'execute')
          and not has_function_privilege('storefront_gateway', 'public.catalog_set_category_media(uuid, uuid, text, uuid)', 'execute'),
          'asignar fotos no se concede a anon ni a la tienda');
select ok(has_function_privilege('storefront_gateway', 'storefront.category_thumbs(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'storefront.category_thumbs(uuid)', 'execute'),
          'las miniaturas solo las lee la tienda');

select * from finish();
rollback;
