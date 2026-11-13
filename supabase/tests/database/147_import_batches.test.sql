-- =============================================================================
-- ADR-064 opción A (Orden 10, mensaje 4): importación por partes. Atomicidad por
-- parte; partes en orden; el lote se detiene en la que falla (anteriores
-- aplicadas, esa sin rastro, siguientes pendientes); corregir y repetir solo
-- esa; idempotencia; productos no repartidos; topes; cancelación; categorías
-- del lote; aislamiento entre tiendas. (18,000 filas: prueba de integración y E2E.)
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function pg_temp.fp(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.cols() returns text[] language sql as $$ select array['handle', 'title', 'sku', 'price', 'categories'] $$;
create function pg_temp.prow(p_row integer, p_handle text, p_sku text, p_cats jsonb default '[]') returns jsonb language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle), 'errors', '[]'::jsonb,
    'normalized', jsonb_build_object('handle', p_handle, 'product', jsonb_build_object('title', initcap(p_handle)),
      'option_names', null, 'categories', p_cats,
      'variants', jsonb_build_array(jsonb_build_object('row_number', p_row, 'sku', p_sku, 'price', 1000))))
$$;
create function pg_temp.part(p_batch uuid, p_part integer, p_fp text, p_rows jsonb) returns jsonb language sql as $$
  select public.imports_create_part(tests.fx('store_a'), p_batch, p_part, p_fp, pg_temp.cols(), '{}', p_rows)
$$;
-- El worker: aplica una parte y avanza el lote en la misma transacción.
create function pg_temp.work(p_job uuid) returns text language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_role('system_worker');
  v := system.import_commit(p_job);
  perform system.import_batch_after_part(p_job);
  perform tests.logout();
  return v ->> 'status';
end $$;
create function pg_temp.part_job(p_batch uuid, p_part integer) returns uuid language sql as $$
  select id from public.import_jobs where batch_id = p_batch and part_number = p_part and status <> 'cancelled'
   order by (status <> 'failed') desc, created_at desc limit 1
$$;
create function pg_temp.part_status(p_batch uuid, p_part integer) returns text language sql as $$
  select status from public.import_jobs where id = pg_temp.part_job(p_batch, p_part)
$$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), ''); end $$;
create function pg_temp.hits() returns integer language sql security definer as $$
  select coalesce(sum(hits), 0)::integer from system.rate_limits where bucket = 'imports:' || tests.fx('store_a')::text
$$;
create function pg_temp.create_batch(p_name text, p_parts integer) returns jsonb language sql as $$
  select public.imports_batch_create(tests.fx('store_a'), p_name, 'create_only',
    array(select 2 from generate_series(1, p_parts)),
    array(select pg_temp.fp(p_name || g) from generate_series(1, p_parts) g), pg_temp.fp(p_name))
$$;

select tests.login('owner');

-- ------------------------------------------------ 1. Crear el lote
select is(pg_temp.err(format('select public.imports_batch_create(%L, %L, %L, %L, %L, %L)', tests.fx('store_a'),
            'x.csv', 'upsert', '{}', '{}', pg_temp.fp('x'))),
          'validation_failed/batch', 'un lote necesita al menos 1 parte');
select is(pg_temp.err(format('select public.imports_batch_create(%L, %L, %L, %L, %L, %L)', tests.fx('store_a'),
            'x.csv', 'upsert', array(select 10 from generate_series(1, 11)),
            array(select pg_temp.fp('p' || g) from generate_series(1, 11) g), pg_temp.fp('x'))),
          'validation_failed/batch', 'ni más de 10 partes');
select is(pg_temp.err(format('select public.imports_batch_create(%L, %L, %L, %L, %L, %L)', tests.fx('store_a'),
            'x.csv', 'upsert', '{5001,10}', array[pg_temp.fp('a'), pg_temp.fp('b')], pg_temp.fp('x'))),
          'validation_failed/batch', 'ninguna parte puede pasar de 5,000 filas');
