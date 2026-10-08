-- =============================================================================
-- Fase R · R-T01 — Módulo regulatorio (ADR-021): denegación por defecto, perfil
-- pendiente sin texto legal, campos obligatorios, términos prohibidos, ficha
-- normalizada, producto activo ⇒ cumple, revisión tras cambios de reglas,
-- permisos de plataforma y aislamiento.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('catalog', 'catalog@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('padmin', 'admin@plataforma.io');
select tests.create_user('psupport', 'soporte@plataforma.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'catalog', 'catalog_manager');
select tests.make_platform_staff('padmin', 'platform_admin');
select tests.make_platform_staff('psupport', 'platform_support');
select tests.set_fx('profile', (select id from public.compliance_profiles
                                 where country = 'MX' and category_key = 'dietary_supplement'));

-- Ejecuta SQL y devuelve 'ok' o 'mensaje/detalle/hint' del error.
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
-- Códigos de cumplimiento de un producto de la tienda A, como los ve el panel.
create function pg_temp.codes(p_product uuid) returns text[] language sql as $$
  select coalesce(array_agg(c.code order by c.code) filter (where c.code like 'compliance%'), '{}')
    from public.catalog_validate_product(tests.fx('store_a'), p_product) c
$$;
create function pg_temp.recheck_one(p_profile uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_role('system_worker');
  v := system.compliance_recheck(p_profile, null, null, 1);
  perform tests.logout();
  return v;
end $$;
create function pg_temp.recheck(p_profile uuid, p_store uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_role('system_worker');
  v := system.compliance_recheck(p_profile, p_store, null, 200);
  perform tests.logout();
  return v;
end $$;

select tests.login('owner');
select tests.set_fx('vendido', pg_temp.product('a', 'Shaker', 'shaker'));
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('vendido'));
select tests.set_fx('omega', pg_temp.product('a', 'Omega 3', 'omega-3'));

-- 1. Sin categorías declaradas nada cambia (tiendas no reguladas).
select is(pg_temp.codes(tests.fx('omega')), '{}'::text[], 'tienda sin categorías reguladas: sin reglas de cumplimiento');
select is((public.compliance_store_status(tests.fx('store_a')) -> 'categories' -> 0 ->> 'declared')::boolean, false,
          'la tienda ve la categoría disponible en su país, sin declarar');
select is(public.compliance_store_status(tests.fx('store_a')) -> 'categories' -> 0 -> 'profile' ->> 'status', 'pending',
          'el perfil de México nace pendiente (sin texto legal de la plataforma)');

-- 2. Declarar exige clasificar antes lo publicado.
select is(pg_temp.err($$select public.compliance_set_store_category(tests.fx('store_a'), 'dietary_supplement', true)$$),
          'conflict/unclassified_products/1', 'no se declara la categoría con productos publicados sin clasificar');
select is(public.catalog_classify_unregulated(tests.fx('store_a'), array[tests.fx('vendido')]), 1,
          'clasificación masiva como no regulado');
select is(public.catalog_classify_unregulated(tests.fx('store_a'), array[tests.fx('vendido')]), 0,
          'y no reclasifica lo ya clasificado');
select tests.logout();
select tests.login('catalog');
select is(pg_temp.err($$select public.compliance_set_store_category(tests.fx('store_a'), 'dietary_supplement', true)$$),
          'forbidden', 'declarar categorías exige store.update');
select tests.logout();
select tests.login('owner');
select is(pg_temp.err($$select public.compliance_set_store_category(tests.fx('store_a'), 'dietary_supplement', true)$$),
          'ok', 'la dueña declara que vende suplementos');
select tests.logout();
select is((select count(*)::int from system.jobs where type = 'compliance.recheck'
             and payload ->> 'store_id' = tests.fx('store_a')::text), 1,
          'declarar encola la revisión de lo publicado (por si una publicación concurrente se coló)');
select is((select count(*)::int from audit.audit_logs where action = 'store.compliance_category_enabled'
             and store_id = tests.fx('store_a')), 1, 'auditado');

-- 3. Denegación por defecto: sin clasificación no se publica.
select tests.login('owner');
select is(pg_temp.err($$select public.catalog_publish_product(tests.fx('store_a'), tests.fx('omega'))$$),
          'validation_failed/publish/compliance_classification_missing', 'sin clasificación no se publica');

-- 4. Ficha: lista blanca, límites y normalización.
select is(pg_temp.err($$select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('omega'),
            'dietary_supplement', '{"ingredients": "Aceite", "potencia": "ultra"}')$$),
          'validation_failed/regulatory/data', 'campo fuera de la lista blanca: rechazado');
select is(pg_temp.err(format($$select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('omega'),
            'dietary_supplement', jsonb_build_object('ingredients', %L, 'servings_per_container', 0))$$, repeat('x', 5001))),
          'validation_failed/regulatory/ingredients,servings_per_container', 'límites de texto y de porciones');
select is(pg_temp.err($$select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('omega'),
            'dietary_supplement', '{"nutrition": [{"name": "Omega 3"}]}')$$),
          'validation_failed/regulatory/nutrition', 'un renglón nutrimental necesita nombre y cantidad');
