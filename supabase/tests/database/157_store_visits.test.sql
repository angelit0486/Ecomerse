-- =============================================================================
-- Visitantes de la tienda (20261126000200): el gateway suma una visita solo en
-- tiendas publicadas y no puede leer la tabla; cada tienda ve solo las suyas con
-- `analytics.read`; la plataforma ve los 7 días en «Mis clientes».
-- =============================================================================
begin;
select plan(14);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('padmin', 'admin@plataforma.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');
select tests.make_platform_staff('padmin', 'platform_admin');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');
-- La tienda B sigue en preparación (borrador).

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

-- Escritura: solo por el gateway de la tienda. (Con su rol mínimo no hay
-- funciones de pgTAP: se hacen las llamadas y el resultado se anota en una
-- variable de la sesión para comprobarlo después.)
select tests.as_role('storefront_gateway');
select storefront.record_visit(tests.fx('store_a'));
select storefront.record_visit(tests.fx('store_a'));
select storefront.record_visit(tests.fx('store_b'));
do $$
begin
  perform count(*) from public.store_visits_daily;
  perform set_config('tests.gw_read', 'leyó', false);
exception when insufficient_privilege then
  perform set_config('tests.gw_read', 'denegado', false);
end $$;
reset role;
select is(current_setting('tests.gw_read'), 'denegado', 'el gateway no puede leer la tabla');
select is((select visitors from public.store_visits_daily where store_id = tests.fx('store_a')), 2,
          'A: dos visitantes hoy (el gateway sumó dos veces)');
select is((select count(*)::int from public.store_visits_daily where store_id = tests.fx('store_b')), 0,
          'una tienda sin publicar no cuenta (y la llamada no falla)');
select is((select day from public.store_visits_daily where store_id = tests.fx('store_a')),
          (now() at time zone 'America/Mexico_City')::date, 'el día es el de la zona horaria de la tienda');

select tests.as_role('anon');
do $$
begin
  perform storefront.record_visit(tests.fx('store_a'));
  perform set_config('tests.anon_exec', 'ejecutó', false);
exception when insufficient_privilege then
  perform set_config('tests.anon_exec', 'denegado', false);
end $$;
reset role;
select is(current_setting('tests.anon_exec'), 'denegado',
          'un visitante anónimo no puede llamar a la función directo');
select is((select visitors from public.store_visits_daily where store_id = tests.fx('store_a')), 2,
          'y no sumó');

-- Lectura: cada tienda, solo las suyas.
select tests.login('owner_a');
select is((public.dashboard_visits(tests.fx('store_a'), null, null) ->> 'visitors')::int, 2,
          'la dueña de A ve sus visitantes del periodo');
select is((public.dashboard_visits(tests.fx('store_a'), null, null) ->> 'counting_since')::date,
          (now() at time zone 'America/Mexico_City')::date, 'y desde cuándo se cuenta');
select is((select count(*)::int from public.store_visits_daily), 1, 'por RLS solo ve su fila');
select is(pg_temp.err($$ select public.dashboard_visits(tests.fx('store_b'), null, null) $$), 'forbidden',
          'no puede ver las visitas de otra tienda');
select tests.logout();
select tests.login('owner_b');
select is((select count(*)::int from public.store_visits_daily), 0, 'la dueña de B no ve las de A');
select ok((public.dashboard_visits(tests.fx('store_b'), null, null) ->> 'counting_since') is null,
          'B: sin visitas aún, «desde cuándo» queda vacío (no un cero engañoso)');
select tests.logout();

-- Plataforma: «Mis clientes» con los 7 días.
select tests.login('padmin');
select is((select visitors_7d from public.platform_store_overview(null, 300)
            where store_id = tests.fx('store_a')), 2, 'la plataforma ve los visitantes de 7 días de A');
select tests.logout();

select is(public.app_schema_version(), '20261127000100', 'versión de la base');

select * from finish();
rollback;