select tests.set_fx('batch', (pg_temp.create_batch('catalogo.csv', 4) ->> 'batch_id')::uuid);
select is((select status from public.import_batches where id = tests.fx('batch')), 'uploading', 'el lote nace subiendo');
select is(pg_temp.create_batch('catalogo.csv', 4) ->> 'batch_id', tests.fx('batch')::text,
          'elegir otra vez el mismo archivo retoma el mismo lote (no crea otro)');
select is((public.imports_batch_create(tests.fx('store_a'), 'pesado.csv', 'upsert', '{3000}',
             array[pg_temp.fp('pesado1')], pg_temp.fp('pesado.csv')) ->> 'resumed')::boolean, false,
          'un archivo de más de 4 MB con hasta 5,000 filas entra como lote de una parte');

-- ------------------------------------------------ 2. Subir partes: idempotencia y productos completos
select is(pg_temp.err(format('select pg_temp.part(%L, 1, %L, %L)', tests.fx('batch'), pg_temp.fp('otro archivo'),
            jsonb_build_array(pg_temp.prow(2, 'p1-a', 'P1-A'), pg_temp.prow(3, 'p1-b', 'P1-B')))),
          'validation_failed/part_fingerprint', 'una parte de otro archivo no se acepta');
create temp table hits_before as select pg_temp.hits() as n;
select tests.set_fx('p1', (pg_temp.part(tests.fx('batch'), 1, pg_temp.fp('catalogo.csv1'),
  jsonb_build_array(pg_temp.prow(2, 'p1-a', 'P1-A'), pg_temp.prow(3, 'p1-b', 'P1-B'))) ->> 'job_id')::uuid);
select is((select pg_temp.hits() - n from hits_before), 1, 'cada parte cuenta en el tope de importaciones');
select is(pg_temp.part(tests.fx('batch'), 1, pg_temp.fp('catalogo.csv1'),
            jsonb_build_array(pg_temp.prow(2, 'p1-a', 'P1-A'), pg_temp.prow(3, 'p1-b', 'P1-B'))) ->> 'job_id',
          tests.fx('p1')::text, 'subir otra vez la misma parte devuelve la misma importación');
select is((select pg_temp.hits() - n from hits_before), 1, '…y no gasta otra del tope');
select is((select count(*)::int from public.import_jobs where batch_id = tests.fx('batch') and part_number = 1), 1,
          'sin importaciones duplicadas de la parte');
select is(pg_temp.create_batch('catalogo.csv', 4) -> 'parts',
          jsonb_build_array(jsonb_build_object('part', 1, 'status', 'validated',
                                               'fingerprint', pg_temp.fp('catalogo.csv1'), 'errors', 0)),
          'al retomar, el navegador sabe qué partes ya subió (y no las vuelve a mandar)');
select is(pg_temp.err(format('select pg_temp.part(%L, 2, %L, %L)', tests.fx('batch'), pg_temp.fp('catalogo.csv2'),
            jsonb_build_array(pg_temp.prow(4, 'p1-a', 'P1-A2'), pg_temp.prow(5, 'p2-b', 'P2-B')))),
          'validation_failed/split_product', 'un producto no puede quedar repartido entre dos partes');
select is((select count(*)::int from public.import_jobs where batch_id = tests.fx('batch') and part_number = 2), 0,
          'y esa parte no se guardó');
select pg_temp.part(tests.fx('batch'), 2, pg_temp.fp('catalogo.csv2'),
  jsonb_build_array(pg_temp.prow(4, 'p2-a', 'P2-A'), pg_temp.prow(5, 'p2-b', 'P2-B')));
select pg_temp.part(tests.fx('batch'), 3, pg_temp.fp('catalogo.csv3'),
  jsonb_build_array(pg_temp.prow(6, 'p3-a', 'P3-A'), pg_temp.prow(7, 'p3-b', 'P3-B')));
