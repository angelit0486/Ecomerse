-- =============================================================================
-- Fase 9 · F9-T03 — Ficha insignia (F9-DESIGN §9): fecha de publicación en la
-- ficha, «Más para tu objetivo» (atributos filtrables en común, luego
-- categoría; sin el propio, sin agotados, sin borradores, sin otra tienda) y el
-- umbral real de envío gratis para el país de la tienda.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
update public.stores set status = 'active', launched_at = now() where id in (tests.fx('store_a'), tests.fx('store_b'));

create function pg_temp.gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'storefront_gateway', true);
  execute p_sql into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function pg_temp.related(p_slug text, p_limit integer default 8) returns text[] language sql as $$
  select coalesce(array_agg(i ->> 'slug' order by o), '{}')
    from jsonb_array_elements(pg_temp.gw(format('select storefront.related_products(%L, %L, %s)',
                                                 tests.fx('store_a'), p_slug, p_limit))) with ordinality x(i, o)
$$;
grant execute on all functions in schema tests to authenticated;

select tests.login('owner');
select tests.set_fx('objetivo', public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Objetivo","values":[{"label":"Energía"},{"label":"Fuerza"}]}'));
select tests.set_fx('interno', public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Proveedor","is_filterable":false,"values":[{"label":"Bodega norte"}]}'));
create function pg_temp.value(p_attr text, p_key text) returns uuid language sql as $$
  select id from public.attribute_values where attribute_id = tests.fx(p_attr) and key = p_key
$$;
create function pg_temp.product(p_slug text, p_publish boolean default true) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object('title', initcap(p_slug), 'slug', p_slug,
          'variants', '[{"price":19900}]'::jsonb)) ->> 'id')::uuid;
  if p_publish then perform public.catalog_publish_product(tests.fx('store_a'), v); end if;
  return v;
end $$;
select tests.set_fx('cafeina', pg_temp.product('cafeina'));
select tests.set_fx('preentreno', pg_temp.product('preentreno'));   -- energía + fuerza
select tests.set_fx('creatina', pg_temp.product('creatina'));       -- fuerza
select tests.set_fx('guarana', pg_temp.product('guarana'));         -- energía, agotado
select tests.set_fx('borrador', pg_temp.product('borrador', false)); -- energía, sin publicar
select tests.set_fx('omega', pg_temp.product('omega'));             -- misma categoría, sin objetivo
select tests.set_fx('proteina', pg_temp.product('proteina'));       -- solo el atributo no filtrable
select tests.set_fx('vitamina', pg_temp.product('vitamina'));       -- nada en común
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('cafeina'),
  array[pg_temp.value('objetivo', 'energia'), pg_temp.value('interno', 'bodega-norte')]);
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('preentreno'),
  array[pg_temp.value('objetivo', 'energia'), pg_temp.value('objetivo', 'fuerza')]);
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('creatina'), array[pg_temp.value('objetivo', 'fuerza')]);
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('guarana'), array[pg_temp.value('objetivo', 'energia')]);
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('borrador'), array[pg_temp.value('objetivo', 'energia')]);
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('proteina'), array[pg_temp.value('interno', 'bodega-norte')]);
select tests.logout();

-- Existencias: todos disponibles salvo el guaraná (se controla y no hay piezas).
update public.product_variants set track_inventory = false where store_id = tests.fx('store_a');
update public.product_variants set track_inventory = true, inventory_policy = 'deny' where product_id = tests.fx('guarana');
-- Categoría compartida por la cafeína y el omega; otra oculta, compartida con la vitamina.
insert into public.categories (store_id, name, slug, path, is_visible) values
  (tests.fx('store_a'), 'Salud', 'salud', 'salud', true),
  (tests.fx('store_a'), 'Oculta', 'oculta', 'oculta', false);
insert into public.product_categories (store_id, product_id, category_id, is_primary)
select tests.fx('store_a'), p.id, c.id, true
  from (values ('cafeina', 'salud'), ('omega', 'salud'), ('vitamina', 'oculta'), ('cafeina', 'oculta')) x(prod, cat)
  join public.products p on p.store_id = tests.fx('store_a') and p.slug = x.prod
  join public.categories c on c.store_id = tests.fx('store_a') and c.slug = x.cat
