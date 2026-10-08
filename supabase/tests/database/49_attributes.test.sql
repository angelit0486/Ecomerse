-- =============================================================================
-- Fase R · R-T04 — Atributos filtrables (ADR-022): permisos sin claves nuevas,
-- validación, lista completa de valores, filtros (OR dentro de un atributo, AND
-- entre atributos), conteos por valor sin el propio atributo, solo publicados,
-- búsqueda por valor, cumplimiento (ADR-021) y aislamiento entre tiendas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_user('stock', 'stock@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('owner_c', 'owner@c.io');
select tests.create_user('padmin', 'admin@plataforma.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.create_tenant('c', 'owner_c');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.add_store_member('a', 'stock', 'inventory_manager');
select tests.make_platform_staff('padmin', 'platform_admin');
update public.stores set status = 'active', launched_at = now()
 where id in (tests.fx('store_a'), tests.fx('store_b'), tests.fx('store_c'));
select tests.set_fx('profile', (select id from public.compliance_profiles
                                 where country = 'MX' and category_key = 'dietary_supplement'));

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '') || coalesce('/' || nullif(v_hint, ''), '');
end $$;
create function pg_temp.product(p_store text, p_title text, p_slug text) returns uuid language sql as $$
  select (public.catalog_upsert_product(tests.fx('store_' || p_store), jsonb_build_object(
    'title', p_title, 'slug', p_slug, 'variants', '[{"price":19900}]'::jsonb)) ->> 'id')::uuid
$$;
create function pg_temp.gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'storefront_gateway', true);
  execute format('select to_jsonb(t.x) from (%s) t(x)', p_sql) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
-- Slugs de un listado de la tienda pública con filtros.
create function pg_temp.list(p_store text, p_filters jsonb, p_category text default null, p_query text default null)
returns text[] language sql as $$
  select coalesce(array_agg(i ->> 'slug' order by i ->> 'slug'), '{}')
    from jsonb_array_elements(pg_temp.gw(format(
      'select storefront.list_products(%L, %L, null, %L, null, null, null, false, null, 48, %L)',
      tests.fx('store_' || p_store), p_category, p_query, p_filters)) -> 'items') i
$$;
-- Filtros como "atributo:valor=conteo" (marcado con * si está seleccionado).
create function pg_temp.facets(p_store text, p_filters jsonb, p_category text default null,
                               p_available boolean default false)
returns text[] language sql as $$
  select coalesce(array_agg((f ->> 'key') || ':' || (v ->> 'key') || '=' || (v ->> 'count')
                            || case when (v ->> 'selected')::boolean then '*' else '' end
                            order by f ->> 'key', v ->> 'key'), '{}')
    from jsonb_array_elements(pg_temp.gw(format('select storefront.list_facets(%L, %L, null, null, %L, %L)',
           tests.fx('store_' || p_store), p_category, p_available, p_filters))) f
   cross join lateral jsonb_array_elements(f -> 'values') v
$$;
create function pg_temp.value(p_attr text, p_key text) returns uuid language sql as $$
  select av.id from public.attribute_values av join public.attributes a on a.id = av.attribute_id
   where a.store_id = tests.fx('store_a') and a.key = p_attr and av.key = p_key
$$;