select is(pg_temp.err($$select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('omega'),
            'dietary_supplement', jsonb_build_object('warnings', 'texto' || chr(7)))$$),
          'validation_failed/regulatory/warnings', 'caracteres de control: rechazados');
select is(pg_temp.err($$select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('omega'),
            'dietary_supplement', '{"form": "  Cápsulas  ", "ingredients": "Aceite de pescado", "usage": "",
              "servings_per_container": 60,
              "nutrition": [{"name": "Omega 3", "amount": "1000", "unit": "mg"}, {"name": "", "amount": ""}]}')$$),
          'ok', 'ficha válida');
select is((select data from public.product_regulatory_info where product_id = tests.fx('omega')),
          '{"form": "Cápsulas", "ingredients": "Aceite de pescado", "servings_per_container": 60,
            "nutrition": [{"name": "Omega 3", "amount": "1000", "unit": "mg"}]}'::jsonb,
          'normalizada: recortada, sin vacíos ni renglones vacíos');

-- 5. Perfil pendiente: no se publica ni se lanza la tienda.
select is(pg_temp.err($$select public.catalog_publish_product(tests.fx('store_a'), tests.fx('omega'))$$),
          'validation_failed/publish/compliance_profile_pending',
          'con el perfil pendiente (sin reglas revisadas) no se publica');
select ok(public.stores_launch_checklist(tests.fx('store_a')) -> 'issues' @> '[{"code": "compliance_profile"}]',
          'ni se lanza la tienda');

