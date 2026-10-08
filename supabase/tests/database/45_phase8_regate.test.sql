-- =============================================================================
-- Gate F8 · Regresiones de la segunda revisión adversarial (PHASE-08-REPORT §5):
-- sesión con contraseña en la cuenta del comprador (G-H1), datos anteriores a una
-- regla nueva (G-H2, G-L1), vista previa contra el conjunto final de variantes
-- (G-M1), límite del plan en la importación (G-M2, G-M3), columnas ajenas (G-L2)
-- y turno de un job devuelto a la cola (G-L3).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_c', 'owner@c.io');
select tests.create_user('ana', 'ana@compra.io');
select tests.create_user('leo', 'leo@compra.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('c', 'owner_c', 'plan_c');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');
update auth.users set email_confirmed_at = now() where id in (tests.fx('ana'), tests.fx('leo'));
insert into public.customers (store_id, email, first_name) values
  (tests.fx('store_a'), 'ana@compra.io', 'Ana'), (tests.fx('store_a'), 'leo@compra.io', 'Leo');
select tests.set_fx('cust_ana', (select id from public.customers where email = 'ana@compra.io'));
select tests.set_fx('cust_leo', (select id from public.customers where email = 'leo@compra.io'));

-- Sesión del mismo usuario abierta con contraseña (GoTrue la une al usuario del código).
create function pg_temp.login_password(p_key text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', tests.fx(p_key), 'role', 'authenticated', 'aal', 'aal1',
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)),
    'email', (select u.email from auth.users u where u.id = tests.fx(p_key)))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.n(p_row integer, p_handle text, p_normalized jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_number', p_row, 'raw', jsonb_build_object('handle', p_handle), 'errors', '[]'::jsonb,
                            'normalized', jsonb_build_object('handle', p_handle, 'product', '{}'::jsonb, 'option_names', null)
                                          || p_normalized)
