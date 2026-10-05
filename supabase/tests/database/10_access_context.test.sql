-- =============================================================================
-- Fase 2 · Contexto de autorización por request (F2-T05).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('cat', 'cat@a.io');
select tests.create_user('psupport', 'support@platform.io');
select tests.create_user('padmin', 'admin@platform.io');
select tests.make_platform_staff('psupport', 'platform_support');
select tests.make_platform_staff('padmin', 'platform_admin');
select tests.create_tenant('a', 'owner');
select tests.create_store('a2', 'org_a');
select tests.add_store_member('a', 'cat', 'catalog_manager');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function tests.ctx(p_handle text) returns jsonb language sql as
  $$ select public.access_store_context(p_handle) $$;
grant execute on all functions in schema tests to authenticated;

select tests.logout(); select tests.login('owner');
select is((tests.ctx('Tienda-A') -> 'store' ->> 'id')::uuid, tests.fx('store_a'),
  'el dueño resuelve su tienda por handle (sin distinguir mayúsculas)');
select ok(tests.ctx('tienda-a') -> 'permissions' ? 'staff.manage', 'el dueño tiene staff.manage');
select is(tests.ctx('tienda-a') ->> 'org_role', 'org_owner', 'incluye el rol de organización');
select is(tests.ctx('tienda-a') ->> 'access_mode', 'full', 'incluye el modo de acceso');
select is((select count(*)::int from public.access_list_my_stores()), 2, 'el dueño lista sus dos tiendas');

select tests.logout(); select tests.login('cat');
select ok(tests.ctx('tienda-a') -> 'permissions' ? 'products.update'
          and not (tests.ctx('tienda-a') -> 'permissions' ? 'staff.manage'),
  'catalog_manager: permisos de catálogo, sin staff.manage');
select ok(not (tests.ctx('tienda-a') -> 'permissions' ? 'org.billing.read'),
  'nunca incluye permisos org.* (regla 5)');
select is((select array_agg(handle) from public.access_list_my_stores()), array['tienda-a'],
  'catalog_manager solo lista su tienda');
select throws_ok($$ select tests.ctx('tienda-a2') $$, 'P0001', 'not_found',
  'otra tienda de su organización: not_found');

select tests.logout(); select tests.login('owner_b');
select throws_ok($$ select tests.ctx('tienda-a') $$, 'P0001', 'not_found',
  'otro tenant: not_found, igual que una tienda inexistente');
select throws_ok($$ select tests.ctx('no-existe') $$, 'P0001', 'not_found', 'handle inexistente');

select tests.logout(); select tests.login('owner', 'aal1');
select throws_ok($$ select tests.ctx('tienda-a') $$, '42501', 'mfa_required', 'sin 2FA no hay contexto de staff');

-- Soporte con concesión: solo permisos de lectura y el id de la concesión.
select tests.logout(); select tests.login('padmin');
select public.platform_grant_support_access(tests.fx('store_a'), tests.fx('psupport'),
                                            'Ticket 77: revisar la configuración de la tienda', 30);
select tests.logout(); select tests.login('psupport');
select ok(tests.ctx('tienda-a') ->> 'support_grant_id' is not null
          and tests.ctx('tienda-a') -> 'permissions' ? 'orders.read'
          and not (tests.ctx('tienda-a') -> 'permissions' ? 'orders.update'),
  'soporte: concesión identificada y solo lectura');
select is((select array_agg(handle) from public.access_list_my_stores()), array['tienda-a'],
  'soporte lista solo la tienda concedida');

-- Organización suspendida: sin contexto ni tiendas.
select tests.logout();
update public.organizations set status = 'suspended' where id = tests.fx('org_a');
select tests.logout(); select tests.login('owner');
select throws_ok($$ select tests.ctx('tienda-a') $$, 'P0001', 'not_found', 'organización suspendida: sin contexto');
select is((select count(*)::int from public.access_list_my_stores()), 0, 'ni tiendas en el selector');
select tests.logout();

select * from finish();
rollback;
