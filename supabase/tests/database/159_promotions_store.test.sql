-- =============================================================================
-- Promociones (ADR-070) en la tienda: alta y estados por RPC (permisos y
-- bitácora), aislamiento entre dos tiendas, límite del plan al activar, cálculo
-- del carrito y pedido con su copia inmutable; cupón que no se combina.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

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

-- ---------------------------------------------------------------- catálogo
select tests.login('owner_a');
select tests.set_fx('p1', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Playera","options":[{"name":"Talla","values":["CH","G"]}],
    "variants":[{"options":{"Talla":"CH"},"price":10000,"sku":"P1-CH"},
                {"options":{"Talla":"G"},"price":12000,"sku":"P1-G"}]}') ->> 'id')::uuid);
select tests.set_fx('p2', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Gorra","variants":[{"price":5000,"sku":"P2"}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('p1'));
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('p2'));
select public.inventory_adjust(tests.fx('store_a'), tests.vid(s), 'adjustment', 50, 'Inicial')
  from unnest(array['P1-CH', 'P1-G', 'P2']) s;
select tests.logout();
select tests.login('owner_b');
select tests.set_fx('pb', (public.catalog_upsert_product(tests.fx('store_b'),
  '{"title":"Otra","variants":[{"price":100,"sku":"PB"}]}') ->> 'id')::uuid);
select tests.logout();

insert into public.shipping_zones (store_id, name, countries) values (tests.fx('store_a'), 'México', '{MX}')
returning tests.set_fx('zone', id);
insert into public.shipping_rates (store_id, zone_id, name, type, price) values
  (tests.fx('store_a'), tests.fx('zone'), 'Estándar', 'flat', 9900) returning tests.set_fx('flat', id);
insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
values (tests.fx('store_a'), 'manual', 'active', 'Transferencia', '{"instructions":"CLABE 0123"}')
returning tests.set_fx('acct', id);

-- ---------------------------------------------------------------- alta por RPC
select tests.login('viewer_a');
select is(tests.err(format($q$select public.promotions_upsert(%L, '{"name":"3x2","label":"3×2","type":"buy_n_pay_m","rules":{"buy":3,"pay":2}}')$q$,
                           tests.fx('store_a'))) <> 'ok', true, 'quien solo puede ver no crea promociones');
select is((public.promotions_preview(tests.fx('store_a'), '{"type":"buy_n_pay_m","rules":{"buy":3,"pay":2}}',
                                     '[{"unit_price":10000,"quantity":3}]') ->> 'promotion_total')::bigint,
          10000::bigint, 'pero sí ve la vista previa (Lleva 3, paga 2)');
select tests.logout();

select tests.login('owner_a');
select tests.set_fx('promo', public.promotions_upsert(tests.fx('store_a'), jsonb_build_object(
  'name', 'Playeras 3x2', 'label', '3×2 en playeras', 'type', 'buy_n_pay_m', 'rules', '{"buy":3,"pay":2}'::jsonb,
  'scope', 'products', 'product_ids', jsonb_build_array(tests.fx('p1')))));
select is((select status from public.promotions where id = tests.fx('promo')), 'draft', 'se crea como borrador');
select is(tests.audits('promotion.saved', tests.fx('promo')),
          1, 'el alta queda en la bitácora');
select is(tests.detail(format($q$select public.promotions_upsert(%L, '{"name":"x","label":"x","type":"buy_n_pay_m","rules":{"buy":2,"pay":2}}')$q$,
                              tests.fx('store_a'))), 'validation_failed/rules', 'reglas inválidas se rechazan');
select is(tests.detail(format($q$select public.promotions_upsert(%L, %L)$q$, tests.fx('store_a'),
                              jsonb_build_object('name', 'x', 'label', 'x', 'type', 'buy_n_pay_m', 'rules', '{"buy":3,"pay":2}'::jsonb,
                                                 'scope', 'products', 'product_ids', jsonb_build_array(tests.fx('pb'))))),
          'validation_failed/targets', 'no se puede apuntar a un producto de otra tienda');
