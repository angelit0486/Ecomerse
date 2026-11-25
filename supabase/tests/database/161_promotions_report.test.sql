-- =============================================================================
-- Reporte de promociones (ADR-070, fase 4): solo con la función de plan
-- promotion_reports y el permiso discounts.read; por promoción, pedidos pagados
-- del periodo con sus piezas, ahorro y venta (de la copia del pedido);
-- aislamiento entre dos tiendas; solo lectura.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select tests.create_user('owner_a', 'owner-a@a.io');
select tests.create_user('owner_b', 'owner-b@b.io');
select tests.create_user('viewer_a', 'viewer-a@a.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'viewer_a', 'viewer');
update public.stores set status = 'active', launched_at = now(), prices_include_tax = true, tax_rate_bps = 1600,
                         tax_applies_to_shipping = false
 where id in (tests.fx('store_a'), tests.fx('store_b'));

create function tests.gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'storefront_gateway', true);
  execute format('select to_jsonb(t.x) from (%s) t(x)', p_sql) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function tests.tok(p text) returns text language sql as $$ select rpad(p, 43, 'x') $$;
create function tests.addr() returns jsonb language sql as $$ select
  '{"recipient_name":"Ana Ruiz","line1":"Calle 1 #2","city":"Puebla","region":"Puebla","postal_code":"72000","country":"MX"}'::jsonb $$;
create function tests.vid(p_sku text) returns uuid language sql as $$
  select id from public.product_variants where sku = p_sku $$;
create function tests.add(p_sku text, p_qty int) returns jsonb language sql as $$
  select tests.gw(format('select storefront.cart_add_item(%L, %L, %L, %s)', tests.fx('store_a'), tests.tok('c1'),
                         tests.vid(p_sku), p_qty)) $$;
create function tests.input(p_code text) returns jsonb language sql as $$
  select jsonb_build_object('email', 'ana@example.io', 'customer_name', 'Ana Ruiz', 'shipping_address', tests.addr(),
                            'shipping_rate_id', tests.fx('flat'), 'payment_account_id', tests.fx('acct'),
                            'discount_code', p_code) $$;
create function tests.details(p_code text) returns jsonb language sql as $$
  select tests.gw(format('select storefront.cart_set_details(%L, %L, %L)', tests.fx('store_a'), tests.tok('c1'),
    jsonb_build_object('email', 'ana@example.io', 'shipping_address', tests.addr(), 'shipping_rate_id', tests.fx('flat'),
                       'discount_code', p_code)))
$$;
create function tests.place(p_expected bigint, p_idem text, p_code text) returns jsonb language sql as $$
  select tests.gw(format('select storefront.place_order(%L, %L, %L, %s, %L, %L)', tests.fx('store_a'), tests.tok('c1'),
    tests.input(p_code), p_expected, p_idem, sha256(convert_to('guest-' || p_idem, 'UTF8'))))
