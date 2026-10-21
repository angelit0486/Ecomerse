-- =============================================================================
-- ADR-034 §6 · Importar un diseño: va al borrador en una transacción, solo
-- cambia las claves de diseño (SEO y contacto se quedan), valida como siempre y
-- nadie importa en otra tienda.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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

create function tests.draft(p_store text) returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('settings', draft_settings, 'sections', draft_home_sections)
    from public.store_themes where store_id = tests.fx('store_' || p_store) $$;
create function tests.import_audits() returns integer language sql security definer set search_path = '' as $$
  select count(*)::int from audit.audit_logs where action = 'theme.design_imported' and store_id = tests.fx('store_a') $$;
grant execute on all functions in schema tests to authenticated;

create function pg_temp.sections() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000001', 'type', 'hero',
    'enabled', true, 'props', jsonb_build_object('heading', 'Importado', 'align', 'center')))
$$;
create function pg_temp.import(p_store text, p_settings jsonb, p_rev integer default null) returns text
language plpgsql as $$
begin
  return pg_temp.err(format('select public.appearance_import_design(%L, %L, %L, %s, %L)',
    tests.fx('store_' || p_store), p_settings, pg_temp.sections(),
    coalesce(p_rev, tests.theme_rev(tests.fx('store_a'))), 'file'));
end $$;

select tests.login('owner');
-- Un borrador con SEO, contacto y una forma que el archivo no trae.
select public.appearance_save_theme_draft(tests.fx('store_a'),
  '{"seo":{"title":"Mi tienda"},"contact":{"whatsapp":"+525512345678"},"shape":{"radius":"full"}}',
  tests.theme_rev(tests.fx('store_a')));

select is(pg_temp.import('a', '{"colors":{"primary":"#0b2d5b"}}'), 'ok', 'la dueña importa un diseño');
select is(tests.draft('a') #>> '{settings,colors,primary}', '#0b2d5b', 'los colores llegan al borrador');
select is(tests.draft('a') #>> '{sections,0,props,heading}', 'Importado', 'y la portada');
select ok(not (tests.draft('a') -> 'settings' ? 'shape'), 'las claves de diseño que no vienen se quitan');
select is(tests.draft('a') #>> '{settings,seo,title}', 'Mi tienda', 'el SEO de la tienda se queda');
select is(tests.import_audits(), 1, 'queda en la auditoría');
select is(pg_temp.import('a', '{"seo":{"title":"Otra"}}'), 'validation_failed/design',
          'el archivo no puede cambiar SEO, contacto ni redes');
select is(pg_temp.import('a', '{"colors":{"primary":"#0b2d5b"}}', tests.theme_rev(tests.fx('store_a')) - 1),
          'conflict/draft_revision', 'con una revisión vieja no pisa');
select tests.logout();

select tests.login('owner_b');
select is(pg_temp.import('a', '{"colors":{"primary":"#0b2d5b"}}'), 'forbidden',
          'B no importa en la tienda de A');
select tests.logout();

select * from finish();
rollback;
