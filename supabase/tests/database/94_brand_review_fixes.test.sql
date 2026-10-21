-- Revisión adversarial del Paso 2 (marcas): la importación no se cae por una
-- descripción con caracteres de control, no reemplaza un logo listo, reintenta
-- un logo rechazado, y cambiar la imagen de una marca borra la anterior.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');

create function pg_temp.rows(p_profile jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('row_number', 2, 'raw', jsonb_build_object('handle', 'creatina'),
    'errors', '[]'::jsonb,
    'normalized', jsonb_build_object('handle', 'creatina', 'option_names', null,
      'product', jsonb_build_object('title', 'Creatina'), 'brand', 'Muha Meds',
      'variants', jsonb_build_array(jsonb_build_object('row_number', 2, 'sku', 'CRE-1', 'price', 29900)),
      'brand_profile', p_profile)))
$$;
create function pg_temp.run(p_profile jsonb) returns text language plpgsql as $$
declare v_job uuid; v jsonb;
begin
  v_job := public.imports_create(tests.fx('store_a'), 'upsert', 'marcas.csv',
             array['handle', 'title', 'sku', 'price', 'brand', 'brand_logo_url', 'brand_description'], '{}',
             pg_temp.rows(p_profile));
  perform public.imports_commit(tests.fx('store_a'), v_job);
  perform tests.as_role('system_worker');
  v := system.import_commit(v_job);
  perform system.import_apply_brand_profiles(v_job);
  perform tests.logout();
  perform tests.login('owner');
  return v ->> 'status';
end $$;
create function pg_temp.brand() returns public.brands language sql security definer as $$
  select * from public.brands where store_id = tests.fx('store_a') and slug = 'muha-meds' $$;
create function pg_temp.media(p_id uuid) returns public.media language sql security definer as $$
  select * from public.media where id = p_id $$;
create function pg_temp.set_status(p_id uuid, p_status text) returns void language sql security definer as $$
  update public.media set status = p_status where id = p_id $$;
create function pg_temp.new_media() returns uuid language sql security definer as $$
  insert into public.media (store_id, owner_type, status, storage_path, mime_type, bytes)
  values (tests.fx('store_a'), 'brand', 'ready',
          tests.fx('store_a') || '/brand/x/' || gen_random_uuid() || '/original.png', 'image/png', 10)
  returning id $$;
grant execute on all functions in schema pg_temp to authenticated;

select tests.login('owner');

-- A1. Un \x0B en la descripción ya no tumba la importación: se omite.
select is(pg_temp.run(jsonb_build_object('description', E'Línea\x0Botra', 'logo_url', 'https://cdn.example.com/a.png')),
          'completed', 'la importación termina aunque la descripción traiga caracteres de control');
select is((pg_temp.brand()).description, null, 'esa descripción no se guarda');

-- M3. El logo del archivo se rechazó: el mismo CSV lo reintenta.
select pg_temp.set_status((pg_temp.brand()).logo_media_id, 'rejected');
select tests.set_fx('first_logo', (pg_temp.brand()).logo_media_id);
select pg_temp.run('{"logo_url": "https://cdn.example.com/a.png"}');
select isnt((pg_temp.brand()).logo_media_id, tests.fx('first_logo'), 'un logo rechazado se vuelve a pedir');
select ok((pg_temp.media(tests.fx('first_logo'))).deleted_at is not null, 'y el intento anterior se borra');

-- A2. Con un logo listo, el archivo no lo reemplaza.
select pg_temp.set_status((pg_temp.brand()).logo_media_id, 'ready');
select tests.set_fx('ready_logo', (pg_temp.brand()).logo_media_id);
select pg_temp.run('{"logo_url": "https://cdn.example.com/otro.png"}');
select is((pg_temp.brand()).logo_media_id, tests.fx('ready_logo'), 'el logo listo se conserva');

-- M4. Cambiar el logo desde el panel borra el anterior; quitarlo también.
select tests.set_fx('panel_logo', pg_temp.new_media());
select public.catalog_set_brand_media(tests.fx('store_a'), (pg_temp.brand()).id, 'logo', tests.fx('panel_logo'));
select ok((pg_temp.media(tests.fx('ready_logo'))).deleted_at is not null, 'el logo reemplazado queda borrado');
select public.catalog_set_brand_media(tests.fx('store_a'), (pg_temp.brand()).id, 'logo', null);
select ok((pg_temp.media(tests.fx('panel_logo'))).deleted_at is not null, 'el logo quitado queda borrado');

-- B8. Auditoría por marca desde la importación.
select tests.logout();
select ok((select count(*) from audit.audit_logs where store_id = tests.fx('store_a') and action = 'brand.media_set'
             and after ? 'import_job_id') >= 2, 'los logos del archivo quedan en la auditoría');

select * from finish();
rollback;