-- 6. Reglas: solo la plataforma (aal2), validadas.
select is(pg_temp.err(format($$select public.platform_compliance_rule_save(%L, '{"kind":"required_field","key":"usa",
            "label":"Modo de uso","field_key":"usage"}')$$, tests.fx('profile'))),
          'forbidden', 'la tienda no edita reglas');
select is(tests.row_count($$ select * from public.compliance_rules $$), 0::bigint, 'ni las lee directamente');
select tests.logout();
select tests.login('psupport');
select is(pg_temp.err(format($$select public.platform_compliance_rule_save(%L, '{"kind":"required_field","key":"usa",
            "label":"Modo de uso","field_key":"usage"}')$$, tests.fx('profile'))),
          'forbidden', 'soporte de plataforma tampoco');
select tests.logout();
select tests.login('padmin', 'aal1');
select is(pg_temp.err(format($$select public.platform_compliance_rule_save(%L, '{"kind":"required_field","key":"usa",
            "label":"Modo de uso","field_key":"usage"}')$$, tests.fx('profile'))),
          'mfa_required', 'platform_admin sin aal2: no');
select tests.logout();
select tests.login('padmin');
select is(pg_temp.err(format($$select public.platform_compliance_rule_save(%L, '{"kind":"required_field","key":"x1",
            "label":"X","field_key":"precio"}')$$, tests.fx('profile'))),
          'validation_failed/field_key', 'campo obligatorio fuera de la ficha: rechazado');
select is(pg_temp.err(format($$select public.platform_compliance_rule_save(%L, '{"kind":"required_legend","key":"l1",
            "label":"Leyenda","body":"Texto del asesor","placements":[]}')$$, tests.fx('profile'))),
          'validation_failed/placements', 'una leyenda dice dónde se muestra');
select is(pg_temp.err(format($$select public.platform_compliance_rule_save(%L, '{"kind":"forbidden_term","key":"t1",
            "label":"Término","body":"x"}')$$, tests.fx('profile'))),
          'validation_failed/body', 'término de al menos 2 caracteres');
select lives_ok(format($$select public.platform_compliance_rule_save(%L, '{"kind":"required_field","key":"usa",
            "label":"Modo de uso","field_key":"usage"}')$$, tests.fx('profile')), 'campo obligatorio');
select lives_ok(format($$select public.platform_compliance_rule_save(%L, '{"kind":"required_legend","key":"leyenda_1",
            "label":"Leyenda (texto de prueba)","body":"TEXTO DE PRUEBA DEL ASESOR","placements":["product_page","checkout"]}')$$,
            tests.fx('profile')), 'leyenda');
select lives_ok(format($$select public.platform_compliance_rule_save(%L, '{"kind":"forbidden_term","key":"no_cura",
            "label":"Afirmación terapéutica (prueba)","body":"cura"}')$$, tests.fx('profile')), 'término prohibido');
select is(pg_temp.err(format($$select public.platform_compliance_rule_save(%L, '{"kind":"required_field","key":"no_cura",
            "label":"Otro","field_key":"form"}')$$, tests.fx('profile'))),
          'validation_failed/kind', 'una regla no cambia de tipo');

-- 7. Activar exige quién revisó; queda con fecha y versión.
select is(pg_temp.err(format($$select public.platform_compliance_profile_set_status(%L, 'active', ' ', null)$$,
            tests.fx('profile'))), 'validation_failed/reviewed_by', 'activar sin revisor: rechazado');
select lives_ok(format($$select public.platform_compliance_profile_set_status(%L, 'active', 'Asesoría de prueba', 'Prueba')$$,
                       tests.fx('profile')), 'activar con revisor');
select tests.logout();
select is((select status || ':' || version || ':' || (reviewed_at is not null) from public.compliance_profiles
            where id = tests.fx('profile')), 'active:2:true', 'perfil activo, versión 2, con fecha de revisión');

-- 8. Campos obligatorios y términos prohibidos (palabra completa, sin acentos ni mayúsculas).
select tests.login('owner');
select is(pg_temp.err($$select public.catalog_publish_product(tests.fx('store_a'), tests.fx('omega'))$$),
          'validation_failed/publish/compliance_field_missing:usage', 'falta el campo obligatorio');
select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('omega'), 'dietary_supplement',
  '{"ingredients": "Aceite de pescado", "usage": "Procurar tomar con alimentos"}');
select is(pg_temp.codes(tests.fx('omega')), '{}'::text[], '"procurar" no coincide con el término "cura"');
select public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object('id', tests.fx('omega'),
  'title', 'Omega 3', 'slug', 'omega-3', 'description_html', '<p>Te CÚRA</p>', 'variants',
  (select jsonb_agg(jsonb_build_object('id', v.id, 'price', v.price)) from public.product_variants v
    where v.product_id = tests.fx('omega'))));
select is(pg_temp.codes(tests.fx('omega')), array['compliance_forbidden_term:no_cura'],
          'el término en la descripción, con acento y mayúsculas, se detecta');
select public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object('id', tests.fx('omega'),
  'title', 'Omega 3', 'slug', 'omega-3', 'description_html', '<p>Aceite</p>', 'variants',
  (select jsonb_agg(jsonb_build_object('id', v.id, 'price', v.price)) from public.product_variants v
    where v.product_id = tests.fx('omega'))));
select lives_ok($$select public.catalog_publish_product(tests.fx('store_a'), tests.fx('omega'))$$,
                'cumple: se publica');
select is((public.compliance_store_status(tests.fx('store_a')) -> 'categories' -> 0 -> 'legends' -> 0 ->> 'text'),
          'TEXTO DE PRUEBA DEL ASESOR', 'la tienda ve el texto vigente de la leyenda');

-- 9. Un producto publicado no deja de cumplir al guardar su ficha.
select is(pg_temp.err($$select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('omega'),
            'dietary_supplement', '{"ingredients": "Aceite de pescado"}')$$),
          'validation_failed/publish/compliance_field_missing:usage', 'quitar un campo obligatorio de uno publicado: rechazado');
select is((select data ->> 'usage' from public.product_regulatory_info where product_id = tests.fx('omega')),
          'Procurar tomar con alimentos', 'y la ficha no cambió');
select tests.logout();

-- 10. Una regla nueva que deja de cumplir: el worker despublica (denegación por defecto).
select tests.login('padmin');
select public.platform_compliance_rule_save(tests.fx('profile'), '{"kind":"required_field","key":"adv",
  "label":"Advertencias","field_key":"warnings"}');
select tests.logout();
select ok(exists (select 1 from system.jobs where type = 'compliance.recheck'
                    and dedupe_key = 'compliance.recheck:' || tests.fx('profile') || ':v3'),
          'el cambio sube la versión y encola la revisión');
select is(pg_temp.recheck(tests.fx('profile'), null) - 'checked',
          jsonb_build_object('unpublished', 1, 'stores', jsonb_build_array(tests.fx('store_a')), 'done', true),
          'la revisión despublica lo que ya no cumple');
select is((select status from public.products where id = tests.fx('omega')), 'draft', 'queda en borrador');
select is((select reason || ':' || (metadata -> 'codes' ->> 0) from audit.audit_logs
            where action = 'product.unpublished' and entity_id = tests.fx('omega')),
          'compliance:compliance_field_missing:warnings', 'auditado con el motivo');

-- 10b. Por lotes: con un lote lleno, la función encola su continuación.
select tests.login('owner');
select tests.set_fx('lote1', pg_temp.product('a', 'Lote uno', 'lote-uno'));
select tests.set_fx('lote2', pg_temp.product('a', 'Lote dos', 'lote-dos'));
select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('lote1'), 'dietary_supplement',
  '{"usage": "Uso de prueba", "warnings": "Advertencia de prueba"}');
select public.catalog_save_regulatory_info(tests.fx('store_a'), tests.fx('lote2'), 'dietary_supplement',
  '{"usage": "Uso de prueba", "warnings": "Advertencia de prueba"}');
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('lote1'));
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('lote2'));
select tests.logout();
select is(pg_temp.recheck_one(tests.fx('profile')) - 'stores',
          '{"checked": 1, "unpublished": 0, "done": false}'::jsonb, 'un lote lleno no termina la revisión');
select ok(exists (select 1 from system.jobs where type = 'compliance.recheck'
                    and payload ->> 'after' = tests.fx('lote1')::text),
          'y encola su continuación desde el último producto revisado');

-- 11. Revisión por tienda: una publicación sin clasificar que se coló se despublica.
select tests.login('owner');
select tests.set_fx('colado', pg_temp.product('a', 'Colado', 'colado'));
select tests.logout();
update public.products set status = 'active', published_at = now() where id = tests.fx('colado');
select is(pg_temp.recheck(null, tests.fx('store_a')) ->> 'unpublished', '1', 'revisión de tienda: lo no clasificado baja');

-- 12. Retirar la categoría: no mientras la use un producto.
select tests.login('owner');
select is(pg_temp.err($$select public.compliance_set_store_category(tests.fx('store_a'), 'dietary_supplement', false)$$),
          'conflict/category_in_use', 'no se retira una categoría en uso');

-- 13. Aislamiento y tiendas no reguladas.
select tests.logout();
select tests.login('owner_b');
select is((select count(*)::int from public.product_regulatory_info), 0, 'otra tienda no ve fichas ajenas');
select is(pg_temp.err(format($$select public.catalog_get_regulatory_info(%L, %L)$$, tests.fx('store_a'), tests.fx('omega'))),
          'forbidden', 'ni por RPC');
select is(pg_temp.err(format($$select public.catalog_save_regulatory_info(%L, %L, 'dietary_supplement', '{}')$$,
            tests.fx('store_b'), tests.fx('omega'))), 'not_found/product', 'ni la escribe desde su tienda');
select tests.set_fx('libre', pg_temp.product('b', 'Taza', 'taza'));
select lives_ok($$select public.catalog_publish_product(tests.fx('store_b'), tests.fx('libre'))$$,
                'la tienda que no declara categorías publica como siempre');

-- 14. La FK hacia las categorías declaradas no impide borrar la tienda en cascada.
select tests.logout();
select lives_ok(format($$ delete from public.stores where id = %L $$, tests.fx('store_a')),
                'una tienda con fichas y categorías declaradas se borra en cascada');

select * from finish();
rollback;
