-- =============================================================================
-- Rediseño A+B · storefront.card_variants: la variante que «Agregar» manda al
-- carrito desde la tarjeta. Solo productos simples publicados de la misma tienda;
-- con opciones, null (se elige en la ficha); nada de otras tiendas ni borradores.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now() where id in (tests.fx('store_a'), tests.fx('store_b'));

select tests.login('owner');
select tests.set_fx('simple', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Creatina","slug":"creatina","variants":[{"price":49900,"sku":"CRE-1"}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('simple'));
select tests.set_fx('flavors', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Proteína","slug":"proteina","options":[{"name":"Sabor","values":["Vainilla","Chocolate"]}],
    "variants":[{"price":89900,"sku":"PRO-V","options":{"Sabor":"Vainilla"}},
                {"price":89900,"sku":"PRO-C","options":{"Sabor":"Chocolate"}}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('flavors'));
select tests.set_fx('draft', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Borrador","slug":"borrador","variants":[{"price":10000,"sku":"BOR-1"}]}') ->> 'id')::uuid);
select tests.logout();

select tests.set_fx('simple_variant', (select id from public.product_variants
                                         where store_id = tests.fx('store_a') and sku = 'CRE-1'));

select is(storefront.card_variants(tests.fx('store_a'), array[tests.fx('simple')]) ->> tests.fx('simple')::text,
          tests.fx('simple_variant')::text, 'producto simple: su variante se agrega desde la tarjeta');
select ok(storefront.card_variants(tests.fx('store_a'), array[tests.fx('flavors')]) ? tests.fx('flavors')::text
          and storefront.card_variants(tests.fx('store_a'), array[tests.fx('flavors')]) -> tests.fx('flavors')::text
              = 'null'::jsonb,
          'con opciones: null, el comprador elige en la ficha');
select ok(not storefront.card_variants(tests.fx('store_a'), array[tests.fx('draft')]) ? tests.fx('draft')::text,
          'un borrador no aparece');
select is(storefront.card_variants(tests.fx('store_b'), array[tests.fx('simple'), tests.fx('flavors')]), '{}'::jsonb,
          'otra tienda no obtiene variantes de esta');
select is(storefront.card_variants(tests.fx('store_a'), '{}'::uuid[]), '{}'::jsonb, 'lista vacía: objeto vacío');

-- Una variante inactiva no se agrega.
update public.product_variants set status = 'inactive' where id = tests.fx('simple_variant');
select is(storefront.card_variants(tests.fx('store_a'), array[tests.fx('simple')]) -> tests.fx('simple')::text,
          'null'::jsonb, 'variante inactiva: nada que agregar desde la tarjeta');
update public.product_variants set status = 'active' where id = tests.fx('simple_variant');

-- Tienda que no se puede leer en público: nada.
update public.stores set status = 'suspended' where id = tests.fx('store_a');
select is(storefront.card_variants(tests.fx('store_a'), array[tests.fx('simple')]), '{}'::jsonb,
          'tienda no visible: nada');
update public.stores set status = 'active' where id = tests.fx('store_a');

select ok(not has_function_privilege('anon', 'storefront.card_variants(uuid, uuid[])', 'execute')
          and not has_function_privilege('authenticated', 'storefront.card_variants(uuid, uuid[])', 'execute')
          and has_function_privilege('storefront_gateway', 'storefront.card_variants(uuid, uuid[])', 'execute'),
          'solo storefront_gateway la ejecuta');

select * from finish();
rollback;
