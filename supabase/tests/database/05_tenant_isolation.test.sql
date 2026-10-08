-- =============================================================================
-- Fase 2 · SUITE DE AISLAMIENTO MULTI-TENANT (GATE0 §34.3). Bloquea el merge.
--
-- Genérica: recorre el catálogo y prueba TODA tabla de "public" con store_id u
-- organization_id. Una tabla nueva de cualquier fase futura queda cubierta sin
-- modificar este archivo. Objetivo de los ataques: la tienda A y su organización.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- Fixtures: dos organizaciones; A tiene dos tiendas (A y A2). Se puebla TODA tabla
-- de tenant para A, de modo que cualquier fuga se manifieste.
select tests.create_user('owner_a', 'owner.a@test.io');
select tests.create_user('owner_b', 'owner.b@test.io');
select tests.create_user('catalog_b', 'catalog.b@test.io');
select tests.create_user('staff_a2', 'staff.a2@test.io');
select tests.create_user('buyer_a', 'buyer.a@test.io');
select tests.create_user('buyer_b', 'buyer.b@test.io');
select tests.create_user('support', 'support@platform.io');
select tests.create_user('padmin', 'admin@platform.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');
select tests.create_store('a2', 'org_a');
select tests.add_store_member('b', 'catalog_b', 'catalog_manager');
select tests.add_store_member('a2', 'staff_a2', 'store_admin');
select tests.make_platform_staff('support', 'platform_support');
select tests.make_platform_staff('padmin', 'platform_admin');

insert into public.store_counters (store_id, key, value) values (tests.fx('store_a'), 'order_number', 1000);
insert into public.customers (store_id, user_id, email) values
  (tests.fx('store_a'), tests.fx('buyer_a'), 'buyer.a@test.io'),
  (tests.fx('store_a'), null, 'invitado.a@test.io'),
  (tests.fx('store_b'), tests.fx('buyer_b'), 'buyer.b@test.io');
insert into public.organization_invitations (organization_id, store_id, email, store_role_id, expires_at)
values (tests.fx('org_a'), tests.fx('store_a'), 'nuevo@test.io',
        (select id from public.roles where key = 'viewer'), now() + interval '7 days');
insert into public.support_access_grants (organization_id, store_id, grantee_user_id, granted_by, reason, expires_at)
values (tests.fx('org_a'), tests.fx('store_a'), tests.fx('support'), tests.fx('padmin'),
        'Ticket 9001: revisión solicitada por el dueño', now() + interval '30 minutes');
insert into public.organization_entitlement_overrides (organization_id, key, value_int, reason)
values (tests.fx('org_a'), 'max_stores', 5, 'Acuerdo comercial');
-- Checkout (F6-T01): una fila en cada tabla nueva de A.
insert into public.products (store_id, title, slug) values (tests.fx('store_a'), 'Taza', 'taza');
insert into public.product_variants (store_id, product_id, sku, price, option_signature)
select tests.fx('store_a'), id, 'TAZA-1', 15000, '' from public.products where store_id = tests.fx('store_a');
insert into public.customer_addresses (store_id, customer_id, recipient_name, line1, city, region, postal_code, country)
select tests.fx('store_a'), id, 'Ana', 'Calle 1', 'CDMX', 'CDMX', '01000', 'MX'
  from public.customers where store_id = tests.fx('store_a') and user_id is not null;
insert into public.shipping_zones (store_id, name, countries) values (tests.fx('store_a'), 'México', '{MX}');
insert into public.shipping_rates (store_id, zone_id, name, type, price)
select tests.fx('store_a'), id, 'Estándar', 'flat', 9900 from public.shipping_zones where store_id = tests.fx('store_a');
insert into public.discounts (store_id, code, type, value) values (tests.fx('store_a'), 'BIENVENIDA', 'percentage', 1000);
insert into public.carts (store_id, token_hash) values (tests.fx('store_a'), sha256('cart-a'::bytea));
insert into public.cart_items (store_id, cart_id, variant_id, quantity)
select tests.fx('store_a'), c.id, v.id, 1 from public.carts c, public.product_variants v
 where c.store_id = tests.fx('store_a') and v.store_id = tests.fx('store_a');
select tests.set_fx('order_a', tests.order(tests.fx('store_a')));
insert into public.order_items (store_id, order_id, product_title, product_type, requires_shipping, unit_price,
                                quantity, line_total)
values (tests.fx('store_a'), tests.fx('order_a'), 'Taza', 'physical', true, 0, 1, 0);
insert into public.order_events (store_id, order_id, type, actor_type)
values (tests.fx('store_a'), tests.fx('order_a'), 'order.created', 'system');
insert into public.discount_redemptions (store_id, discount_id, order_id, amount)
select tests.fx('store_a'), id, tests.fx('order_a'), 0 from public.discounts where store_id = tests.fx('store_a');
insert into public.payment_accounts (store_id, provider, status, display_name)
values (tests.fx('store_a'), 'manual', 'active', 'Transferencia');
insert into public.payments (store_id, order_id, payment_account_id, provider, amount, currency, idempotency_key)
select tests.fx('store_a'), tests.fx('order_a'), id, 'manual', 100, 'MXN', 'pago-prueba-0000001'
  from public.payment_accounts where store_id = tests.fx('store_a');