-- -----------------------------------------------------------------------------
-- Catálogo de la tienda A
-- -----------------------------------------------------------------------------
select tests.login('owner');
select tests.set_fx('objetivo', public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Objetivo","position":1,"values":[{"label":"Energía"},{"label":"Masa muscular"},{"label":"Recuperación"}]}'));
select tests.set_fx('sabor', public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Sabor","position":2,"values":[{"label":"Chocolate"},{"label":"Vainilla"}]}'));
select tests.set_fx('origen', public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Origen","position":3,"is_filterable":false,"values":[{"label":"Nacional"}]}'));
select tests.set_fx('cat', public.catalog_upsert_category(tests.fx('store_a'), '{"name":"Proteínas"}'));

select tests.set_fx('p1', pg_temp.product('a', 'Proteína Choco', 'proteina-choco'));
select tests.set_fx('p2', pg_temp.product('a', 'Proteína Vainilla', 'proteina-vainilla'));
select tests.set_fx('p3', pg_temp.product('a', 'Cafeína', 'cafeina'));
select tests.set_fx('p4', pg_temp.product('a', 'Pre entreno', 'pre-entreno'));
select tests.set_fx('p5', pg_temp.product('a', 'Borrador', 'borrador'));
select public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object('id', tests.fx(k), 'title', t,
         'slug', s, 'variants', '[{"price":19900}]'::jsonb,
         'categories', jsonb_build_array(jsonb_build_object('id', tests.fx('cat'), 'is_primary', true))))
  from (values ('p1', 'Proteína Choco', 'proteina-choco'), ('p2', 'Proteína Vainilla', 'proteina-vainilla')) x(k, t, s);
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('p1'),
  array[pg_temp.value('objetivo', 'masa-muscular'), pg_temp.value('objetivo', 'recuperacion'),
        pg_temp.value('sabor', 'chocolate'), pg_temp.value('origen', 'nacional')]);
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('p2'),
  array[pg_temp.value('objetivo', 'masa-muscular'), pg_temp.value('sabor', 'vainilla')]);
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('p3'),
  array[pg_temp.value('objetivo', 'energia')]);
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('p4'),
  array[pg_temp.value('objetivo', 'energia'), pg_temp.value('sabor', 'chocolate')]);
select public.catalog_set_product_attributes(tests.fx('store_a'), tests.fx('p5'),
  array[pg_temp.value('objetivo', 'energia')]);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx(k)) from unnest(array['p1', 'p2', 'p3', 'p4']) k;
select tests.logout();

-- -----------------------------------------------------------------------------
-- Modelo y validación
-- -----------------------------------------------------------------------------
select is((select array_agg(a.key || '=' || a.is_filterable order by a.position) from public.attributes a
            where a.store_id = tests.fx('store_a')),
          array['objetivo=true', 'sabor=true', 'origen=false'], 'la clave sale del nombre; filtrable por defecto');
select is((select array_agg(av.key order by av.position) from public.attribute_values av
            where av.attribute_id = tests.fx('objetivo')),
          array['energia', 'masa-muscular', 'recuperacion'], 'claves de los valores sin acentos, en orden');

select tests.login('owner');
select is(pg_temp.err(format($$select public.catalog_save_attribute(%L, '{"name":"Orden","values":[{"label":"A"}]}')$$,
            tests.fx('store_a'))), 'validation_failed/key', 'una clave reservada del listado se rechaza');
select is(pg_temp.err(format($$select public.catalog_save_attribute(%L, '{"name":"objetivo","key":"meta","values":[{"label":"A"}]}')$$,
            tests.fx('store_a'))), 'validation_failed/name', 'el nombre no se repite en la tienda (sin distinguir mayúsculas)');
select is(pg_temp.err(format($$select public.catalog_save_attribute(%L, '{"name":"Tamaño","values":[{"label":"Chico"},{"label":"chico"}]}')$$,
            tests.fx('store_a'))), 'validation_failed/values', 'un valor no se repite en el atributo');
select is(pg_temp.err(format($$select public.catalog_save_attribute(%L, '{"name":"Tamaño","values":[]}')$$,
            tests.fx('store_a'))), 'validation_failed/values', 'un atributo necesita al menos un valor');
select is(pg_temp.err(format('select public.catalog_save_attribute(%L, %L)', tests.fx('store_a'),
            jsonb_build_object('name', 'Tamaño', 'values',
              (select jsonb_agg(jsonb_build_object('label', 'V' || g)) from generate_series(1, 51) g)))),
          'validation_failed/values', 'hasta 50 valores por atributo');
select is(pg_temp.err(format($$select public.catalog_save_attribute(%L, '{"name":"Tamaño","position":99999999999,"values":[{"label":"A"}]}')$$,
            tests.fx('store_a'))), 'validation_failed/attribute', 'una posición fuera de rango es un error de validación');
