-- =============================================================================
-- Fase R · R-T03 — La ficha sanitaria y las leyendas en la tienda pública, como
-- storefront_gateway: solo lo publicado, solo la leyenda (sin la etiqueta
-- interna), por lugar (ficha, carrito, checkout) y sin cruzar tiendas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('padmin', 'admin@plataforma.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.make_platform_staff('padmin', 'platform_admin');
update public.stores set status = 'active', launched_at = now() where id in (tests.fx('store_a'), tests.fx('store_b'));
select tests.set_fx('profile', (select id from public.compliance_profiles
                                 where country = 'MX' and category_key = 'dietary_supplement'));
select tests.retire_compliance_rules(tests.fx('profile'));

create function pg_temp.gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'storefront_gateway', true);
  execute format('select to_jsonb(t.x) from (%s) t(x)', p_sql) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function pg_temp.tok(p text) returns text language sql as $$ select rpad(p, 43, 'x') $$;

-- Reglas revisadas (texto de prueba; el real lo da el asesor) y un suplemento publicado.
select tests.login('padmin');
select public.platform_compliance_rule_save(tests.fx('profile'),
  '{"kind":"required_legend","key":"l_ficha","label":"Interna ficha","body":"LEYENDA FICHA","placements":["product_page"]}');
select public.platform_compliance_rule_save(tests.fx('profile'),
  '{"kind":"required_legend","key":"l_compra","label":"Interna compra","body":"LEYENDA COMPRA","placements":["cart","checkout"]}');
select public.platform_compliance_profile_set_status(tests.fx('profile'), 'active', 'Asesoría de prueba', null);
select tests.logout();
select tests.login('owner');
select public.compliance_set_store_category(tests.fx('store_a'), 'dietary_supplement', true);
select tests.set_fx('omega', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Omega 3","slug":"omega-3","variants":[{"sku":"OMG-1","price":29900}]}') ->> 'id')::uuid);
select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('omega'), 'dietary_supplement',
  '{"ingredients":"Aceite de pescado","nutrition":[{"name":"Omega 3","amount":"1000","unit":"mg"}]}');
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('omega'));
select tests.set_fx('borrador', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Borrador","slug":"borrador","variants":[{"price":100}]}') ->> 'id')::uuid);
select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('borrador'), 'dietary_supplement', '{}');
select tests.set_fx('shaker', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Shaker","slug":"shaker","variants":[{"sku":"SHK-1","price":15000}]}') ->> 'id')::uuid);
select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('shaker'), null, null);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('shaker'));
select tests.logout();
select tests.login('owner_b');
select public.catalog_publish_product(tests.fx('store_b'), (public.catalog_upsert_product(tests.fx('store_b'),
  '{"title":"Omega B","slug":"omega-3","variants":[{"price":100}]}') ->> 'id')::uuid);
select tests.logout();

-- Ficha del producto.
select is(pg_temp.gw(format('select storefront.get_product_regulatory(%L, %L)', tests.fx('store_a'), 'omega-3')),
  '{"category":"dietary_supplement","category_name":"Suplemento alimenticio",
    "data":{"ingredients":"Aceite de pescado","nutrition":[{"name":"Omega 3","amount":"1000","unit":"mg"}]},
    "legends":[{"key":"l_ficha","text":"LEYENDA FICHA"}]}'::jsonb,
  'la ficha publicada con su leyenda de ficha (sin la etiqueta interna)');
select is(pg_temp.gw(format('select storefront.get_product_regulatory(%L, %L)', tests.fx('store_a'), 'borrador')),
  null::jsonb, 'un borrador no se publica');
select is(pg_temp.gw(format('select storefront.get_product_regulatory(%L, %L)', tests.fx('store_a'), 'shaker')),
  null::jsonb, 'un producto no regulado no lleva ficha');
select is(pg_temp.gw(format('select storefront.get_product_regulatory(%L, %L)', tests.fx('store_b'), 'omega-3')),
  null::jsonb, 'el mismo slug en otra tienda no trae la ficha ajena');

-- Carrito y checkout.
select pg_temp.gw(format('select storefront.cart_add_item(%L, %L, %L, 1)', tests.fx('store_a'), pg_temp.tok('c1'),
  (select id from public.product_variants where sku = 'OMG-1')));
select pg_temp.gw(format('select storefront.cart_add_item(%L, %L, %L, 2)', tests.fx('store_a'), pg_temp.tok('c2'),
  (select id from public.product_variants where sku = 'SHK-1')));
select is(pg_temp.gw(format('select storefront.cart_legends(%L, %L, %L)', tests.fx('store_a'), pg_temp.tok('c1'), 'cart')),
  '[{"key":"l_compra","text":"LEYENDA COMPRA"}]'::jsonb, 'el carrito con un suplemento muestra la leyenda de compra');
select is(pg_temp.gw(format('select storefront.cart_legends(%L, %L, %L)', tests.fx('store_a'), pg_temp.tok('c1'), 'checkout')),
  '[{"key":"l_compra","text":"LEYENDA COMPRA"}]'::jsonb, 'y el checkout también');
select is(pg_temp.gw(format('select storefront.cart_legends(%L, %L, %L)', tests.fx('store_a'), pg_temp.tok('c2'), 'cart')),
  '[]'::jsonb, 'un carrito sin productos regulados no muestra leyendas');
select is(pg_temp.gw(format('select storefront.cart_legends(%L, %L, %L)', tests.fx('store_a'), pg_temp.tok('nada'), 'cart')),
  '[]'::jsonb, 'un token sin carrito tampoco');
select is(pg_temp.gw(format('select storefront.cart_legends(%L, %L, %L)', tests.fx('store_b'), pg_temp.tok('c1'), 'cart')),
  '[]'::jsonb, 'el carrito de una tienda no se lee desde otra');
select throws_ok(format('select pg_temp.gw(%L)', format('select storefront.cart_legends(%L, %L, %L)',
  tests.fx('store_a'), pg_temp.tok('c1'), 'product_page')), 'P0001', 'validation_failed',
  'solo carrito o checkout');

-- Solo lo vigente: una regla retirada o un perfil que deja de estar revisado no se muestran.
select tests.set_fx('rule_ficha', (select id from public.compliance_rules
                                     where profile_id = tests.fx('profile') and key = 'l_ficha'));
select tests.login('padmin');
select public.platform_compliance_rule_retire(tests.fx('rule_ficha'));
select tests.logout();
select is(pg_temp.gw(format('select storefront.get_product_regulatory(%L, %L)', tests.fx('store_a'), 'omega-3'))
            -> 'legends',
  '[]'::jsonb, 'una leyenda retirada deja de mostrarse');
select tests.login('padmin');
select public.platform_compliance_profile_set_status(tests.fx('profile'), 'suspended', null, 'Revisión de prueba');
select tests.logout();
select is(pg_temp.gw(format('select storefront.cart_legends(%L, %L, %L)', tests.fx('store_a'), pg_temp.tok('c1'), 'cart')),
  '[]'::jsonb, 'con el perfil suspendido no se muestran sus leyendas');

select * from finish();
rollback;
