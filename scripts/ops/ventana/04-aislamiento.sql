-- =============================================================================
-- Ventana única (Orden 10, mensaje 7, H4-B) — PASO 9b: aislamiento entre tiendas.
-- *** ESCRIBE Y REVIERTE *** Crea datos de prueba en las dos tiendas de prueba,
-- comprueba como el dueño de cada una que ve lo suyo y nada de la otra, y
-- termina con ROLLBACK: no queda nada. Requiere la autorización de la ventana.
--
-- Tiendas de prueba (runbook de despliegue §11.5): dos tiendas con handle
-- `pruva-ventana-a` y `pruva-ventana-b`, cada una en SU PROPIA organización y con
-- un dueño (org_owner). Se crean antes de la ventana desde la Consola. Se buscan
-- por handle: ningún id está escrito aquí. Si faltan, el guion se detiene.
--
-- Correr con psql (no con el editor SQL, que puede no mostrar el resultado de
-- una transacción revertida [NO VERIFICADO]):
--   psql -X -v ON_ERROR_STOP=1 -At -F '|' -f scripts/ops/ventana/04-aislamiento.sql
-- REGLA: cualquier fila con ok = false detiene la ventana (categoría «detener»).
-- Probado en tests/integration/window-isolation.test.ts (también que una
-- política filtrada se detecta).
-- =============================================================================
begin;

create temp table _aislamiento (
  orden        serial,
  comprobacion text,
  valor        text,
  esperado     text,
  ok           boolean,
  categoria    text default 'detener'
) on commit drop;
grant insert, select on _aislamiento to authenticated, anon;
grant usage on sequence _aislamiento_orden_seq to authenticated, anon;

do $$
declare
  v_store   uuid[] := array[]::uuid[];
  v_org     uuid[] := array[]::uuid[];
  v_owner   uuid[] := array[]::uuid[];
  v_product uuid[] := array[null, null]::uuid[];
  v_job     uuid[] := array[null, null]::uuid[];
  v_batch   uuid[] := array[null, null]::uuid[];
  v_run     uuid[] := array[null, null]::uuid[];
  v_handle  text;
  v_s       uuid;
  v_o       uuid;
  v_u       uuid;
  me        integer;
  other     integer;
  v_n       bigint;
  v_tag     text;
  v_table   text;