$$;
-- El worker no ve las funciones de pgTAP: se ejecuta aparte y se compara después.
create function pg_temp.work(p_job uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_role('system_worker');
  v := system.import_commit(p_job);
  perform tests.logout();
  return v;
end $$;
create function pg_temp.errors(p_job uuid) returns text[] language sql as $$
  select coalesce(array_agg(e order by r.row_number, e), '{}') from public.import_job_rows r,
         jsonb_array_elements_text(r.errors) e where r.import_job_id = p_job
$$;

-- ============================================================================ G-H1
select tests.login_otp('ana');
select isnt(public.storefront_link_customer(tests.fx('store_a')), null, 'Ana vincula su cuenta con un código');
select tests.logout();
select pg_temp.login_password('ana');
select is(public.account_overview(tests.fx('store_a')), null,
  'una sesión con contraseña del mismo usuario no ve la cuenta vinculada');
select throws_ok(format($$ select public.account_update_profile(%L, 'Atacante', null, null) $$, tests.fx('store_a')),
  '42501', 'forbidden', 'ni la modifica');
select is((select count(*)::int from public.customers), 0, 'ni lee su fila de cliente directamente');
select is(tests.row_count($$ update public.customers set first_name = 'Atacante' $$), 0::bigint, 'ni la edita');
select tests.logout();
select tests.login_otp('ana', 30 * 24 * 3600);
select isnt(public.account_overview(tests.fx('store_a')), null,
  'la sesión que entró con un código (renovada durante días) sigue viendo su cuenta');
select tests.logout();

-- ============================================================================ G-H2
-- Un teléfono guardado antes de la regla (se simula sin el trigger).
alter table public.customers disable trigger customers_phone_guard;
update public.customers set phone = '555' where id = tests.fx('cust_leo');
alter table public.customers enable trigger customers_phone_guard;
select lives_ok(format($$ update public.customers set updated_at = now() where id = %L $$, tests.fx('cust_leo')),
  'una fila con un teléfono anterior a la regla se sigue escribiendo (upsert del checkout)');
select lives_ok(format($$ update public.customers set orders_count = orders_count + 1 where id = %L $$, tests.fx('cust_leo')),
  'y su contador de pedidos (confirmación del pago por webhook)');
select tests.login_otp('leo');
select isnt(public.storefront_link_customer(tests.fx('store_a')), null, 'y se vincula su cuenta');
select tests.logout();
select throws_ok(format($$ update public.customers set phone = '12' where id = %L $$, tests.fx('cust_leo')),
  '23514', null, 'un teléfono nuevo sin formato: rechazado');
select lives_ok(format($$ update public.customers set phone = '+52 55 1234 5678' where id = %L $$, tests.fx('cust_leo')),
  'con formato: aceptado');

-- ============================================================================ G-L1
select tests.login('owner');
select tests.set_fx('cat', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Ninos"}'));
select tests.logout();
alter table public.categories disable trigger categories_name_guard;
update public.categories set name = 'Niños > 5 años' where id = tests.fx('cat');
alter table public.categories enable trigger categories_name_guard;
select tests.login('owner');
select lives_ok(format($$ select public.catalog_delete_category(%L, %L) $$, tests.fx('store_a'), tests.fx('cat')),
  'una categoría anterior con separador en el nombre se puede borrar');
select throws_ok(format($$ select public.catalog_upsert_category(%L, '{"name":"A | B"}') $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'y no se crean nuevas con separadores');

-- ============================================================================ G-M1
select tests.set_fx('camisa', (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object(
  'title', 'Camisa', 'slug', 'camisa', 'options', '[{"name":"Talla","values":["S","M"]}]'::jsonb,
  'variants', '[{"sku":"CAM-S","price":10000,"options":{"Talla":"S"}},
                {"sku":"CAM-M","price":10000,"compare_at_price":15000,"barcode":"BC-M","options":{"Talla":"M"}}]'::jsonb))
  ->> 'id')::uuid);
select tests.set_fx('g1', public.imports_create(tests.fx('store_a'), 'update_existing', 'final.csv',
  array['handle', 'sku', 'price', 'compare_at_price', 'barcode', 'option1_name', 'option1_value'], '{}', jsonb_build_array(
    pg_temp.n(2, 'camisa', '{"variants":[{"row_number":2,"sku":"CAM-S","compare_at_price":5000}]}'))));
select is(pg_temp.errors(tests.fx('g1')),
  array['compare_at_price: debe ser mayor que price (con el precio que conserva la variante)'],
  'precio de comparación contra el precio que se conserva');
select tests.set_fx('g2', public.imports_create(tests.fx('store_a'), 'update_existing', 'final.csv',
  array['handle', 'sku', 'price'], '{}', jsonb_build_array(
    pg_temp.n(2, 'camisa', '{"variants":[{"row_number":2,"sku":"CAM-M","price":20000}]}'))));
select is(pg_temp.errors(tests.fx('g2')),
  array['compare_at_price: debe ser mayor que price (con el precio que conserva la variante)'],
  'precio nuevo contra el precio de comparación que se conserva');
select tests.set_fx('g3', public.imports_create(tests.fx('store_a'), 'update_existing', 'final.csv',
  array['handle', 'sku', 'option1_name', 'option1_value'], '{}', jsonb_build_array(
    pg_temp.n(2, 'camisa', '{"option_names":["Talla"],"variants":[{"row_number":2,"sku":"CAM-S","options":{"Talla":"M"}}]}'))));
select is(pg_temp.errors(tests.fx('g3')), array['opciones: esa combinación ya la tiene otra variante del producto'],
  'una combinación que ya tiene otra variante');
select tests.set_fx('g4', public.imports_create(tests.fx('store_a'), 'update_existing', 'final.csv',
  array['handle', 'sku', 'barcode'], '{}', jsonb_build_array(
    pg_temp.n(2, 'camisa', '{"variants":[{"row_number":2,"sku":"CAM-S","barcode":"BC-M"}]}'))));
select is(pg_temp.errors(tests.fx('g4')),
  array['barcode: ya lo tiene otra variante del producto (para intercambiarlos, usa dos importaciones)'],
  'un código de barras que se mueve entre variantes del producto');
select tests.set_fx('g5', public.imports_create(tests.fx('store_a'), 'update_existing', 'final.csv',
  array['handle', 'sku', 'price', 'barcode'], '{}', jsonb_build_array(
    pg_temp.n(2, 'camisa', '{"variants":[{"row_number":2,"sku":"CAM-M","price":12000,"barcode":"BC-M"},
                                         {"row_number":3,"sku":"CAM-S","price":12000}]}'))));
select is(pg_temp.errors(tests.fx('g5')), '{}'::text[], 'sin falsos positivos: los valores propios de cada variante');
select tests.logout();

-- ============================================================================ G-M2 / G-M3
select tests.login('owner_c');
select public.catalog_upsert_product(tests.fx('store_c'), '{"title":"Uno","slug":"uno","variants":[{"sku":"C-1","price":100}]}');
select public.catalog_upsert_product(tests.fx('store_c'), '{"title":"Dos","slug":"dos","variants":[{"sku":"C-2","price":100}]}');
select tests.logout();
update public.plan_entitlements set value_int = 1
 where key = 'max_products' and plan_id = (select id from public.plans where key = 'plan_c');
select tests.login('owner_c');
select tests.set_fx('jc', public.imports_create(tests.fx('store_c'), 'update_existing', 'existencias.csv',
  array['handle', 'sku', 'inventory_quantity'], '{}', jsonb_build_array(
    pg_temp.n(2, 'uno', '{"variants":[{"row_number":2,"sku":"C-1","quantity":7}]}'))));
select public.imports_commit(tests.fx('store_c'), tests.fx('jc'));
select tests.logout();
select is(pg_temp.work(tests.fx('jc')) ->> 'status', 'completed',
  'por encima del límite del plan, una importación que no crea productos se aplica');
select is((select l.on_hand from public.inventory_levels l join public.product_variants v on v.id = l.variant_id
            where v.sku = 'C-1'), 7, 'con sus existencias');
select tests.login('owner_c');
select set_config('app.bulk_product_limit_store', tests.fx('store_c')::text, true);
select throws_ok(format($$ select public.catalog_upsert_product(%L, '{"title":"Tres","slug":"tres","variants":[{"price":100}]}') $$,
                        tests.fx('store_c')), 'P0001', 'limit_reached', 'fijar el antiguo GUC ya no salta el límite');
select throws_ok(format($$ insert into system.product_limit_bulk (txid, store_id) values (txid_current(), %L) $$,
                        tests.fx('store_c')), '42501', null, 'y la marca de lote no se puede falsificar');
select tests.logout();

-- ============================================================================ G-L2
select tests.login('owner');
select lives_ok(format($$ select public.imports_create(%L, 'upsert', 'ajenas.csv', array['handle', 'price'],
                          (select array_agg(repeat('x', 97) || lpad(g::text, 3, '0')) from generate_series(1, 30) g),
                          jsonb_build_array(jsonb_build_object('row_number', 2, 'raw', '{}'::jsonb, 'errors', '[]'::jsonb,
                            'normalized', '{"handle":"x","product":{"title":"X"},"option_names":null,
                                            "variants":[{"row_number":2,"price":100}]}'::jsonb))) $$, tests.fx('store_a')),
  '30 columnas ajenas de 100 caracteres: se aceptan (antes, error de permisos)');
select tests.logout();

-- ============================================================================ G-L3
insert into system.jobs (type, status, attempts, locked_at, locked_by, run_after)
values ('test.release', 'running', 1, now(), 'w1', now() - interval '10 minutes');
select system.release_job((select id from system.jobs where type = 'test.release'), 'w1');
select ok((select run_after < now() - interval '9 minutes' and status = 'queued' and attempts = 0
             from system.jobs where type = 'test.release'), 'un job devuelto a la cola conserva su turno');

select * from finish();
rollback;
