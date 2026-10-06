-- =============================================================================
-- Fase 3 · Medios (F3-T03): buckets, política de subida, RPC y funciones del
-- worker. La subida se simula como la hace Storage: INSERT en storage.objects
-- con el rol authenticated y los claims del JWT (RLS aplicada).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('cat', 'cat@a.io');
select tests.create_user('view', 'view@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'cat', 'catalog_manager');
select tests.add_store_member('a', 'view', 'viewer');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function tests.upload(p_store text, p_owner text, p_product uuid, p_mime text default 'image/jpeg',
                             p_bytes bigint default 2048) returns jsonb language sql as
  $$ select public.media_create_upload(tests.fx('store_' || p_store), p_owner, p_product, p_mime, p_bytes) $$;
create function tests.put_object(p_bucket text, p_name text) returns void language sql as
  $$ insert into storage.objects (bucket_id, name, owner) values (p_bucket, p_name, auth.uid()) $$;
create function tests.media_path(p_id uuid) returns text
language sql security definer set search_path = '' as $$ select storage_path from public.media where id = p_id $$;
create function tests.media_status(p_id uuid) returns text
language sql security definer set search_path = '' as $$ select status from public.media where id = p_id $$;
grant execute on all functions in schema tests to authenticated;

select tests.login('owner');
select tests.set_fx('product', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Playera","variants":[{"price":19900,"sku":"PLY-1"}]}') ->> 'id')::uuid);
select tests.logout();

-- ============================================================================ Buckets y políticas
select is((select public from storage.buckets where id = 'store-uploads'), false, 'store-uploads es privado');
select is((select public from storage.buckets where id = 'store-media'), true, 'store-media es público');
select ok((select not (allowed_mime_types && array['image/svg+xml', 'image/gif', 'text/html'])
             from storage.buckets where id = 'store-media'), 'sin SVG, GIF ni HTML en los buckets (§44.13)');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
            and cmd <> 'INSERT'), 0, 'sin políticas de lectura, edición ni borrado en storage.objects');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
            and 'anon' = any (roles)), 0, 'anon no tiene políticas de Storage');

-- ============================================================================ Reservar
select tests.login('cat');
select tests.set_fx('m1', (tests.upload('a', 'product', tests.fx('product')) ->> 'media_id')::uuid);
select matches(tests.media_path(tests.fx('m1')),
  '^' || tests.fx('store_a') || '/product/' || tests.fx('product') || '/' || tests.fx('m1') || '/original\.jpg$',
  'la ruta la genera el servidor: {store}/{tipo}/{dueño}/{medio}/original.{ext}');
select is(tests.media_status(tests.fx('m1')), 'pending', 'el medio nace pendiente');
select is((select created_by from public.media where id = tests.fx('m1')), tests.fx('cat'), 'registra quién reservó');
select throws_ok($$ select tests.upload('a', 'product', tests.fx('product'), 'image/svg+xml') $$,
  'P0001', 'validation_failed', 'SVG rechazado');
select throws_ok($$ select tests.upload('a', 'product', tests.fx('product'), 'image/gif') $$,
  'P0001', 'validation_failed', 'GIF rechazado');
select throws_ok($$ select tests.upload('a', 'product', tests.fx('product'), 'image/jpeg', 0) $$,
  'P0001', 'validation_failed', 'tamaño 0 rechazado');
select throws_ok($$ select tests.upload('a', 'product', tests.fx('product'), 'image/jpeg', 10485761) $$,
  'P0001', 'validation_failed', 'más de 10 MB rechazado');
select throws_ok($$ select tests.upload('a', 'brand', tests.fx('product')) $$,
  'P0001', 'validation_failed', 'solo los medios de producto llevan product_id');
select throws_ok($$ select tests.upload('a', 'product', null) $$, 'P0001', 'not_found', 'producto obligatorio');
select throws_ok($$ select tests.upload('a', 'store_branding', null) $$, '42501', 'forbidden',
  'catalog_manager no sube branding (appearance.manage)');
