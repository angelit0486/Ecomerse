-- =============================================================================
-- Fase 2 · Integridad de identidad y tenancy (constraints y triggers).
-- Se ejecuta como postgres: prueba lo que la base garantiza incluso sin RLS.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

select tests.create_user('owner_a', 'owner.a@test.io');
select tests.create_user('owner_b', 'owner.b@test.io');
select tests.create_user('staff_x', 'staff.x@test.io');
select tests.create_user('support', 'support@platform.io');
select tests.create_user('padmin', 'admin@platform.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');

-- Perfiles ----------------------------------------------------------------------
select ok(exists (select 1 from public.profiles where id = tests.fx('owner_a')),
  'crear un auth.user crea su perfil');

-- Handles de tienda ---------------------------------------------------------------
select throws_ok($$ insert into public.stores (organization_id, name, handle, currency, country, timezone)
  values (tests.fx('org_a'), 'X', 'admin', 'MXN', 'MX', 'America/Mexico_City') $$,
  '23514', null, 'handle reservado rechazado');
select throws_ok($$ insert into public.stores (organization_id, name, handle, currency, country, timezone)
  values (tests.fx('org_a'), 'X', 'Mi-Tienda', 'MXN', 'MX', 'America/Mexico_City') $$,
  '23514', null, 'handle con mayúsculas rechazado');
select throws_ok($$ insert into public.stores (organization_id, name, handle, currency, country, timezone)
  values (tests.fx('org_a'), 'X', 'mi--tienda', 'MXN', 'MX', 'America/Mexico_City') $$,
  '23514', null, 'handle con "--" rechazado');
select throws_ok($$ insert into public.stores (organization_id, name, handle, currency, country, timezone)
  values (tests.fx('org_a'), 'X', 'tienda-zz', 'MXN', 'MX', 'Marte/Olimpo') $$,
  '23514', 'invalid_timezone', 'zona horaria inexistente rechazada');
select throws_ok($$ update public.stores set handle = 'otro-handle' where id = tests.fx('store_a') $$,
  '42501', 'column_immutable', 'el handle es inmutable');
select throws_ok($$ update public.stores set organization_id = tests.fx('org_b') where id = tests.fx('store_a') $$,
  '42501', 'tenant_immutable', 'una tienda no puede cambiar de organización');

update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');
select throws_ok($$ update public.stores set currency = 'USD' where id = tests.fx('store_a') $$,
  '42501', 'column_immutable', 'la moneda es inmutable tras el lanzamiento');
select throws_ok($$ update public.stores set status = 'active', launched_at = null where id = tests.fx('store_b') $$,
  '23514', null, 'una tienda activa debe tener fecha de lanzamiento');

-- Dominios ------------------------------------------------------------------------
select throws_ok($$ insert into public.store_domains (store_id, hostname, type) values
  (tests.fx('store_a'), 'Tienda.Example.com', 'custom') $$, '23514', null, 'hostname en mayúsculas rechazado');
select throws_ok($$ insert into public.store_domains (store_id, hostname, type) values
  (tests.fx('store_a'), 'evil.com/path', 'custom') $$, '23514', null, 'hostname inválido rechazado');
select throws_ok($$ insert into public.store_domains (store_id, hostname, type, status, is_primary) values
  (tests.fx('store_a'), 'www.tienda-a.com', 'custom', 'active', true) $$, '23505', null,
  'solo un dominio primario por tienda');
select throws_ok($$ insert into public.store_domains (store_id, hostname, type) values
  (tests.fx('store_b'), 'tienda-a.tiendas.test', 'custom') $$, '23505', null,
  'un hostname pertenece a una sola tienda en toda la plataforma');
select throws_ok($$ update public.store_domains set store_id = tests.fx('store_b')
  where store_id = tests.fx('store_a') $$, '42501', 'tenant_immutable', 'un dominio no puede moverse de tienda');

-- Membresías ----------------------------------------------------------------------
select throws_ok($$ insert into public.organization_members (organization_id, user_id, role)
  values (tests.fx('org_a'), tests.fx('staff_x'), 'org_owner') $$, '23505', null,
  'solo un dueño por organización');
select throws_ok($$ insert into public.store_members (store_id, user_id, role_id)
  values (tests.fx('store_a'), tests.fx('staff_x'), (select id from public.roles where key = 'viewer')) $$,
  '23514', 'store_member_not_in_organization', 'un miembro de tienda debe pertenecer a la organización');