insert into public.shipments (store_id, order_id, idempotency_key)
values (tests.fx('store_a'), tests.fx('order_a'), 'envio-prueba-0000001');
insert into public.shipment_items (store_id, shipment_id, order_item_id, quantity)
select tests.fx('store_a'), s.id, i.id, 1 from public.shipments s, public.order_items i
 where s.store_id = tests.fx('store_a') and i.order_id = tests.fx('order_a');
insert into public.refunds (store_id, order_id, payment_id, amount, idempotency_key)
select tests.fx('store_a'), tests.fx('order_a'), id, 1, 'reemb-prueba-000001' from public.payments
 where store_id = tests.fx('store_a');
insert into public.store_notification_settings (store_id, staff_emails) values (tests.fx('store_a'), '{ventas@a.io}');
insert into public.payment_events (store_id, payment_account_id, provider_event_id, type, signed_at, payload)
select tests.fx('store_a'), id, 'evt_test_1', 'checkout.session.completed', now(), '{}'
  from public.payment_accounts where store_id = tests.fx('store_a');

-- Cobertura: ninguna tabla con columna de tenant queda fuera de la clasificación.
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and not a.attisdropped
                      and a.attname in ('store_id', 'organization_id'))
        and c.relname <> 'roles'
        and tests.tenant_filter(c.relname, gen_random_uuid(), gen_random_uuid(), true) is null $$,
  'toda tabla con store_id/organization_id está cubierta por la suite'
);

-- Ninguna tabla de tenant concede INSERT ni DELETE a authenticated: las altas y
-- bajas pasan solo por funciones que verifican permisos.
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and tests.tenant_filter(c.relname, gen_random_uuid(), gen_random_uuid(), true) is not null
        and (has_table_privilege('authenticated', c.oid, 'INSERT')
             or has_table_privilege('authenticated', c.oid, 'DELETE')
             or has_table_privilege('authenticated', c.oid, 'TRUNCATE')) $$,
  'authenticated no tiene INSERT/DELETE/TRUNCATE directo en tablas de tenant'
);

-- Control positivo: el dueño de A (con 2FA) SÍ ve los datos de A. Sin esto, los
-- "0 filas" de abajo podrían ser una prueba vacía.
select tests.login('owner_a');
select set_eq(
  $$ select * from tests.visible_tenant_tables(tests.fx('store_a'), tests.fx('org_a')) $$,
  -- inventory_locations: toda tienda nace con su ubicación por defecto (F4-T01).
  -- menus y store_pages: menús y políticas en borrador creados con la tienda (F5-T01).
  -- Checkout (F6-T01): todo menos carts/cart_items (sin grants: solo storefront.*).
  array['customer_addresses', 'customers', 'discount_redemptions', 'discounts', 'inventory_levels',
        'inventory_locations', 'menus', 'order_events', 'order_items', 'orders', 'organization_entitlement_overrides',
        'organization_invitations', 'organization_members', 'organizations', 'payment_accounts', 'payment_events',
        'payments', 'refunds', 'shipment_items', 'shipments',
        'product_variants', 'products', 'shipping_rates', 'shipping_zones', 'store_domains', 'store_pages',
        'store_notification_settings', 'store_themes', 'stores', 'subscriptions', 'support_access_grants'],
  'control positivo: el dueño de A ve los datos de A'
);
select is(tests.row_count($$ update public.stores set name = name where id = tests.fx('store_a') $$), 1::bigint,
  'control positivo: el dueño de A puede modificar su tienda');
-- Desde F2-T11 el borrador solo se guarda con la RPC que valida contraste (D-F2-31).
select lives_ok($$ select public.appearance_save_theme_draft(tests.fx('store_a'), '{"colors":{"primary":"#1d4ed8"}}') $$,
  'control positivo: el dueño de A puede editar el borrador de su branding');
select tests.logout();

-- ATAQUE 1: dueño de otra organización (con 2FA) --------------------------------------
select tests.login('owner_b');
select is_empty($$ select * from tests.visible_tenant_tables(tests.fx('store_a'), tests.fx('org_a')) $$,
  'dueño de B: no LEE nada de A');
select is(tests.updatable_tenant_rows(tests.fx('store_a'), tests.fx('org_a')), 0::bigint,
  'dueño de B: no MODIFICA ni BORRA nada de A');
select throws_ok($$ select public.appearance_publish_theme(tests.fx('store_a')) $$, '42501', 'forbidden',
  'dueño de B: no puede publicar el tema de A');
select tests.logout();

-- ATAQUE 2: staff de otra organización ---------------------------------------------------
select tests.login('catalog_b');
select is_empty($$ select * from tests.visible_tenant_tables(tests.fx('store_a'), tests.fx('org_a')) $$,
  'staff de B: no LEE nada de A');
select is(tests.updatable_tenant_rows(tests.fx('store_a'), tests.fx('org_a')), 0::bigint,
  'staff de B: no MODIFICA ni BORRA nada de A');
select tests.logout();

