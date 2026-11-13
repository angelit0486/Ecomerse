-- =============================================================================
-- D3 (Orden 10, mensaje 4): la revisión de enlaces de fotos se controla en la
-- base, no en la memoria de una instancia. Reutilización, una revisión a la vez
-- por tienda e importación, tope de la plataforma, tope por hora, forma del
-- resultado, retención, permisos y aislamiento entre tiendas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
select tests.create_user('designer', 'designer@a.io');
select tests.add_store_member('a', 'designer', 'designer');

create function pg_temp.prow(p_row integer, p_handle text, p_images jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle),
    'errors', '[]'::jsonb,
    'normalized', jsonb_build_object('handle', p_handle, 'product', jsonb_build_object('title', initcap(p_handle)),
      'option_names', null, 'images', p_images,
      'variants', jsonb_build_array(jsonb_build_object('row_number', p_row, 'sku', upper(p_handle), 'price', 1000))))
$$;
create function pg_temp.job(p_store uuid, p_name text, p_rows jsonb) returns uuid language sql as $$
  select public.imports_create(p_store, 'create_only', p_name, array['handle', 'title', 'sku', 'price', 'image_urls'],
                               '{}', p_rows)
$$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
create function pg_temp.ok_result() returns jsonb language sql as $$
  select '{"total": 2, "checked": 2, "counts": {"ok": 1, "no_domain": 1},
           "problems": [{"row": 3, "handle": "plato", "link": "fotos.invalid/p.jpg", "status": "no_domain"}]}'::jsonb
$$;

select tests.login('owner');
select tests.set_fx('job1', pg_temp.job(tests.fx('store_a'), 'fotos.csv', jsonb_build_array(
  pg_temp.prow(2, 'taza', '["https://cdn.ejemplo.mx/taza.jpg"]'),
  pg_temp.prow(3, 'plato', '["https://fotos.invalid/p.jpg", "https://cdn.ejemplo.mx/taza.jpg"]'),
  pg_temp.prow(4, 'vaso', '[]'))));
select tests.set_fx('job2', pg_temp.job(tests.fx('store_a'), 'otro.csv', jsonb_build_array(
  pg_temp.prow(2, 'jarra', '["https://cdn.ejemplo.mx/jarra.jpg"]'))));
select tests.set_fx('nolinks', pg_temp.job(tests.fx('store_a'), 'sin-fotos.csv', jsonb_build_array(
  pg_temp.prow(2, 'cuchara', '[]'))));

-- 1-3. Empezar: enlaces distintos, en el orden de sus filas, y el registro en curso.
select tests.set_fx('check1', (public.imports_photo_check_begin(tests.fx('store_a'), tests.fx('job1')) ->> 'check_id')::uuid);
select is((select links from public.import_photo_checks where id = tests.fx('check1')), 2,
          'cuenta los enlaces distintos del archivo (uno repetido cuenta una vez)');
select is((select status from public.import_photo_checks where id = tests.fx('check1')), 'running',
          'la revisión queda registrada en curso');
select is(public.imports_photo_check_begin(tests.fx('store_a'), tests.fx('nolinks')) ->> 'action', 'no_links',
          'un archivo sin enlaces no abre una revisión');

-- 4-5. Repetir la misma importación o empezar otra de la tienda mientras corre.
select is(public.imports_photo_check_begin(tests.fx('store_a'), tests.fx('job1')) ->> 'action', 'running',
          'la misma importación no se revisa dos veces a la vez');
select is(public.imports_photo_check_begin(tests.fx('store_a'), tests.fx('job2')) ->> 'action', 'busy',
          'una revisión a la vez por tienda');

-- 6-8. Guardar el resultado: la forma se valida; solo quien la empezó.
select is(pg_temp.err(format('select public.imports_photo_check_finish(%L, %L, %L)', tests.fx('store_a'), tests.fx('check1'),
            '{"total": 1, "checked": 1, "counts": {"ok": 1}, "problems": [{"row": 2, "status": "hackeado"}]}')),
          'validation_failed/photo_check_result', 'un estado desconocido en el resultado se rechaza');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.err(format('select public.imports_photo_check_finish(%L, %L, %L)', tests.fx('store_b'), tests.fx('check1'),
            pg_temp.ok_result())),
          'not_found/photo_check', 'otra tienda no puede escribir el resultado (ni sabe que existe)');
select tests.logout();
select tests.login('owner');
select lives_ok(format('select public.imports_photo_check_finish(%L, %L, %L)', tests.fx('store_a'), tests.fx('check1'),
                       pg_temp.ok_result()), 'quien la empezó guarda el resultado');

-- 9-11. Reutilizar el resultado (también si se pide de nuevo antes de 10 minutos).
select is(public.imports_photo_check_begin(tests.fx('store_a'), tests.fx('job1')) ->> 'action', 'reuse',
          'sin pedirlo, se reutiliza el resultado guardado (no sale a internet)');
select is(public.imports_photo_check_begin(tests.fx('store_a'), tests.fx('job1'), true) -> 'result' -> 'counts' ->> 'no_domain', '1',
          'el resultado reutilizado es el guardado');
select ok((public.imports_photo_check_begin(tests.fx('store_a'), tests.fx('job1'), true) ->> 'retry_after_seconds')::int > 0,
          'pedirla otra vez antes de 10 minutos también reutiliza y dice cuándo se puede');

