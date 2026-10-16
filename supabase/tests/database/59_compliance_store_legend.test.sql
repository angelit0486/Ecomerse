-- =============================================================================
-- Fase A · Cumplimiento real configurable: reglas propuestas de México
-- (PENDIENTE DE REVISIÓN), contenido neto, leyenda de la tienda (borrador y
-- aprobado), validador de la tienda y aislamiento entre tiendas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '') || coalesce('/' || nullif(v_hint, ''), '');
end $$;
create function pg_temp.gw(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'storefront_gateway', true);
  execute format('select to_jsonb(t.x) from (%s) t(x)', p_sql) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;

select tests.set_fx('profile', (select id from public.compliance_profiles
                                 where country = 'MX' and category_key = 'dietary_supplement'));

-- -----------------------------------------------------------------------------
-- 1. Reglas propuestas: pendientes, sin revisor y sin las de demostración
-- -----------------------------------------------------------------------------
select is((select status || ':' || (reviewed_by is null) || ':' || (reviewed_at is null)
             from public.compliance_profiles where id = tests.fx('profile')),
          'pending:true:true', 'el perfil de México queda pendiente y sin revisor');
select ok((select review_notes like '%PENDIENTE DE REVISIÓN%' from public.compliance_profiles
            where id = tests.fx('profile')), 'las notas dicen PENDIENTE DE REVISIÓN');
select is((select array_agg(field_key order by position) from public.compliance_rules
            where profile_id = tests.fx('profile') and status = 'active' and kind = 'required_field'),
          array['ingredients', 'usage', 'warnings', 'net_content'],
          'campos obligatorios propuestos: ingredientes, modo de uso, advertencias y contenido neto');
select is((select placements from public.compliance_rules
            where profile_id = tests.fx('profile') and key = 'leyenda_tienda' and status = 'active'),
          array['product_page', 'cart', 'checkout'], 'la leyenda de la tienda se pide en ficha, carrito y checkout');
select ok((select body like 'PENDIENTE DE REVISIÓN%' from public.compliance_rules
            where profile_id = tests.fx('profile') and key = 'leyenda_tienda'),
          'el borrador sugerido está marcado PENDIENTE DE REVISIÓN');
select ok((select count(*) >= 10 from public.compliance_rules
            where profile_id = tests.fx('profile') and status = 'active' and kind = 'forbidden_term'),
          'lista inicial de términos prohibidos');
select is((select count(*)::integer from public.compliance_rules
            where profile_id = tests.fx('profile') and key like 'demo\_%' and status = 'active'), 0,
          'ninguna regla de demostración activa');

-- -----------------------------------------------------------------------------
-- 2. Contenido neto en la ficha
-- -----------------------------------------------------------------------------
select is(app.regulatory_normalize('dietary_supplement', '{"net_content":"  60 cápsulas "}'),
          '{"net_content":"60 cápsulas"}'::jsonb, 'contenido neto se acepta y se recorta');
select is(pg_temp.err($$select app.regulatory_normalize('dietary_supplement', jsonb_build_object('net_content', repeat('x', 101)))$$),
          'validation_failed/regulatory/net_content', 'contenido neto: hasta 100 caracteres');