select pg_temp.part(tests.fx('batch'), 4, pg_temp.fp('catalogo.csv4'),
  jsonb_build_array(pg_temp.prow(8, 'p4-a', 'P4-A'), pg_temp.prow(9, 'p4-b', 'P4-B')));
select is((select status from public.import_batches where id = tests.fx('batch')), 'ready',
          'con las 4 partes arriba, el lote queda listo');
select is(pg_temp.err(format('select public.imports_commit(%L, %L)', tests.fx('store_a'), tests.fx('p1'))),
          'conflict/batch_part', 'una parte no se aplica suelta: solo desde su lote, en orden');
select is(pg_temp.err(format('select public.imports_accept_categories(%L, %L, %L)', tests.fx('store_a'), tests.fx('p1'), '{Calzado}')),
          'conflict/batch_part', 'y sus categorías nuevas se eligen en el lote, no parte por parte');

-- ------------------------------------------------ 3. Fallo en la tercera parte
-- Entre la vista previa y la aplicación otro producto toma un SKU de la parte 3:
-- la parte 3 fallará AL APLICARSE (no en la vista previa).
select public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Intruso","slug":"intruso","variants":[{"price":100,"sku":"P3-B"}]}');
select is(public.imports_batch_commit(tests.fx('store_a'), tests.fx('batch')) ->> 'status', 'running',
          'aplicar el lote empieza por la parte 1');
select is(array[pg_temp.part_status(tests.fx('batch'), 1), pg_temp.part_status(tests.fx('batch'), 2)],
          array['committing', 'validated'], 'una parte a la vez: la 2 espera');
select is(public.imports_batch_commit(tests.fx('store_a'), tests.fx('batch')) ->> 'replayed', 'true',
          'pedirlo dos veces no empieza dos partes');
select is(pg_temp.err(format('select public.imports_batch_cancel(%L, %L)', tests.fx('store_a'), tests.fx('batch'))),
          'conflict/batch_processing', 'no se cancela mientras una parte se está aplicando');
select is(pg_temp.err(format('select pg_temp.part(%L, 1, %L, %L)', tests.fx('batch'), pg_temp.fp('catalogo.csv1-otra'),
            jsonb_build_array(pg_temp.prow(2, 'p1-a', 'P1-A'), pg_temp.prow(3, 'p1-b', 'P1-B')))),
          'conflict/part_processing', 'ni se reemplaza una parte que se está aplicando');
select tests.logout();
select is(pg_temp.work(pg_temp.part_job(tests.fx('batch'), 1)), 'completed', 'parte 1 aplicada');
select is(pg_temp.part_status(tests.fx('batch'), 2), 'committing', 'el worker sigue solo con la parte 2');
select is(pg_temp.work(pg_temp.part_job(tests.fx('batch'), 2)), 'completed', 'parte 2 aplicada');
select is(pg_temp.work(pg_temp.part_job(tests.fx('batch'), 3)), 'failed', 'la parte 3 falla al aplicarse');
select is((select status from public.import_batches where id = tests.fx('batch')), 'stopped', 'el lote se detiene');
select matches((select stop_reason from public.import_batches where id = tests.fx('batch')),
          '^La parte 3 no se pudo aplicar', 'y dice qué parte falló');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug in ('p1-a', 'p1-b', 'p2-a', 'p2-b')),
          4, 'las partes 1 y 2 permanecen aplicadas');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug in ('p3-a', 'p3-b')),
          0, 'la parte 3 se revirtió completa (ni su primera fila quedó)');
select is(pg_temp.part_status(tests.fx('batch'), 4), 'validated', 'la parte 4 sigue pendiente (no se aplicó)');

-- ------------------------------------------------ 4. Corregir y repetir solo la tercera
select tests.login('owner');
select tests.set_fx('p3old', pg_temp.part_job(tests.fx('batch'), 3));
select isnt((pg_temp.part(tests.fx('batch'), 3, pg_temp.fp('catalogo.csv3-corregida'),
  jsonb_build_array(pg_temp.prow(6, 'p3-a', 'P3-A'), pg_temp.prow(7, 'p3-b', 'P3-B2'))) ->> 'job_id')::uuid,
  tests.fx('p3old'), 'la parte 3 corregida es una importación nueva');