on conflict do nothing;
-- Más ventas desempatan entre iguales.
update public.products set sales_count = 5 where id = tests.fx('creatina');

-- 1. Ficha.
select ok((pg_temp.gw(format('select storefront.get_product(%L, ''cafeina'')', tests.fx('store_a'))) ->> 'published_at')
            is not null, 'la ficha incluye la fecha de publicación (insignia «Nuevo»)');

-- 2. Relacionados.
select is(pg_temp.related('cafeina'), array['preentreno', 'omega'],
          'cafeína: primero quien comparte objetivo, luego la misma categoría; sin agotados ni borradores');
select ok(not ('cafeina' = any (pg_temp.related('cafeina'))), 'nunca el propio producto');
select ok(not ('guarana' = any (pg_temp.related('cafeina'))), 'nunca un agotado');
select ok(not ('borrador' = any (pg_temp.related('cafeina'))), 'nunca un producto sin publicar');
select ok(not ('proteina' = any (pg_temp.related('cafeina'))), 'un atributo no filtrable no cuenta');
select ok(not ('vitamina' = any (pg_temp.related('cafeina'))), 'una categoría oculta no cuenta');
select is(pg_temp.related('preentreno'), array['creatina', 'cafeina'],
          'preentreno: comparte un valor con cada uno; desempata por ventas solo entre iguales');
select is(pg_temp.related('preentreno', 1), array['creatina'], 'respeta el límite');
select is(pg_temp.related('vitamina'), '{}'::text[], 'sin nada en común no se recomienda nada');
select is(pg_temp.related('no-existe'), '{}'::text[], 'un slug inexistente devuelve una lista vacía');
select is(pg_temp.gw(format('select storefront.related_products(%L, ''cafeina'', 8)', tests.fx('store_b'))), '[]'::jsonb,
          'otra tienda no ve los productos de esta');
select ok(pg_temp.gw(format('select storefront.related_products(%L, ''cafeina'', 8)', tests.fx('store_a'))) -> 0
            ?& array['id', 'slug', 'title', 'min_price', 'compare_at_price', 'availability', 'image', 'published_at'],
          'cada relacionado trae lo que pinta la tarjeta');

-- 3. Envío gratis.
select is(pg_temp.gw(format('select storefront.shipping_promo(%L)', tests.fx('store_a'))), null,
          'sin tarifa «gratis desde» no se promete envío gratis');
insert into public.shipping_zones (store_id, name, countries, regions) values
  (tests.fx('store_a'), 'Centro', (select array[country::text] from public.stores where id = tests.fx('store_a')), '{CDMX}')
  returning tests.set_fx('z_centro', id);
insert into public.shipping_zones (store_id, name, countries) values
  (tests.fx('store_a'), 'Nacional', (select array[country::text] from public.stores where id = tests.fx('store_a')))
  returning tests.set_fx('z_nac', id);
insert into public.shipping_zones (store_id, name, countries) values
  (tests.fx('store_a'), 'Extranjero', '{ZZ}') returning tests.set_fx('z_ext', id);
insert into public.shipping_rates (store_id, zone_id, name, type, price, free_over_subtotal, is_active) values
  (tests.fx('store_a'), tests.fx('z_ext'), 'Fuera', 'free_over', 9900, 100, true),
  (tests.fx('store_a'), tests.fx('z_nac'), 'Inactiva', 'free_over', 9900, 500, false),
  (tests.fx('store_a'), tests.fx('z_centro'), 'Local', 'free_over', 9900, 49900, true),
  (tests.fx('store_a'), tests.fx('z_nac'), 'Nacional', 'free_over', 9900, 99900, true);
select is(pg_temp.gw(format('select storefront.shipping_promo(%L)', tests.fx('store_a'))),
          '{"free_over":49900,"conditional":true}'::jsonb,
          'el menor umbral activo del país de la tienda; marcado condicional si depende de la región');
insert into public.shipping_rates (store_id, zone_id, name, type, price, free_over_subtotal) values
  (tests.fx('store_a'), tests.fx('z_nac'), 'Nacional promo', 'free_over', 9900, 49900);
select is(pg_temp.gw(format('select storefront.shipping_promo(%L)', tests.fx('store_a'))),
          '{"free_over":49900,"conditional":false}'::jsonb,
          'con el mismo umbral se prefiere la tarifa sin condiciones');

select * from finish();
rollback;
