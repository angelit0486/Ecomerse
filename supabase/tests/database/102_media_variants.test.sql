-- =============================================================================
-- Paso 8: fotos en varios tamaños. La tienda pide srcset solo cuando TODAS sus
-- fotos listas tienen copias; el worker las marca al publicarlas o al generarlas
-- para las de antes; nada de esto lo alcanza un rol que no sea el worker.
-- =============================================================================
begin;
select plan(14);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function tests.photo(p_store text, p_status text) returns uuid
language sql security definer set search_path = '' as $$
  insert into public.media (store_id, owner_type, status, storage_path, mime_type, bytes, width, height, alt_text)
  values (tests.fx('store_' || p_store), 'store_branding', p_status,
          tests.fx('store_' || p_store) || '/store_branding/x/' || gen_random_uuid() || '/original.png',
          'image/png', 100, 1200, 600, 'Portada')
  returning id $$;
create function tests.variants_flag(p_store text) returns boolean
language sql security definer set search_path = '' as $$
  select (app.store_public_json(tests.fx('store_' || p_store), false) ->> 'media_variants')::boolean $$;
create function tests.done(p_id uuid) returns boolean
language sql security definer set search_path = '' as $$
  select variants_done from public.media where id = p_id $$;
create function pg_temp.as_worker(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform tests.as_role('system_worker');
  execute p_sql into v;
  perform tests.logout();
  return v;
end $$;
grant execute on all functions in schema tests to authenticated;

select ok(tests.variants_flag('a'), 'una tienda sin fotos no tiene nada pendiente');

select tests.set_fx('old', tests.photo('a', 'ready'));
select ok(not tests.variants_flag('a'), 'una foto de antes sin copias: la tienda aún no usa srcset');
select ok(tests.variants_flag('b'), 'la otra tienda no se ve afectada');

select is(pg_temp.as_worker('select count(*)::text from system.media_variants_pending(10)'), '1',
          'el worker ve la foto pendiente');
select is(pg_temp.as_worker('select system.media_backfill_requeue()::text'), 'true',
          'con fotos pendientes, el job de copias se vuelve a encolar');
select is(pg_temp.as_worker(format('select system.media_set_variants_done(%L)::text', tests.fx('old'))), 'true',
          'y la marca al generar sus copias');
select ok(tests.variants_flag('a'), 'con todas sus copias, la tienda usa srcset');
select is(pg_temp.as_worker('select system.media_backfill_requeue()::text'), 'false',
          'sin pendientes, ya no se encola');

-- Una subida nueva se marca con sus copias al publicarse (sin volver a apagar el srcset).
select tests.set_fx('new', tests.photo('a', 'pending'));
select is(pg_temp.as_worker(format('select system.media_mark_ready(%L, 1200, 600, 100, true)::text', tests.fx('new'))) is not null,
          true, 'el worker publica la foto nueva con sus copias');
select ok(tests.done(tests.fx('new')) and tests.variants_flag('a'), 'y la tienda sigue con srcset');

select ok(not has_function_privilege('authenticated', 'system.media_set_variants_done(uuid)', 'execute')
          and not has_function_privilege('storefront_gateway', 'system.media_variants_pending(integer)', 'execute'),
          'solo el worker marca o lista fotos pendientes');
select ok(has_function_privilege('system_worker',
                                 'system.media_mark_ready(uuid, integer, integer, bigint, boolean)', 'execute'),
          'el worker conserva el permiso de publicar');

-- La purga de huérfanos no confunde las copias con basura (sí la copia de una foto que no existe).
create function tests.orphan_paths() returns text[]
language sql security definer set search_path = '' as $$
  select coalesce(array_agg(c.path order by c.path), '{}') from system.media_purge_candidates(500) c
   where c.kind = 'orphan_media' $$;
create function tests.old_object(p_name text) returns void
language sql security definer set search_path = '' as $$
  insert into storage.objects (bucket_id, name, created_at) values ('store-media', p_name, now() - interval '3 days') $$;
select tests.old_object((select storage_path from public.media where id = tests.fx('old')) || '.w640.webp');
select tests.old_object(tests.fx('store_a') || '/store_branding/x/' || gen_random_uuid() || '/original.png.w640.webp');
select ok(not exists (select 1 from unnest(tests.orphan_paths()) p
                       where p = (select storage_path from public.media where id = tests.fx('old')) || '.w640.webp'),
          'la copia de una foto viva no es huérfana');
select is((select count(*)::int from unnest(tests.orphan_paths()) p where p like '%.w640.webp'), 1,
          'la copia de una foto que no existe sí se limpia');

select * from finish();
rollback;