-- ATAQUE 3: administrador de OTRA tienda de la MISMA organización (A2) ------------------
select tests.login('staff_a2');
select is_empty($$ select * from tests.visible_tenant_tables(tests.fx('store_a'), tests.fx('org_a'), false) $$,
  'admin de A2: no LEE nada de la tienda A (misma organización)');
select is(tests.updatable_tenant_rows(tests.fx('store_a'), tests.fx('org_a'), false), 0::bigint,
  'admin de A2: no MODIFICA nada de la tienda A');
select ok(exists (select 1 from public.stores where id = tests.fx('store_a2')),
  'control: el admin de A2 sí ve su propia tienda');
select tests.logout();

-- ATAQUE 4: el dueño de A SIN 2FA (sesión aal1, p. ej. obtenida como comprador) ---------
select tests.login('owner_a', 'aal1');
select is_empty($$ select * from tests.visible_tenant_tables(tests.fx('store_a'), tests.fx('org_a')) $$,
  'dueño de A sin 2FA: no LEE nada de staff (CF-02)');
select is(tests.updatable_tenant_rows(tests.fx('store_a'), tests.fx('org_a')), 0::bigint,
  'dueño de A sin 2FA: no MODIFICA nada');
select tests.logout();

-- ATAQUE 5: comprador de otra tienda ---------------------------------------------------------
select tests.login_otp('buyer_b');
select is_empty($$ select * from tests.visible_tenant_tables(tests.fx('store_a'), tests.fx('org_a')) $$,
  'comprador de B: no LEE nada de A');
select is(tests.updatable_tenant_rows(tests.fx('store_a'), tests.fx('org_a')), 0::bigint,
  'comprador de B: no MODIFICA nada de A');
select tests.logout();

-- Separación comprador ↔ staff: el comprador de A solo ve SU fila de cliente (sesión
-- con código por email; sin ella no ve ni su propio registro: Gate F8, G-H1).
select tests.login_otp('buyer_a');
select set_eq($$ select * from tests.visible_tenant_tables(tests.fx('store_a'), tests.fx('org_a')) $$,
  array['customers'], 'comprador de A: solo ve su registro de cliente, nada de staff');
select is((select count(*) from public.customers where store_id = tests.fx('store_a'))::int, 1,
  'comprador de A: no ve a otros clientes de la misma tienda');
select is(tests.row_count($$ update public.customers set first_name = 'Ana' where user_id = tests.fx('buyer_a') $$),
  1::bigint, 'comprador de A: puede editar su propio nombre');
select throws_ok($$ update public.customers set email = 'otro@test.io' where user_id = tests.fx('buyer_a') $$,
  '42501', null, 'comprador de A: no puede cambiar su email ni campos estructurales');
select tests.logout();

-- ATAQUE 6: soporte de plataforma ----------------------------------------------------------
-- Con concesión en A: solo lectura de la tienda; nunca datos sensibles ni escritura.
select tests.login('support');
select set_eq($$ select * from tests.visible_tenant_tables(tests.fx('store_a'), tests.fx('org_a')) $$,
  -- inventory.read es legible por soporte (dato operativo, no sensible).
  -- Pedidos sin datos de contacto (grant por columna), descuentos y envíos: lectura no
  -- sensible (matriz §8, «G»). Nunca pagos, cuentas de pago ni direcciones (sensibles).
  array['discount_redemptions', 'discounts', 'inventory_levels', 'inventory_locations', 'menus', 'order_events',
        'order_items', 'orders', 'product_variants', 'products', 'refunds', 'shipment_items', 'shipments',
        'shipping_rates', 'shipping_zones',
        'store_domains', 'store_pages', 'store_themes', 'stores', 'support_access_grants'],
  'soporte con concesión: solo lectura no sensible (sin clientes, invitaciones ni facturación)');
select is(tests.updatable_tenant_rows(tests.fx('store_a'), tests.fx('org_a')), 0::bigint,
  'soporte con concesión: no MODIFICA nada');
select is_empty($$ select * from tests.visible_tenant_tables(tests.fx('store_b'), tests.fx('org_b')) $$,
  'soporte: sin concesión en B no ve nada de B');
select tests.logout();

select tests.login('padmin');
select is_empty($$ select * from tests.visible_tenant_tables(tests.fx('store_a'), tests.fx('org_a')) $$,
  'platform_admin sin concesión: no ve datos del tenant');
select tests.logout();

-- ATAQUE 7: anon y roles de mínimo privilegio (sin grants de tabla) -------------------------
select tests.as_role('anon');
select is_empty($$ select * from tests.visible_tenant_tables(tests.fx('store_a'), tests.fx('org_a')) $$,
  'anon: no lee nada');
select tests.logout();
select is(tests.visible_tenant_tables_as('storefront_gateway', tests.fx('store_a'), tests.fx('org_a')),
  '{}'::text[], 'storefront_gateway: no lee tablas directamente');
select is(tests.visible_tenant_tables_as('system_worker', tests.fx('store_a'), tests.fx('org_a')),
  '{}'::text[], 'system_worker: no lee tablas directamente');

select * from finish();
rollback;
