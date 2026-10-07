-- =============================================================================
-- Fase 8 · Cuenta del comprador por tienda (F8-T01): vinculación solo tras OTP,
-- aislamiento entre tiendas y entre clientes, direcciones e intentos de acceso.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now(), prices_include_tax = true, tax_rate_bps = 0
 where id in (tests.fx('store_a'), tests.fx('store_b'));
insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
on conflict (key) do update set value = excluded.value;
select tests.create_user('ana', 'ana@compra.io');
select tests.create_user('beto', 'beto@compra.io');
select tests.create_user('sin_verificar', 'nadie@compra.io');
update auth.users set email_confirmed_at = now() where id in (tests.fx('ana'), tests.fx('beto'), tests.fx('owner'));

create function tests.variant(p_store uuid) returns uuid language sql as
  $$ select id from public.product_variants where store_id = p_store and deleted_at is null limit 1 $$;
create function tests.guest_order(p_store uuid, p_email text, p_key text) returns uuid language plpgsql as $$
declare v jsonb; tok text := rpad(p_key, 43, 'x');
begin
  perform storefront.cart_add_item(p_store, tok, tests.variant(p_store), 1);
  v := storefront.place_order(p_store, tok,
         jsonb_build_object('email', p_email, 'customer_name', 'C',
                            'payment_account_id', (select id from public.payment_accounts where store_id = p_store)),
         10000, 'idem-' || p_key || '-000000000', sha256(convert_to(p_key, 'UTF8')));
  return (v ->> 'order_id')::uuid;
end $$;
grant execute on all functions in schema tests to authenticated;

do $$ begin
  perform tests.login('owner');
  perform public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
    '{"title":"Taza","variants":[{"price":10000,"sku":"ACC-A","requires_shipping":false}]}') ->> 'id')::uuid);
  perform public.inventory_adjust(tests.fx('store_a'), tests.variant(tests.fx('store_a')), 'adjustment', 10, 'Inicial');
  perform tests.logout();
  perform tests.login('owner_b');
  perform public.catalog_publish_product(tests.fx('store_b'), (public.catalog_upsert_product(tests.fx('store_b'),
    '{"title":"Vela","variants":[{"price":10000,"sku":"ACC-B","requires_shipping":false}]}') ->> 'id')::uuid);
  perform public.inventory_adjust(tests.fx('store_b'), tests.variant(tests.fx('store_b')), 'adjustment', 10, 'Inicial');
  perform tests.logout();
end $$;
insert into public.payment_accounts (store_id, provider, status, display_name) values
  (tests.fx('store_a'), 'fake', 'active', 'Prueba'), (tests.fx('store_b'), 'fake', 'active', 'Prueba');

-- Pedidos de invitado ANTES de tener cuenta.
select tests.set_fx('ana_a', tests.guest_order(tests.fx('store_a'), 'ana@compra.io', 'ana-a'));
select tests.set_fx('ana_b', tests.guest_order(tests.fx('store_b'), 'ana@compra.io', 'ana-b'));
select tests.set_fx('beto_a', tests.guest_order(tests.fx('store_a'), 'beto@compra.io', 'beto-a'));

-- ============================================================================ Vinculación
select tests.login('sin_verificar', 'aal1');
select throws_ok(format($$ select public.storefront_link_customer(%L) $$, tests.fx('store_a')), '42501', 'forbidden',
  'sin email verificado no se vincula (solo tras OTP)');
select tests.logout();
select throws_ok(format($$ select public.storefront_link_customer(%L) $$, tests.fx('store_a')), '42501', 'forbidden',
  'sin sesión no se vincula');

select tests.login('ana', 'aal1');
select isnt(public.storefront_link_customer(tests.fx('store_a')), null, 'Ana vincula su cuenta en la tienda A');
select is(public.storefront_link_customer(tests.fx('store_a')),
  (select id from public.customers where store_id = tests.fx('store_a') and email = 'ana@compra.io'),
  'vincula el cliente existente (el de su pedido de invitado), idempotente');
select is(jsonb_array_length(public.account_overview(tests.fx('store_a')) -> 'orders'), 1,
  'su pedido de invitado aparece en la cuenta');
select is(public.account_overview(tests.fx('store_a')) -> 'orders' -> 0 ->> 'id', tests.fx('ana_a')::text,
  'es el pedido de la tienda A');
select is(public.account_get_order(tests.fx('store_a'), tests.fx('ana_a')) ->> 'id', tests.fx('ana_a')::text,
  've el detalle de su pedido');

