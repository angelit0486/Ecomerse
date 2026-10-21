-- =============================================================================
-- Misión Portada/Marcas · CSV con logo y descripción de la marca: se valida
-- (https, ≤ 1000, solo con marca), exige el permiso de marcas y, al terminar la
-- importación, guarda la descripción y reserva el logo como medio de marca
-- pendiente (con su job de descarga); reimportar el mismo enlace no duplica.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('cat', 'cat@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'cat', 'inventory_manager');

create function pg_temp.rows(p_profile jsonb, p_brand text default 'Muha Meds') returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('row_number', 2, 'raw', jsonb_build_object('handle', 'creatina'),
    'errors', '[]'::jsonb,
    'normalized', jsonb_build_object('handle', 'creatina', 'option_names', null,
      'product', jsonb_build_object('title', 'Creatina'), 'brand', p_brand,
      'variants', jsonb_build_array(jsonb_build_object('row_number', 2, 'sku', 'CRE-1', 'price', 29900)))
      || case when p_profile is null then '{}'::jsonb else jsonb_build_object('brand_profile', p_profile) end))
$$;
create function pg_temp.job(p_rows jsonb) returns uuid language sql as $$
  select public.imports_create(tests.fx('store_a'), 'upsert', 'marcas.csv',
                               array['handle', 'title', 'sku', 'price', 'brand', 'brand_logo_url', 'brand_description'],
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
create function pg_temp.run(p_job uuid) returns integer language plpgsql as $$
declare v integer;
begin
  perform public.imports_commit(tests.fx('store_a'), p_job);
  perform tests.as_role('system_worker');
  perform system.import_commit(p_job);
  v := system.import_apply_brand_profiles(p_job);
  perform tests.logout();
  perform tests.login('owner');
  return v;
end $$;
create function pg_temp.brand() returns jsonb language sql security definer as $$
  select jsonb_build_object('description', b.description,
           'logo', (select jsonb_build_object('owner', m.owner_type, 'status', m.status, 'url', m.source_url,
                                              'alt', m.alt_text, 'path_ok', split_part(m.storage_path, '/', 1) = b.store_id::text)
                      from public.media m where m.store_id = b.store_id and m.id = b.logo_media_id))
    from public.brands b where b.store_id = tests.fx('store_a') and b.slug = 'muha-meds' $$;
create function pg_temp.jobs() returns integer language sql security definer as $$
  select count(*)::int from system.jobs j where j.type = 'media.fetch_remote' and j.store_id = tests.fx('store_a') $$;
-- Las filas de la importación se leen como dueña de la base (RLS aparte).
create function pg_temp.row_errors(p_job uuid) returns text language sql security definer as $$
  select coalesce(string_agg(r.errors::text, ' '), '') || coalesce((select j.error from public.import_jobs j where j.id = p_job), '')
    from public.import_job_rows r where r.import_job_id = p_job $$;
grant execute on all functions in schema pg_temp to authenticated;

select tests.login('owner');

-- 1. Validación (la base no confía en el plan).
select is(pg_temp.err(format('select pg_temp.job(%L)', pg_temp.rows('{"logo_url": "http://x.com/l.png"}'))),
          'validation_failed/rows', 'el logo debe ser https');
select is(pg_temp.err(format('select pg_temp.job(%L)', pg_temp.rows('{"description": "x"}', ''))),
          'validation_failed/rows', 'sin marca no hay perfil de marca');
select is(pg_temp.err(format('select pg_temp.job(%L)', pg_temp.rows('{"color": "#fff"}'))),
          'validation_failed/rows', 'solo logo y descripción');
select is(pg_temp.err(format('select pg_temp.job(%L)',
            pg_temp.rows(jsonb_build_object('description', repeat('a', 1001))))),
          'validation_failed/rows', 'descripción de hasta 1000 caracteres');

-- 2. Inventario importa pero no cambia marcas: error en la fila.
select tests.logout();
select tests.login('cat');
select tests.set_fx('cat_job', pg_temp.job(pg_temp.rows('{"description": "Hola"}')));
select tests.logout();
select ok(pg_temp.row_errors(tests.fx('cat_job')) like '%brand_logo_url: tu rol no puede%',
          'Inventario: la fila dice que su rol no puede cambiar marcas');
select tests.login('owner');

-- 3. La dueña importa: descripción guardada y logo reservado con su descarga.
select is(pg_temp.run(pg_temp.job(pg_temp.rows(
            '{"logo_url": "https://cdn.example.com/muha.png", "description": "Creatinas hechas en México."}'))),
          1, 'un logo encolado');
select is(pg_temp.brand() ->> 'description', 'Creatinas hechas en México.', 'descripción de la marca');
select is((pg_temp.brand() -> 'logo') - 'path_ok'::text,
          '{"owner": "brand", "status": "pending", "url": "https://cdn.example.com/muha.png", "alt": "Logo de Muha Meds"}'::jsonb,
          'logo de marca pendiente con su enlace y texto alternativo');
select ok((pg_temp.brand() -> 'logo' ->> 'path_ok')::boolean, 'la ruta del logo es de la misma tienda');
select is(pg_temp.jobs(), 1, 'job de descarga encolado');

-- 4. Reimportar el mismo enlace no duplica.
select is(pg_temp.run(pg_temp.job(pg_temp.rows('{"logo_url": "https://cdn.example.com/muha.png"}'))), 0,
          'reimportar el mismo logo no lo vuelve a encolar');
select is(pg_temp.jobs(), 1, 'sigue un solo job');

select * from finish();
rollback;
