-- =============================================================================
-- Fase R · Gate R — Correcciones de la revisión adversarial: texto revisado
-- normalizado (invisibles, entidades, etiquetas en línea), términos con signos,
-- texto completo del producto (etiquetas, marca, opciones, texto alternativo),
-- continuación de la revisión sin deduplicar y guardado de atributos.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '') || coalesce('/' || nullif(v_hint, ''), '');
end $$;

-- -----------------------------------------------------------------------------
-- 1. Normalización
-- -----------------------------------------------------------------------------
select is(app.compliance_text('Cu' || chr(8203) || 'ra' || chr(173) || '   TOTAL ' || chr(65279)), 'cura total',
          'sin caracteres invisibles ni guiones suaves y con los espacios colapsados');
select is(app.compliance_text(app.compliance_html_text('<p>Una c<strong>u</strong>ra</p><p>total</p>')),
          'una cura total', 'las etiquetas en línea no separan la palabra; las de bloque sí');
select is(app.compliance_text(app.compliance_html_text('c&#250;ra c&#xFA;ra c&uacute;ra c&uacutera c&#250ra')),
          'cura cura cura cura cura', 'entidades numéricas y con nombre, con o sin punto y coma');
select is(app.compliance_html_text('&amp;uacute; &#0; &#xD800;'), '&uacute;    ',
          '«&amp;» se decodifica al final y un código inválido es un espacio');
select ok('natural 100% garantizado' ~ app.compliance_term_regex('100%'), 'un término que termina en signo coincide');
select ok(not ('rinde 1100%' ~ app.compliance_term_regex('100%')), 'pero sigue siendo palabra completa');
select ok(not ('procurar' ~ app.compliance_term_regex('cura')) and 'la cura.' ~ app.compliance_term_regex('cura'),
          'como antes: «cura» no coincide con «procurar»');

-- -----------------------------------------------------------------------------
-- 2. El texto completo del producto
-- -----------------------------------------------------------------------------
select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('padmin', 'admin@plataforma.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.make_platform_staff('padmin', 'platform_admin');
select tests.set_fx('profile', (select id from public.compliance_profiles
                                 where country = 'MX' and category_key = 'dietary_supplement'));
select tests.login('padmin');
select public.platform_compliance_rule_save(tests.fx('profile'),
  '{"kind":"forbidden_term","key":"no_cura","label":"Afirmación curativa","body":"cura"}');
select public.platform_compliance_profile_set_status(tests.fx('profile'), 'active', 'Asesoría de prueba', null);
select tests.logout();

create function pg_temp.supplement(p_slug text, p_extra jsonb) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object(
          'title', 'Producto ' || p_slug, 'slug', p_slug, 'variants', '[{"price":19900}]'::jsonb) || p_extra) ->> 'id')::uuid;
  perform public.catalog_save_regulatory_info(tests.fx('store_a'), v, 'dietary_supplement', '{"ingredients":"Prueba"}');
  return v;
end $$;
create function pg_temp.codes(p_product uuid) returns text[] language sql as $$
  select coalesce(array_agg(c.code order by c.code) filter (where c.code like 'compliance%'), '{}')
    from public.catalog_validate_product(tests.fx('store_a'), p_product) c
$$;
create function pg_temp.store_rechecks(p_store text) returns integer language sql as $$
  select count(*)::integer from system.jobs j
   where j.type = 'compliance.recheck' and j.status = 'queued'
     and j.payload = jsonb_build_object('store_id', tests.fx('store_' || p_store))
$$;

select tests.login('owner');
select public.compliance_set_store_category(tests.fx('store_a'), 'dietary_supplement', true);
select tests.set_fx('limpio', pg_temp.supplement('limpio', '{}'));
select is(pg_temp.codes(tests.fx('limpio')), '{}'::text[], 'un producto sin términos prohibidos cumple');
select is(pg_temp.codes(pg_temp.supplement('desc', '{"description_html":"<p>Una c&uacute;ra natural</p>"}')),
          array['compliance_forbidden_term:no_cura'], 'la descripción se lee como en el navegador');
select is(pg_temp.codes(pg_temp.supplement('etiquetas', '{"tags":["cura"]}')),
          array['compliance_forbidden_term:no_cura'], 'las etiquetas se revisan');