select is((select status from public.import_jobs where id = tests.fx('p3old')), 'failed',
          'la que falló queda en el historial como fallida');
select is((select part_fingerprints[3] from public.import_batches where id = tests.fx('batch')),
          pg_temp.fp('catalogo.csv3-corregida'), 'el lote registra la versión corregida de la parte');
select is(pg_temp.err(format('select pg_temp.part(%L, 1, %L, %L)', tests.fx('batch'), pg_temp.fp('catalogo.csv1-otra'),
            jsonb_build_array(pg_temp.prow(2, 'p1-a', 'P1-A'), pg_temp.prow(3, 'p1-b', 'P1-B')))),
          'conflict/part_applied', 'una parte ya aplicada no se puede volver a subir');
select public.imports_batch_commit(tests.fx('store_a'), tests.fx('batch'));
select is(pg_temp.part_status(tests.fx('batch'), 3), 'committing', 'continuar retoma en la parte 3 (la 1 y la 2 no se repiten)');
select tests.logout();
select is(pg_temp.work(pg_temp.part_job(tests.fx('batch'), 3)), 'completed', 'parte 3 aplicada');
select is(pg_temp.work(pg_temp.part_job(tests.fx('batch'), 4)), 'completed', 'parte 4 aplicada');
select is((select status from public.import_batches where id = tests.fx('batch')), 'completed', 'el lote termina');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug like 'p_-_'), 8,
          'sin productos duplicados: 8');
select is((select array_agg(v.sku order by v.sku) from public.product_variants v
             join public.products p on p.store_id = v.store_id and p.id = v.product_id
            where v.store_id = tests.fx('store_a') and p.slug like 'p_-_'),
          array['P1-A', 'P1-B', 'P2-A', 'P2-B', 'P3-A', 'P3-B2', 'P4-A', 'P4-B'],
          'sin variantes duplicadas: 8, con la corrección de la parte 3');

-- ------------------------------------------------ 5. Aislamiento entre tiendas
select tests.login('owner_b');
select is((select count(*)::int from public.import_batches where store_id = tests.fx('store_a')), 0,
          'RLS: otra tienda no ve los lotes');
select is(pg_temp.err(format('select public.imports_batch_commit(%L, %L)', tests.fx('store_b'), tests.fx('batch'))),
          'not_found/import_batch', 'ni puede aplicar un lote ajeno haciéndolo pasar por suyo');
select is(pg_temp.err(format('select public.imports_create_part(%L, %L, 1, %L, %L, %L, %L)', tests.fx('store_a'), tests.fx('batch'),
            pg_temp.fp('x'), pg_temp.cols(), '{}', jsonb_build_array(pg_temp.prow(2, 'z', 'Z')))),
          'forbidden', 'ni subirle partes');
select tests.logout();

-- ------------------------------------------------ 6. Categorías del lote, cancelar y topes
select tests.login('owner');
select tests.set_fx('b2', (pg_temp.create_batch('zapatos.csv', 2) ->> 'batch_id')::uuid);
select pg_temp.part(tests.fx('b2'), 1, pg_temp.fp('zapatos.csv1'),
  jsonb_build_array(pg_temp.prow(2, 'tenis', 'TEN-1', '["Calzado"]'), pg_temp.prow(3, 'bota', 'BOT-1', '["Calzado"]')));
select pg_temp.part(tests.fx('b2'), 2, pg_temp.fp('zapatos.csv2'),
  jsonb_build_array(pg_temp.prow(4, 'sandalia', 'SAN-1', '["calzado"]'), pg_temp.prow(5, 'pantufla', 'PAN-1', '["Calzado"]')));
select is((public.imports_batch_new_categories(tests.fx('store_a'), tests.fx('b2')) -> 'missing' -> 0 ->> 'products')::int, 4,
          'el lote suma los productos de todas sus partes por categoría');