select is(pg_temp.err(format($$select public.catalog_save_attribute(%L, '{"name":"Tamaño\u0007","values":[{"label":"A"}]}')$$,
            tests.fx('store_a'))), 'validation_failed/name', 'sin caracteres de control en el nombre');

-- Máximo de 20 atributos por tienda.
select public.catalog_save_attribute(tests.fx('store_a'),
         jsonb_build_object('name', 'Extra ' || g, 'values', '[{"label":"Sí"}]'::jsonb))
  from generate_series(1, 17) g;
select is(pg_temp.err(format($$select public.catalog_save_attribute(%L, '{"name":"Uno más","values":[{"label":"A"}]}')$$,
            tests.fx('store_a'))), 'validation_failed/attributes_limit', 'hasta 20 atributos por tienda');
select public.catalog_delete_attribute(tests.fx('store_a'), a.id)
  from public.attributes a where a.store_id = tests.fx('store_a') and a.name like 'Extra %';
select tests.logout();

-- -----------------------------------------------------------------------------
-- Permisos: definir con categories.manage, asignar con products.update
-- -----------------------------------------------------------------------------
select tests.login('viewer');
select is(jsonb_array_length(public.catalog_list_attributes(tests.fx('store_a'))), 3, 'con products.read se listan');
select throws_ok(format($$select public.catalog_save_attribute(%L, '{"name":"Tamaño","values":[{"label":"A"}]}')$$,
                   tests.fx('store_a')), '42501', 'forbidden', 'sin categories.manage no se definen atributos');
select throws_ok(format('select public.catalog_delete_attribute(%L, %L)', tests.fx('store_a'), tests.fx('sabor')),
                 '42501', 'forbidden', 'ni se borran');
select tests.logout();
select tests.login('stock');
select throws_ok(format('select public.catalog_set_product_attributes(%L, %L, %L)', tests.fx('store_a'), tests.fx('p3'),
                   array[pg_temp.value('sabor', 'chocolate')]), '42501', 'forbidden',
                 'sin products.update no se asignan a un producto');
select tests.logout();

-- -----------------------------------------------------------------------------
-- Filtros de la tienda pública
-- -----------------------------------------------------------------------------
select is(pg_temp.list('a', null), array['cafeina', 'pre-entreno', 'proteina-choco', 'proteina-vainilla'],
          'sin filtros: los publicados');
select is(pg_temp.list('a', '{"objetivo":["masa-muscular"]}'), array['proteina-choco', 'proteina-vainilla'],
          'un valor');
select is(pg_temp.list('a', '{"objetivo":["masa-muscular","energia"]}'),
          array['cafeina', 'pre-entreno', 'proteina-choco', 'proteina-vainilla'], 'dentro de un atributo: cualquiera (OR)');
select is(pg_temp.list('a', '{"objetivo":["energia"],"sabor":["chocolate"]}'), array['pre-entreno'],
          'entre atributos: todos (AND)');
select is(pg_temp.list('a', '{"objetivo":["inexistente"],"ref":["instagram"],"origen":["nacional"]}'),
          array['cafeina', 'pre-entreno', 'proteina-choco', 'proteina-vainilla'],
          'claves o valores desconocidos y atributos no filtrables se ignoran');
select is(pg_temp.list('a', '{"objetivo":["masa-muscular"]}', 'proteinas'), array['proteina-choco', 'proteina-vainilla'],
          'con la categoría');
select throws_ok($$select pg_temp.list('a', '{"objetivo":"energia"}')$$, 'P0001', 'validation_failed',
                 'la forma de los filtros se valida');
select throws_ok(format('select pg_temp.list(%L, %L)', 'a',
                   (select jsonb_object_agg('k' || g, '["x"]'::jsonb) from generate_series(1, 11) g)),
                 'P0001', 'validation_failed', 'hasta 10 atributos a la vez');

