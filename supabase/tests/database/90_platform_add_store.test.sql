-- Pulido: la plataforma agrega una tienda a una organización existente
-- (`platform_add_store`). Respeta max_stores, solo platform_owner/admin, el dueño
-- de la organización la administra y otra organización no la ve.
begin;
select plan(14);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

insert into public.platform_settings (key, value) values ('storefront.root_domain', '{"domain":"tiendas.test"}')
on conflict (key) do update set value = excluded.value;

select tests.create_user('admin', 'admin@plataforma.io');
select tests.create_user('support', 'support@plataforma.io');
select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.make_platform_staff('admin', 'platform_admin');
select tests.make_platform_staff('support', 'platform_support');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');

create function tests.new_store() returns uuid language sql security definer set search_path = '' as $$
  select id from public.stores where handle = 'pruva-mujer' $$;
create function tests.store_setup(p_store uuid) returns text[] language sql security definer set search_path = '' as $$
  select array[
    (select s.organization_id::text from public.stores s where s.id = p_store),
    (select d.hostname || ':' || d.status || ':' || d.is_primary::text
       from public.store_domains d where d.store_id = p_store),
    (select count(*)::text from public.store_themes t where t.store_id = p_store),
    (select count(*)::text from public.store_counters c where c.store_id = p_store and c.key = 'order_number'),
    (select count(*)::text from audit.audit_logs l where l.store_id = p_store and l.action = 'store.created')] $$;
create function tests.store_status(p_store uuid) returns text language sql security definer set search_path = '' as $$
  select status from public.stores where id = p_store $$;
grant execute on all functions in schema tests to authenticated;

-- 1. Permisos: solo platform_owner o platform_admin.
select tests.login('support');
select is(pg_temp.err(format('select public.platform_add_store(%L, %L, %L)', tests.fx('org_a'),
            'PRUVA Mujer', 'pruva-mujer')), 'forbidden', 'soporte no agrega tiendas');
select tests.logout();
select tests.login('owner');
select is(pg_temp.err(format('select public.platform_add_store(%L, %L, %L)', tests.fx('org_a'),
            'PRUVA Mujer', 'pruva-mujer')), 'forbidden', 'la dueña tampoco: la crea la plataforma (E15)');
select tests.logout();

-- 2. Alta: tienda en la organización, subdominio activo y principal, tema,
--    contador y auditoría.
select tests.login('admin');
select is(public.platform_add_store(tests.fx('org_a'), 'PRUVA Mujer', 'Pruva-Mujer') ->> 'hostname',
          'pruva-mujer.tiendas.test', 'la plataforma agrega la tienda y devuelve su dirección');
select is(tests.store_setup(tests.new_store()),
          array[tests.fx('org_a')::text, 'pruva-mujer.tiendas.test:active:true', '1', '1', '1'],
          'en la organización A, con subdominio, tema, contador y auditoría');
select is(tests.store_status(tests.new_store()), 'draft',
          'nace en borrador: no se vende hasta lanzarla');

-- 3. Errores: nombre de dirección repetido, organización inexistente o suspendida.
select is(pg_temp.err(format('select public.platform_add_store(%L, %L, %L)', tests.fx('org_b'),
            'Otra', 'pruva-mujer')), 'conflict/handle', 'la dirección ya existe');
select is(pg_temp.err(format('select public.platform_add_store(%L, %L, %L)', gen_random_uuid(),
            'Otra', 'otra-tienda')), 'not_found/organization', 'organización inexistente');
select tests.logout();
update public.organizations set status = 'suspended' where id = tests.fx('org_b');
select tests.login('admin');
select is(pg_temp.err(format('select public.platform_add_store(%L, %L, %L)', tests.fx('org_b'),
            'Otra', 'otra-tienda')), 'validation_failed/organization_status', 'organización suspendida');
select tests.logout();
update public.organizations set status = 'active' where id = tests.fx('org_b');
select tests.login('admin');

-- 4. Límite del plan (max_stores = 3 en el plan de prueba; A ya tiene 2).
select is(pg_temp.err(format('select public.platform_add_store(%L, %L, %L)', tests.fx('org_a'),
            'Tercera', 'tercera-tienda')), 'ok', 'la tercera cabe en el plan');
select ok(pg_temp.err(format('select public.platform_add_store(%L, %L, %L)', tests.fx('org_a'),
            'Cuarta', 'cuarta-tienda')) like 'limit_reached%', 'la cuarta rebasa max_stores');
select tests.logout();

-- 5. La dueña de A la administra; la de B no la ve.
select tests.login('owner');
select ok(app.has_store_permission(tests.new_store(), 'store.update'), 'la dueña de A administra la tienda nueva');
select is((select count(*)::int from public.stores where id = tests.new_store()), 1,
          'y la ve en su lista de tiendas');
select tests.logout();
select tests.login('owner_b');
select ok(not app.has_store_permission(tests.new_store(), 'store.read'), 'la dueña de B no tiene permisos');
select is((select count(*)::int from public.stores where id = tests.new_store()), 0, 'ni la ve (RLS)');
select tests.logout();

select * from finish();
rollback;
