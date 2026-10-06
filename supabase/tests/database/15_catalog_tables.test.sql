-- =============================================================================
-- Fase 3 · Invariantes del catálogo (GATE0 §13, §14.2, §23): FK compuestas,
-- unicidades, firma de variantes, árbol de categorías, derivados, límites y RLS.
-- Las inserciones se hacen como postgres (omitiendo RLS) para probar el motor.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('cat', 'cat@a.io');
select tests.create_user('view', 'view@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'cat', 'catalog_manager');
select tests.add_store_member('a', 'view', 'viewer');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function tests.product(p_store text, p_slug text, p_title text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  insert into public.products (store_id, title, slug) values (tests.fx('store_' || p_store), coalesce(p_title, p_slug), p_slug)
  returning id into v;
  return tests.set_fx('p_' || p_slug, v);
end $$;
create function tests.variant(p_product text, p_price bigint, p_sku text default null, p_sig text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  insert into public.product_variants (store_id, product_id, price, sku, option_signature)
  select p.store_id, p.id, p_price, p_sku, p_sig from public.products p where p.id = tests.fx('p_' || p_product)
  returning id into v;
  return v;
end $$;
create function tests.option(p_product text, p_name text, p_pos int, variadic p_values text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_opt uuid; v_val uuid; v text; i int := 0;
begin
  insert into public.product_options (store_id, product_id, name, position)
  select p.store_id, p.id, p_name, p_pos from public.products p where p.id = tests.fx('p_' || p_product)
  returning id into v_opt;
  foreach v in array p_values loop
    insert into public.product_option_values (store_id, option_id, value, position)
    select o.store_id, o.id, v, i from public.product_options o where o.id = v_opt
    returning id into v_val;
    perform tests.set_fx('ov_' || p_name || '_' || v, v_val);
    i := i + 1;
  end loop;
  return tests.set_fx('opt_' || p_name, v_opt);
end $$;
create function tests.pick(p_variant uuid, variadic p_values text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  foreach v in array p_values loop
    insert into public.variant_option_values (variant_id, option_value_id, option_id, store_id)
    select p_variant, ov.id, ov.option_id, ov.store_id from public.product_option_values ov
     where ov.id = tests.fx('ov_' || v);
  end loop;
end $$;
grant execute on all functions in schema tests to authenticated;

-- ============================================================================ FK compuestas
select tests.product('a', 'playera', 'Playera Básica');
select tests.product('b', 'gorra');
select throws_ok(format($$ insert into public.product_variants (store_id, product_id, price)
  values (%L, %L, 100) $$, tests.fx('store_a'), tests.fx('p_gorra')),
  '23503', null, 'variante de A con producto de B: imposible a nivel de motor');
select throws_ok(format($$ insert into public.media (store_id, owner_type, product_id, storage_path)
  values (%L, 'product', %L, 'x/1') $$, tests.fx('store_a'), tests.fx('p_gorra')),
  '23503', null, 'medio de A para un producto de B: imposible');
insert into public.categories (store_id, name, slug) values (tests.fx('store_b'), 'Ropa B', 'ropa');
select throws_ok(format($$ insert into public.product_categories (store_id, product_id, category_id)
  select %L, %L, id from public.categories where store_id = %L $$, tests.fx('store_a'), tests.fx('p_playera'), tests.fx('store_b')),
  '23503', null, 'categoría de B en un producto de A: imposible');

-- ============================================================================ Producto simple
select tests.variant('playera', 19900, '  ply-001 ');
select is((select sku from public.product_variants where product_id = tests.fx('p_playera')), 'PLY-001',
  'SKU normalizado: sin espacios y en mayúsculas');
select is((select min_price || '-' || max_price from public.products where id = tests.fx('p_playera')), '19900-19900',
  'rango de precios derivado de las variantes');
select throws_ok($$ select tests.variant('playera', 100, 'ply-001', 'X') $$, '23505', null,
  'SKU único por tienda (sin distinguir mayúsculas)');
select lives_ok($$ select tests.variant('gorra', 100, 'PLY-001') $$, 'el mismo SKU en otra tienda está permitido');
select throws_ok($$ select tests.variant('playera', 100, null, '') $$, '23505', null,
  'un producto simple tiene una sola variante sin opciones (firma única)');
select throws_ok(format($$ insert into public.product_variants (store_id, product_id, price, compare_at_price)
  values (%L, %L, 500, 500) $$, tests.fx('store_a'), tests.fx('p_playera')),
  '23514', null, 'compare_at_price debe ser mayor que el precio');
select throws_ok(format($$ insert into public.product_variants (store_id, product_id, price, option_signature)
  values (%L, %L, -1, 'Z') $$, tests.fx('store_a'), tests.fx('p_playera')),
  '23514', null, 'precio negativo rechazado');

-- ============================================================================ Variantes con opciones
select tests.product('a', 'sudadera');
select tests.option('sudadera', 'Color', 0, 'Negro', 'Blanco');
select tests.option('sudadera', 'Talla', 1, 'M', 'G');
savepoint ok_variant;
select lives_ok($$ select tests.pick(tests.variant('sudadera', 50000, 'SUD-N-M', 'Color=Negro|Talla=M'), 'Color_Negro', 'Talla_M') $$,
  'variante con un valor por opción y firma correcta');
select lives_ok($$ set constraints all immediate $$, 'la validación diferida acepta la variante');
set constraints all deferred;
release savepoint ok_variant;

savepoint bad1;
select tests.pick(tests.variant('sudadera', 50000, 'SUD-B-M', 'Color=Blanco|Talla=M'), 'Color_Blanco');
select throws_ok($$ set constraints all immediate $$, '23514', 'variant_options_incomplete',
  'falta un valor de una opción: rechazada al validar');
rollback to savepoint bad1;

savepoint bad2;
select tests.pick(tests.variant('sudadera', 50000, 'SUD-B-G', 'Color=Negro|Talla=G'), 'Color_Blanco', 'Talla_G');
select throws_ok($$ set constraints all immediate $$, '23514', 'variant_signature_mismatch',
  'firma que no corresponde a sus valores: rechazada');
rollback to savepoint bad2;

savepoint bad3;
select throws_ok($$ select tests.pick(tests.variant('sudadera', 1, 'SUD-X', 'Color=Negro|Talla=G'), 'Color_Negro', 'Color_Blanco') $$,
  '23505', null, 'dos valores de la misma opción: imposible (UNIQUE variant_id, option_id)');
rollback to savepoint bad3;

savepoint bad4;
select throws_ok($$ select tests.variant('sudadera', 1, 'SUD-DUP', 'Color=Negro|Talla=M') $$, '23505', null,
  'combinación repetida en el mismo producto: imposible');
rollback to savepoint bad4;

savepoint bad5;
select tests.product('a', 'calcetin');
select tests.option('calcetin', 'Tamaño', 0, 'Unico');
select tests.pick(tests.variant('calcetin', 100, null, 'Tamaño=Unico'), 'Color_Negro');
select throws_ok($$ set constraints all immediate $$, '23514', null,
  'valor de una opción de otro producto: rechazado');
rollback to savepoint bad5;

select tests.option('sudadera', 'Material', 2, 'Algodon');
select throws_ok($$ select tests.option('sudadera', 'Estilo', 3, 'Clasico') $$, 'P0001', 'limit_reached',
  'máximo 3 opciones por producto');
savepoint opt_added;
select throws_ok($$ set constraints all immediate $$, '23514', 'variant_options_incomplete',
  'agregar una opción deja incompletas las variantes existentes hasta completarlas');
rollback to savepoint opt_added;
delete from public.product_options where id = tests.fx('opt_Material');

-- ============================================================================ Categorías
insert into public.categories (store_id, name, slug) values (tests.fx('store_a'), 'Ropa', 'ropa');
select tests.set_fx('c_ropa', (select id from public.categories where store_id = tests.fx('store_a') and slug = 'ropa'));
insert into public.categories (store_id, parent_id, name, slug) values (tests.fx('store_a'), tests.fx('c_ropa'), 'Hombre', 'hombre');
select tests.set_fx('c_hombre', (select id from public.categories where slug = 'hombre'));
insert into public.categories (store_id, parent_id, name, slug) values (tests.fx('store_a'), tests.fx('c_hombre'), 'Playeras', 'playeras');
select tests.set_fx('c_playeras', (select id from public.categories where slug = 'playeras'));
insert into public.categories (store_id, parent_id, name, slug) values (tests.fx('store_a'), tests.fx('c_playeras'), 'Manga corta', 'manga-corta');
select tests.set_fx('c_manga', (select id from public.categories where slug = 'manga-corta'));
select is((select path || ':' || depth from public.categories where id = tests.fx('c_manga')),
  'ropa/hombre/playeras/manga-corta:3', 'path y profundidad derivados del padre');
select throws_ok(format($$ insert into public.categories (store_id, parent_id, name, slug) values (%L, %L, 'X', 'x') $$,
  tests.fx('store_a'), tests.fx('c_manga')), '23514', 'category_too_deep', 'máximo 4 niveles');
select throws_ok(format($$ update public.categories set parent_id = %L where id = %L $$, tests.fx('c_playeras'), tests.fx('c_hombre')),
  '23514', 'category_cycle', 'no puede colgar de un descendiente (ciclo)');
select throws_ok(format($$ update public.categories set parent_id = id where id = %L $$, tests.fx('c_ropa')),
  '23514', null, 'no puede ser su propio padre');
select throws_ok(format($$ insert into public.categories (store_id, parent_id, name, slug) values (%L, %L, 'Otra', 'hombre') $$,
  tests.fx('store_a'), tests.fx('c_ropa')), '23505', null, 'slug único entre hermanos');
insert into public.categories (store_id, name, slug) values (tests.fx('store_a'), 'Rebajas', 'rebajas');
update public.categories set parent_id = (select id from public.categories where slug = 'rebajas' and store_id = tests.fx('store_a'))
 where id = tests.fx('c_playeras');
select is((select path from public.categories where id = tests.fx('c_manga')), 'rebajas/playeras/manga-corta',
  'mover una rama recalcula el path de sus descendientes');
update public.categories set slug = 'basicos' where id = tests.fx('c_playeras');
select is((select path from public.categories where id = tests.fx('c_manga')), 'rebajas/basicos/manga-corta',
  'renombrar el slug también propaga el path');

-- ============================================================================ Búsqueda y derivados
update public.products set title = 'Café de olla', tags = '{organico}' where id = tests.fx('p_playera');
select ok((select search_vector @@ to_tsquery('spanish', extensions.unaccent('cafe')) from public.products
            where id = tests.fx('p_playera')), 'búsqueda sin acentos: "cafe" encuentra "Café"');
select ok((select search_vector @@ plainto_tsquery('spanish', 'ply-001') from public.products
            where id = tests.fx('p_playera')), 'el SKU entra en la búsqueda');
insert into public.product_categories (store_id, product_id, category_id, is_primary)
values (tests.fx('store_a'), tests.fx('p_playera'), tests.fx('c_ropa'), true);
select ok((select search_vector @@ to_tsquery('spanish', 'ropa') from public.products where id = tests.fx('p_playera')),
  'la categoría entra en la búsqueda');
update public.categories set name = 'Vestimenta' where id = tests.fx('c_ropa');
select ok((select search_vector @@ to_tsquery('spanish', 'vestimenta') from public.products where id = tests.fx('p_playera')),
  'renombrar la categoría actualiza la búsqueda de sus productos');
select throws_ok(format($$ insert into public.product_categories (store_id, product_id, category_id, is_primary)
  values (%L, %L, %L, true) $$, tests.fx('store_a'), tests.fx('p_playera'), tests.fx('c_hombre')),
  '23505', null, 'una sola categoría principal por producto');
select tests.variant('sudadera', 30000, 'SUD-INACT', 'Z');
update public.product_variants set status = 'inactive', option_signature = 'Inactiva' where sku = 'SUD-INACT';
select is((select min_price from public.products where id = tests.fx('p_sudadera')), 50000::bigint,
  'las variantes inactivas no cuentan en el rango de precios');

-- ============================================================================ Límites
update public.plan_entitlements set value_int = (select count(*)::int from public.products p
  join public.stores s on s.id = p.store_id where s.organization_id = tests.fx('org_a') and p.deleted_at is null)
 where key = 'max_products' and plan_id = (select plan_id from public.subscriptions where organization_id = tests.fx('org_a'));
select throws_ok($$ select tests.product('a', 'extra') $$, 'P0001', 'limit_reached', 'límite de productos del plan');
insert into public.organization_entitlement_overrides (organization_id, key, value_int, reason)
values (tests.fx('org_a'), 'max_variants_per_product', 2, 'Prueba de límite');
select throws_ok($$ select tests.variant('sudadera', 100, 'SUD-3', 'Otra') $$, 'P0001', 'limit_reached',
  'límite de variantes por producto');

-- ============================================================================ Inmutabilidad
select throws_ok(format($$ update public.product_variants set product_id = %L where sku = 'PLY-001' and store_id = %L $$,
  tests.fx('p_sudadera'), tests.fx('store_a')), null, null, 'una variante no cambia de producto');
select throws_ok(format($$ update public.products set store_id = %L where id = %L $$, tests.fx('store_b'), tests.fx('p_playera')),
  null, null, 'un producto no cambia de tienda');

-- ============================================================================ RLS
insert into public.variant_costs (variant_id, store_id, cost)
select id, store_id, 9000 from public.product_variants where sku = 'PLY-001' and store_id = tests.fx('store_a');
select tests.logout(); select tests.login('cat');
select is((select count(*)::int from public.products), 2, 'catalog_manager ve el catálogo de su tienda');
select is((select count(*)::int from public.variant_costs), 1, 'catalog_manager ve los costos (products.cost.read)');
select is(tests.sqlstate_as('authenticated', $$ insert into public.products (store_id, title, slug)
  values (gen_random_uuid(), 'x', 'x') $$), '42501', 'sin escrituras directas: solo por RPC');
select tests.logout(); select tests.login('view');
select is((select count(*)::int from public.variant_costs), 0, 'viewer no ve costos (products.cost.read)');
select is((select count(*)::int from public.products), 2, 'viewer sí ve los productos');
select tests.logout(); select tests.login('owner_b');
select is((select count(*)::int from public.products where store_id = tests.fx('store_a')), 0,
  'otro tenant no ve nada del catálogo de A');
select tests.logout();

select * from finish();
rollback;
