-- =============================================================================
-- Fase 8 · Clientes en el panel (F8-T02): sin customers.pii.read no hay PII.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_user('orders', 'orders@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.add_store_member('a', 'orders', 'order_manager');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
select tests.create_user('buyer', 'ana.lopez@compra.io');

insert into public.customers (store_id, email, first_name, last_name, phone, note, user_id, accepts_marketing,
                              marketing_consent_at, marketing_consent_source)
values (tests.fx('store_a'), 'ana.lopez@compra.io', 'Ana', 'López', '+52 55 1234 5678', 'Cliente frecuente',
        tests.fx('buyer'), true, now(), 'checkout')
returning tests.set_fx('ana', id);
insert into public.customer_addresses (store_id, customer_id, recipient_name, line1, city, region, postal_code, country)
values (tests.fx('store_a'), tests.fx('ana'), 'Ana López', 'Calle 1', 'CDMX', 'CDMX', '01000', 'MX');
insert into public.customers (store_id, email) select tests.fx('store_a'), 'c' || g || '@x.io' from generate_series(1, 30) g;

-- ============================================================================ Sin PII (viewer)
select tests.login('viewer');
select is(public.customers_get(tests.fx('store_a'), tests.fx('ana')) ->> 'email', 'a***@c***.io', 'email enmascarado (sin parte local ni dominio completos)');
select is(public.customers_get(tests.fx('store_a'), tests.fx('ana')) ->> 'phone', '••• 5678', 'teléfono enmascarado');
select is(public.customers_get(tests.fx('store_a'), tests.fx('ana')) ->> 'name', 'A. L.', 'nombre en iniciales');
select ok(public.customers_get(tests.fx('store_a'), tests.fx('ana')) -> 'note' = 'null'::jsonb
          and jsonb_array_length(public.customers_get(tests.fx('store_a'), tests.fx('ana')) -> 'addresses') = 0,
  'sin nota ni direcciones');
select throws_ok(format($$ select public.customers_list(%L, 'ana', null, 25) $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'sin PII no se busca por email o nombre');
select is(jsonb_array_length(public.customers_list(tests.fx('store_a'), null, null, 25) -> 'items'), 25,
  'listado paginado');
select isnt(public.customers_list(tests.fx('store_a'), null, null, 25) ->> 'next_cursor', null, 'hay página siguiente');
select is(jsonb_array_length(public.customers_list(tests.fx('store_a'), null,
  public.customers_list(tests.fx('store_a'), null, null, 25) ->> 'next_cursor', 25) -> 'items'), 6,
  'la segunda página trae el resto (31 en total)');
select throws_ok(format($$ select public.customers_update(%L, %L, 'X', null, null, null, null) $$,
  tests.fx('store_a'), tests.fx('ana')), '42501', 'forbidden', 'viewer no edita');
select tests.logout();

-- ============================================================================ Con PII (order_manager)
select tests.login('orders');
select is(public.customers_get(tests.fx('store_a'), tests.fx('ana')) ->> 'email', 'ana.lopez@compra.io', 'email completo');
select is(public.customers_get(tests.fx('store_a'), tests.fx('ana')) ->> 'note', 'Cliente frecuente', 'nota visible');
select is(jsonb_array_length(public.customers_list(tests.fx('store_a'), 'ana.lo', null, 25) -> 'items'), 1,
  'busca por email');
select is(jsonb_array_length(public.customers_list(tests.fx('store_a'), '%', null, 25) -> 'items'), 0,
  'los comodines se escapan');
select throws_ok(format($$ select public.customers_update(%L, %L, 'Ana', 'López', null, null, true) $$,
  tests.fx('store_a'), (select id from public.customers where email = 'c1@x.io')), 'P0001', 'validation_failed',
  'la tienda no puede dar el consentimiento de marketing por el cliente');
select lives_ok(format($$ select public.customers_update(%L, %L, 'Ana', 'López', null, 'VIP', false) $$,
  tests.fx('store_a'), tests.fx('ana')), 'retirar el consentimiento sí');
select throws_ok(format($$ select public.customers_anonymize(%L, %L, 'Lo pidió') $$, tests.fx('store_a'), tests.fx('ana')),
  '42501', 'forbidden', 'order_manager no anonimiza');
select tests.logout();

-- ============================================================================ Anonimizar
select tests.login('owner_b');
select throws_ok(format($$ select public.customers_get(%L, %L) $$, tests.fx('store_b'), tests.fx('ana')),
  'P0001', 'not_found', 'B no ve clientes de A');
select tests.logout();
select tests.login('owner');
select is((public.customers_anonymize(tests.fx('store_a'), tests.fx('ana'), 'Solicitud del titular (ARCO)')
  ->> 'replayed')::boolean, false, 'anonimizado');
select tests.logout();
select is((select coalesce(first_name, '') || coalesce(phone, '') || coalesce(note, '') || (user_id is null)::text
                  || (email like 'anonimo-%@anonimizado.invalid')::text || accepts_marketing::text
             from public.customers where id = tests.fx('ana')), 'truetruefalse',
  'sin nombre, teléfono, nota, cuenta ni consentimiento; email sustituido');
select is((select count(*)::int from public.customer_addresses where customer_id = tests.fx('ana')), 0,
  'direcciones eliminadas');

select * from finish();
rollback;