$$;
create function tests.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;
create function tests.detail(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v = pg_exception_detail;
  return sqlerrm || '/' || coalesce(v, '');
end $$;
create function tests.audits(p_action text, p_id uuid) returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from audit.audit_logs where action = p_action and entity_id = p_id $$;
grant execute on all functions in schema tests to storefront_gateway, authenticated;
create function tests.add_t(p_tok text, p_sku text, p_qty int) returns jsonb language sql as $$
  select tests.gw(format('select storefront.cart_add_item(%L, %L, %L, %s)', tests.fx('store_a'), tests.tok(p_tok),
                         tests.vid(p_sku), p_qty)) $$;
create function tests.buy(p_tok text) returns uuid language sql as $$
  select (tests.gw(format('select storefront.place_order(%L, %L, %L, %s, %L, %L)', tests.fx('store_a'), tests.tok(p_tok),
    tests.input(null),
    (tests.gw(format('select storefront.cart_set_details(%L, %L, %L)', tests.fx('store_a'), tests.tok(p_tok),
       jsonb_build_object('email', 'ana@example.io', 'shipping_address', tests.addr(), 'shipping_rate_id', tests.fx('flat'))))
       ->> 'total')::bigint,
    'idem-rep-' || p_tok || '-000000', sha256(convert_to('guest-rep-' || p_tok, 'UTF8')))) ->> 'order_id')::uuid $$;
create function tests.paid(p_order uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  set local session_replication_role = replica;
  update public.orders set paid_at = p_at, payment_status = 'paid', status = 'open' where id = p_order;
  set local session_replication_role = origin;
end $$;
create function tests.report(p_store text, p_from date, p_to date) returns jsonb language sql as $$
  select public.promotions_report(tests.fx(p_store), p_from, p_to) $$;
grant execute on all functions in schema tests to storefront_gateway, authenticated;

-- ---------------------------------------------------------------- catálogo y promociones
select tests.login('owner_a');
select tests.set_fx('p1', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Playera","options":[{"name":"Talla","values":["CH","G"]}],
    "variants":[{"options":{"Talla":"CH"},"price":10000,"sku":"P1-CH"},
                {"options":{"Talla":"G"},"price":12000,"sku":"P1-G"}]}') ->> 'id')::uuid);
select tests.set_fx('p2', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Gorra","variants":[{"price":5000,"sku":"P2"}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), p) from unnest(array[tests.fx('p1'), tests.fx('p2')]) p;
select public.inventory_adjust(tests.fx('store_a'), tests.vid(s), 'adjustment', 50, 'Inicial')
  from unnest(array['P1-CH', 'P1-G', 'P2']) s;
select tests.logout();

insert into public.shipping_zones (store_id, name, countries) values (tests.fx('store_a'), 'México', '{MX}')
returning tests.set_fx('zone', id);
insert into public.shipping_rates (store_id, zone_id, name, type, price) values
  (tests.fx('store_a'), tests.fx('zone'), 'Estándar', 'flat', 9900) returning tests.set_fx('flat', id);
insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
values (tests.fx('store_a'), 'manual', 'active', 'Transferencia', '{"instructions":"CLABE 0123"}')
returning tests.set_fx('acct', id);
insert into public.plan_entitlements (plan_id, key, value_int)
values ((select id from public.plans where key = 'test_plan'), 'max_active_promotions', 5);

select tests.login('owner_a');
select tests.set_fx('A', public.promotions_upsert(tests.fx('store_a'), jsonb_build_object(
  'name', 'Playeras 3x2', 'label', '3×2 en playeras', 'type', 'buy_n_pay_m', 'rules', '{"buy":3,"pay":2}'::jsonb,
  'scope', 'products', 'product_ids', jsonb_build_array(tests.fx('p1')))));
select tests.set_fx('S', public.promotions_upsert(tests.fx('store_a'),
  '{"name":"Segunda al 50","label":"2a al 50%","type":"nth_percent","rules":{"nth":2,"percent_bps":5000}}'));
select public.promotions_set_status(tests.fx('store_a'), tests.fx(k), 'active') from unnest(array['A', 'S']) k;
select tests.logout();

-- ---------------------------------------------------------------- pedidos
-- o1: Playera CH ×2 + G ×1 (3×2: −$100 en la línea CH). o2: Gorra ×2 (2a al 50%: −$25).
-- o3: Gorra ×2 sin pagar (no cuenta). o4: pagado hace 40 días (fuera del periodo).
select tests.add_t('r1', 'P1-CH', 2);
select tests.add_t('r1', 'P1-G', 1);
select tests.set_fx('o1', tests.buy('r1'));
select tests.add_t('r2', 'P2', 2);
select tests.set_fx('o2', tests.buy('r2'));
select tests.add_t('r3', 'P2', 2);
select tests.set_fx('o3', tests.buy('r3'));
select tests.add_t('r4', 'P2', 2);
select tests.set_fx('o4', tests.buy('r4'));
select tests.paid(tests.fx('o1'), now());
select tests.paid(tests.fx('o2'), now());
select tests.paid(tests.fx('o4'), now() - interval '40 days');

-- ---------------------------------------------------------------- función del plan
select tests.login('owner_a');
select is(tests.detail(format('select tests.report(%L, null, null)', 'store_a')), 'not_found/feature',
          'sin «Reporte de promociones» en el plan no hay reporte');
select tests.logout();

insert into public.organization_entitlement_overrides (organization_id, key, value_bool, reason)
values ((select organization_id from public.stores where id = tests.fx('store_a')), 'promotion_reports', true,
        'Prueba pgTAP del reporte');

select tests.login('owner_a');
select is(tests.report('store_a', null, null) -> 'rows',
          jsonb_build_array(
            jsonb_build_object('promotion_id', tests.fx('A'), 'name', 'Playeras 3x2', 'label', '3×2 en playeras',
                               'type', 'buy_n_pay_m', 'status', 'active', 'orders', 1, 'units', 2,
                               'discount', 10000, 'sales', 10000),
            jsonb_build_object('promotion_id', tests.fx('S'), 'name', 'Segunda al 50', 'label', '2a al 50%',
                               'type', 'nth_percent', 'status', 'active', 'orders', 1, 'units', 2,
                               'discount', 2500, 'sales', 7500)),
          'por promoción: pedidos, piezas, ahorro y venta (los últimos 30 días)');
select is(tests.report('store_a', null, null) -> 'totals',
          '{"orders": 2, "discount": 12500, "sales": 17500, "paid_orders": 2}'::jsonb,
          'y los totales: el pedido sin pagar y el de hace 40 días no cuentan');
select is((tests.report('store_a', (current_date - 60), current_date) -> 'totals' ->> 'orders')::int, 3,
          'con un periodo más largo entra el de hace 40 días');
select is(tests.report('store_a', current_date + 1, current_date + 2) -> 'rows', '[]'::jsonb,
          'un periodo sin pedidos viene vacío');
select is(tests.detail(format('select tests.report(%L, %L, %L)', 'store_a', current_date, current_date - 1)),
          'validation_failed/range', 'el periodo al revés se rechaza');
select is(tests.detail(format('select tests.report(%L, %L, %L)', 'store_a', current_date - 400, current_date)),
          'validation_failed/range', 'más de un año se rechaza');

-- La copia manda: renombrar la promoción cambia el nombre, no los números.
select public.promotions_upsert(tests.fx('store_a'), jsonb_build_object('id', tests.fx('A'), 'name', 'Playeras (dic)',
  'label', '3×2 en playeras', 'type', 'buy_n_pay_m', 'rules', '{"buy":3,"pay":2}'::jsonb, 'scope', 'products',
  'product_ids', jsonb_build_array(tests.fx('p1'))));
select is(tests.report('store_a', null, null) -> 'rows' -> 0 ->> 'name', 'Playeras (dic)', 'nombre de hoy');
select is((tests.report('store_a', null, null) -> 'rows' -> 0 ->> 'discount')::bigint, 10000::bigint,
          'con el ahorro que guardó el pedido');
select tests.logout();

-- ---------------------------------------------------------------- permisos y aislamiento
select tests.login('viewer_a');
select is((tests.report('store_a', null, null) -> 'totals' ->> 'discount')::bigint, 12500::bigint,
          'quien puede ver descuentos ve el reporte');
select tests.logout();
select tests.login('owner_b');
select isnt(tests.err(format('select tests.report(%L, null, null)', 'store_a')), 'ok',
            'la otra tienda no ve el reporte de esta');
select is(tests.detail(format('select tests.report(%L, null, null)', 'store_b')), 'not_found/feature',
          'ni tiene el reporte sin la función en su plan');
select tests.logout();
select isnt(tests.err(format('select tests.report(%L, null, null)', 'store_a')), 'ok', 'sin sesión no hay reporte');

select is((select provolatile from pg_proc where oid = 'public.promotions_report(uuid, date, date)'::regprocedure),
          's', 'el reporte es solo lectura (stable)');
select is(has_function_privilege('anon', 'public.promotions_report(uuid, date, date)', 'execute'), false,
          'anon no lo llama');

select is(public.app_schema_version(), '20261125000400', 'versión de la base');

select * from finish();
rollback;