begin
  -- 0. Resolver las tiendas de prueba por handle.
  foreach v_handle in array array['pruva-ventana-a', 'pruva-ventana-b'] loop
    select s.id, s.organization_id into v_s, v_o from public.stores s where s.handle = v_handle;
    select m.user_id into v_u from public.organization_members m
     where m.organization_id = v_o and m.role = 'org_owner' order by m.created_at limit 1;
    if v_s is null or v_u is null then
      raise exception using errcode = 'P0001', message = 'ventana_sin_tiendas_de_prueba',
        detail = format('Falta la tienda %s o su dueño (org_owner).', v_handle),
        hint = 'Crearlas antes de la ventana (runbook de despliegue, §11.5).';
    end if;
    v_store := v_store || v_s; v_org := v_org || v_o; v_owner := v_owner || v_u;
  end loop;
  if v_org[1] = v_org[2] then
    raise exception using errcode = 'P0001', message = 'ventana_sin_tiendas_de_prueba',
      detail = 'Las dos tiendas de prueba deben estar en organizaciones distintas.';
  end if;

  -- 1. Datos de prueba en cada tienda (se revierten al final).
  for me in 1 .. 2 loop
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_owner[me], 'role', 'authenticated', 'aal', 'aal2')::text, true);
    perform set_config('role', 'authenticated', true);
    select (public.catalog_upsert_product(v_store[me], jsonb_build_object(
              'title', 'Ventana aislamiento', 'slug', 'ventana-aislamiento-' || gen_random_uuid(),
              'variants', jsonb_build_array(jsonb_build_object('price', 10000, 'sku', 'VA-' || me)))) ->> 'id')::uuid
      into v_s;
    v_product[me] := v_s;
    perform set_config('role', 'postgres', true);
    insert into public.import_jobs (store_id, type, mode, status, file_name, requested_by, columns, needs, totals)
    values (v_store[me], 'products', 'create_only', 'validated', 'ventana.csv', v_owner[me],
            array['handle', 'title'], array['imports.run'], '{"rows": 1, "errors": 0}')
    returning id into v_s;
    v_job[me] := v_s;
    insert into public.import_batches (store_id, file_name, mode, total_rows, parts_count, part_rows,
                                       part_fingerprints, file_fingerprint, status, requested_by)
    values (v_store[me], 'ventana.csv', 'create_only', 1, 1, '{1}', array[repeat('0', 64)], repeat('0', 64),
            'ready', v_owner[me])
    returning id into v_s;
    v_batch[me] := v_s;
    insert into public.publish_runs (store_id, import_job_id, requested_by, status)
    values (v_store[me], v_job[me], v_owner[me], 'completed') returning id into v_s;
    v_run[me] := v_s;
    insert into public.publish_run_items (store_id, run_id, product_id) values (v_store[me], v_run[me], v_product[me]);
    insert into public.import_photo_checks (store_id, import_job_id, status, requested_by)
    values (v_store[me], v_job[me], 'done', v_owner[me]);
  end loop;

  -- 2. Como el dueño de cada tienda: lo suyo sí, lo de la otra no.
  for me in 1 .. 2 loop
    other := 3 - me;
    v_tag := case me when 1 then 'A' else 'B' end;
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_owner[me], 'role', 'authenticated', 'aal', 'aal2')::text, true);
    perform set_config('role', 'authenticated', true);

    foreach v_table in array array['import_batches', 'import_jobs', 'publish_runs', 'publish_run_items',
                                   'import_photo_checks', 'products'] loop
      execute format('select count(*) from public.%I where store_id = $1', v_table) into v_n using v_store[me];
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('dueño %s ve sus %s', v_tag, v_table), v_n::text, '>= 1', v_n >= 1);
      execute format('select count(*) from public.%I where store_id = $1', v_table) into v_n using v_store[other];
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('dueño %s no ve %s de la otra tienda', v_tag, v_table), v_n::text, '0', v_n = 0);
    end loop;

    -- Actuar sobre recursos de la otra tienda: cada intento debe rechazarse con 42501.
    begin
      perform public.imports_batch_cancel(v_store[other], v_batch[other]);
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('dueño %s no cancela el lote de la otra', v_tag), 'aceptado', 'rechazado (42501)', false);
    exception when others then
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('dueño %s no cancela el lote de la otra', v_tag), 'rechazado (' || sqlstate || ')',
              'rechazado (42501)', sqlstate = '42501');
    end;
    begin
      perform public.imports_commit(v_store[other], v_job[other]);
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('dueño %s no aplica la importación de la otra', v_tag), 'aceptado', 'rechazado (42501)', false);
    exception when others then
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('dueño %s no aplica la importación de la otra', v_tag), 'rechazado (' || sqlstate || ')',
              'rechazado (42501)', sqlstate = '42501');
    end;
    begin
      perform public.catalog_publish_product(v_store[other], v_product[other]);
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('dueño %s no publica productos de la otra', v_tag), 'aceptado', 'rechazado (42501)', false);
    exception when others then
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('dueño %s no publica productos de la otra', v_tag), 'rechazado (' || sqlstate || ')',
              'rechazado (42501)', sqlstate = '42501');
    end;
    begin
      perform system.publish_run_step(v_run[other]);
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('dueño %s no corre la publicación de nadie', v_tag), 'aceptado', 'rechazado (42501)', false);
    exception when others then
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('dueño %s no corre la publicación de nadie', v_tag), 'rechazado (' || sqlstate || ')',
              'rechazado (42501)', sqlstate = '42501');
    end;
    begin
      update public.products set title = 'cambiado' where store_id = v_store[other];
      get diagnostics v_n = row_count;
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('dueño %s no edita productos de la otra', v_tag), v_n || ' fila(s)', '0 filas o 42501', v_n = 0);
    exception when others then
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('dueño %s no edita productos de la otra', v_tag), 'rechazado (' || sqlstate || ')',
              '0 filas o 42501', sqlstate = '42501');
    end;
    perform set_config('role', 'postgres', true);
  end loop;

  -- 3. Sin sesión (anon): no lee lotes ni publicaciones.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
  foreach v_table in array array['import_batches', 'publish_runs'] loop
    begin
      execute format('select count(*) from public.%I', v_table) into v_n;
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('anon no lee %s', v_table), v_n || ' fila(s)', 'rechazado (42501)', false);
    exception when others then
      insert into _aislamiento (comprobacion, valor, esperado, ok)
      values (format('anon no lee %s', v_table), 'rechazado (' || sqlstate || ')', 'rechazado (42501)',
              sqlstate = '42501');
    end;
  end loop;
  perform set_config('role', 'postgres', true);
end
$$;

select comprobacion, valor, esperado, ok, categoria from _aislamiento order by orden;
rollback;