-- ============================================================================ Aislamiento
select is(public.account_overview(tests.fx('store_b')), null,
  'en la tienda B no hay cuenta hasta vincularla allí (cada tienda es independiente)');
select is(public.account_get_order(tests.fx('store_a'), tests.fx('beto_a')), null,
  'no ve el pedido de otro cliente de la misma tienda');
select throws_ok(format($$ select public.account_get_order(%L, %L) $$, tests.fx('store_b'), tests.fx('ana_b')),
  '42501', 'forbidden', 'ni su propio pedido de B sin cuenta en B');
select is(public.account_get_order(tests.fx('store_a'), tests.fx('ana_b')), null,
  'un pedido de otra tienda pedido con el id de A: nada');
select is((select count(*)::int from public.orders), 0, 'sesión aal1: ninguna lectura directa de pedidos (RLS)');
select is((select string_agg(email || '@' || (store_id = tests.fx('store_a'))::text, ',') from public.customers),
  'ana@compra.io@true', 'de clientes solo ve su propia fila (§7.4)');
select throws_ok($$ select note from public.customers $$, '42501', null,
  'la nota interna del staff sobre el cliente no es legible');
select tests.logout();

-- Staff con sesión de comprador (aal1) en su propia tienda: solo datos de comprador.
select tests.login('owner', 'aal1');
select is((select count(*)::int from public.orders where store_id = tests.fx('store_a')), 0,
  'el dueño con aal1 (sesión de tienda) no ve pedidos del panel');
select throws_ok(format($$ select public.orders_cancel(%L, %L, 'staff', null, 'cancel-acc-0000000001') $$,
  tests.fx('store_a'), tests.fx('ana_a')), '42501', null, 'ni opera el panel (exige aal2)');
select tests.logout();

-- Un cliente ya vinculado a otra cuenta no se puede tomar.
update public.customers set user_id = tests.fx('ana') where store_id = tests.fx('store_b') and email = 'beto@compra.io';
select tests.login('beto', 'aal1');
select lives_ok(format($$ select public.storefront_link_customer(%L) $$, tests.fx('store_a')), 'Beto vincula en A');
select tests.logout();

-- ============================================================================ Perfil y direcciones
select tests.login('ana', 'aal1');
select lives_ok(format($$ select public.account_update_profile(%L, 'Ana', 'López', '+52 55 1234 5678') $$,
  tests.fx('store_a')), 'actualiza su perfil');
select throws_ok(format($$ select public.account_update_profile(%L, 'Ana', null, '<script>') $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'teléfono inválido: rechazado');
select tests.set_fx('addr', public.account_save_address(tests.fx('store_a'), null,
  '{"recipient_name":"Ana López","line1":"Calle 1","city":"CDMX","region":"CDMX","postal_code":"01000","country":"mx","is_default":true}'));
select is((public.account_overview(tests.fx('store_a')) -> 'addresses' -> 0 ->> 'country'), 'MX', 'dirección guardada');
select throws_ok(format($$ select public.account_save_address(%L, null, '{"recipient_name":"","line1":"x","city":"x","region":"x","postal_code":"1","country":"MX"}') $$,
  tests.fx('store_a')), 'P0001', 'validation_failed', 'dirección inválida: rechazada');
select tests.logout();
select tests.login('beto', 'aal1');
select throws_ok(format($$ select public.account_delete_address(%L, %L) $$, tests.fx('store_a'), tests.fx('addr')),
  'P0001', 'not_found', 'Beto no borra direcciones de Ana');
select tests.logout();

-- ============================================================================ Intentos de acceso
select ok(not has_function_privilege('authenticated', 'storefront.record_login_intent(uuid,text,text)', 'execute')
       and has_function_privilege('storefront_gateway', 'storefront.record_login_intent(uuid,text,text)', 'execute')
       and not has_function_privilege('storefront_gateway', 'system.login_intent_store(text)', 'execute'),
  'el intento lo registra solo el gateway; la marca la lee solo el worker');
select is((select count(*)::int from generate_series(1, 7) g
            where storefront.record_login_intent(tests.fx('store_a'), 'Ana@Compra.io', repeat('a', 64))), 5,
  'máximo 5 códigos por email y tienda cada 15 minutos');
select is(system.login_intent_store(' ana@compra.io ') ->> 'id', tests.fx('store_a')::text,
  'el hook obtiene la tienda del intento más reciente');
select ok(not exists (select 1 from system.auth_login_intents where email_hash = convert_to('ana@compra.io', 'UTF8')),
  'nunca se guarda el email en claro');

select * from finish();
rollback;