-- -----------------------------------------------------------------------------
-- 3. Con las reglas propuestas activas (como si el asesor las aprobara)
-- -----------------------------------------------------------------------------
select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_user('padmin', 'admin@plataforma.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.make_platform_staff('padmin', 'platform_admin');

select tests.login('padmin');
select lives_ok(format($$select public.platform_compliance_rule_save(%L,
  '{"kind":"store_legend","key":"leyenda_extra","label":"Sin borrador","placements":["cart"],"position":99}')$$,
  tests.fx('profile')), 'una regla store_legend no necesita borrador sugerido');
select is(pg_temp.err(format($$select public.platform_compliance_rule_save(%L,
  '{"kind":"store_legend","key":"leyenda_mala","label":"Sin lugar","placements":[]}')$$, tests.fx('profile'))),
  'validation_failed/placements', 'pero sí al menos un lugar');
select tests.logout();
select tests.set_fx('extra', (select id from public.compliance_rules
                               where profile_id = tests.fx('profile') and key = 'leyenda_extra'));
select tests.login('padmin');
select public.platform_compliance_rule_retire(tests.fx('extra'));
select public.platform_compliance_profile_set_status(tests.fx('profile'), 'active', 'Asesoría de prueba', null);
select tests.logout();

create function pg_temp.codes(p_product uuid) returns text[] language sql as $$
  select coalesce(array_agg(c.code order by c.code) filter (where c.code like 'compliance%'), '{}')
    from public.catalog_validate_product(tests.fx('store_a'), p_product) c
$$;
create function pg_temp.supplement(p_slug text, p_data jsonb, p_extra jsonb default '{}') returns uuid
language plpgsql as $$
declare v uuid;
begin
  v := (public.catalog_upsert_product(tests.fx('store_a'), jsonb_build_object(
          'title', 'Producto ' || p_slug, 'slug', p_slug, 'variants', '[{"price":19900}]'::jsonb) || p_extra) ->> 'id')::uuid;
  perform public.catalog_save_regulatory_info(tests.fx('store_a'), v, 'dietary_supplement', p_data);
  return v;
end $$;

select tests.login('owner');
select public.compliance_set_store_category(tests.fx('store_a'), 'dietary_supplement', true);
select tests.set_fx('vacio', pg_temp.supplement('vacio', '{}'));
select is(pg_temp.codes(tests.fx('vacio')),
          array['compliance_field_missing:ingredients', 'compliance_field_missing:net_content',
                'compliance_field_missing:usage', 'compliance_field_missing:warnings',
                'compliance_store_legend_pending'],
          'sin ficha ni leyenda: faltan los cuatro campos y la leyenda de la tienda');
select tests.set_fx('completo', pg_temp.supplement('completo',
  '{"ingredients":"Proteína de suero","usage":"Una medida al día","warnings":"Si padeces alguna enfermedad o estás en tratamiento médico, consulta a tu médico.","net_content":"907 g"}'));
select is(pg_temp.codes(tests.fx('completo')), array['compliance_store_legend_pending'],
          'ficha completa (advertencia con «enfermedad» y «tratamiento» permitida): solo falta la leyenda');
select is(pg_temp.err(format('select public.catalog_publish_product(%L, %L)', tests.fx('store_a'), tests.fx('completo'))),
          'validation_failed/publish/compliance_store_legend_pending', 'sin leyenda aprobada no se publica');

select is(pg_temp.codes(pg_temp.supplement('cura', '{"ingredients":"x","usage":"x","warnings":"x","net_content":"1"}',
                                           '{"description_html":"<p>Te cura en días</p>"}')),
          array['compliance_forbidden_term:termino_cura', 'compliance_store_legend_pending'], '«cura» se detecta');
select is(pg_temp.codes(pg_temp.supplement('procura', '{"ingredients":"x","usage":"x","warnings":"x","net_content":"1"}',
                                           '{"description_html":"<p>Procura hidratarte; trata de dormir bien.</p>"}')),
          array['compliance_store_legend_pending'], '«procura» y «trata» no son términos prohibidos');
select is(pg_temp.codes(pg_temp.supplement('milagro', '{"ingredients":"x","usage":"x","warnings":"x","net_content":"1"}',
                                           '{"title":"Fórmula MILAGROSA, resultados garantizados"}')),
          array['compliance_forbidden_term:termino_garantizados', 'compliance_forbidden_term:termino_milagrosa',
                'compliance_store_legend_pending'], 'mayúsculas, acentos y frases de varias palabras');

-- -----------------------------------------------------------------------------
-- 4. Leyenda de la tienda: borrador, aprobación y permisos
-- -----------------------------------------------------------------------------
select ok((public.compliance_store_status(tests.fx('store_a')) #>> '{categories,0,store_legend,suggested}')
            like 'PENDIENTE DE REVISIÓN%', 'Ajustes → Cumplimiento ve el borrador sugerido');
select is(pg_temp.err(format($$select public.compliance_save_store_legend(%L, 'dietary_supplement',
            'PENDIENTE DE REVISIÓN: texto', true, 'Asesora Regulatoria')$$, tests.fx('store_a'))),
          'validation_failed/pending_marker', 'no se aprueba un texto que aún diga PENDIENTE DE REVISIÓN');
select is(pg_temp.err(format($$select public.compliance_save_store_legend(%L, 'dietary_supplement',
            'Leyenda revisada.', true, ' ')$$, tests.fx('store_a'))),
          'validation_failed/reviewed_by', 'aprobar exige el nombre de quien revisó');
select is(pg_temp.err(format($$select public.compliance_save_store_legend(%L, 'dietary_supplement', '   ', false, null)$$,
            tests.fx('store_a'))), 'validation_failed/body', 'el texto no puede ir vacío');
select is(pg_temp.err(format($$select public.compliance_save_store_legend(%L, 'dietary_supplement',
            'PENDIENTE DE REVISIÓN: borrador', false, null)$$, tests.fx('store_a'))), 'ok',
          'el borrador se guarda sin aprobar');
select is(pg_temp.codes(tests.fx('completo')), array['compliance_store_legend_pending'],
          'un borrador no basta para publicar');
select tests.logout();

select tests.login('viewer');
select is(pg_temp.err(format($$select public.compliance_save_store_legend(%L, 'dietary_supplement', 'Texto', false, null)$$,
            tests.fx('store_a'))), 'forbidden', 'un rol sin store.update no la edita');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.err(format($$select public.compliance_save_store_legend(%L, 'dietary_supplement', 'Texto', true, 'Alguien')$$,
            tests.fx('store_a'))), 'forbidden', 'otra tienda no la edita');
select is(pg_temp.err(format('select public.compliance_store_report(%L)', tests.fx('store_a'))), 'forbidden',
          'ni lee el validador de otra tienda');
select is(tests.row_count('select * from public.store_compliance_legends'), 0::bigint,
          'ni lee su leyenda directamente (RLS)');
select tests.logout();

select tests.login('owner');
select is(pg_temp.err(format($$select public.compliance_save_store_legend(%L, 'dietary_supplement',
            'Leyenda revisada por la asesora.', true, 'Asesora Regulatoria')$$, tests.fx('store_a'))), 'ok',
          'el texto revisado se aprueba con el nombre de quien revisó');
select is(pg_temp.codes(tests.fx('completo')), '{}'::text[], 'con la leyenda aprobada la ficha completa cumple');
select is(pg_temp.err(format('select public.catalog_publish_product(%L, %L)', tests.fx('store_a'), tests.fx('completo'))),
          'ok', 'y se publica');
select public.compliance_save_store_legend(tests.fx('store_a'), 'dietary_supplement', 'Nuevo borrador en edición.',
                                           false, null);
select is((select approved_body || '|' || draft_body || '|' || reviewed_by from public.store_compliance_legends
            where store_id = tests.fx('store_a')),
          'Leyenda revisada por la asesora.|Nuevo borrador en edición.|Asesora Regulatoria',
          'editar el borrador no cambia el texto aprobado');
select is(tests.row_count('select * from public.store_compliance_legends'), 1::bigint,
          'la dueña lee la leyenda de su tienda');

select is((public.compliance_store_report(tests.fx('store_a')) ->> 'total')::integer, 3,
          'el validador lista los 3 que no se pueden publicar (sin ficha, «cura» y «milagrosa»)');
select is((select x -> 'codes' from jsonb_array_elements(public.compliance_store_report(tests.fx('store_a')) -> 'products') x
            where x ->> 'title' = 'Producto cura'),
          '["compliance_forbidden_term:termino_cura"]'::jsonb, 'con el motivo de cada uno');
select tests.logout();

-- -----------------------------------------------------------------------------
-- 5. La tienda pública muestra el texto aprobado (nunca el sugerido ni el borrador)
-- -----------------------------------------------------------------------------
select is(pg_temp.gw(format('select storefront.get_product_regulatory(%L, %L)', tests.fx('store_a'), 'completo'))
            -> 'legends', '[{"key":"leyenda_tienda","text":"Leyenda revisada por la asesora."}]'::jsonb,
          'la ficha del producto muestra la leyenda aprobada');
select is(app.compliance_legends(tests.fx('store_a'), 'dietary_supplement', 'checkout'),
          '[{"key":"leyenda_tienda","text":"Leyenda revisada por la asesora."}]'::jsonb, 'también en el checkout');
select is(app.compliance_legends(tests.fx('store_b'), 'dietary_supplement', 'cart'), '[]'::jsonb,
          'otra tienda sin leyenda aprobada no muestra nada');

select is((select count(*)::integer from audit.audit_logs
            where store_id = tests.fx('store_a') and action in ('store.compliance_legend_saved',
                                                                'store.compliance_legend_approved')), 3,
          'cada guardado y aprobación queda auditado');

select * from finish();
rollback;
