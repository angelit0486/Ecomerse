-- =============================================================================
-- «Salud de tu tienda» (paso 19): cada revisión con su umbral, solo de la propia
-- tienda (aislamiento), solo para quien puede ver la tienda, y sin cambiar datos.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.plan_entitlements set value_int = 5
 where key = 'max_products' and plan_id = (select id from public.plans where key = 'test_plan');

create function pg_temp.check(p_store uuid, p_key text) returns jsonb language sql as $$
  select c from jsonb_array_elements(public.store_health(p_store) -> 'checks') c where c ->> 'key' = p_key
$$;

-- 1-2. Solo quien ve la tienda.
select is(tests.sqlstate_as('anon', format('select public.store_health(%L)', tests.fx('store_a'))), '42501',
  'anon no la consulta');
select tests.login('owner_b');
select throws_ok(format($$ select public.store_health(%L) $$, tests.fx('store_a')), '42501', 'forbidden',
  'la dueña de B no ve la salud de A');
select tests.logout();

-- Tienda A recién creada: sin avisos, pagos, envíos ni políticas.
select tests.login('owner_a');
select is(pg_temp.check(tests.fx('store_a'), 'notifications') ->> 'status', 'critical', 'nadie recibe avisos: urgente');
select is(pg_temp.check(tests.fx('store_a'), 'payments') ->> 'status', 'critical', 'sin pagos: urgente');
select is(pg_temp.check(tests.fx('store_a'), 'policies') ->> 'status', 'critical', 'sin aviso de privacidad: urgente');
select is((pg_temp.check(tests.fx('store_a'), 'policies') ->> 'value')::int, 4, 'faltan las 4 políticas');
select is(public.store_health(tests.fx('store_a')) ->> 'status', 'critical', 'la tienda queda en urgente');

-- 4 productos activos (80 % de 5), sin fotos; uno sin existencias.
select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
  jsonb_build_object('title', 'Producto ' || g,
                     'variants', jsonb_build_array(jsonb_build_object('price', 10000, 'sku', 'SKU-H' || g)))) ->> 'id')::uuid)
  from generate_series(1, 4) g;
select public.inventory_adjust(tests.fx('store_a'), v.id, 'adjustment', 5, 'Inicial')
  from public.product_variants v where v.store_id = tests.fx('store_a') and v.sku in ('SKU-H1', 'SKU-H2', 'SKU-H3');
select is((pg_temp.check(tests.fx('store_a'), 'plan_max_products') ->> 'status'), 'warning', '4 de 5 productos: aviso');
select is((pg_temp.check(tests.fx('store_a'), 'plan_max_products') ->> 'limit')::int, 5, 'con el límite del plan');
select is((pg_temp.check(tests.fx('store_a'), 'products_without_photo') ->> 'value')::int, 4, 'los 4 sin foto');
select is((pg_temp.check(tests.fx('store_a'), 'out_of_stock') ->> 'value')::int, 1, 'uno no se puede comprar');
select is(pg_temp.check(tests.fx('store_a'), 'shipping') ->> 'status', 'critical',
  'se envían productos y no hay tarifas: urgente');
select tests.logout();

-- Lo resuelve: contacto, pago manual y política de privacidad publicada.
update public.stores set contact_email = 'hola@a.test' where id = tests.fx('store_a');
insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
values (tests.fx('store_a'), 'manual', 'active', 'Transferencia', '{"instructions":"CLABE 0123456789"}');
-- La tienda nace con borradores de sus políticas; se publica el de privacidad.
update public.store_pages set is_published = true, published_at = now()
 where store_id = tests.fx('store_a') and type = 'policy_privacy';
select tests.login('owner_a');
select is(pg_temp.check(tests.fx('store_a'), 'notifications') ->> 'status', 'ok', 'con correo de contacto: bien');
select is(pg_temp.check(tests.fx('store_a'), 'payments') ->> 'status', 'warning',
  'solo transferencia: aviso para agregar pago en línea');
select is(pg_temp.check(tests.fx('store_a'), 'policies') ->> 'status', 'warning',
  'con privacidad, faltan las demás: aviso');
select tests.logout();

-- 16-18. Aislamiento: B no hereda nada de A y la consulta no cambia datos.
select tests.login('owner_b');
select is((pg_temp.check(tests.fx('store_b'), 'products_without_photo') ->> 'value')::int, 0,
  'B cuenta solo sus productos');
select is(pg_temp.check(tests.fx('store_b'), 'payments') ->> 'status', 'critical', 'ni los pagos de A');
select tests.logout();
select is((select count(*)::int from audit.audit_logs where action like 'store.health%'), 0, 'consultar no deja rastro ni cambia datos');

select * from finish();
rollback;
