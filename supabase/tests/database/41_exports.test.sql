-- =============================================================================
-- Fase 8 · Exportación (F8-T04a, §26.2): permisos por entidad, PII según
-- customers.pii.read, formato de opciones, auditoría y límite de filas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_user('catalog', 'catalog@a.io');
select tests.create_user('inv', 'inv@a.io');
select tests.create_user('orders', 'orders@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.add_store_member('a', 'catalog', 'catalog_manager');
select tests.add_store_member('a', 'inv', 'inventory_manager');
select tests.add_store_member('a', 'orders', 'order_manager');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

select tests.login('owner');
select public.catalog_upsert_product(tests.fx('store_a'), '{"title":"Playera","options":[{"name":"Talla","values":["M"]},{"name":"Color","values":["Azul"]}],"variants":[{"price":29900,"sku":"PLA-M-AZ","options":{"Talla":"M","Color":"Azul"}}]}');
select tests.logout();
select tests.set_fx('ord', tests.order(tests.fx('store_a')));
insert into public.customers (store_id, email, first_name) values (tests.fx('store_a'), 'luis@compra.io', 'Luis');

select tests.login('viewer');
select throws_ok(format($$ select public.exports_rows(%L, 'products') $$, tests.fx('store_a')), '42501', 'forbidden',
  'sin exports.run no se exporta');
select tests.logout();

select tests.login('catalog');
create temp table p as select public.exports_rows(tests.fx('store_a'), 'products') as v;
select is((select v -> 'rows' -> 0 ->> 'sku' from p), 'PLA-M-AZ', 'una fila por variante');
select is((select v -> 'rows' -> 0 -> 'options' from p),
  '[{"name": "Talla", "value": "M"}, {"name": "Color", "value": "Azul"}]'::jsonb,
  'opciones en el orden del producto (no el alfabético de la firma)');
select is((select (v -> 'rows' -> 0 ->> 'price')::bigint from p), 29900::bigint, 'precio en centavos');
select throws_ok(format($$ select public.exports_rows(%L, 'customers') $$, tests.fx('store_a')), '42501', 'forbidden',
  'catalog_manager no exporta clientes (sin customers.read)');
select tests.logout();

-- Rol propio de la organización con pedidos y exportación, pero sin PII.
select tests.create_user('nopii', 'nopii@a.io');
select tests.add_store_member('a', 'nopii', 'viewer');
with r as (
  insert into public.roles (key, organization_id, name, rank) values ('pedidos_sin_pii', tests.fx('org_a'), 'Pedidos', 50)
  returning id
), p as (
  insert into public.role_permissions (role_id, permission_key)
  select r.id, k from r, unnest(array['store.read', 'orders.read', 'orders.update', 'exports.run']) k
)
update public.store_members set role_id = (select id from r)
 where store_id = tests.fx('store_a') and user_id = tests.fx('nopii');
select tests.login('nopii');
select is((select count(*)::int from jsonb_array_elements(public.exports_rows(tests.fx('store_a'), 'orders') -> 'rows') r
            where r ? 'email'), 0, 'sin customers.pii.read: pedidos sin datos de contacto');
select tests.logout();

select tests.login('inv');
select throws_ok(format($$ select public.exports_rows(%L, 'orders') $$, tests.fx('store_a')), '42501', 'forbidden',
  'inventory_manager exporta inventario, no pedidos (§8.3)');
select tests.logout();

select tests.login('orders');
select is(public.exports_rows(tests.fx('store_a'), 'orders') -> 'rows' -> 0 ->> 'email', 'test@example.test',
  'con PII: email del pedido');
select throws_ok(format($$ select public.exports_rows(%L, 'customers') $$, tests.fx('store_a')), '42501', 'forbidden',
  'order_manager no exporta la lista de clientes (§8.3)');
select throws_ok(format($$ select public.exports_rows(%L, 'secretos') $$, tests.fx('store_a')), 'P0001',
  'validation_failed', 'entidad desconocida: rechazada');
select tests.logout();

select tests.login('owner');
select is(public.exports_rows(tests.fx('store_a'), 'customers') -> 'rows' -> 0 ->> 'email', 'luis@compra.io',
  'clientes completos: solo la administración de la tienda');
select tests.logout();

select ok(exists (select 1 from audit.audit_logs where action = 'export.requested' and store_id = tests.fx('store_a')
                                                 and after ->> 'entity' = 'customers' and (after ->> 'pii')::boolean),
  'auditado con la entidad y si llevó PII');

select tests.login('owner_b');
select is(jsonb_array_length(public.exports_rows(tests.fx('store_b'), 'products') -> 'rows'), 0,
  'B no ve productos de A en su exportación');
select throws_ok(format($$ select public.exports_rows(%L, 'products') $$, tests.fx('store_a')), '42501', 'forbidden',
  'B no exporta A');
select tests.logout();

insert into public.customers (store_id, email) select tests.fx('store_a'), 'm' || g || '@x.io' from generate_series(1, 5000) g;
select tests.login('owner');
select throws_ok(format($$ select public.exports_rows(%L, 'customers') $$, tests.fx('store_a')), 'P0001',
  'validation_failed', 'más de 5 000 filas: rechazado (exportación asíncrona en F8-T04b)');
select tests.logout();

select * from finish();
rollback;