select is(tests.detail(format($q$select public.promotions_set_status(%L, %L, 'active')$q$, tests.fx('store_a'),
                              tests.fx('promo'))) like 'limit_reached%', true,
          'sin el valor en el plan no se puede activar (cerrado por omisión)');
select is(tests.err('insert into public.promotions (store_id, name, label, type, rules) values (' ||
                    quote_literal(tests.fx('store_a')) || ', ''x'', ''x'', ''buy_n_pay_m'', ''{"buy":3,"pay":2}'')') <> 'ok',
          true, 'no se escribe directo en la tabla');
select tests.logout();

insert into public.plan_entitlements (plan_id, key, value_int)
values ((select id from public.plans where key = 'test_plan'), 'max_active_promotions', 2);

select tests.login('owner_a');
select lives_ok(format($q$select public.promotions_set_status(%L, %L, 'active')$q$, tests.fx('store_a'), tests.fx('promo')),
                'con el plan configurado se activa');
select is(tests.audits('promotion.status_changed', tests.fx('promo')), 1, 'y queda en la bitácora');
select tests.logout();

-- ---------------------------------------------------------------- aislamiento
select tests.login('owner_b');
select is((select count(*)::int from public.promotions), 0, 'la otra tienda no ve las promociones');
select is((select count(*)::int from public.promotion_targets), 0, 'ni a qué productos aplican');
select is(tests.err(format($q$select public.promotions_set_status(%L, %L, 'paused')$q$, tests.fx('store_a'),
                           tests.fx('promo'))) <> 'ok', true, 'ni puede pausarlas');
select is(tests.detail(format($q$select public.promotions_set_status(%L, %L, 'paused')$q$, tests.fx('store_b'),
                              tests.fx('promo'))), 'not_found/promotion', 'ni desde su propia tienda');
-- Límite del plan: 2 activas por organización.
select tests.set_fx('b1', public.promotions_upsert(tests.fx('store_b'), '{"name":"b1","label":"b1","type":"buy_n_pay_m","rules":{"buy":3,"pay":2}}'));
select tests.set_fx('b2', public.promotions_upsert(tests.fx('store_b'), '{"name":"b2","label":"b2","type":"buy_n_pay_m","rules":{"buy":2,"pay":1}}'));
select tests.set_fx('b3', public.promotions_upsert(tests.fx('store_b'), '{"name":"b3","label":"b3","type":"nth_percent","rules":{"nth":2,"percent_bps":5000}}'));
select public.promotions_set_status(tests.fx('store_b'), tests.fx('b1'), 'active');
select public.promotions_set_status(tests.fx('store_b'), tests.fx('b2'), 'active');
select is(tests.detail(format($q$select public.promotions_set_status(%L, %L, 'active')$q$, tests.fx('store_b'),
                              tests.fx('b3'))) like 'limit_reached%', true, 'la tercera activa excede el plan');
select public.promotions_set_status(tests.fx('store_b'), tests.fx('b1'), 'paused');
select lives_ok(format($q$select public.promotions_set_status(%L, %L, 'active')$q$, tests.fx('store_b'), tests.fx('b3')),
                'al pausar una, otra se puede activar');
select public.promotions_set_status(tests.fx('store_b'), tests.fx('b1'), 'archived');
select is(tests.detail(format($q$select public.promotions_set_status(%L, %L, 'active')$q$, tests.fx('store_b'),
                              tests.fx('b1'))), 'not_found/promotion', 'archivada ya no se reactiva');
select tests.logout();
select is(tests.err(format('update public.promotions set status = ''active'' where id = %L', tests.fx('b1'))),
          'promotion_archived', 'ni con escritura privilegiada');

-- ---------------------------------------------------------------- carrito y pedido
-- Playera CH $100 ×2 + G $120 ×1 (presentaciones juntas: 3×2, gratis la de $100)
-- + Gorra $50 ×2 (sin promoción). Cupón 10% que no se combina: solo la gorra.
select tests.login('owner_a');
select public.discounts_upsert(tests.fx('store_a'), '{"code":"DIEZ","type":"percentage","value":1000}');
select tests.logout();
select tests.add('P1-CH', 2);
select tests.add('P1-G', 1);
select tests.add('P2', 2);