select is(pg_temp.facets('a', null),
          array['objetivo:energia=2', 'objetivo:masa-muscular=2', 'objetivo:recuperacion=1',
                'sabor:chocolate=2', 'sabor:vainilla=1'],
          'conteos sin filtros: solo publicados y sin el atributo no filtrable');
select is(pg_temp.facets('a', '{"objetivo":["masa-muscular"]}'),
          array['objetivo:energia=2', 'objetivo:masa-muscular=2*', 'objetivo:recuperacion=1',
                'sabor:chocolate=1', 'sabor:vainilla=1'],
          'el atributo seleccionado cuenta sin su propio filtro; los demás, con él');
select is(pg_temp.facets('a', '{"objetivo":["energia"],"sabor":["chocolate"]}'),
          array['objetivo:energia=1*', 'objetivo:masa-muscular=1', 'objetivo:recuperacion=1',
                'sabor:chocolate=1*'],
          'con dos atributos: cada uno cuenta con el filtro del otro; un valor sin productos no aparece');
select is(pg_temp.facets('a', '{"sabor":["vainilla"]}', 'proteinas'),
          array['objetivo:masa-muscular=1', 'sabor:chocolate=1', 'sabor:vainilla=1*'],
          'los conteos respetan la categoría');

select tests.login('owner');
select public.inventory_adjust(tests.fx('store_a'),
         (select v.id from public.product_variants v where v.product_id = tests.fx('p4')), 'adjustment', 5, 'Inicial');
select tests.logout();
select is(pg_temp.facets('a', null, null, true), array['objetivo:energia=1', 'sabor:chocolate=1'],
          '"solo disponibles" también cuenta');

select is(pg_temp.gw(format('select storefront.get_product_attributes(%L, %L)', tests.fx('store_a'), 'proteina-choco')),
  '[{"key":"objetivo","name":"Objetivo","filterable":true,
     "values":[{"key":"masa-muscular","label":"Masa muscular"},{"key":"recuperacion","label":"Recuperación"}]},
    {"key":"sabor","name":"Sabor","filterable":true,"values":[{"key":"chocolate","label":"Chocolate"}]},
    {"key":"origen","name":"Origen","filterable":false,"values":[{"key":"nacional","label":"Nacional"}]}]'::jsonb,
  'la ficha del producto lleva sus atributos en orden');
select is(pg_temp.gw(format('select storefront.get_product_attributes(%L, %L)', tests.fx('store_a'), 'borrador')),
          '[]'::jsonb, 'un borrador no publica sus atributos');

-- Búsqueda por el nombre de un valor (entra al vector de búsqueda).
select is(pg_temp.list('a', null, null, 'recuperación'), array['proteina-choco'], 'se busca por un valor del producto');

-- -----------------------------------------------------------------------------
-- Editar la lista de valores
-- -----------------------------------------------------------------------------
select tests.login('owner');
select tests.set_fx('v_energia', pg_temp.value('objetivo', 'energia'));
select tests.set_fx('v_recup', pg_temp.value('objetivo', 'recuperacion'));
select is(pg_temp.err(format('select public.catalog_save_attribute(%L, %L)', tests.fx('store_a'),
            jsonb_build_object('id', tests.fx('objetivo'), 'name', 'Objetivo', 'values', jsonb_build_array(
              jsonb_build_object('id', tests.fx('v_recup'), 'label', 'Energía'),
              jsonb_build_object('id', tests.fx('v_energia'), 'label', 'Recuperación'),
              jsonb_build_object('id', pg_temp.value('objetivo', 'masa-muscular'), 'label', 'Masa muscular'))))),
          'ok', 'intercambiar nombres entre valores no choca con las claves únicas');
select tests.logout();
select is(pg_temp.list('a', '{"objetivo":["energia"]}'), array['cafeina', 'pre-entreno'],
          'las asignaciones y la clave de la URL siguen al valor (id), no a su nombre');
select tests.login('owner');
select public.catalog_save_attribute(tests.fx('store_a'),
  jsonb_build_object('id', tests.fx('objetivo'), 'name', 'Objetivo', 'values', jsonb_build_array(
    jsonb_build_object('id', tests.fx('v_recup'), 'label', 'Descanso'),
    jsonb_build_object('id', pg_temp.value('objetivo', 'masa-muscular'), 'label', 'Masa muscular'),
    jsonb_build_object('label', 'Bienestar'))));