select tests.add_store_member('a', 'staff_x', 'viewer');
select throws_ok($$ update public.store_members set store_id = tests.fx('store_b')
  where user_id = tests.fx('staff_x') $$, '42501', 'tenant_immutable', 'una membresía no puede moverse de tienda');
select throws_ok($$ insert into public.role_permissions (role_id, permission_key)
  values ((select id from public.roles where key = 'viewer'), 'org.billing.manage') $$, '23514', null,
  'los permisos de organización no se asignan a roles de tienda');

-- Invitaciones: FK compuesta (organización, tienda) --------------------------------
select throws_ok($$ insert into public.organization_invitations
  (organization_id, store_id, email, store_role_id, expires_at)
  values (tests.fx('org_a'), tests.fx('store_b'), 'x@test.io',
          (select id from public.roles where key = 'viewer'), now() + interval '1 day') $$,
  '23503', null, 'una invitación de la org A no puede apuntar a una tienda de la org B');

-- Concesiones de soporte -------------------------------------------------------------
select throws_ok($$ insert into public.support_access_grants
  (organization_id, store_id, grantee_user_id, granted_by, reason, expires_at)
  values (tests.fx('org_a'), tests.fx('store_a'), tests.fx('support'), tests.fx('padmin'),
          'Revisión del ticket 123 solicitada por el cliente', now() + interval '61 minutes') $$,
  '23514', null, 'una concesión de soporte no puede durar más de 60 minutos');
select throws_ok($$ insert into public.support_access_grants
  (organization_id, store_id, grantee_user_id, granted_by, reason, expires_at)
  values (tests.fx('org_a'), tests.fx('store_a'), tests.fx('support'), tests.fx('support'),
          'Revisión del ticket 123 solicitada por el cliente', now() + interval '30 minutes') $$,
  '23514', null, 'nadie puede concederse soporte a sí mismo');
select throws_ok($$ insert into public.support_access_grants
  (organization_id, store_id, grantee_user_id, granted_by, reason, expires_at)
  values (tests.fx('org_a'), tests.fx('store_a'), tests.fx('support'), tests.fx('padmin'),
          'corto', now() + interval '30 minutes') $$,
  '23514', null, 'el motivo es obligatorio (mínimo 20 caracteres)');
select throws_ok($$ insert into public.support_access_grants
  (organization_id, store_id, grantee_user_id, granted_by, reason, expires_at)
  values (tests.fx('org_b'), tests.fx('store_a'), tests.fx('support'), tests.fx('padmin'),
          'Revisión del ticket 123 solicitada por el cliente', now() + interval '30 minutes') $$,
  '23503', null, 'la concesión debe ser coherente: la tienda pertenece a la organización');

-- Branding ----------------------------------------------------------------------------
select lives_ok($$ update public.store_themes
  set draft_settings = '{"colors":{"primary":"#1d4ed8","background":"#ffffff"},"shape":{"radius":"md"}}'
  where store_id = tests.fx('store_a') $$, 'tokens de marca válidos aceptados');
select throws_ok($$ update public.store_themes set draft_settings = '{"colors":{"primary":"red"}}'
  where store_id = tests.fx('store_a') $$, '23514', null, 'color que no es hexadecimal rechazado');
select throws_ok($$ update public.store_themes set draft_settings = '{"css":"body{}"}'
  where store_id = tests.fx('store_a') $$, '23514', null, 'claves desconocidas (p. ej. CSS libre) rechazadas');

-- Límites del plan (aplicados por trigger, también para roles privilegiados) ---------
select tests.ensure_plan('plan_una_tienda', 1, 2);
update public.subscriptions set plan_id = (select id from public.plans where key = 'plan_una_tienda')
 where organization_id = tests.fx('org_b');
select throws_ok($$ select tests.create_store('b2', 'org_b') $$, 'P0001', 'limit_reached',
  'max_stores se aplica en la base de datos');
select tests.add_org_member('org_b', 'staff_x', 'org_member');
select throws_ok($$ select tests.add_org_member('org_b', 'support', 'org_member') $$, 'P0001', 'limit_reached',
  'max_staff se aplica en la base de datos');

select * from finish();
rollback;
