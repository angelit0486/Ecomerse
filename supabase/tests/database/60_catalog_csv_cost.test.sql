-- =============================================================================
-- Fase B · Costo unitario en el CSV de productos (variant_costs, sensible:
-- products.cost.read): importar, borrar con celda vacía, validar, permisos y
-- exportar solo con el permiso.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('sincosto', 'sincosto@a.io');
select tests.create_tenant('a', 'owner');

-- Rol propio de la organización: catálogo e importación, sin ver costos.
insert into public.roles (key, organization_id, name, rank)
values ('catalogo_sin_costos', tests.fx('org_a'), 'Catálogo sin costos', 30);
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r,
       unnest(array['store.read', 'products.read', 'products.create', 'products.update', 'imports.run',
                    'exports.run']) k
 where r.key = 'catalogo_sin_costos';
insert into public.organization_members (organization_id, user_id, role)
values (tests.fx('org_a'), tests.fx('sincosto'), 'org_member');
insert into public.store_members (store_id, user_id, role_id)
values (tests.fx('store_a'), tests.fx('sincosto'), (select id from public.roles where key = 'catalogo_sin_costos'));

create function pg_temp.n(p_row integer, p_handle text, p_normalized jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle), 'errors', '[]'::jsonb,
                            'normalized', jsonb_build_object('handle', p_handle, 'product', '{}'::jsonb, 'option_names', null)
                                          || p_normalized)
$$;
create function pg_temp.job(p_columns text[], p_rows jsonb) returns uuid language sql as $$
  select public.imports_create(tests.fx('store_a'), 'upsert', 'c.csv', p_columns, '{}', p_rows)
$$;
create function pg_temp.errors(p_job uuid) returns text[] language sql as $$
  select coalesce(array_agg(e order by r.row_number), '{}') from public.import_job_rows r,
         jsonb_array_elements_text(r.errors) e where r.import_job_id = p_job
$$;
create function pg_temp.run(p_job uuid, p_user text) returns text language plpgsql as $$
declare v jsonb;
begin
  perform public.imports_commit(tests.fx('store_a'), p_job);
  perform tests.as_role('system_worker');
  v := system.import_commit(p_job);
  perform tests.logout();
  perform tests.login(p_user);
  return coalesce(v ->> 'status', '') || coalesce(':' || (select error from public.import_jobs where id = p_job), '');
end $$;
create function pg_temp.costs() returns text language sql security definer as $$
  select coalesce(string_agg(v.sku || '=' || coalesce(c.cost::text, '-'), ',' order by v.sku), '')
    from public.product_variants v left join public.variant_costs c on c.variant_id = v.id
   where v.store_id = tests.fx('store_a') and v.deleted_at is null
$$;

select tests.login('owner');
select tests.set_fx('j1', pg_temp.job(array['handle', 'title', 'option1_name', 'option1_value', 'sku', 'price', 'cost'],
  jsonb_build_array(
    pg_temp.n(2, 'proteina', '{"product":{"title":"Proteína"},"option_names":["Sabor"],
       "variants":[{"row_number":2,"options":{"Sabor":"Vainilla"},"sku":"PRO-VAI","price":89900,"cost":45000},
                   {"row_number":3,"options":{"Sabor":"Chocolate"},"sku":"PRO-CHO","price":89900,"cost":46050}]}'))));
select is(pg_temp.errors(tests.fx('j1')), '{}'::text[], 'el costo se valida sin errores');
select ok((select 'products.cost.read' = any (needs) from public.import_jobs where id = tests.fx('j1')),
          'y la confirmación exige products.cost.read');
select is(pg_temp.run(tests.fx('j1'), 'owner'), 'completed', 'se confirma');
select is(pg_temp.costs(), 'PRO-CHO=46050,PRO-VAI=45000', 'cada variante queda con su costo');

-- Celda vacía = se borra; columna ausente = sin cambios.
select tests.set_fx('j2', pg_temp.job(array['handle', 'sku', 'cost'],
  jsonb_build_array(pg_temp.n(2, 'proteina', '{"variants":[{"row_number":2,"sku":"PRO-VAI","cost":null}]}'))));
select is(pg_temp.run(tests.fx('j2'), 'owner'), 'completed', 'borrar el costo de una variante');
select is(pg_temp.costs(), 'PRO-CHO=46050,PRO-VAI=-', 'la otra conserva el suyo');
select tests.set_fx('j3', pg_temp.job(array['handle', 'sku', 'price'],
  jsonb_build_array(pg_temp.n(2, 'proteina', '{"variants":[{"row_number":2,"sku":"PRO-CHO","price":92900}]}'))));
select is(pg_temp.run(tests.fx('j3'), 'owner'), 'completed', 'cambiar el precio sin la columna de costo');
select is(pg_temp.costs(), 'PRO-CHO=46050,PRO-VAI=-', 'no toca los costos');

select is(pg_temp.errors(pg_temp.job(array['handle', 'sku', 'cost'],
  jsonb_build_array(pg_temp.n(2, 'proteina', '{"variants":[{"row_number":2,"sku":"PRO-CHO","cost":-5}]}')))),
  array['cost: escribe un importe como 199.50'], 'un costo negativo es un error de la fila');

select ok((public.exports_rows(tests.fx('store_a'), 'products') -> 'rows' -> 0) ? 'cost'
          and (public.exports_rows(tests.fx('store_a'), 'products') ->> 'costs')::boolean,
          'la exportación de la dueña trae el costo');
select tests.logout();

-- Sin products.cost.read: ni importa costos ni los exporta.
select tests.login('sincosto');
select is(pg_temp.errors(pg_temp.job(array['handle', 'sku', 'cost'],
  jsonb_build_array(pg_temp.n(2, 'proteina', '{"variants":[{"row_number":2,"sku":"PRO-CHO","cost":100}]}')))),
  array['cost: tu rol no puede ver ni cambiar costos'], 'un rol sin products.cost.read no importa costos');
select is((select count(*)::integer from jsonb_array_elements(public.exports_rows(tests.fx('store_a'), 'products') -> 'rows') r
            where r ->> 'cost' is not null), 0, 'ni los ve en la exportación');
select is(public.exports_rows(tests.fx('store_a'), 'products') ->> 'costs', 'false', 'y el CSV no lleva la columna');
select tests.logout();

select * from finish();
rollback;
