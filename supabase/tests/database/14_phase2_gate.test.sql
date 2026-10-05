-- =============================================================================
-- Gate F2 · Permiso con usuario explícito (worker) y auditoría de configuración.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('cat', 'cat@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'cat', 'catalog_manager');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function tests.worker_can(p_user text, p_store text, p_perm text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('role', 'system_worker', true);
  v := system.user_has_store_permission(tests.fx(p_user), tests.fx('store_' || p_store), p_perm);
  perform set_config('role', 'none', true);
  return v;
end $$;
grant execute on all functions in schema tests to system_worker;

select ok(tests.worker_can('owner', 'a', 'staff.manage'), 'dueño: todos los permisos de su tienda');
select ok(tests.worker_can('cat', 'a', 'products.update'), 'catalog_manager: permisos de catálogo');
select ok(not tests.worker_can('cat', 'a', 'staff.manage'), 'catalog_manager: sin staff.manage');
select ok(not tests.worker_can('cat', 'b', 'products.read'), 'nada en otra tienda');
select ok(not tests.worker_can('owner', 'a', 'org.billing.read'), 'nunca permisos org.*');
update public.organization_members set status = 'suspended' where user_id = tests.fx('cat');
select ok(not tests.worker_can('cat', 'a', 'products.read'), 'miembro suspendido: sin permisos');
update public.subscriptions set status = 'paused' where organization_id = tests.fx('org_a');
select ok(not tests.worker_can('owner', 'a', 'products.update') and tests.worker_can('owner', 'a', 'products.read'),
  'modo solo lectura: niega escritura, permite lectura');
select is(tests.sqlstate_as('authenticated',
  format('select system.user_has_store_permission(%L, %L, %L)', tests.fx('owner'), tests.fx('store_a'), 'store.read')),
  '42501', 'solo el worker ejecuta la variante con usuario explícito');

-- Auditoría de configuración por trigger.
insert into public.plans (key, name) values ('gate_plan', 'Plan gate');
select is((select count(*)::int from audit.audit_logs where action = 'config.insert' and entity_type = 'plans'
            and after ->> 'key' = 'gate_plan'), 1, 'alta de plan auditada');
select is((select count(*)::int from audit.audit_logs where action = 'config.update' and entity_type = 'subscriptions'
            and organization_id = tests.fx('org_a')), 1, 'cambio de suscripción auditado con su organización');
insert into public.platform_settings (key, value) values ('gate.test', '{"x": 1}');
select is((select count(*)::int from audit.audit_logs where action = 'config.insert' and entity_type = 'platform_settings'),
  1, 'cambio de configuración de plataforma auditado');

-- Reset de MFA: no si el usuario tiene acceso en otra organización o es staff de plataforma.
select tests.create_user('shared', 'shared@x.io');
select tests.add_org_member('org_a', 'shared', 'org_member');
select tests.add_org_member('org_b', 'shared', 'org_member');
select tests.create_user('staffer', 'staffer@platform.io');
select tests.add_org_member('org_a', 'staffer', 'org_member');
select tests.make_platform_staff('staffer', 'platform_support');
update public.subscriptions set status = 'active' where organization_id = tests.fx('org_a');
select tests.logout(); select tests.login('owner');
select throws_ok(format($$ select public.access_authorize_mfa_reset(%L, %L) $$, tests.fx('org_a'), tests.fx('shared')),
  '42501', 'forbidden', 'miembro de otra organización: la organización no puede resetear su MFA');
select throws_ok(format($$ select public.access_authorize_mfa_reset(%L, %L) $$, tests.fx('org_a'), tests.fx('staffer')),
  '42501', 'forbidden', 'staff de plataforma: la organización no puede resetear su MFA');
select lives_ok(format($$ select public.access_authorize_mfa_reset(%L, %L) $$, tests.fx('org_a'), tests.fx('cat')),
  'miembro solo de esta organización: sí');
select tests.logout();

-- Reactivar en la tienda a un miembro suspendido en la organización: error explícito.
select tests.logout(); select tests.login('owner');
select throws_ok(format($$ select public.access_reactivate_member(%L, %L, %L) $$,
                        tests.fx('org_a'), tests.fx('cat'), tests.fx('store_a')),
  'P0001', 'member_org_suspended', 'reactivar en la tienda no oculta la suspensión de la organización');
select tests.logout();

select * from finish();
rollback;
