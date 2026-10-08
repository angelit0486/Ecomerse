-- =============================================================================
-- Gate F8 · Regresiones de la revisión adversarial (PHASE-08-REPORT §5): cuenta del
-- comprador, marca del código, clientes, auditoría, dashboard e importación.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('inv', 'inv@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'inv', 'inventory_manager');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');
select tests.create_user('ana', 'ana@compra.io');
select tests.create_user('eva', 'eva@compra.io');
update public.stores set status = 'active', launched_at = now() where id in (tests.fx('store_a'), tests.fx('store_b'));
update auth.users set email_confirmed_at = now() where id in (tests.fx('ana'), tests.fx('eva'));
insert into public.customers (store_id, email, first_name) values (tests.fx('store_a'), 'ana@compra.io', 'Ana');
select tests.set_fx('cust_ana', (select id from public.customers where email = 'ana@compra.io'));

-- ============================================================================ DB-H1 / DB-L1
select tests.login('ana', 'aal1');  -- email confirmado, pero la sesión no vino de un código (p. ej. contraseña)
select throws_ok(format($$ select public.storefront_link_customer(%L) $$, tests.fx('store_a')), '42501', 'forbidden',
  'sin un código por email en esta sesión no se vincula (alta con contraseña y confirmación automática)');
select tests.logout();
select tests.login_otp('ana', 3600);
select throws_ok(format($$ select public.storefront_link_customer(%L) $$, tests.fx('store_a')), '42501', 'forbidden',
  'un código de hace una hora no sirve para vincular');
select tests.logout();
select tests.login_otp('ana');
select isnt(public.storefront_link_customer(tests.fx('store_a')), null, 'con un código reciente sí');
select tests.logout();
-- Ana cambia el email de su cuenta: deja de ver el cliente del email anterior...
update auth.users set email = 'ana.nueva@compra.io' where id = tests.fx('ana');
select tests.login_otp('ana');
select is(public.account_overview(tests.fx('store_a')), null, 'cuenta con otro email: ya no ve al cliente anterior');
select tests.logout();
-- ... y quien ahora tiene ese email puede reclamarlo.
update auth.users set email = 'ana@compra.io' where id = tests.fx('eva');
select tests.login_otp('eva');
select is(public.storefront_link_customer(tests.fx('store_a')), tests.fx('cust_ana'),
  'el dueño actual del email reclama al cliente');
select tests.logout();

-- ============================================================================ DB-M1 / APP-M4 / DB-L3
create temp table n as select storefront.record_login_intent(tests.fx('store_b'), 'owner@a.io', repeat('b', 64)) as nonce;
select is(system.login_intent_store('owner@a.io', repeat('0', 32)), null,
  'sin el nonce de la petición no hay marca de tienda (login del panel: plataforma)');
select is(system.login_intent_store('owner@a.io', (select nonce from n)) ->> 'id', tests.fx('store_b')::text,
  'con su nonce, la marca de la tienda que lo pidió');
select ok(not (system.login_intent_store('owner@a.io', (select nonce from n)) ? 'contact_email'),
  'la marca del código no lleva Reply-To de la tienda');
select is((select count(*)::int from generate_series(1, 6) g
            where storefront.record_login_intent(tests.fx('store_a'), 'multi@compra.io', repeat('c', 64)) is not null)
        + (select count(*)::int from generate_series(1, 6) g
            where storefront.record_login_intent(tests.fx('store_b'), 'multi@compra.io', repeat('d', 64)) is not null),
  10, 'por email: 5 por tienda y 10 en total cada 15 minutos');
select is((select count(*)::int from generate_series(1, 10) g
            where storefront.take_code_attempt(tests.fx('store_a'), 'ana@compra.io', repeat('e', 64))), 8,
  'verificaciones del código: 8 por email cada 15 minutos');

-- ============================================================================ DB-M2
select tests.login_otp('eva');
select throws_ok(format($$ update public.customers set phone = '<script>' where store_id = %L $$, tests.fx('store_a')),
  '23514', null, 'editar la fila directamente exige el mismo formato que la RPC');
select tests.logout();
select tests.login('owner');
select public.customers_anonymize(tests.fx('store_a'),
  (select id from public.customers where store_id = tests.fx('store_a') and email = 'ana@compra.io'), 'Pedido del cliente');
select tests.logout();
update public.customers set first_name = 'Real', phone = '+52 55 1234 5678', accepts_marketing = true, marketing_consent_at = now()
 where store_id = tests.fx('store_a') and anonymized_at is not null;
select is((select coalesce(first_name, '') || coalesce(phone, '') || accepts_marketing::text from public.customers
            where store_id = tests.fx('store_a') and anonymized_at is not null), 'false',
  'un anonimizado no recupera datos por ninguna vía');

