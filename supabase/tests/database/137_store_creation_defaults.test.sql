-- =============================================================================
-- Crear tiendas en la demostración (2026-11-10): dirección temporal con prefijo
-- (`pruva-tienda-<dirección>.vercel.app`), alta en el hosting por job y
-- funciones que nacen encendidas (la tienda las puede apagar). Las tiendas que
-- ya existen no cambian y otra organización no ve ni toca nada.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
create function pg_temp.root(p_value jsonb) returns void language sql as $$
  insert into public.platform_settings (key, value) values ('storefront.root_domain', p_value)
  on conflict (key) do update set value = excluded.value
$$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('admin', 'admin@plataforma.io');
select tests.make_platform_staff('admin', 'platform_admin');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');

create function tests.store_by_handle(p_handle text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.stores where handle = p_handle $$;
create function tests.domain_of(p_store uuid) returns uuid language sql security definer set search_path = '' as $$
  select id from public.store_domains where store_id = p_store and is_primary $$;
create function tests.on_features(p_store uuid) returns text[] language sql security definer set search_path = '' as $$
  select coalesce(array_agg(f.key order by f.key), '{}') from public.feature_flags f
   where f.store_toggle and app.flag_enabled(f.key, p_store) and not f.default_enabled $$;
create function tests.attach_jobs(p_store uuid) returns integer language sql security definer set search_path = '' as $$
  select count(*)::int from system.jobs j
   where j.type = 'domains.attach_platform' and j.store_id = p_store
     and j.payload ->> 'domain_id' = (select d.id::text from public.store_domains d
                                       where d.store_id = p_store and d.is_primary) $$;
create function tests.created_features(p_store uuid) returns jsonb language sql security definer set search_path = '' as $$
  select l.after -> 'features' from audit.audit_logs l where l.store_id = p_store and l.action = 'store.created' $$;
grant execute on all functions in schema tests to authenticated;

-- ------------------------------------------------------------- 1. La dirección
select pg_temp.root('{"domain":"tiendas.test"}');
select is(app.platform_store_hostname('Mi-Tienda'), 'mi-tienda.tiendas.test', 'sin prefijo: igual que antes');
select pg_temp.root('{"domain":"vercel.app","prefix":"pruva-tienda-","attach":true}');
select is(app.platform_store_hostname('mi-tienda'), 'pruva-tienda-mi-tienda.vercel.app',
          'con prefijo: pruva-tienda-<dirección>.vercel.app');
select is(pg_temp.err($$ select app.platform_store_hostname(repeat('a', 51)) $$), 'validation_failed/store_handle',
          'una etiqueta de más de 63 caracteres no es válida');
select pg_temp.root('{"domain":"vercel.app","prefix":"Pruva tienda"}');
select is(pg_temp.err($$ select app.platform_store_hostname('x1') $$),
          'platform_not_configured/platform_settings.storefront.root_domain', 'un prefijo inválido no se usa');
delete from public.platform_settings where key = 'storefront.root_domain';
select is(pg_temp.err($$ select app.platform_store_hostname('x1') $$),
          'platform_not_configured/platform_settings.storefront.root_domain', 'sin dominio configurado: no hay dirección');

-- ---------------------------------------------- 2. La dueña crea una tienda
select pg_temp.root('{"domain":"vercel.app","prefix":"pruva-tienda-","attach":true}');
select is(pg_temp.err($$ select app.platform_store_hostname('x1') $$), 'ok', 'configurado: hay dirección');
select tests.login('owner');
select is(public.org_create_store(tests.fx('org_a'), 'Pruva Café', 'pruva-cafe') ->> 'hostname',
          'pruva-tienda-pruva-cafe.vercel.app', 'la tienda nueva recibe su dirección temporal');
select tests.logout();
select is(tests.on_features(tests.store_by_handle('pruva-cafe')),
          array['email_texts', 'order_printing', 'panel_help', 'returns', 'store_health', 'theme_personality',
                'weekly_summary'],
          'nace con las funciones de la lista encendidas');
select is(tests.created_features(tests.store_by_handle('pruva-cafe')),
          '["email_texts", "order_printing", "panel_help", "returns", "store_health", "theme_personality", "weekly_summary"]'::jsonb,
          'y queda en la auditoría del alta');
select is(tests.attach_jobs(tests.store_by_handle('pruva-cafe')), 1, 'se encola el alta de la dirección en el hosting');

select tests.login('owner');
select is((select count(*)::int from public.store_features(tests.store_by_handle('pruva-cafe')) f
            where f.key = 'returns' and f.enabled and not f.locked), 1,
          'la dueña la ve encendida y la puede cambiar (no queda bloqueada)');
select is(public.store_set_feature(tests.store_by_handle('pruva-cafe'), 'returns', false), false,
          'y la puede apagar');
select tests.logout();

-- ------------------------------------------- 3. Lo que ya existía no cambia
select is(tests.on_features(tests.fx('store_a')), '{}'::text[], 'la tienda que ya existía sigue igual');
select is(tests.on_features(tests.fx('store_b')), '{}'::text[], 'y la de otra organización también');

-- ------------------------------------------- 4. Solo funciones que la tienda puede cambiar
update public.platform_settings set value = '{"keys":["api_access","returns","no_existe","panel_help"]}'
 where key = 'stores.default_features';
update public.feature_flags set kill_switch = true where key = 'panel_help';
select pg_temp.root('{"domain":"vercel.app","prefix":"pruva-tienda-"}');
select tests.login('owner');
select is(public.org_create_store(tests.fx('org_a'), 'Pruva Dos', 'pruva-dos') ->> 'hostname',
          'pruva-tienda-pruva-dos.vercel.app', 'otra tienda');
select tests.logout();
select is(tests.on_features(tests.store_by_handle('pruva-dos')), array['returns'],
          'ni de plataforma (api_access), ni desconocidas, ni con kill switch');
select is(tests.attach_jobs(tests.store_by_handle('pruva-dos')), 0, 'sin «attach» no se encola el alta');
update public.feature_flags set kill_switch = false where key = 'panel_help';

-- ------------------------------------------- 5. Alta por la plataforma
select tests.login('admin');
select is(public.platform_add_store(tests.fx('org_b'), 'Pruva Tres', 'pruva-tres') ->> 'hostname',
          'pruva-tienda-pruva-tres.vercel.app', 'la plataforma agrega una tienda con la misma dirección');
select tests.logout();
select is(tests.on_features(tests.store_by_handle('pruva-tres')), array['panel_help', 'returns'],
          'con las funciones de la lista encendidas (sin kill switch, panel_help vuelve a entrar)');

-- ------------------------------------------- 6. Aislamiento
select tests.login('owner_b');
select is(pg_temp.err(format('select public.org_create_store(%L, %L, %L)', tests.fx('org_a'), 'Ajena', 'ajena')),
          'forbidden', 'la dueña de B no crea tiendas en A');
select is(pg_temp.err(format('select * from public.store_features(%L)', tests.store_by_handle('pruva-cafe'))),
          'forbidden', 'ni ve las funciones de la tienda de A');
select is(pg_temp.err(format('select public.store_set_feature(%L, %L, true)', tests.store_by_handle('pruva-cafe'), 'returns')),
          'forbidden', 'ni las cambia');
select tests.logout();

-- ------------------------------------------- 7. Worker: anota el alta
create function pg_temp.w_target(p_id uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'system_worker', true);
  v := system.domains_platform_target(p_id);
  perform set_config('role', 'none', true);
  return v;
end $$;
create function pg_temp.w_attached(p_id uuid, p_ref text) returns text language plpgsql as $$
declare v boolean; v_msg text; v_detail text;
begin
  perform set_config('role', 'system_worker', true);
  v := system.domains_platform_attached(p_id, p_ref);
  perform set_config('role', 'none', true);
  return v::text;
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  perform set_config('role', 'none', true);
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
select is(pg_temp.w_target(tests.domain_of(tests.store_by_handle('pruva-cafe'))) ->> 'hostname',
          'pruva-tienda-pruva-cafe.vercel.app', 'el worker sabe qué dirección dar de alta');
select is(pg_temp.w_attached(tests.domain_of(tests.store_by_handle('pruva-cafe')), 'prj_x'), 'true',
          'y anota que el hosting ya la sirve');
select is(pg_temp.w_attached(tests.domain_of(tests.store_by_handle('pruva-cafe')), 'prj_x'), 'false',
          'anotarlo otra vez no cambia nada');
select is(pg_temp.w_target(tests.domain_of(tests.store_by_handle('pruva-cafe'))), null,
          'ya dada de alta: nada que hacer');
select is(pg_temp.w_attached(tests.domain_of(tests.store_by_handle('pruva-dos')), ''),
          'validation_failed/provider_ref', 'sin referencia del hosting no se anota');
select is((select count(*)::int from audit.audit_logs l
            where l.action = 'domain.attached' and l.store_id = tests.store_by_handle('pruva-cafe')), 1,
          'queda en la auditoría');

-- ------------------------------------------- 8. Quién ejecuta qué
select ok(has_function_privilege('system_worker', 'system.domains_platform_target(uuid)', 'execute')
          and has_function_privilege('system_worker', 'system.domains_platform_attached(uuid, text)', 'execute')
          and not has_function_privilege('authenticated', 'system.domains_platform_attached(uuid, text)', 'execute')
          and not has_function_privilege('storefront_gateway', 'system.domains_platform_target(uuid)', 'execute')
          and not has_function_privilege('anon', 'system.domains_platform_target(uuid)', 'execute'),
          'solo el worker anota el alta');
select ok(not has_function_privilege('authenticated', 'app.platform_store_hostname(text)', 'execute')
          and not has_function_privilege('authenticated', 'app.store_creation_defaults(uuid, text, uuid)', 'execute')
          and not has_function_privilege('anon', 'app.store_creation_defaults(uuid, text, uuid)', 'execute'),
          'las funciones de app no se exponen');
select is(public.app_schema_version(), '20261113000400', 'versión de la base');

select * from finish();
rollback;