select throws_ok($$ select tests.upload('a', 'virus', null) $$, 'P0001', 'validation_failed', 'tipo de dueño desconocido');
select tests.logout(); select tests.login('owner');
select throws_ok($$ select tests.upload('a', 'store_branding', null, 'image/png', 3145728) $$,
  'P0001', 'validation_failed', 'branding: máximo 2 MB');
select lives_ok($$ select tests.upload('a', 'store_branding', null, 'image/png', 1048576) $$, 'branding de 1 MB');
select tests.logout(); select tests.login('view');
select throws_ok($$ select tests.upload('a', 'product', tests.fx('product')) $$, '42501', 'forbidden',
  'viewer no sube imágenes');
select tests.logout(); select tests.login('cat', 'aal1');
select throws_ok($$ select tests.upload('a', 'product', tests.fx('product')) $$, '42501', 'mfa_required',
  'sin 2FA no se sube');
select tests.logout(); select tests.login('owner_b');
select throws_ok($$ select tests.upload('a', 'product', tests.fx('product')) $$, '42501', 'forbidden',
  'otro tenant no sube a la tienda A');
select throws_ok($$ select tests.upload('b', 'product', tests.fx('product')) $$, 'P0001', 'not_found',
  'un producto de A no existe para la tienda B');

-- ============================================================================ Subir (política de Storage)
select tests.logout(); select tests.login('cat');
select lives_ok(format($$ select tests.put_object('store-uploads', %L) $$, tests.media_path(tests.fx('m1'))),
  'sube a la ruta exacta que reservó');
select throws_ok(format($$ select tests.put_object('store-uploads', %L) $$,
  tests.fx('store_a') || '/product/' || tests.fx('product') || '/' || gen_random_uuid() || '/original.jpg'),
  '42501', null, 'una ruta sin reserva: denegada');
select throws_ok(format($$ select tests.put_object('store-media', %L) $$, tests.media_path(tests.fx('m1'))),
  '42501', null, 'nadie sube directo al bucket público');
select tests.set_fx('m2', (tests.upload('a', 'product', tests.fx('product'), 'image/png') ->> 'media_id')::uuid);
select tests.logout(); select tests.login('owner');
select throws_ok(format($$ select tests.put_object('store-uploads', %L) $$, tests.media_path(tests.fx('m2'))),
  '42501', null, 'la reserva de otro usuario no sirve (aunque tenga permiso)');
select tests.logout(); select tests.login('owner_b');
select throws_ok(format($$ select tests.put_object('store-uploads', %L) $$, tests.media_path(tests.fx('m2'))),
  '42501', null, 'otro tenant no sube a una reserva de A');
select tests.logout();
update public.media set created_at = now() - interval '20 minutes' where id = tests.fx('m2');
select tests.login('cat');
select throws_ok(format($$ select tests.put_object('store-uploads', %L) $$, tests.media_path(tests.fx('m2'))),
  '42501', null, 'reserva de más de 15 minutos: vencida');
select tests.logout(); select tests.login('cat');
select tests.set_fx('m3', (tests.upload('a', 'product', tests.fx('product'), 'image/webp') ->> 'media_id')::uuid);
select tests.logout(); select tests.login('cat', 'aal1');
select throws_ok(format($$ select tests.put_object('store-uploads', %L) $$, tests.media_path(tests.fx('m3'))),
  '42501', null, 'sin 2FA la política deniega la subida');

-- ============================================================================ Finalizar
select tests.logout(); select tests.login('cat');
select throws_ok(format($$ select public.media_finalize(%L, %L) $$, tests.fx('store_a'), tests.fx('m3')),
  'P0001', 'validation_failed', 'finalizar sin objeto subido: error');
select is((public.media_finalize(tests.fx('store_a'), tests.fx('m1')) ->> 'status'), 'pending',
  'finalizar encola el procesamiento');