-- ============================================================================ DB-M3 / APP-M2 / DB-L2
select is((select actor_label from audit.audit_logs where action = 'customer.account_linked' and actor_user_id = tests.fx('eva')),
  'Cliente a***@c***.io', 'la auditoría guarda al comprador enmascarado');
insert into audit.audit_logs (organization_id, store_id, actor_type, actor_user_id, actor_label, action, entity_type)
values (tests.fx('org_a'), tests.fx('store_a'), 'user', tests.fx('eva'), 'eva.completa@compra.io', 'customer.legacy', 'customer');
select tests.login('owner');
select is((select x ->> 'actor_label' from jsonb_array_elements(public.audit_list(tests.fx('store_a'), null, null, 50) -> 'items') x
            where x ->> 'action' = 'customer.legacy'), 'Cliente e***@c***.io',
  'y Actividad tampoco muestra un email completo de un registro anterior');
select tests.logout();
select is(app.mask_email('x@y.co') || ' ' || app.mask_email('jo@perez-garcia.mx'), '***@y***.co j***@p***.mx',
  'el enmascarado nunca muestra la parte local ni el dominio completos');

-- ============================================================================ DB-L4 / DB-L5
select tests.login('owner');
select throws_ok(format($$ select public.dashboard_kpis(%L, '2025-01-01', '2026-01-02') $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'más de 366 días: rechazado');
select lives_ok(format($$ select public.dashboard_kpis(%L, '2025-01-01', '2026-01-01') $$, tests.fx('store_a')),
  '366 días contando ambos extremos: aceptado');
select throws_ok(format($$ select public.dashboard_kpis(%L, '-infinity', null) $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'fechas infinitas: validation_failed');
do $$
declare v uuid;
begin
  for i in 1..10 loop
    v := (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object('title', 'Viejo ' || i,
           'variants', jsonb_build_array(jsonb_build_object('price', 100, 'sku', 'OLD-' || i, 'options', '{}'::jsonb)))) ->> 'id')::uuid;
    perform public.catalog_soft_delete_product(tests.fx('store_a'), v);
  end loop;
  perform public.catalog_upsert_product(tests.fx('store_a'),
    '{"title":"Vivo","variants":[{"price":100,"sku":"LIVE-1","options":{}}]}');
end $$;
select tests.logout();
update public.inventory_levels set low_stock_threshold = 5 where store_id = tests.fx('store_a');
select tests.login('owner');
select is((select string_agg(x ->> 'sku', ',') from jsonb_array_elements(
             public.dashboard_kpis(tests.fx('store_a'), null, null) -> 'low_stock') x), 'LIVE-1',
  'existencias bajas: los borrados no ocupan los 10 lugares');

-- ============================================================================ Importación (DB-L6, DB-L7, DB-L8, DB-M4, §8.3)
select tests.set_fx('j1', public.imports_create(tests.fx('store_a'), 'create_only', 'a.csv', array['handle', 'title', 'price'], '{}',
  jsonb_build_array(jsonb_build_object('row_number', 2, 'raw', '{}'::jsonb, 'errors', '[]'::jsonb, 'normalized',
    jsonb_build_object('handle', 'nuevo', 'option_names', null,
      -- Intento de inyección: el payload del cliente con el id de otro producto se ignora (DB-M4).
      'product', jsonb_build_object('title', 'Nuevo', 'id', (select id from public.products where slug = 'vivo')),
      'payload', jsonb_build_object('id', (select id from public.products where slug = 'vivo'), 'title', 'Sobrescrito'),
      'variants', '[{"row_number":2,"price":500}]'::jsonb)))));
select tests.logout();
select tests.login('inv');
select throws_ok(format($$ select public.imports_commit(%L, %L) $$, tests.fx('store_a'), tests.fx('j1')), '42501',
  'forbidden', 'quien no puede crear productos no confirma (ni hace fallar) el job de otro');
select tests.logout();
select is((select status from public.import_jobs where id = tests.fx('j1')), 'validated', 'el job sigue intacto');
select tests.login('owner');
select public.imports_commit(tests.fx('store_a'), tests.fx('j1'));
select tests.logout();
select tests.as_role('system_worker');
select system.import_commit(tests.fx('j1'));
select tests.logout();
select is((select title from public.products where slug = 'vivo'), 'Vivo', 'el producto ajeno no se sobrescribe');
select is((select title from public.products where store_id = tests.fx('store_a') and slug = 'nuevo'), 'Nuevo',
  'se crea el del handle');

-- Solo existencias: inventory_manager puede (GATE0 §8.3: imports.run "solo inventario").
select tests.login('inv');
select tests.set_fx('j2', public.imports_create(tests.fx('store_a'), 'update_existing', 'stock.csv',
  array['handle', 'sku', 'inventory_quantity'], '{}', jsonb_build_array(jsonb_build_object('row_number', 2, 'raw', '{}'::jsonb,
    'errors', '[]'::jsonb, 'normalized', jsonb_build_object('handle', 'vivo', 'product', '{}'::jsonb, 'option_names', null,
      'variants', '[{"row_number":2,"sku":"LIVE-1","quantity":12}]'::jsonb)))));
select is((select errors from public.import_job_rows where import_job_id = tests.fx('j2')), '[]'::jsonb,
  'inventory_manager: importar existencias sin tocar el catálogo');
select is((select needs from public.import_jobs where id = tests.fx('j2')), array['imports.run', 'inventory.adjust'],
  'el lote solo exige ajustar existencias');
select public.imports_commit(tests.fx('store_a'), tests.fx('j2'));
select tests.logout();
select tests.as_role('system_worker');
select system.import_commit(tests.fx('j2'));
select tests.logout();
select is((select l.on_hand from public.inventory_levels l join public.product_variants v on v.id = l.variant_id
            where v.sku = 'LIVE-1'), 12, 'existencias aplicadas');

-- Entrada robusta (DB-L7).
select tests.login('owner');
select tests.set_fx('j3', public.imports_create(tests.fx('store_a'), 'upsert', 'raro.csv', array['handle', 'status', 'categories'], '{}',
  jsonb_build_array(jsonb_build_object('row_number', 2, 'raw', '{}'::jsonb, 'errors', '[]'::jsonb, 'normalized',
    jsonb_build_object('handle', 'vivo', 'product', '{}'::jsonb, 'option_names', null, 'status', 'maybe',
      'categories', '[null]'::jsonb, 'variants', '[{"row_number":2,"sku":"LIVE-1"}]'::jsonb)))));
select is((select errors from public.import_job_rows where import_job_id = tests.fx('j3')),
  '["status: usa draft, active o archived", "categories: hasta 20 rutas de categoría"]'::jsonb,
  'estado y categorías inválidos: errores por fila, no excepciones');
select throws_ok(format($$ select public.imports_create(%L, 'upsert', 'x.csv', array['handle'], '{}', %L) $$, tests.fx('store_a'),
  jsonb_build_array(jsonb_build_object('row_number', 2, 'normalized', jsonb_build_object('handle', 'x', 'product', '{}'::jsonb,
    'variants', jsonb_build_array(jsonb_build_object('row_number', 2, 'pad', repeat('x', 300000))))))),
  'P0001', 'validation_failed', 'un plan desmesurado se rechaza');
select throws_ok(format($$ select public.imports_create(%L, 'upsert', 'x.csv', array['handle'], '{}', %L) $$, tests.fx('store_a'),
  jsonb_build_array(jsonb_build_object('row_number', 2), jsonb_build_object('row_number', 2))),
  'P0001', 'validation_failed', 'filas repetidas: validation_failed sin detalles internos');

-- Categorías por ruta (DB-L8).
select tests.set_fx('ofertas', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"ofertas"}'));
select tests.set_fx('Ofertas', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Ofertas","slug":"ofertas-2"}'));
select tests.logout();
select is(app.category_by_path(tests.fx('store_a'), 'Ofertas'), tests.fx('Ofertas'), 'mayúsculas exactas primero');
select tests.login('owner');
select throws_ok(format($$ select public.catalog_upsert_category(%L, '{"name":"Ropa > Niños"}') $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'una categoría no puede llamarse con los separadores de la importación');
select tests.logout();

-- ============================================================================ DB-L9 / DB-L10 / DB-L11
insert into public.customers (store_id, email, accepts_marketing, marketing_consent_at, marketing_consent_source)
values (tests.fx('store_a'), 'luis@compra.io', true, now(), 'checkout');
insert into public.carts (store_id, token_hash, customer_id, email, shipping_address)
select tests.fx('store_a'), sha256('carrito-luis'), id, email, '{"city":"CDMX"}' from public.customers where email = 'luis@compra.io';
select tests.login('owner');
select public.customers_update(tests.fx('store_a'), (select id from public.customers where email = 'luis@compra.io'),
                               null, null, null, null, false);
select is((select coalesce(marketing_consent_at::text, '') || coalesce(marketing_consent_source, '')
             from public.customers where email = 'luis@compra.io'), '', 'retirar el consentimiento borra fecha y origen');
select tests.set_fx('luis', (select id from public.customers where email = 'luis@compra.io'));
select public.customers_anonymize(tests.fx('store_a'), tests.fx('luis'), 'Derecho de cancelación');
select tests.logout();
select is((select count(*)::int from public.carts where store_id = tests.fx('store_a') and (email is not null or shipping_address is not null)),
  0, 'anonimizar limpia también sus carritos');
select tests.login('owner');
select ok((select bool_and(starts_with(x ->> 'action', 'import.') or starts_with(x ->> 'action', 'export.'))
             and count(*) > 0
             from jsonb_array_elements(public.audit_list(tests.fx('store_a'), 'datos', null, 50) -> 'items') x),
  'Actividad: área de importaciones y exportaciones');
select tests.logout();

select * from finish();
rollback;
