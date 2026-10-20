-- =============================================================================
-- ADR-033 · Fotos desde los enlaces del archivo: la columna image_urls se valida
-- (solo https, ≤ 10), exige el permiso de medios, y al terminar la importación
-- cada enlace queda como medio pendiente con su job; reimportar no duplica y
-- solo el worker fija el tipo real (con la cuota).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');

create function pg_temp.n(p_row integer, p_handle text, p_normalized jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle), 'errors', '[]'::jsonb,
                            'normalized', jsonb_build_object('handle', p_handle, 'product', '{}'::jsonb, 'option_names', null)
                                          || p_normalized)
$$;
create function pg_temp.job(p_rows jsonb) returns uuid language sql as $$
  select public.imports_create(tests.fx('store_a'), 'upsert', 'shopify.csv',
                               array['handle', 'title', 'sku', 'price', 'image_urls'], '{}', p_rows)
$$;
create function pg_temp.commit(p_job uuid) returns text language plpgsql as $$
declare v jsonb;
begin
  perform public.imports_commit(tests.fx('store_a'), p_job);
  perform tests.as_role('system_worker');
  v := system.import_commit(p_job);
  perform tests.logout();
  perform tests.login('owner');
  return v ->> 'status';
end $$;
create function pg_temp.queue(p_job uuid) returns integer language plpgsql as $$
declare v integer;
begin
  perform tests.as_role('system_worker');
  v := system.import_queue_remote_images(p_job);
  perform tests.logout();
  perform tests.login('owner');
  return v;
end $$;
create function pg_temp.remote() returns text language sql security definer as $$
  select coalesce(string_agg(m.position || ':' || m.status || ':' || m.mime_type || ':' || m.source_url,
                             ',' order by m.position), '')
    from public.media m where m.store_id = tests.fx('store_a') and m.source_url is not null
$$;

create function pg_temp.cafe(p_images jsonb) returns jsonb language sql as $$
  select jsonb_build_array(pg_temp.n(2, 'cafe', jsonb_build_object(
    'product', jsonb_build_object('title', 'Café'),
    'variants', jsonb_build_array(jsonb_build_object('row_number', 2, 'sku', 'CAF-1', 'price', 19900)),
    'images', p_images)))
$$;

create function pg_temp.fetch_jobs() returns integer language sql security definer as $$
  select count(*)::int from system.jobs j where j.type = 'media.fetch_remote' and j.store_id = tests.fx('store_a')
$$;
create function pg_temp.first_remote() returns uuid language sql security definer as $$
  select id from public.media where store_id = tests.fx('store_a') and source_url = 'https://cdn.example.com/b.png?v=2'
$$;

create function pg_temp.worker_source(p_media uuid) returns text language plpgsql as $$
declare v text;
begin
  perform tests.as_role('system_worker');
  select source_url into v from system.media_remote_source(p_media);
  perform tests.logout();
  perform tests.login('owner');
  return v;
end $$;
create function pg_temp.worker_set(p_media uuid, p_mime text, p_bytes bigint) returns text language plpgsql as $$
declare v text;
begin
  perform tests.as_role('system_worker');
  begin
    v := system.media_set_remote_original(p_media, p_mime, p_bytes);
  exception when others then
    v := 'error:' || sqlerrm;
  end;
  perform tests.logout();
  perform tests.login('owner');
  return v;
end $$;

create function pg_temp.media_row(p_id uuid) returns setof public.media language sql security definer as $$
  select * from public.media where id = p_id
$$;

select tests.login('owner');

-- 1. Validación del plan (la base no confía en el servidor).
select tests.set_fx('j1', pg_temp.job(pg_temp.cafe(
  '["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.png?v=2"]')));
select is((select status from public.import_jobs where id = tests.fx('j1')), 'validated',
          'enlaces https: la importación se valida');
select ok((select 'products.update' = any (needs) from public.import_jobs where id = tests.fx('j1')),
          'las fotos exigen el permiso de medios de producto');
select throws_ok($$ select pg_temp.job(pg_temp.cafe('["http://cdn.example.com/a.jpg"]')) $$,
                 'P0001', 'validation_failed', 'un enlace http se rechaza');
select throws_ok($$ select pg_temp.job(pg_temp.cafe('["https://user@cdn.example.com/a.jpg"]')) $$,
                 'P0001', 'validation_failed', 'un enlace con usuario se rechaza');
select throws_ok($$ select pg_temp.job(pg_temp.cafe(
                     (select jsonb_agg('https://cdn.example.com/' || i || '.jpg') from generate_series(1, 11) i))) $$,
                 'P0001', 'validation_failed', 'más de 10 fotos por producto se rechazan');
select throws_ok($$ select pg_temp.job(pg_temp.cafe('[42]')) $$,
                 'P0001', 'validation_failed', 'un enlace que no es texto se rechaza');

-- 2. Al terminar: un medio pendiente por enlace, en orden, con su job.
select is(pg_temp.commit(tests.fx('j1')), 'completed', 'la importación se confirma');
select is(pg_temp.queue(tests.fx('j1')), 2, 'se reservan las 2 fotos');
select is(pg_temp.remote(),
          '0:pending:image/jpeg:https://cdn.example.com/a.jpg,1:pending:image/jpeg:https://cdn.example.com/b.png?v=2',
          'pendientes, en el orden del archivo');
select is(pg_temp.fetch_jobs(), 2, 'un job media.fetch_remote por foto');
select is((select (totals ->> 'remote_images')::int from public.import_jobs where id = tests.fx('j1')),
          2, 'la importación anota cuántas fotos descarga');

-- 3. Idempotente: el mismo job o el mismo archivo otra vez no duplican.
select is(pg_temp.queue(tests.fx('j1')), 0, 'repetir el encolado no duplica');
select tests.set_fx('j2', pg_temp.job(pg_temp.cafe(
  '["https://cdn.example.com/a.jpg", "https://cdn.example.com/c.webp"]')));
select is(pg_temp.commit(tests.fx('j2')), 'completed', 'reimportar el archivo con una foto nueva');
select is(pg_temp.queue(tests.fx('j2')), 1, 'solo se reserva el enlace nuevo');

-- 4. Lo que fija el worker.
select tests.set_fx('m1', pg_temp.first_remote());
select is(pg_temp.worker_source(tests.fx('m1')), 'https://cdn.example.com/b.png?v=2',
          'el worker lee el enlace de un medio pendiente');
select ok(pg_temp.worker_set(tests.fx('m1'), 'image/png', 5000) like '%/original.jpg',
          'devuelve la ruta reservada (inmutable)');
select is((select mime_type || '/' || bytes from pg_temp.media_row(tests.fx('m1'))), 'image/png/5000',
          'y anota el tipo real y el tamaño descargado');
select is(pg_temp.worker_set(tests.fx('m1'), 'image/svg+xml', 5000), 'error:validation_failed',
          'un tipo no permitido se rechaza');
select is(pg_temp.worker_set(tests.fx('m1'), 'image/png', 50000000), 'error:validation_failed',
          'más de lo permitido para una foto se rechaza');
select tests.logout();

-- 5. Solo el worker.
select tests.login('owner');
select throws_ok($$ select system.import_queue_remote_images(tests.fx('j1')) $$, '42501', null,
                 'la usuaria no puede encolar descargas');
select throws_ok($$ select * from system.media_remote_source(tests.fx('m1')) $$, '42501', null,
                 'ni leer los enlaces desde la base');
select tests.logout();

select * from finish();
rollback;
