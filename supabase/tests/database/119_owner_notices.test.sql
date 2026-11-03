-- =============================================================================
-- Avisos al dueño (D-F2-16, D-F2-20): suspender, reactivar y cerrar desde la
-- plataforma, y transferir la propiedad, encolan el aviso en la misma
-- transacción; el motivo interno no viaja; el worker solo obtiene correos de
-- miembros de esa organización.
-- =============================================================================
begin;
select plan(11);

select tests.create_user('padmin', 'admin@platform.io');
select tests.make_platform_staff('padmin', 'platform_admin');
select tests.create_user('owner', 'owner@a.io');
select tests.create_user('admin', 'admin@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_org_member('org_a', 'admin', 'org_admin');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function pg_temp.notices() returns setof jsonb language sql as $$
  select j.payload from system.jobs j where j.type = 'tenant.owner_notice' order by j.created_at, j.id $$;
create function pg_temp.contacts(p_org uuid, p_store uuid, p_users uuid[]) returns setof text
language plpgsql as $$
declare r record;
begin
  perform tests.as_role('system_worker');
  for r in select c.email from system.owner_notice_contacts(p_org, p_store, p_users) c loop
    return next r.email;
  end loop;
  perform tests.logout();
end $$;

update public.stores set launched_at = now() where id = tests.fx('store_a');

select tests.login('padmin');
select public.platform_set_tenant_status(tests.fx('org_a'), 'suspended', 'Revisión de pagos reportados', tests.fx('store_a'));
select tests.logout();
select is((select count(*)::int from pg_temp.notices()), 1, 'suspender una tienda encola un aviso');
select is((select n ->> 'kind' || '/' || (n ->> 'store_status') from pg_temp.notices() n), 'suspended/suspended',
          'con el tipo y el estado de la tienda');
select ok((select not (n::text like '%Revisión de pagos%') from pg_temp.notices() n),
          'el motivo interno no viaja en el aviso');

select tests.login('padmin');
select public.platform_set_tenant_status(tests.fx('org_a'), 'suspended', 'Revisión de pagos reportados', tests.fx('store_a'));
select tests.logout();
select is((select count(*)::int from pg_temp.notices()), 1, 'repetir el mismo estado no avisa otra vez');

select tests.login('padmin');
select public.platform_set_tenant_status(tests.fx('org_a'), 'active', 'Pagos revisados y correctos', tests.fx('store_a'));
select tests.logout();
select is((select n ->> 'kind' || '/' || (n ->> 'store_status') from pg_temp.notices() n offset 1),
          'reactivated/paused', 'reactivar avisa que la tienda quedó en pausa');

select tests.login('padmin');
select public.platform_set_tenant_status(tests.fx('org_b'), 'closed', 'Cierre solicitado por el titular');
select tests.logout();
select is((select n ->> 'kind' from pg_temp.notices() n offset 2), 'closed', 'cerrar una organización avisa');

select tests.login('owner');
select public.access_transfer_ownership(tests.fx('org_a'), tests.fx('admin'));
select tests.logout();
select is((select (n ->> 'previous_owner')::uuid = tests.fx('owner') and (n ->> 'new_owner')::uuid = tests.fx('admin')
             from pg_temp.notices() n where n ->> 'kind' = 'ownership_transferred'), true,
          'transferir la propiedad avisa a quien entrega y a quien recibe');

select is(array(select pg_temp.contacts(tests.fx('org_a'), null, null)), array['admin@a.io'],
          'sin lista: el dueño actual (tras la transferencia)');
select is(array(select pg_temp.contacts(tests.fx('org_a'), null, array[tests.fx('owner_b')])), '{}'::text[],
          'nunca el correo de alguien de otra organización');
select is((select c.store_name from system.owner_notice_contacts(tests.fx('org_a'), tests.fx('store_b'), null) c),
          null, 'una tienda de otra organización no aporta su nombre');
select ok(not has_function_privilege('authenticated', 'system.owner_notice_contacts(uuid,uuid,uuid[])', 'execute')
          and not has_function_privilege('storefront_gateway', 'system.owner_notice_contacts(uuid,uuid,uuid[])', 'execute'),
          'solo el worker lee los correos');

select * from finish();
rollback;
