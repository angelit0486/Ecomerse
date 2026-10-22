-- =============================================================================
-- ADR-038: la dueña o una administradora de la organización crea otra tienda
-- desde su panel (`org_create_store`, permiso `org.stores.create`). Solo en su
-- organización, con verificación en dos pasos, el límite del plan, en borrador
-- y con auditoría; la otra organización no la ve.
-- =============================================================================
begin;
select plan(19);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
create function pg_temp.create(p_org text, p_name text, p_handle text) returns text language sql as $$
  select pg_temp.err(format('select public.org_create_store(%L, %L, %L)', tests.fx(p_org), p_name, p_handle))
$$;

insert into public.platform_settings (key, value) values ('storefront.root_domain', '{"domain":"tiendas.test"}')
on conflict (key) do update set value = excluded.value;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('orgadmin', 'admin@a.io');
select tests.create_user('staff', 'staff@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_org_member('org_a', 'orgadmin', 'org_admin');
select tests.add_store_member('a', 'staff', 'store_admin');

create function tests.store_by_handle(p_handle text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.stores where handle = p_handle $$;
create function tests.store_setup(p_store uuid) returns text[] language sql security definer set search_path = '' as $$
  select array[
    (select s.organization_id::text from public.stores s where s.id = p_store),
    (select s.status || ':' || s.currency || ':' || s.timezone from public.stores s where s.id = p_store),
    (select d.hostname || ':' || d.status || ':' || d.is_primary::text
       from public.store_domains d where d.store_id = p_store),
    (select count(*)::text from public.store_themes t where t.store_id = p_store),
    (select count(*)::text from public.store_counters c where c.store_id = p_store and c.key = 'order_number'),
    (select count(*)::text from audit.audit_logs l where l.store_id = p_store and l.action = 'store.created')] $$;
grant execute on all functions in schema tests to authenticated;

-- 1. Quién puede.
select tests.login('staff');
select is(pg_temp.create('org_a', 'Intento', 'intento-staff'), 'forbidden',
          'el equipo de una tienda (sin rol de organización) no crea tiendas');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.create('org_a', 'Ajena', 'tienda-ajena'), 'forbidden',
          'la dueña de otra organización no crea tiendas en A');
select tests.logout();
select tests.login('owner', 'aal1');
select is(pg_temp.create('org_a', 'Sin 2FA', 'sin-dos-pasos'), 'mfa_required',
          'sin verificación en dos pasos no se puede');
select tests.logout();
select is(pg_temp.create('org_a', 'Anónima', 'anonima'), 'unauthenticated', 'sin sesión no se puede');

-- 2. Alta por la dueña: borrador, subdominio, tema, contador y auditoría; hereda
--    moneda y zona horaria de la primera tienda.
select tests.login('owner');
select is(public.org_create_store(tests.fx('org_a'), '  PRUVA Mujer  ', 'Pruva-Mujer') ->> 'hostname',
          'pruva-mujer.tiendas.test', 'la dueña crea la tienda y recibe su dirección');
select is(tests.store_setup(tests.store_by_handle('pruva-mujer')),
          array[tests.fx('org_a')::text, 'draft:MXN:America/Mexico_City',
                'pruva-mujer.tiendas.test:active:true', '1', '1', '1'],
          'en su organización, en borrador, con subdominio, tema, contador y auditoría');
select ok(app.has_store_permission(tests.store_by_handle('pruva-mujer'), 'store.update'),
          'y la administra');

-- 3. Validación.
select is(pg_temp.create('org_a', 'Otra', 'pruva-mujer'), 'conflict/handle', 'dirección repetida');
select is(pg_temp.create('org_a', 'Otra', 'a'), 'validation_failed/store_handle', 'dirección demasiado corta');
select is(pg_temp.create('org_a', 'Otra', 'mi--tienda'), 'validation_failed/store_handle', 'dirección con «--»');
select is(pg_temp.create('org_a', 'Otra', 'admin'), 'validation_failed/store_handle', 'dirección reservada');
select is(pg_temp.create('org_a', ' ', 'sin-nombre'), 'validation_failed/store_name', 'sin nombre');
select tests.logout();

-- 4. Administradora de la organización y límite del plan (max_stores = 3; A ya tiene 2).
select tests.login('orgadmin');
select is(pg_temp.create('org_a', 'Tercera', 'tercera-tienda'), 'ok',
          'la administradora de la organización también puede');
select ok(pg_temp.create('org_a', 'Cuarta', 'cuarta-tienda') like 'limit_reached%',
          'la cuarta rebasa el límite del plan');
select tests.logout();

-- 5. La otra organización no la ve; la cuenta en solo lectura no crea.
select tests.login('owner_b');
select is((select count(*)::int from public.stores where id = tests.store_by_handle('pruva-mujer')), 0,
          'la dueña de B no la ve (RLS)');
select tests.logout();
update public.organizations set status = 'suspended' where id = tests.fx('org_b');
select tests.login('owner_b');
select is(pg_temp.create('org_b', 'Suspendida', 'suspendida'), 'forbidden',
          'una organización suspendida no crea tiendas');
select tests.logout();

select tests.login('owner');
select is((select array_agg(organization_id) from public.access_orgs_can_create_stores()), array[tests.fx('org_a')],
          'la dueña ve «Nueva tienda» solo en su organización');
select tests.logout();
select tests.login('staff');
select is((select count(*)::int from public.access_orgs_can_create_stores()), 0,
          'el equipo de una tienda no lo ve');
select tests.logout();

select ok(not has_function_privilege('anon', 'public.org_create_store(uuid, text, text)', 'execute'),
          'anon no puede ejecutarla');

select * from finish();
rollback;