select public.imports_batch_accept_categories(tests.fx('store_a'), tests.fx('b2'), array['Calzado']);
select is((select sum((totals ->> 'errors')::int)::int from public.import_jobs where batch_id = tests.fx('b2') and status = 'validated'),
          0, 'aceptarla una vez en el lote la quita de todas las partes');
select public.imports_batch_commit(tests.fx('store_a'), tests.fx('b2'));
select tests.logout();
select is(pg_temp.work(pg_temp.part_job(tests.fx('b2'), 1)), 'completed', 'la parte 1 crea la categoría al aplicarse');
select is(pg_temp.work(pg_temp.part_job(tests.fx('b2'), 2)), 'completed', 'y la parte 2 usa la misma');
select is((select status from public.import_batches where id = tests.fx('b2')), 'completed', 'el lote con categorías nuevas termina');
select is((select count(*)::int from public.categories where store_id = tests.fx('store_a') and lower(name) = 'calzado'), 1,
          'una sola categoría «Calzado», aunque la pidieron dos partes');
select is((select count(*)::int from public.product_categories pc join public.categories c on c.store_id = pc.store_id and c.id = pc.category_id
            where pc.store_id = tests.fx('store_a') and lower(c.name) = 'calzado'), 4,
          'con los 4 productos de las dos partes');

-- Cancelar un lote aplicado a medias: lo aplicado se queda y se dice.
select tests.login('owner');
select tests.set_fx('b3', (pg_temp.create_batch('cancelar.csv', 2) ->> 'batch_id')::uuid);
select pg_temp.part(tests.fx('b3'), 1, pg_temp.fp('cancelar.csv1'), jsonb_build_array(pg_temp.prow(2, 'gorra', 'GOR-1')));
select pg_temp.part(tests.fx('b3'), 2, pg_temp.fp('cancelar.csv2'), jsonb_build_array(pg_temp.prow(3, 'tenis', 'TEN-9')));
select is((select (totals ->> 'errors')::int from public.import_jobs where id = pg_temp.part_job(tests.fx('b3'), 2)), 1,
          'la parte 2 trae un error de validación (ese producto ya existe y el modo es «solo crear»)');
select public.imports_batch_commit(tests.fx('store_a'), tests.fx('b3'));
select tests.logout();
select is(pg_temp.work(pg_temp.part_job(tests.fx('b3'), 1)), 'completed', 'la parte 1 se aplica');
select is((select stop_reason from public.import_batches where id = tests.fx('b3')),
          'La parte 2 tiene errores: corrígela y súbela de nuevo.', 'y el lote se detiene antes de la parte con errores');
select tests.login('owner');
select is((public.imports_batch_cancel(tests.fx('store_a'), tests.fx('b3')) ->> 'applied_parts')::int, 1,
          'un lote detenido se puede cancelar');
select is((select stop_reason from public.import_batches where id = tests.fx('b3')),
          'Lote cancelado: 1 parte ya aplicada se queda en tu catálogo.', 'cancelar no deshace lo aplicado y lo dice');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a') and slug = 'gorra'), 1,
          'el producto de la parte aplicada sigue en el catálogo');
select is((select status from public.import_jobs where id = (select id from public.import_jobs
            where batch_id = tests.fx('b3') and part_number = 2 order by created_at desc limit 1)), 'cancelled',
          'la parte sin aplicar queda cancelada');

