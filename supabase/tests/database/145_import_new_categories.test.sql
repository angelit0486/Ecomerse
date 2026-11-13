-- =============================================================================
-- ADR-065 opción A (Orden 10, mensaje 4): crear las categorías que falten al
-- importar. Apagado por defecto; vista previa con conteos; confirmación
-- explícita; permisos; nombres que no se pueden crear; avisos de parecidos sin
-- fusionar; creación dentro de la transacción de la importación; si la
-- importación falla, no queda ninguna; aislamiento entre tiendas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
select tests.create_user('bodega', 'bodega@a.io');
select tests.add_store_member('a', 'bodega', 'inventory_manager');

create function pg_temp.cols() returns text[] language sql as $$
  select array['handle', 'title', 'sku', 'price', 'categories']
$$;
create function pg_temp.prow(p_row integer, p_handle text, p_categories jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle),
    'errors', '[]'::jsonb,
    'normalized', jsonb_build_object('handle', p_handle, 'product', jsonb_build_object('title', initcap(p_handle)),
      'option_names', null, 'categories', p_categories,
      'variants', jsonb_build_array(jsonb_build_object('row_number', p_row, 'sku', upper(p_handle), 'price', 1000))))
$$;
create function pg_temp.work(p_job uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_role('system_worker');
  v := system.import_commit(p_job);
  perform tests.logout();
  return v;
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
create function pg_temp.missing(p_job uuid) returns jsonb language sql as $$
  select public.imports_new_categories(tests.fx('store_a'), p_job) -> 'missing'
$$;
create function pg_temp.item(p_job uuid, p_key text) returns jsonb language sql as $$
  select m from jsonb_array_elements(pg_temp.missing(p_job)) m where m ->> 'key' = p_key
$$;
create function pg_temp.cat_count(p_store uuid, p_name text) returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer from public.categories c where c.store_id = p_store and lower(c.name) = lower(p_name) and c.deleted_at is null
$$;
grant execute on function pg_temp.cat_count(uuid, text) to authenticated;

select tests.login('owner');
select tests.set_fx('ropa', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Ropa"}'));
select public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Lácteos"}');
select public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Bebidas"}');
select tests.set_fx('job1', public.imports_create(tests.fx('store_a'), 'create_only', 'tienda.csv', pg_temp.cols(), '{}',
  jsonb_build_array(
    pg_temp.prow(2, 'taza', '["Calzado"]'),
    pg_temp.prow(3, 'plato', '["calzado"]'),
    pg_temp.prow(4, 'vaso', '["Ropa > Niños"]'),
    pg_temp.prow(5, 'jarra', '["Lacteos"]'),
    pg_temp.prow(6, 'cuchara', '["A > B > C > D"]'),
    pg_temp.prow(7, 'mantel', '["Bebida"]'))));

-- ------------------------------------------------ 1. Apagado por defecto
select is((select (totals ->> 'errors')::int from public.import_jobs where id = tests.fx('job1')), 6,
          'sin aceptar nada, cada categoría que no existe sigue siendo un error de su fila');
select is((select new_categories from public.import_jobs where id = tests.fx('job1')), '{}'::text[],
          'la lista de categorías nuevas nace vacía');

-- ------------------------------------------------ 2. Vista previa
select is(jsonb_array_length(pg_temp.missing(tests.fx('job1'))), 5,
          'lista 5 categorías que faltan («Calzado» y «calzado» son la misma)');
select is((pg_temp.item(tests.fx('job1'), 'calzado') ->> 'products')::int, 2, 'con el número de productos que la usan');
select is(pg_temp.item(tests.fx('job1'), 'ropa > niños') ->> 'creatable', 'true',
          'una subcategoría nueva de una categoría que existe se puede crear');
select is(pg_temp.item(tests.fx('job1'), 'lacteos') ->> 'reason', 'slug_taken',
          '«Lacteos» no se crea: su dirección ya es la de «Lácteos»');
select is(pg_temp.item(tests.fx('job1'), 'lacteos') ->> 'hint', 'Lácteos', 'y dice cuál existe');
select is(pg_temp.item(tests.fx('job1'), 'a > b > c > d') ->> 'reason', 'too_deep', 'más de 3 niveles no se crea');
select ok(pg_temp.item(tests.fx('job1'), 'bebida') -> 'similar' ? 'Bebidas',
          '«Bebida» avisa que se parece a «Bebidas»…');
select is(pg_temp.item(tests.fx('job1'), 'bebida') ->> 'creatable', 'true', '…pero no se fusiona: se puede crear aparte');
select is((public.imports_new_categories(tests.fx('store_a'), tests.fx('job1')) ->> 'can_create')::boolean, true,
          'la dueña puede crear categorías');

-- ------------------------------------------------ 3. Permisos
select tests.logout();
select tests.login('bodega');
select is((public.imports_new_categories(tests.fx('store_a'), tests.fx('job1')) ->> 'can_create')::boolean, false,
          'un rol sin categories.manage ve la lista pero no puede crear');
select is(pg_temp.err(format('select public.imports_accept_categories(%L, %L, %L)', tests.fx('store_a'), tests.fx('job1'),
            '{Calzado}')), 'forbidden', 'ni aceptarla');
select tests.logout();

-- ------------------------------------------------ 4. Confirmación explícita
select tests.login('owner');
select is(pg_temp.err(format('select public.imports_accept_categories(%L, %L, %L)', tests.fx('store_a'), tests.fx('job1'),
            '{Lacteos}')), 'validation_failed/categories', 'no se acepta una categoría que no se puede crear');
select is(public.imports_accept_categories(tests.fx('store_a'), tests.fx('job1'),
            array['CALZADO', 'Ropa > Niños', 'Bebida']) -> 'accepted',
          '["Calzado", "Ropa > Niños", "Bebida"]'::jsonb,
          'acepta la lista con la forma en que la escribió el archivo');
select is((select (totals ->> 'errors')::int from public.import_jobs where id = tests.fx('job1')), 2,
          'quedan con error solo las filas de categorías no aceptadas');
select is((select action from public.import_job_rows where import_job_id = tests.fx('job1') and row_number = 3), 'create',
          '«calzado» en minúsculas queda resuelta con «Calzado»');
select ok((select 'categories.manage' = any (needs) from public.import_jobs where id = tests.fx('job1')),
          'confirmar exige ahora poder crear categorías (se revalida al aplicar)');
select is(pg_temp.cat_count(tests.fx('store_a'), 'Calzado'), 0, 'aceptar no crea nada todavía');

-- ------------------------------------------------ 5. Al confirmar se crean, una vez
select is(public.imports_commit(tests.fx('store_a'), tests.fx('job1'), true) ->> 'status', 'committing',
          'se confirma (las 2 filas con error se saltan)');
select tests.logout();
select is(pg_temp.work(tests.fx('job1')) ->> 'categories_created', '3', 'el worker crea las 3 categorías aceptadas');
select is(pg_temp.cat_count(tests.fx('store_a'), 'Calzado'), 1, '«Calzado» existe una sola vez');
select is((select count(distinct pc.category_id)::int from public.product_categories pc
             join public.products p on p.store_id = pc.store_id and p.id = pc.product_id
            where p.store_id = tests.fx('store_a') and p.slug in ('taza', 'plato')), 1,
          'los dos productos quedan en la misma categoría');
select is((select c.parent_id from public.categories c where c.store_id = tests.fx('store_a') and c.name = 'Niños'),
          tests.fx('ropa'), '«Niños» cuelga de «Ropa»');

-- ------------------------------------------------ 6. Ya existe al confirmar: no se duplica
select tests.login('owner');
select tests.set_fx('job2', public.imports_create(tests.fx('store_a'), 'create_only', 'zapatos.csv', pg_temp.cols(), '{}',
  jsonb_build_array(pg_temp.prow(2, 'bota', '["Zapatos"]'))));
select public.imports_accept_categories(tests.fx('store_a'), tests.fx('job2'), array['Zapatos']);
-- Otra persona (u otra importación) la crea antes de que esta se aplique.
select public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Zapatos"}');
select public.imports_commit(tests.fx('store_a'), tests.fx('job2'));
select tests.logout();
select is(pg_temp.work(tests.fx('job2')) ->> 'categories_created', '0', 'si ya existe al confirmar, se usa esa');
select is(pg_temp.cat_count(tests.fx('store_a'), 'Zapatos'), 1, 'y no queda duplicada');

-- ------------------------------------------------ 7. Si la importación falla, no queda ninguna
select tests.login('owner');
select tests.set_fx('job3', public.imports_create(tests.fx('store_a'), 'create_only', 'temporada.csv', pg_temp.cols(), '{}',
  jsonb_build_array(pg_temp.prow(2, 'mesa', '["Temporada"]'))));
select public.imports_accept_categories(tests.fx('store_a'), tests.fx('job3'), array['Temporada']);
-- El producto aparece después de la vista previa: en «solo crear», la fila falla al aplicar.
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Mesa","slug":"mesa","variants":[{"price":100,"sku":"MESA-0"}]}');
select public.imports_commit(tests.fx('store_a'), tests.fx('job3'));
select tests.logout();
select is(pg_temp.work(tests.fx('job3')) ->> 'status', 'failed', 'la importación falla al aplicar');
select is(pg_temp.cat_count(tests.fx('store_a'), 'Temporada'), 0, 'y la categoría aceptada no se creó');

-- ------------------------------------------------ 8. Aislamiento entre tiendas
select tests.login('owner_b');
select is(pg_temp.err(format('select public.imports_new_categories(%L, %L)', tests.fx('store_a'), tests.fx('job1'))),
          'forbidden', 'otra tienda no ve la vista previa de categorías');
select is(pg_temp.err(format('select public.imports_accept_categories(%L, %L, %L)', tests.fx('store_b'), tests.fx('job1'),
            '{Calzado}')), 'not_found/import_job', 'ni puede aceptar en una importación ajena');
select is(pg_temp.cat_count(tests.fx('store_b'), 'Calzado'), 0, 'las categorías creadas son solo de su tienda');
select tests.logout();

select * from finish();
rollback;
