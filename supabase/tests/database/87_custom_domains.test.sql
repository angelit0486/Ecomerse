-- =============================================================================
-- E16 · Dominio propio: alta pendiente con token (solo su hash), verificación
-- solo por el worker con el TXT correcto y el proveedor listo, principal con
-- 301 desde la dirección de la plataforma, quitar, y aislamiento entre tiendas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

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
insert into public.platform_settings (key, value) values ('storefront.root_domain', '{"domain":"pruva.test"}')
on conflict (key) do update set value = excluded.value;

create function tests.domain(p_host text) returns public.store_domains language sql security definer
set search_path = '' as $$ select * from public.store_domains where hostname = p_host $$;
create function tests.platform_host() returns text language sql security definer set search_path = '' as $$
  select hostname from public.store_domains
   where store_id = tests.fx('store_a') and type = 'platform_subdomain' order by created_at limit 1 $$;
create function tests.check_jobs(p_id uuid) returns integer language sql security definer set search_path = '' as $$
  select count(*)::int from system.jobs where type = 'domains.verify' and payload ->> 'domain_id' = p_id::text $$;
grant execute on all functions in schema tests to authenticated;

create function pg_temp.worker(p_id uuid, p_txt text[], p_provider text) returns text language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'system_worker', true);
  v := system.domains_record_check(p_id, p_txt, p_provider, 'prj_1');
  perform set_config('role', 'none', true);
  return v ->> 'status';
end $$;

create function pg_temp.resolve(p_host text) returns table (store_id uuid, primary_hostname text)
language plpgsql as $$
begin
  perform set_config('role', 'storefront_gateway', true);
  return query select r.store_id, r.primary_hostname from storefront.resolve_host(p_host) r;
  perform set_config('role', 'none', true);
end $$;

-- 1. Alta.
select tests.login('owner');
select set_config('test.token', public.domains_add_custom(tests.fx('store_a'), 'WWW.MiTienda.mx.') ->> 'token', true);
select is((tests.domain('www.mitienda.mx')).status, 'pending', 'el dominio queda pendiente (en minúsculas)');
select ok((tests.domain('www.mitienda.mx')).verification_token_hash = sha256(convert_to(current_setting('test.token'), 'UTF8')),
          'solo se guarda el hash del token');
select is(tests.check_jobs((tests.domain('www.mitienda.mx')).id), 1, 'se encola la primera revisión');
select is(pg_temp.err(format('select public.domains_add_custom(%L, %L)', tests.fx('store_a'), 'x.pruva.test')),
          'validation_failed/platform_domain', 'no se puede usar el dominio de la plataforma');
select is(pg_temp.err(format('select public.domains_add_custom(%L, %L)', tests.fx('store_a'), 'no válido')),
          'validation_failed/hostname', 'un nombre inválido se rechaza');
select is(pg_temp.err(format('select public.domains_set_primary(%L, %L)', tests.fx('store_a'),
            (tests.domain('www.mitienda.mx')).id)), 'validation_failed/not_active',
          'un dominio sin verificar no puede ser el principal');
-- El panel no tiene forma de declararlo verificado.
select is(pg_temp.err(format('select system.domains_record_check(%L, %L, %L, null)',
            (tests.domain('www.mitienda.mx')).id, array[current_setting('test.token')], 'ready')),
          'permission denied for schema system', 'el panel no puede marcar un dominio verificado');
select tests.logout();

-- 2. Verificación por el worker.
select is(pg_temp.worker((tests.domain('www.mitienda.mx')).id, array['otro-token'], 'ready'), 'verifying',
          'con otro TXT sigue en verificación');
select is(pg_temp.worker((tests.domain('www.mitienda.mx')).id, array[current_setting('test.token')], 'pending'), 'verifying',
          'con el TXT pero sin certificado, también');
select is(pg_temp.worker((tests.domain('www.mitienda.mx')).id, array['"' || current_setting('test.token') || '"'], 'ready'),
          'active', 'con el TXT y el proveedor listo, activo');

-- 3. Principal: la dirección de la plataforma redirige al dominio propio.
select tests.login('owner');
select is(pg_temp.err(format('select public.domains_set_primary(%L, %L)', tests.fx('store_a'),
            (tests.domain('www.mitienda.mx')).id)), 'ok', 'se hace principal');
select tests.logout();
select is((select primary_hostname from pg_temp.resolve(tests.platform_host())), 'www.mitienda.mx',
          'la dirección de la plataforma apunta al principal (el proxy redirige 301)');
select set_config('role', 'none', true);
select is((select store_id from pg_temp.resolve('www.mitienda.mx')), tests.fx('store_a'),
          'el dominio propio resuelve a su tienda');
select set_config('role', 'none', true);

-- 4. Aislamiento y permisos.
select tests.login('owner_b');
select is(pg_temp.err(format('select public.domains_add_custom(%L, %L)', tests.fx('store_b'), 'www.mitienda.mx')),
          'validation_failed/taken', 'otra tienda no puede tomar el dominio');
select is(pg_temp.err(format('select public.domains_remove(%L, %L)', tests.fx('store_b'),
            (tests.domain('www.mitienda.mx')).id)), 'not_found/domain', 'ni quitarlo con su tienda');
select is(pg_temp.err(format('select public.domains_remove(%L, %L)', tests.fx('store_a'),
            (tests.domain('www.mitienda.mx')).id)), 'forbidden', 'ni con el id de la tienda de A');
select tests.logout();
select tests.login('cat');
select is(pg_temp.err(format('select public.domains_add_custom(%L, %L)', tests.fx('store_a'), 'shop.mitienda.mx')),
          'forbidden', 'Catálogo no gestiona dominios');
select tests.logout();

-- 5. Quitar el principal devuelve la dirección de la plataforma.
select tests.login('owner');
select is(pg_temp.err(format('select public.domains_remove(%L, %L)', tests.fx('store_a'),
            (tests.domain('www.mitienda.mx')).id)), 'ok', 'se quita');
select tests.logout();
select ok((tests.domain(tests.platform_host())).is_primary, 'la dirección de la plataforma vuelve a ser la principal');
select is((select count(*)::int from pg_temp.resolve('www.mitienda.mx')), 0,
          'el dominio quitado ya no resuelve');
select set_config('role', 'none', true);

select * from finish();
rollback;
