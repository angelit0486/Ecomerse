-- =============================================================================
-- Publicación masiva por candidatos (Orden 10, mensaje 4): «Publicado: sí» deja
-- candidatos; el worker los publica por tandas con las reglas de siempre;
-- los que no cumplen (precio, Cumplimiento) quedan sin publicar con su motivo;
-- idempotente, reanudable, revalida el permiso de quien importó, respeta lo
-- que la tienda cambió después y aísla tiendas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
select tests.create_user('catalog', 'catalog@a.io');
select tests.add_store_member('a', 'catalog', 'catalog_manager');

create function pg_temp.cols() returns text[] language sql as $$
  select array['handle', 'title', 'status', 'sku', 'price']
$$;
create function pg_temp.prow(p_row integer, p_handle text, p_price bigint, p_status text default 'active') returns jsonb
language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle), 'errors', '[]'::jsonb,
    'normalized', jsonb_build_object('handle', p_handle, 'status', p_status,
      'product', jsonb_build_object('title', initcap(p_handle)), 'option_names', null,
      'variants', jsonb_build_array(jsonb_build_object('row_number', p_row, 'sku', upper(p_handle), 'price', p_price))))
$$;
create function pg_temp.work(p_job uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_role('system_worker');
  v := system.import_commit(p_job);
  perform tests.logout();
  return v;
end $$;
create function pg_temp.run_of(p_job uuid) returns uuid language sql as $$
  select r.id from public.publish_runs r where r.import_job_id = p_job
$$;
create function pg_temp.step(p_job uuid, p_limit integer default 200) returns jsonb language plpgsql as $$
declare v jsonb; v_run uuid := pg_temp.run_of(p_job);
begin
  perform tests.as_role('system_worker');
  v := system.publish_run_step(v_run, p_limit);
  perform tests.logout();
  return v;
end $$;
create function pg_temp.status(p_store uuid, p_slug text) returns text language sql as $$
  select p.status from public.products p where p.store_id = p_store and p.slug = p_slug
$$;
create function pg_temp.item(p_job uuid, p_slug text) returns text language sql as $$
  select i.status || case when cardinality(i.reasons) > 0 then ':' || array_to_string(i.reasons, ',') else '' end
    from public.publish_run_items i join public.products p on p.store_id = i.store_id and p.id = i.product_id
   where i.run_id = pg_temp.run_of(p_job) and p.slug = p_slug
$$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics v_msg = message_text; return v_msg; end $$;

-- ------------------------------------------------ 1. La importación deja candidatos, no publica
select tests.login('owner');
select tests.set_fx('job1', public.imports_create(tests.fx('store_a'), 'create_only', 'lote.csv', pg_temp.cols(), '{}',
  jsonb_build_array(
    pg_temp.prow(2, 'taza', 15000),
    pg_temp.prow(3, 'plato', 0),          -- precio 0: no se puede publicar
    pg_temp.prow(4, 'vaso', 9000),
    pg_temp.prow(5, 'jarra', 12000),
    pg_temp.prow(6, 'olla', 30000, 'draft'))));
select public.imports_commit(tests.fx('store_a'), tests.fx('job1'));
select tests.logout();
select is(pg_temp.work(tests.fx('job1')) ->> 'status', 'completed',
          'un producto que no se puede publicar ya no tumba la importación');
select is(pg_temp.status(tests.fx('store_a'), 'taza'), 'draft', 'al importar nada se publica todavía');
select is((select (totals ->> 'candidates')::int from public.publish_runs where import_job_id = tests.fx('job1')), 4,
          'cuatro candidatos (el que pide borrador no lo es)');
select is((select count(*)::int from system.jobs where type = 'catalog.publish_run'
            and dedupe_key = 'catalog.publish_run:' || pg_temp.run_of(tests.fx('job1'))), 1,
          'el trabajo de publicación quedó en la cola en la misma transacción');

-- Mientras tanto la dueña publica «jarra» a mano y archiva «vaso».
select tests.login('owner');
select public.catalog_publish_product(tests.fx('store_a'), (select id from public.products where store_id = tests.fx('store_a') and slug = 'jarra'));
select public.catalog_set_product_status(tests.fx('store_a'), (select id from public.products where store_id = tests.fx('store_a') and slug = 'vaso'), 'archived');
select tests.logout();

-- ------------------------------------------------ 2. Por tandas, reanudable
select is(pg_temp.step(tests.fx('job1'), 1) ->> 'remaining', '3', 'una tanda de 1 deja 3 pendientes (se puede cortar)');
select is(pg_temp.step(tests.fx('job1')) ->> 'status', 'completed', 'la siguiente tanda termina la corrida');
select is(pg_temp.status(tests.fx('store_a'), 'taza'), 'active', 'el que cumple se publicó');
select is(pg_temp.item(tests.fx('job1'), 'taza'), 'published', '…y quedó registrado');
select is(pg_temp.status(tests.fx('store_a'), 'plato'), 'draft', 'el de precio 0 sigue en borrador');
select is(pg_temp.item(tests.fx('job1'), 'plato'), 'blocked:price_zero', '…con su motivo');
select is(pg_temp.item(tests.fx('job1'), 'jarra'), 'already', 'el que la dueña ya publicó cuenta como ya publicado');
select is(pg_temp.item(tests.fx('job1'), 'vaso'), 'skipped:archived', 'el que la dueña archivó no se publica a sus espaldas');
select is(pg_temp.status(tests.fx('store_a'), 'vaso'), 'archived', 'y sigue archivado');
select is((select totals -> 'groups' ->> 'price' from public.publish_runs where import_job_id = tests.fx('job1')), '1',
          'el resumen agrupa los motivos (1 con precio inválido)');
select is((select totals ->> 'published' from public.publish_runs where import_job_id = tests.fx('job1')), '1',
          'y cuenta los publicados');

-- ------------------------------------------------ 3. Idempotente
select is(pg_temp.step(tests.fx('job1')) ->> 'replayed', 'true', 'repetir una corrida terminada no hace nada');
select ok(exists (select 1 from audit.audit_logs where action = 'catalog.publish_run'
                    and entity_id = pg_temp.run_of(tests.fx('job1'))), 'la corrida terminada queda en la auditoría');

-- ------------------------------------------------ 4. Cumplimiento: nunca se publica lo que no cumple
insert into public.store_regulated_categories (store_id, category_key) values (tests.fx('store_a'), 'dietary_supplement');
select tests.login('owner');
select tests.set_fx('job2', public.imports_create(tests.fx('store_a'), 'create_only', 'proteinas.csv', pg_temp.cols(), '{}',
  jsonb_build_array(pg_temp.prow(2, 'proteina', 89900))));
select public.imports_commit(tests.fx('store_a'), tests.fx('job2'));
select tests.logout();
select pg_temp.work(tests.fx('job2'));
select pg_temp.step(tests.fx('job2'));
select is(pg_temp.status(tests.fx('store_a'), 'proteina'), 'draft',
          'con suplementos declarados, un producto sin ficha no se publica');
select matches(pg_temp.item(tests.fx('job2'), 'proteina'), '^blocked:compliance', 'el motivo es de Cumplimiento');
select is((select totals -> 'groups' ->> 'compliance' from public.publish_runs where import_job_id = tests.fx('job2')), '1',
          'y el resumen lo cuenta como «sin ficha de cumplimiento»');
delete from public.store_regulated_categories where store_id = tests.fx('store_a');

-- ------------------------------------------------ 5. Quien importó perdió el permiso de publicar
select tests.login('catalog');
select tests.set_fx('job3', public.imports_create(tests.fx('store_a'), 'create_only', 'catalogo.csv', pg_temp.cols(), '{}',
  jsonb_build_array(pg_temp.prow(2, 'mantel', 25000))));
select public.imports_commit(tests.fx('store_a'), tests.fx('job3'));
select tests.logout();
select pg_temp.work(tests.fx('job3'));
delete from public.store_members where store_id = tests.fx('store_a') and user_id = tests.fx('catalog');
select is(pg_temp.step(tests.fx('job3')) ->> 'status', 'failed', 'sin permiso de publicar, la corrida se detiene');
select is(pg_temp.status(tests.fx('store_a'), 'mantel'), 'draft', 'y no publica nada');
select is(pg_temp.item(tests.fx('job3'), 'mantel'), 'blocked:permission', 'el motivo queda registrado');

-- ------------------------------------------------ 6. Aislamiento y privilegios
select tests.login('owner_b');
select is((select count(*)::int from public.publish_runs where store_id = tests.fx('store_a')), 0,
          'RLS: otra tienda no ve las corridas');
select is((select count(*)::int from public.publish_run_items where store_id = tests.fx('store_a')), 0,
          'ni sus candidatos');
select is(pg_temp.err(format('select system.publish_run_step(%L)', pg_temp.run_of(tests.fx('job1')))),
          'permission denied for schema system', 'una tienda no puede correr la publicación');
select tests.logout();
select ok(not has_table_privilege('authenticated', 'public.publish_run_items', 'update')
          and not has_table_privilege('authenticated', 'public.publish_runs', 'insert'),
          'nadie escribe las corridas directamente');

select * from finish();
rollback;