select tests.logout();
select is((select array_agg(av.key || '@' || av.position order by av.position) from public.attribute_values av
            where av.attribute_id = tests.fx('objetivo')),
          array['recuperacion@1', 'masa-muscular@2', 'bienestar@3'],
          'renombrar (la clave se conserva), quitar y agregar en una sola lista');
select tests.login('owner');
select public.catalog_save_attribute(tests.fx('store_a'),
  jsonb_build_object('id', tests.fx('sabor'), 'name', 'Sabores', 'values', jsonb_build_array(
    jsonb_build_object('id', pg_temp.value('sabor', 'chocolate'), 'label', 'Cacao'),
    jsonb_build_object('id', pg_temp.value('sabor', 'vainilla'), 'label', 'Vainilla'),
    jsonb_build_object('label', 'Chocolate'))));
select tests.logout();
select is((select a.key || ':' || a.name from public.attributes a where a.id = tests.fx('sabor')), 'sabor:Sabores',
          'renombrar un atributo conserva su clave');
select is((select array_agg(av.key || '=' || av.label order by av.position) from public.attribute_values av
            where av.attribute_id = tests.fx('sabor')),
          array['chocolate=Cacao', 'vainilla=Vainilla', 'chocolate-2=Chocolate'],
          'un valor nuevo cuya clave ya existe recibe un sufijo');
select is((select count(*)::integer from public.product_attribute_values pav where pav.value_id = tests.fx('v_energia')),
          0, 'quitar un valor lo quita de sus productos');
select is(pg_temp.list('a', null, null, 'descanso'), array['proteina-choco'], 'renombrar un valor actualiza la búsqueda');
select is(pg_temp.list('a', null, null, 'recuperación'), '{}'::text[], 'y el nombre anterior ya no se encuentra');

select tests.login('owner');
select public.catalog_delete_attribute(tests.fx('store_a'), tests.fx('origen'));
select tests.logout();
select is((select count(*)::integer from public.product_attribute_values pav
            where pav.product_id = tests.fx('p1')), 3, 'borrar un atributo lo quita de sus productos');
select ok(exists (select 1 from audit.audit_logs l where l.store_id = tests.fx('store_a')
                   and l.action = 'attribute.deleted' and l.entity_id = tests.fx('origen')), 'con auditoría');
select ok(exists (select 1 from audit.audit_logs l where l.store_id = tests.fx('store_a')
                   and l.action = 'product.attributes_updated' and l.entity_id = tests.fx('p1')),
          'asignar valores también se audita');

select tests.login('owner');
select is(pg_temp.err(format('select public.catalog_set_product_attributes(%L, %L, %L)', tests.fx('store_a'),
            tests.fx('p3'), (select array_agg(gen_random_uuid()) from generate_series(1, 41)))),
          'validation_failed/values', 'hasta 40 valores por producto');
select tests.logout();

-- -----------------------------------------------------------------------------
-- Aislamiento
-- -----------------------------------------------------------------------------
select tests.set_fx('a_choco', pg_temp.value('sabor', 'chocolate'));
select tests.login('owner_b');
select tests.set_fx('pb', pg_temp.product('b', 'Proteína B', 'proteina-b'));
select public.catalog_publish_product(tests.fx('store_b'), tests.fx('pb'));
select is((select count(*)::integer from public.attributes), 0, 'RLS: otra tienda no ve los atributos de A');
select is((select count(*)::integer from public.product_attribute_values), 0, 'ni sus asignaciones');
select throws_ok(format($$select public.catalog_save_attribute(%L, '{"name":"Intruso","values":[{"label":"A"}]}')$$,
                   tests.fx('store_a')), '42501', 'forbidden', 'no define atributos en la tienda A');