-- Una parte atascada (el worker murió y su trabajo ya no está en la cola) detiene su lote.
select tests.set_fx('b4', (pg_temp.create_batch('atascado.csv', 2) ->> 'batch_id')::uuid);
select pg_temp.part(tests.fx('b4'), 1, pg_temp.fp('atascado.csv1'), jsonb_build_array(pg_temp.prow(2, 'cinto', 'CIN-1')));
select pg_temp.part(tests.fx('b4'), 2, pg_temp.fp('atascado.csv2'), jsonb_build_array(pg_temp.prow(3, 'cartera', 'CAR-1')));
select public.imports_batch_commit(tests.fx('store_a'), tests.fx('b4'));
select tests.logout();
select tests.set_fx('b4p1', pg_temp.part_job(tests.fx('b4'), 1));
delete from system.jobs where dedupe_key = 'import.commit:' || tests.fx('b4p1')::text;
update public.import_jobs set commit_requested_at = now() - interval '31 minutes' where id = tests.fx('b4p1');
create function pg_temp.sweep() returns integer language plpgsql as $$
declare v integer;
begin
  perform tests.as_role('system_worker');
  v := system.fail_stuck_imports();
  perform tests.logout();
  return v;
end $$;
select is(pg_temp.sweep(), 1, 'el mantenimiento encuentra la parte atascada');
select is((select status from public.import_jobs where id = tests.fx('b4p1')), 'failed', 'la marca fallida (no se cambió nada)');
select is((select status from public.import_batches where id = tests.fx('b4')), 'stopped',
          'y detiene su lote: ya no se queda «aplicando» para siempre');
select matches((select stop_reason from public.import_batches where id = tests.fx('b4')),
          '^La parte 1 no se pudo aplicar: La importación no terminó', 'con el motivo a la vista');

-- Una publicación de candidatos cuyo trabajo murió se retoma sola (hasta 3 veces) y después falla con el motivo.
select tests.set_fx('tenis', (select id from public.products where store_id = tests.fx('store_a') and slug = 'tenis'));
select tests.set_fx('pr', app.uuid_v7());
insert into public.publish_runs (id, store_id, import_job_id, requested_by, status)
values (tests.fx('pr'), tests.fx('store_a'), pg_temp.part_job(tests.fx('b2'), 1), tests.fx('owner'), 'running');
insert into public.publish_run_items (store_id, run_id, product_id) values (tests.fx('store_a'), tests.fx('pr'), tests.fx('tenis'));
alter table public.publish_runs disable trigger publish_runs_set_updated_at;
update public.publish_runs set updated_at = now() - interval '20 minutes' where id = tests.fx('pr');
create function pg_temp.resume() returns integer language plpgsql as $$
declare v integer;
begin
  perform tests.as_role('system_worker');
  v := system.resume_stuck_publish_runs();
  perform tests.logout();
  return v;
end $$;
select is(pg_temp.resume(), 1, 'una publicación sin trabajo vivo se retoma');
select is((select count(*)::int from system.jobs where dedupe_key = 'catalog.publish_run:' || tests.fx('pr')::text || ':1'
            and status = 'queued'), 1, 'con un trabajo nuevo en la cola (llave nueva)');
select is(pg_temp.resume(), 0, 'mientras ese trabajo vive, no se encola otro');
update system.jobs set status = 'dead', finished_at = now()
 where type = 'catalog.publish_run' and payload ->> 'run_id' = tests.fx('pr')::text;
update public.publish_runs set resumes = 3 where id = tests.fx('pr');
select is(pg_temp.resume(), 1, 'muerto otra vez tras 3 reintentos');
select is((select status from public.publish_runs where id = tests.fx('pr')), 'failed', 'la publicación queda fallida');
select matches((select error from public.publish_runs where id = tests.fx('pr')), '^La publicación no terminó',
               'con el motivo a la vista');
select is((select status from public.products where id = tests.fx('tenis')), 'draft',
          'y el producto sigue en borrador: nada se publicó sin pasar las reglas');
alter table public.publish_runs enable trigger publish_runs_set_updated_at;
select tests.logout();
update system.rate_limits set hits = 29 where bucket = 'imports:' || tests.fx('store_a')::text;
select tests.login('owner');
select is(pg_temp.err(format('select pg_temp.create_batch(%L, 3)', 'grande.csv')), 'rate_limited/imports_batch',
          'un lote que no cabe en el tope de 30 importaciones por hora se rechaza al crearlo');
select tests.logout();

select * from finish();
rollback;