select is(pg_temp.codes(pg_temp.supplement('opciones', '{"options":[{"name":"Presentación","values":["Cura"]}],
            "variants":[{"options":{"Presentación":"Cura"},"price":19900}]}')),
          array['compliance_forbidden_term:no_cura'], 'las opciones y sus valores se revisan');
select tests.set_fx('marca', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Cura Natural"}'));
select is(pg_temp.codes(pg_temp.supplement('marca', jsonb_build_object('brand_id', tests.fx('marca')))),
          array['compliance_forbidden_term:no_cura'], 'la marca se revisa');
select tests.logout();

insert into public.media (store_id, owner_type, product_id, status, storage_path, alt_text)
values (tests.fx('store_a'), 'product', tests.fx('limpio'), 'ready', 'gate-r/limpio.webp', 'Frasco');
select tests.set_fx('foto', (select id from public.media where storage_path = 'gate-r/limpio.webp'));
select tests.login('owner');
select is(pg_temp.codes(tests.fx('limpio')), '{}'::text[], 'un texto alternativo permitido no cambia nada');
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('limpio'));
select tests.logout();

-- Cambiar el texto alternativo o la marca vuelve a revisar la tienda (una vez).
-- (Declarar la categoría ya encoló una; se da por hecha.)
update system.jobs set status = 'succeeded', finished_at = now() where type = 'compliance.recheck';
select is(pg_temp.store_rechecks('a'), 0, 'sin revisiones de tienda en cola');
select tests.login('owner');
select public.media_set_alt_text(tests.fx('store_a'), tests.fx('foto'), 'La cura del cansancio');
select is(pg_temp.codes(tests.fx('limpio')), array['compliance_forbidden_term:no_cura'],
          'el texto alternativo de las imágenes se revisa');
select tests.logout();
select is(pg_temp.store_rechecks('a'), 1, 'cambiar el texto alternativo encola la revisión de la tienda');
select tests.as_role('system_worker');
select system.compliance_recheck(null, tests.fx('store_a'), null, 200);
select tests.logout();
select is((select status from public.products where id = tests.fx('limpio')), 'draft',
          'y la revisión despublica el producto');
select tests.login('owner');
select public.catalog_upsert_brand(tests.fx('store_a'), jsonb_build_object('id', tests.fx('marca'), 'name', 'Otra'));
select public.catalog_upsert_brand(tests.fx('store_a'), jsonb_build_object('id', tests.fx('marca'), 'name', 'Otra más'));
select tests.logout();
select is(pg_temp.store_rechecks('a'), 1, 'renombrar la marca no duplica la revisión que sigue en cola');
select tests.login('owner_b');
select tests.set_fx('marca_b', public.catalog_upsert_brand(tests.fx('store_b'), '{"name":"Marca B"}'));
select public.catalog_upsert_brand(tests.fx('store_b'), jsonb_build_object('id', tests.fx('marca_b'), 'name', 'B2'));
select tests.logout();
select is(pg_temp.store_rechecks('b'), 0, 'una tienda sin categorías reguladas no encola revisiones');

-- -----------------------------------------------------------------------------
-- 3. Continuación de la revisión por lotes
-- -----------------------------------------------------------------------------
update system.jobs set status = 'succeeded', finished_at = now() where type = 'compliance.recheck';
select tests.login('owner');
select tests.set_fx('lote1', pg_temp.supplement('lote-1', '{}'));
select tests.set_fx('lote2', pg_temp.supplement('lote-2', '{}'));
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('lote1'));
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('lote2'));
select tests.logout();
select tests.as_role('system_worker');
select system.compliance_recheck(null, tests.fx('store_a'), null, 1);
select system.compliance_recheck(null, tests.fx('store_a'), null, 1);
select tests.logout();
select is((select count(*)::integer from system.jobs where type = 'compliance.recheck'
            and payload ->> 'after' = least(tests.fx('lote1'), tests.fx('lote2'))::text),
          2, 'dos revisiones que terminan su lote en el mismo producto encolan cada una su continuación');

-- -----------------------------------------------------------------------------
-- 4. Guardar un atributo
-- -----------------------------------------------------------------------------
select tests.login('owner');
select tests.set_fx('objetivo', public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Objetivo","values":[{"label":"Energía"},{"label":"Fuerza"}]}'));
select tests.set_fx('sabor', public.catalog_save_attribute(tests.fx('store_a'),
  '{"name":"Sabor","values":[{"label":"Chocolate"}]}'));
select tests.set_fx('energia', (select id from public.attribute_values where attribute_id = tests.fx('objetivo') and key = 'energia'));
select tests.set_fx('fuerza', (select id from public.attribute_values where attribute_id = tests.fx('objetivo') and key = 'fuerza'));
select tests.set_fx('chocolate', (select id from public.attribute_values where attribute_id = tests.fx('sabor')));
select is(pg_temp.err(format('select public.catalog_save_attribute(%L, %L)', tests.fx('store_a'),
            jsonb_build_object('id', tests.fx('objetivo'), 'name', 'Objetivo', 'values', jsonb_build_array(
              jsonb_build_object('id', tests.fx('chocolate'), 'key', 'chocolate', 'label', 'Chocolate'))))),
          'not_found/value', 'el valor de otro atributo no se acepta aunque traiga su clave');
select is(pg_temp.err(format('select public.catalog_save_attribute(%L, %L)', tests.fx('store_a'),
            jsonb_build_object('id', tests.fx('objetivo'), 'name', 'Objetivo',
                               'known_value_ids', jsonb_build_array(tests.fx('energia')),
                               'values', jsonb_build_array(jsonb_build_object('id', tests.fx('energia'), 'label', 'Energía'))))),
          'conflict/values', 'un valor que el formulario no conocía es un conflicto y no se borra');
select is(pg_temp.err(format('select public.catalog_save_attribute(%L, %L)', tests.fx('store_a'),
            jsonb_build_object('id', tests.fx('objetivo'), 'name', 'Objetivo', 'known_value_ids', '"x"'::jsonb,
                               'values', jsonb_build_array(jsonb_build_object('id', tests.fx('energia'), 'label', 'Energía'))))),
          'validation_failed/values', 'los valores conocidos van como lista');
select tests.logout();
update system.jobs set status = 'succeeded', finished_at = now() where type = 'compliance.recheck' and status = 'queued';
select tests.login('owner');
select is(pg_temp.err(format('select public.catalog_save_attribute(%L, %L)', tests.fx('store_a'),
            jsonb_build_object('id', tests.fx('objetivo'), 'name', 'Meta',
                               'known_value_ids', jsonb_build_array(tests.fx('energia'), tests.fx('fuerza')),
                               'values', jsonb_build_array(jsonb_build_object('id', tests.fx('energia'), 'label', 'Energía'))))),
          'ok', 'con todos los valores conocidos se guarda y borra el que se quitó');
select is((select array_agg(key) from public.attribute_values where attribute_id = tests.fx('objetivo')),
          array['energia'], 'queda solo el valor enviado');
select tests.logout();
select is(pg_temp.store_rechecks('a'), 1, 'y editar el atributo vuelve a revisar los productos de la tienda');

select * from finish();
rollback;
