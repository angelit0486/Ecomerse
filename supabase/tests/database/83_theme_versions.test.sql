-- =============================================================================
-- ADR-034 §4 · Historial de versiones del diseño: cada publicación guarda una
-- versión, se conservan 30, «Restaurar» la copia al borrador (no publica),
-- revalida referencias, y nadie ve ni restaura versiones de otra tienda.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('cat', 'cat@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'cat', 'catalog_manager');

create function pg_temp.publish(p_store text, p_heading text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform public.appearance_save_home_draft(tests.fx('store_' || p_store), jsonb_build_array(jsonb_build_object(
    'id', '00000000-0000-4000-8000-000000000001', 'type', 'hero', 'enabled', true,
    'props', jsonb_build_object('heading', p_heading, 'align', 'center'))), tests.theme_rev(tests.fx('store_' || p_store)));
  v := public.appearance_publish_theme(tests.fx('store_' || p_store), tests.theme_rev(tests.fx('store_' || p_store)));
  return v;
end $$;
create function pg_temp.versions(p_store text) returns integer language sql security definer as $$
  select count(*)::int from public.store_theme_versions where store_id = tests.fx('store_' || p_store)
$$;
create function pg_temp.version_id(p_store text, p_number integer) returns uuid language sql security definer as $$
  select id from public.store_theme_versions where store_id = tests.fx('store_' || p_store) and number = p_number
$$;
create function pg_temp.draft_heading(p_store text) returns text language sql security definer as $$
  select draft_home_sections #>> '{0,props,heading}' from public.store_themes where store_id = tests.fx('store_' || p_store)
$$;
create function pg_temp.live_heading(p_store text) returns text language sql security definer as $$
  select home_sections #>> '{0,props,heading}' from public.store_themes where store_id = tests.fx('store_' || p_store)
$$;
create function pg_temp.restored_audits() returns integer language sql security definer as $$
  select count(*)::int from audit.audit_logs where action = 'theme.version_restored' and store_id = tests.fx('store_a')
$$;
grant execute on all functions in schema tests to authenticated;

-- 1. Publicar guarda una versión numerada.
select tests.login('owner');
select is((pg_temp.publish('a', 'Primera') ->> 'version')::int, 1, 'la primera publicación es la versión 1');
select is((pg_temp.publish('a', 'Segunda') ->> 'version')::int, 2, 'la siguiente, la 2');
select is(pg_temp.versions('a'), 2, 'quedan las dos');
select is((select count(*)::int from public.store_theme_versions), 2, 'la dueña ve sus versiones');

-- 2. Restaurar copia al borrador; lo publicado no cambia.
select tests.set_fx('v1', pg_temp.version_id('a', 1));
select is(pg_temp.err(format('select public.appearance_restore_theme_version(%L, %L, %s)',
            tests.fx('store_a'), tests.fx('v1'), tests.theme_rev(tests.fx('store_a')))), 'ok',
          'restaurar la versión 1');
select is(pg_temp.draft_heading('a'), 'Primera', 'el borrador tiene la versión 1');
select is(pg_temp.live_heading('a'), 'Segunda', 'la tienda sigue con lo publicado');
select is(pg_temp.err(format('select public.appearance_restore_theme_version(%L, %L, %s)',
            tests.fx('store_a'), tests.fx('v1'), tests.theme_rev(tests.fx('store_a')) - 1)),
          'conflict/draft_revision', 'con una revisión vieja: conflicto, no pisa');
select is(pg_temp.restored_audits(), 1, 'restaurar queda en la auditoría');
select tests.logout();

-- 3. Aislamiento: la otra tienda no ve ni restaura versiones de A.
select tests.login('owner_b');
select is((select count(*)::int from public.store_theme_versions), 0, 'B no ve versiones de A');
select is(pg_temp.err(format('select public.appearance_restore_theme_version(%L, %L, 0)',
            tests.fx('store_b'), tests.fx('v1'))), 'not_found/version',
          'la versión de A no existe para B');
select is(pg_temp.err(format('select public.appearance_restore_theme_version(%L, %L, 0)',
            tests.fx('store_a'), tests.fx('v1'))), 'forbidden', 'ni con el id de la tienda de A');
select tests.logout();

-- 4. Sin permiso de apariencia, nada.
select tests.login('cat');
select is((select count(*)::int from public.store_theme_versions), 0, 'Catálogo no ve el historial');
select tests.logout();

-- 5. Solo se conservan 30.
select tests.login('owner');
select pg_temp.publish('a', 'Versión ' || n) from generate_series(3, 32) n;
select is(pg_temp.versions('a'), 30, 'se conservan las últimas 30');
select is((select min(number) from public.store_theme_versions where store_id = tests.fx('store_a')), 3,
          'se podan las más viejas');
select tests.logout();

-- 6. Las versiones no se editan.
select throws_ok($$ update public.store_theme_versions set number = 99 $$, '42501', 'append_only',
                 'una versión no se puede editar');

select * from finish();
rollback;
