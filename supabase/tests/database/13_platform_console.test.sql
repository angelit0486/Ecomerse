-- =============================================================================
-- Fase 2 · Consola de plataforma: lecturas (F2-T12).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select tests.create_user('padmin', 'admin@platform.io');
select tests.create_user('psupport', 'support@platform.io');
select tests.create_user('psupport2', 'support2@platform.io');
select tests.make_platform_staff('padmin', 'platform_admin');
select tests.make_platform_staff('psupport', 'platform_support');
select tests.make_platform_staff('psupport2', 'platform_support');
select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

insert into public.support_access_grants (organization_id, store_id, grantee_user_id, granted_by, reason, expires_at)
values (tests.fx('org_a'), tests.fx('store_a'), tests.fx('psupport'), tests.fx('padmin'),
        'Ticket 1: revisar la configuración de envíos', now() + interval '30 minutes'),
       (tests.fx('org_b'), tests.fx('store_b'), tests.fx('psupport2'), tests.fx('padmin'),
        'Ticket 2: revisar los pedidos pendientes de pago', now() + interval '30 minutes');

select tests.logout(); select tests.login('padmin');
select is(public.access_platform_role(), 'platform_admin', 'rol de plataforma del usuario');
select is((select count(*)::int from public.platform_list_organizations()), 2, 'admin lista las organizaciones');
select is((select owner_email from public.platform_list_organizations('org-a')), 'owner@a.io',
  'búsqueda por slug con el email del dueño');
select is((select count(*)::int from public.platform_list_organizations('100%')), 0,
  'los comodines de la búsqueda se escapan');
select is((select primary_hostname from public.platform_list_stores(tests.fx('org_a'))), 'tienda-a.tiendas.test',
  'tiendas de una organización con su dominio primario');
select is((select count(*)::int from public.platform_list_support_grants()), 2, 'admin ve todas las concesiones');
select is((select count(*)::int from public.platform_list_support_staff()), 3, 'staff elegible para concesiones');

select tests.logout(); select tests.login('psupport');
select is((select count(*)::int from public.platform_list_organizations()), 2, 'soporte ve metadatos de organizaciones');
select is((select array_agg(store_name) from public.platform_list_support_grants()), array['Tienda a'],
  'soporte ve solo sus concesiones');
select throws_ok($$ select * from public.platform_list_support_staff() $$, '42501', 'forbidden',
  'soporte no lista al staff');

select tests.logout(); select tests.login('owner');
select is(public.access_platform_role(), null::text, 'un dueño de tienda no tiene rol de plataforma');
select throws_ok($$ select * from public.platform_list_organizations() $$, '42501', 'forbidden',
  'un tenant no lista organizaciones');

select tests.logout(); select tests.login('padmin', 'aal1');
select is(public.access_platform_role(), null::text, 'sin 2FA no hay rol de plataforma');
select tests.logout();
select is(tests.sqlstate_as('anon', 'select * from public.platform_list_organizations()'), '42501',
  'anon no ejecuta');

select * from finish();
rollback;