select lives_ok(format($$ select public.media_finalize(%L, %L) $$, tests.fx('store_a'), tests.fx('m1')),
  'finalizar es idempotente');
select tests.logout();
select is((select count(*)::int from system.jobs where type = 'media.process'
            and dedupe_key = 'media.process:' || tests.fx('m1') and store_id = tests.fx('store_a')
            and payload = jsonb_build_object('media_id', tests.fx('m1'))),
  1, 'un solo job media.process, con la tienda y solo el id en el payload');
select tests.login('owner_b');
select throws_ok(format($$ select public.media_finalize(%L, %L) $$, tests.fx('store_a'), tests.fx('m1')),
  '42501', null, 'otro tenant no finaliza medios de A');
select throws_ok(format($$ select public.media_finalize(%L, %L) $$, tests.fx('store_b'), tests.fx('m1')),
  'P0001', 'not_found', 'un medio de A no existe para la tienda B');
select is((select count(*)::int from public.media where store_id = tests.fx('store_a')), 0,
  'RLS: otro tenant no ve los medios de A');

-- ============================================================================ Worker (system_worker)
select tests.logout();
select is(tests.sqlstate_as('system_worker', format('select * from system.media_for_processing(%L)', tests.fx('m1'))),
  'ok', 'system_worker lee el medio a procesar');
select is(tests.sqlstate_as('authenticated', format('select * from system.media_for_processing(%L)', tests.fx('m1'))),
  '42501', 'authenticated no ejecuta funciones del worker');
select is(tests.sqlstate_as('system_worker', 'select * from public.media'), '42501',
  'system_worker no tiene acceso de tabla');
select is((select storage_path from system.media_for_processing(tests.fx('m1'))), tests.media_path(tests.fx('m1')),
  'la ruta sale de la fila, no del payload');
select is(tests.sqlstate_as('system_worker', format('select system.media_mark_ready(%L, 800, 600, 1500)', tests.fx('m1'))),
  'ok', 'el worker marca el medio listo');
select is((select status || ':' || width || 'x' || height || ':' || bytes from public.media where id = tests.fx('m1')),
  'ready:800x600:1500', 'ancho, alto y bytes del archivo re-codificado');
select is(system.media_mark_ready(tests.fx('m1'), 1, 1, 1), false, 'marcar listo dos veces no cambia nada');
select is(system.media_mark_rejected(tests.fx('m1'), 'decode_failed'), false, 'un medio listo no se rechaza después');
select is((select count(*)::int from system.media_for_processing(tests.fx('m1'))), 0,
  'un medio listo ya no se procesa');
select throws_ok(format($$ select system.media_mark_rejected(%L, 'Razón libre <b>') $$, tests.fx('m3')),
  '22023', 'invalid_reason', 'el motivo de rechazo es un código, no texto libre');
select is(system.media_mark_rejected(tests.fx('m3'), 'mime_mismatch'), true, 'rechazo de un pendiente');

-- ============================================================================ Texto alternativo, orden, borrado
select tests.login('cat');
select lives_ok(format($$ select public.media_set_alt_text(%L, %L, 'Playera negra de frente') $$,
  tests.fx('store_a'), tests.fx('m1')), 'texto alternativo');
select throws_ok(format($$ select public.media_set_alt_text(%L, %L, repeat('x', 251)) $$,
  tests.fx('store_a'), tests.fx('m1')), 'P0001', 'validation_failed', 'texto alternativo de más de 250');
select tests.logout(); select tests.login('view');
select throws_ok(format($$ select public.media_set_alt_text(%L, %L, 'x') $$,
  tests.fx('store_a'), tests.fx('m1')), '42501', 'forbidden', 'viewer no edita medios');
select tests.logout(); select tests.login('cat');
select lives_ok(format($$ select public.media_reorder_product(%L, %L, array[%L, %L]::uuid[]) $$,
  tests.fx('store_a'), tests.fx('product'), tests.fx('m3'), tests.fx('m1')), 'reordenar imágenes');