select is((select array[(v ->> 'promotion_total')::bigint, (v ->> 'coupon_total')::bigint, (v ->> 'total')::bigint]
             from (select tests.details('DIEZ') v) t),
          array[10000, 1000, 40900]::bigint[],
          'carrito: 3×2 en playeras ($100) + 10% solo en gorras ($10) + envío');
select is((select (l ->> 'promotion_allocation')::bigint from jsonb_array_elements(tests.details('DIEZ') -> 'lines') l
            where (l ->> 'variant_id')::uuid = tests.vid('P1-CH')), 10000::bigint,
          'el descuento cae en la presentación más barata');
select is(tests.details('DIEZ') -> 'promotions' -> 0 ->> 'label', '3×2 en playeras', 'el carrito dice qué promoción aplicó');

select throws_ok(format('select tests.place(%s, %L, %L)', 50900, 'idem-promo-00000001', 'DIEZ'),
                 'P0001', 'price_changed', 'un total sin la promoción se rechaza');
select tests.set_fx('o', (tests.place(40900, 'idem-promo-00000002', 'DIEZ') ->> 'order_id')::uuid);
select is((select array[subtotal, promotion_total, discount_total, total] from public.orders where id = tests.fx('o')),
          array[42000, 10000, 11000, 40900]::bigint[], 'el pedido guarda promoción y cupón por separado');
select is((select snapshot_version::int from public.orders where id = tests.fx('o')), 2, 'con versión de copia 2');
select is((select (discount_snapshot ->> 'amount')::bigint from public.orders where id = tests.fx('o')), 1000::bigint,
          'la copia del cupón guarda solo lo del cupón');
select is((select sum(promotion_allocation)::bigint from public.order_items where order_id = tests.fx('o')), 10000::bigint,
          'las partidas suman la promoción');
select is((select string_agg(snapshot ->> 'label' || ':' || units || ':' || amount, ',')
             from public.order_promotions where order_id = tests.fx('o')), '3×2 en playeras:1:10000',
          'y el pedido guarda la copia de la regla');
select is(tests.err(format('update public.order_promotions set amount = 1 where order_id = %L', tests.fx('o'))) <> 'ok',
          true, 'la copia no se modifica');

-- Una vez usada, la regla queda fija (los pedidos la citan).
select is(tests.err(format('update public.promotions set rules = ''{"buy":2,"pay":1}'' where id = %L', tests.fx('promo'))),
          'promotion_locked', 'la regla usada no cambia');
select tests.login('owner_a');
select is(tests.detail(format($q$select public.promotions_upsert(%L, %L)$q$, tests.fx('store_a'),
                              jsonb_build_object('id', tests.fx('promo'), 'name', 'x', 'label', 'x', 'type', 'buy_n_pay_m',
                                                 'rules', '{"buy":3,"pay":2}'::jsonb, 'scope', 'store'))),
          'validation_failed/promotion_locked', 'ni su alcance');
select lives_ok(format($q$select public.promotions_upsert(%L, %L)$q$, tests.fx('store_a'),
                       jsonb_build_object('id', tests.fx('promo'), 'name', 'Playeras 3x2 (nov)', 'label', '3×2 playeras',
                                          'type', 'buy_n_pay_m', 'rules', '{"buy":3,"pay":2}'::jsonb, 'scope', 'products',
                                          'product_ids', jsonb_build_array(tests.fx('p1')))),
                'el nombre y la leyenda sí');
select is((select promotion_total from public.orders where id = tests.fx('o')), 10000::bigint,
          'el dueño ve el total de promoción del pedido');
select is((select count(*)::int from public.order_promotions where order_id = tests.fx('o')), 1,
          'y su detalle');
select tests.logout();
select tests.login('owner_b');
select is((select count(*)::int from public.order_promotions), 0, 'la otra tienda no ve el detalle de promociones');
select tests.logout();

select is(public.app_schema_version(), '20261125000300', 'versión de la base');

select * from finish();
rollback;