-- 12. Pasados 10 minutos, pedirla otra vez sí abre una revisión nueva.
select tests.logout();
update public.import_photo_checks set finished_at = now() - interval '11 minutes' where id = tests.fx('check1');
select tests.logout();
select tests.login('owner');
select tests.set_fx('check2', (public.imports_photo_check_begin(tests.fx('store_a'), tests.fx('job1'), true) ->> 'check_id')::uuid);
select isnt(tests.fx('check2'), tests.fx('check1'), 'pasados 10 minutos, se puede revisar otra vez a pedido');

-- 13. Una revisión colgada (la instancia se cayó) vence a los 2 minutos.
select tests.logout();
update public.import_photo_checks set started_at = now() - interval '3 minutes' where id = tests.fx('check2');
select tests.logout();
select tests.login('owner');
select is(public.imports_photo_check_begin(tests.fx('store_a'), tests.fx('job2')) ->> 'action', 'start',
          'la revisión colgada no bloquea a la tienda para siempre');
select tests.logout();
select is((select error from public.import_photo_checks where id = tests.fx('check2')), 'expired',
          'y queda registrada como vencida');

-- 15. Tope de la plataforma: 8 revisiones simultáneas entre todas las tiendas.
update public.import_photo_checks set status = 'failed', error = 'prueba', finished_at = now()
 where store_id = tests.fx('store_a') and status = 'running';
select tests.logout();
select tests.login('owner_b');
select tests.set_fx('job_b', pg_temp.job(tests.fx('store_b'), 'b.csv', jsonb_build_array(
  pg_temp.prow(2, 'mesa', '["https://cdn.ejemplo.mx/mesa.jpg"]'))));
select tests.logout();
insert into public.import_photo_checks (store_id, import_job_id, status, links)
select tests.fx('store_b'), tests.fx('job_b'), 'running', 1 from generate_series(1, 8);
select tests.logout();
select tests.login('owner');
select is(public.imports_photo_check_begin(tests.fx('store_a'), tests.fx('job2')) ->> 'action', 'busy_platform',
          'con 8 revisiones en curso en la plataforma, la tienda espera (nadie acapara la capacidad)');
select tests.logout();
delete from public.import_photo_checks where store_id = tests.fx('store_b');

-- 16. Tope por hora de la tienda (persistente, no en memoria).
update system.rate_limits set hits = 10
 where bucket = 'imports.photo_check:' || tests.fx('store_a')::text;
insert into system.rate_limits (bucket, window_start, hits)
select 'imports.photo_check:' || tests.fx('store_a')::text,
       to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 10
on conflict (bucket, window_start) do update set hits = 10;
select tests.logout();
select tests.login('owner');
select is(public.imports_photo_check_begin(tests.fx('store_a'), tests.fx('job2'), true) ->> 'action', 'rate_limited',
          'más de 10 revisiones por hora en una tienda: se frena');

-- 17-19. Permisos y aislamiento.
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.err(format('select public.imports_photo_check_begin(%L, %L)', tests.fx('store_a'), tests.fx('job1'))),
          'forbidden', 'otra tienda no puede revisar una importación ajena');
select is(pg_temp.err(format('select public.imports_photo_check_begin(%L, %L)', tests.fx('store_b'), tests.fx('job1'))),
          'not_found/import_job', 'ni haciéndola pasar por suya');
select is((select count(*)::int from public.import_photo_checks where store_id = tests.fx('store_a')), 0,
          'RLS: otra tienda no ve las revisiones');
select tests.logout();
select tests.login('designer');
select is(pg_temp.err(format('select public.imports_photo_check_begin(%L, %L)', tests.fx('store_a'), tests.fx('job1'))),
          'forbidden', 'un rol sin importar productos no revisa');

-- 21-23. Privilegios de la tabla y de las funciones.
select tests.logout();
select ok(not has_table_privilege('authenticated', 'public.import_photo_checks', 'insert')
          and not has_table_privilege('authenticated', 'public.import_photo_checks', 'update'),
          'nadie escribe la tabla directamente');
select ok(not has_function_privilege('anon', 'public.imports_photo_check_begin(uuid, uuid, boolean)', 'execute'),
          'anon no puede empezar revisiones');
select ok(not has_function_privilege('system_worker', 'system.purge_retention_base(integer)', 'execute')
          and has_function_privilege('system_worker', 'system.purge_retention(integer)', 'execute'),
          'el worker llama a la purga envuelta, no a la base');

-- 24. Una importación que ya no es vista previa no se revisa.
update public.import_jobs set status = 'completed' where id = tests.fx('job2');
select tests.logout();
select tests.login('owner');
select is(pg_temp.err(format('select public.imports_photo_check_begin(%L, %L)', tests.fx('store_a'), tests.fx('job2'))),
          'conflict/import_not_validated', 'solo se revisa una vista previa');

-- 25-26. Retención: la purga diaria borra las revisiones vencidas.
select tests.logout();
update public.import_photo_checks set expires_at = now() - interval '1 minute' where store_id = tests.fx('store_a');
select is((system.purge_retention() ->> 'photo_checks')::int >= 1, true, 'la purga diaria borra las revisiones vencidas');
select is((select count(*)::int from public.import_photo_checks where store_id = tests.fx('store_a')), 0,
          'no queda ninguna vencida');

-- 27. El metatest de RLS y FK compuestas cubre la tabla nueva (00_schema_security);
--     aquí se comprueba además el trigger de inmutabilidad del tenant.
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.import_photo_checks'::regclass
                    and tgname = 'import_photo_checks_prevent_tenant_change'),
          'la tabla tiene el trigger de inmutabilidad de tienda');

select * from finish();
rollback;