select is((select string_agg(id::text, ',' order by position) from public.media
            where product_id = tests.fx('product') and id in (tests.fx('m1'), tests.fx('m3'))),
  tests.fx('m3') || ',' || tests.fx('m1'), 'el orden pedido queda primero');
select throws_ok(format($$ select public.media_reorder_product(%L, %L, array[%L, %L]::uuid[]) $$,
  tests.fx('store_a'), tests.fx('product'), tests.fx('m1'), tests.fx('m1')),
  'P0001', 'validation_failed', 'ids repetidos: rechazado');
select throws_ok(format($$ select public.media_reorder_product(%L, %L, array[%L]::uuid[]) $$,
  tests.fx('store_a'), tests.fx('product'), gen_random_uuid()),
  'P0001', 'validation_failed', 'id ajeno al producto: rechazado');
select lives_ok(format($$ select public.media_delete(%L, %L) $$, tests.fx('store_a'), tests.fx('m1')),
  'borrado lógico');
select throws_ok(format($$ select public.media_finalize(%L, %L) $$, tests.fx('store_a'), tests.fx('m1')),
  'P0001', 'not_found', 'un medio borrado ya no existe para las RPC');
select tests.logout();
select is((select count(*)::int from audit.audit_logs where action = 'media.deleted' and entity_id = tests.fx('m1')),
  1, 'borrado auditado');

-- ============================================================================ Límites
insert into public.organization_entitlement_overrides (organization_id, key, value_int, reason)
values (tests.fx('org_a'), 'storage_mb', 1, 'prueba de cuota');
select tests.login('cat');
select throws_ok($$ select tests.upload('a', 'product', tests.fx('product'), 'image/jpeg', 2097152) $$,
  'P0001', 'limit_reached', 'cuota de almacenamiento del plan (storage_mb)');
select tests.logout();
insert into public.media (store_id, owner_type, status, storage_path, created_by)
select tests.fx('store_b'), 'banner', 'pending', tests.fx('store_b') || '/banner/x/' || g || '/original.jpg', null
  from generate_series(1, 50) g;
select tests.login('owner_b');
select throws_ok($$ select tests.upload('b', 'banner', null) $$, 'P0001', 'limit_reached',
  'como máximo 50 subidas pendientes por tienda');

-- ============================================================================ Purga
select tests.logout();
delete from public.media where store_id = tests.fx('store_b');
update public.media set created_at = now() - interval '25 hours' where id = tests.fx('m2');
update public.media set deleted_at = now() - interval '8 days' where id = tests.fx('m1');
insert into storage.objects (bucket_id, name, created_at) values
  ('store-uploads', tests.fx('store_a') || '/product/old/upload.jpg', now() - interval '25 hours'),
  ('store-media', tests.fx('store_a') || '/product/sin-fila/original.jpg', now() - interval '49 hours'),
  ('store-media', tests.fx('store_a') || '/product/reciente/original.jpg', now() - interval '1 hour');
select is((select string_agg(kind, ',' order by kind) from system.media_purge_candidates(100)),
  'deleted_media,expired_pending,orphan_media,stale_upload', 'candidatos de purga por tipo');
select is((select count(*)::int from system.media_purge_candidates(100) where path like '%/reciente/%'), 0,
  'los objetos recientes no se purgan');
select is(system.media_purge_rows(array[tests.fx('m1'), tests.fx('m2'), tests.fx('m3')]), 2,
  'solo se eliminan filas vencidas (pendiente > 24 h, borrada > 7 días)');
select is((select count(*)::int from public.media where id = tests.fx('m3')), 1, 'el rechazado reciente se conserva');
select is(tests.sqlstate_as('system_worker', 'select system.enqueue_maintenance()'), 'ok',
  'el worker encola el mantenimiento');
select system.enqueue_maintenance();
select is((select count(*)::int from system.jobs where type = 'media.purge_orphans'), 1,
  'la purga se encola una vez al día');

select * from finish();
rollback;