select is(pg_temp.err(format('select public.catalog_set_product_attributes(%L, %L, %L)', tests.fx('store_b'),
            tests.fx('pb'), array[tests.fx('a_choco')])),
          'validation_failed/values', 'ni asigna valores de A a su producto');
select throws_ok(format('select public.catalog_list_attributes(%L)', tests.fx('store_a')), '42501', 'forbidden',
                 'ni lista los de A');
select tests.logout();
select is(pg_temp.facets('b', null), '{}'::text[], 'la tienda B no tiene filtros');
select is(pg_temp.list('b', '{"sabor":["chocolate"]}'), array['proteina-b'], 'y un filtro de A no le aplica');

-- -----------------------------------------------------------------------------
-- Cumplimiento (ADR-021): nombres y valores de atributos se revisan
-- -----------------------------------------------------------------------------
select tests.login('padmin');
select public.platform_compliance_rule_save(tests.fx('profile'),
  '{"kind":"forbidden_term","key":"no_cura","label":"Afirmación curativa","body":"cura"}');
select public.platform_compliance_profile_set_status(tests.fx('profile'), 'active', 'Asesoría de prueba', null);
select tests.logout();
select tests.login('owner_c');
select public.compliance_set_store_category(tests.fx('store_c'), 'dietary_supplement', true);
select tests.set_fx('beneficio', public.catalog_save_attribute(tests.fx('store_c'),
  '{"name":"Beneficio","values":[{"label":"Energía"},{"label":"Cura total"}]}'));
select tests.set_fx('s1', pg_temp.product('c', 'Omega 3', 'omega-3'));
select public.catalog_save_regulatory_info(tests.fx('store_c'), tests.fx('s1'), 'dietary_supplement',
  '{"ingredients":"Aceite de pescado"}');
select public.catalog_publish_product(tests.fx('store_c'), tests.fx('s1'));
select tests.set_fx('c_energia', (select av.id from public.attribute_values av
                                   where av.attribute_id = tests.fx('beneficio') and av.key = 'energia'));
select tests.set_fx('c_cura', (select av.id from public.attribute_values av
                                where av.attribute_id = tests.fx('beneficio') and av.key = 'cura-total'));
select is(pg_temp.err(format('select public.catalog_set_product_attributes(%L, %L, %L)', tests.fx('store_c'),
            tests.fx('s1'), array[tests.fx('c_energia')])), 'ok', 'un valor permitido se asigna a un suplemento publicado');
select is(pg_temp.err(format('select public.catalog_set_product_attributes(%L, %L, %L)', tests.fx('store_c'),
            tests.fx('s1'), array[tests.fx('c_energia'), tests.fx('c_cura')])),
          'validation_failed/publish/compliance_forbidden_term:no_cura',
          'un valor con un término prohibido no se asigna a uno publicado');
select is(pg_temp.err(format('select public.catalog_save_attribute(%L, %L)', tests.fx('store_c'),
            jsonb_build_object('id', tests.fx('beneficio'), 'name', 'Beneficio', 'values', jsonb_build_array(
              jsonb_build_object('id', tests.fx('c_energia'), 'label', 'Cura el cansancio'),
              jsonb_build_object('id', tests.fx('c_cura'), 'label', 'Cura total'))))),
          'validation_failed/publish/compliance_forbidden_term:no_cura',
          'ni se renombra así un valor que ya usa un producto publicado');
select tests.logout();
select is((select status from public.products where id = tests.fx('s1')), 'active', 'el suplemento sigue publicado');

-- Un término nuevo de la plataforma que coincide con un valor asignado: la revisión despublica.
select tests.login('padmin');
select public.platform_compliance_rule_save(tests.fx('profile'),
  '{"kind":"forbidden_term","key":"no_energia","label":"Prueba","body":"energía"}');
select tests.logout();
select tests.as_role('system_worker');
select system.compliance_recheck(tests.fx('profile'), null, null, 200);
select tests.logout();
select is((select status from public.products where id = tests.fx('s1')), 'draft',
          'la revisión por cambio de reglas también lee los atributos');

select * from finish();
rollback;
