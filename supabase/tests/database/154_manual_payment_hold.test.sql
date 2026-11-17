-- =============================================================================
-- Pago por transferencia: las piezas quedan apartadas 24 horas (20261117000600,
-- D-INT-02). La tarjeta (aquí el proveedor de prueba) sigue con el plazo de la
-- tienda. Aislamiento: una tienda no usa la cuenta de otra ni confirma sus pagos.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select tests.create_user('owner', 'owner@hold-a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@hold-b.io');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now(), prices_include_tax = true, tax_rate_bps = 0,
                         reservation_ttl_minutes = 30
 where id in (tests.fx('store_a'), tests.fx('store_b'));

create function tests.hold_gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'storefront_gateway', true);
  execute format('select to_jsonb(t.x) from (%s) t(x)', p_sql) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function tests.hold_tok(p text) returns text language sql as $$ select rpad(p, 43, 'x') $$;
create function tests.hold_variant() returns uuid language sql as
  $$ select id from public.product_variants where sku = 'HOLD-1' and deleted_at is null $$;
create function tests.hold_order(p_cart text, p_account uuid) returns jsonb language plpgsql as $f$
begin
  perform tests.hold_gw(format('select storefront.cart_add_item(%L, %L, %L, 1)', tests.fx('store_a'), p_cart,
                               tests.hold_variant()));
  return tests.hold_gw(format('select storefront.place_order(%L, %L, %L, %s, %L, %L)', tests.fx('store_a'), p_cart,
    jsonb_build_object('email', 'ana@x.io', 'customer_name', 'Ana', 'payment_account_id', p_account,
                       'shipping_address', '{"recipient_name":"Ana","line1":"C 1","city":"Puebla","region":"Puebla","postal_code":"72000","country":"MX"}'::jsonb,
                       'shipping_rate_id', tests.fx('hold_rate')),
    10000, 'idem-' || p_cart, sha256(convert_to('g-' || p_cart, 'UTF8'))));
end $f$;
create function tests.hold_minutes(p_order uuid) returns numeric language sql as $$
  select round(extract(epoch from (r.expires_at - now())) / 60)
    from public.inventory_reservations r where r.order_id = p_order $$;
grant execute on all functions in schema tests to storefront_gateway, authenticated;

select tests.login('owner');
select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Taza","variants":[{"price":10000,"sku":"HOLD-1"}]}') ->> 'id')::uuid);
select public.inventory_adjust(tests.fx('store_a'), tests.hold_variant(), 'adjustment', 10, 'Inicial');
select tests.logout();
insert into public.shipping_zones (store_id, name, countries) values (tests.fx('store_a'), 'MX', '{MX}')
returning tests.set_fx('hold_zone', id);
insert into public.shipping_rates (store_id, zone_id, name, type, price) values
  (tests.fx('store_a'), tests.fx('hold_zone'), 'Gratis', 'flat', 0) returning tests.set_fx('hold_rate', id);
insert into public.payment_accounts (store_id, provider, status, display_name) values
  (tests.fx('store_a'), 'manual', 'active', 'Transferencia') returning tests.set_fx('hold_manual', id);
insert into public.payment_accounts (store_id, provider, status, display_name) values
  (tests.fx('store_a'), 'fake', 'active', 'Tarjeta de prueba') returning tests.set_fx('hold_fake', id);
insert into public.payment_accounts (store_id, provider, status, display_name) values
  (tests.fx('store_b'), 'manual', 'active', 'Transferencia B') returning tests.set_fx('hold_manual_b', id);
insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
  on conflict (key) do update set value = excluded.value;

-- ======================================================== Transferencia: 24 horas
select tests.set_fx('hold_o1', (tests.hold_order(tests.hold_tok('h1'), tests.fx('hold_manual')) ->> 'order_id')::uuid);
select is(tests.hold_minutes(tests.fx('hold_o1')), 1440::numeric, 'transferencia: las piezas quedan apartadas 24 horas');
select is((select round(extract(epoch from (r.expires_at - p.expires_at)) / 60)
             from public.inventory_reservations r join public.payments p on p.order_id = r.order_id
            where r.order_id = tests.fx('hold_o1')),
          2::numeric, 'el pago vence 2 minutos antes que el apartado, como con tarjeta');
select is((select reserved from public.inventory_levels where variant_id = tests.hold_variant()), 1,
          'la pieza queda reservada mientras se espera la transferencia');

-- ============================================== Tarjeta: el plazo de la tienda
select tests.set_fx('hold_o2', (tests.hold_order(tests.hold_tok('h2'), tests.fx('hold_fake')) ->> 'order_id')::uuid);
select is(tests.hold_minutes(tests.fx('hold_o2')), 30::numeric, 'tarjeta: sigue con el plazo de la tienda (30 min)');
update public.stores set reservation_ttl_minutes = 60 where id = tests.fx('store_a');
select tests.set_fx('hold_o3', (tests.hold_order(tests.hold_tok('h3'), tests.fx('hold_fake')) ->> 'order_id')::uuid);
select is(tests.hold_minutes(tests.fx('hold_o3')), 60::numeric, 'tarjeta: si la tienda cambia su plazo, se respeta');
select tests.set_fx('hold_o4', (tests.hold_order(tests.hold_tok('h4'), tests.fx('hold_manual')) ->> 'order_id')::uuid);
select is(tests.hold_minutes(tests.fx('hold_o4')), 1440::numeric, 'transferencia: 24 horas sin importar el plazo de la tienda');

-- ===================== 40 minutos después, el mantenimiento no cancela la transferencia
-- Como si pasaran 40 minutos: vence el plazo de la tienda (30), no el de 24 horas.
update public.inventory_reservations set expires_at = expires_at - interval '40 minutes' where store_id = tests.fx('store_a');
select system.expire_orders();
select is((select status from public.orders where id = tests.fx('hold_o2')), 'cancelled',
          'la de tarjeta vencida se cancela');
select is((select status from public.orders where id = tests.fx('hold_o1')), 'pending_payment',
          'la de transferencia sigue esperando el pago');

-- ======================================================================= Aislamiento
select throws_ok(format($$ select tests.hold_order(%L, %L) $$, tests.hold_tok('h5'), tests.fx('hold_manual_b')),
  'P0001', 'validation_failed', 'la tienda A no puede usar la cuenta de transferencia de la tienda B');
select tests.login('owner_b');
select throws_ok(format($$ select public.orders_mark_paid_manual(%L, %L) $$, tests.fx('store_a'), tests.fx('hold_o1')),
  '42501', 'forbidden', 'la dueña de B no confirma pagos de la tienda A');
select tests.logout();
select tests.login('owner');
select lives_ok(format($$ select public.orders_mark_paid_manual(%L, %L, 'Transferencia recibida') $$,
  tests.fx('store_a'), tests.fx('hold_o1')), 'la dueña de A confirma la transferencia');
select tests.logout();
select is((select payment_status from public.orders where id = tests.fx('hold_o1')), 'paid',
          'el pedido por transferencia queda pagado');

-- ========================================================================= Seguridad
select ok((select prosecdef and proconfig @> array['search_path=""']
             from pg_proc where oid = 'storefront.place_order(uuid, text, jsonb, bigint, text, bytea)'::regprocedure),
          'place_order sigue con security definer y search_path vacío');

select * from finish();
rollback;
