-- =============================================================================
-- Fase 2 · Matriz de autorización: has_store_permission / has_org_permission.
-- GATE0 §8.3, §12.2, §19.4, CF-02 (AAL2), CF-08 (soporte).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

select tests.create_user('owner_a', 'owner.a@test.io');
select tests.create_user('owner_b', 'owner.b@test.io');
select tests.create_user('admin_a', 'admin.a@test.io');
select tests.create_user('catalog_a', 'catalog.a@test.io');
select tests.create_user('orders_a', 'orders.a@test.io');
select tests.create_user('staff_a2', 'staff.a2@test.io');
select tests.create_user('susp_a', 'susp.a@test.io');
select tests.create_user('support', 'support@platform.io');
select tests.create_user('padmin', 'admin@platform.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');
select tests.create_store('a2', 'org_a');
select tests.add_org_member('org_a', 'admin_a', 'org_admin');
select tests.add_store_member('a', 'catalog_a', 'catalog_manager');
select tests.add_store_member('a', 'orders_a', 'order_manager');
select tests.add_store_member('a2', 'staff_a2', 'viewer');
select tests.add_store_member('a', 'susp_a', 'viewer');
update public.organization_members set status = 'suspended'
 where user_id = tests.fx('susp_a') and organization_id = tests.fx('org_a');
select tests.make_platform_staff('support', 'platform_support');
select tests.make_platform_staff('padmin', 'platform_admin');

-- Dueño y AAL2 ------------------------------------------------------------------------
select tests.login('owner_a');
select ok(app.has_store_permission(tests.fx('store_a'), 'store.read'), 'dueño (aal2): store.read en su tienda');
select ok(app.has_store_permission(tests.fx('store_a2'), 'products.update'), 'dueño: permisos en todas las tiendas de su organización');
select ok(not app.has_store_permission(tests.fx('store_b'), 'store.read'), 'dueño de A: nada en la tienda B');
select ok(not app.has_store_permission(tests.fx('store_a'), 'permiso.inventado'), 'permiso desconocido = denegado');
select ok(not app.has_store_permission(tests.fx('store_a'), 'org.billing.manage'), 'un permiso org.* nunca se concede por tienda');
select tests.logout();

select tests.login('owner_a', 'aal1');
select ok(not app.has_store_permission(tests.fx('store_a'), 'store.read'), 'dueño con sesión aal1 (sin 2FA): ningún permiso de staff');
select ok(not app.has_org_permission(tests.fx('org_a'), 'org.read'), 'sesión aal1: ningún permiso de organización');
select tests.logout();

-- Administrador de organización ------------------------------------------------------------
select tests.login('admin_a');
select ok(app.has_store_permission(tests.fx('store_a'), 'appearance.manage'), 'org_admin: todos los permisos de tienda');
select ok(app.has_org_permission(tests.fx('org_a'), 'org.members.manage'), 'org_admin: gestiona miembros');
select ok(not app.has_org_permission(tests.fx('org_a'), 'org.billing.manage'), 'org_admin: NO gestiona la facturación');
select ok(not app.has_org_permission(tests.fx('org_a'), 'org.transfer_ownership'), 'org_admin: NO transfiere la propiedad');
select tests.logout();

-- Roles de tienda --------------------------------------------------------------------------
select tests.login('catalog_a');
select ok(app.has_store_permission(tests.fx('store_a'), 'products.update'), 'catalog_manager: edita productos');
select ok(not app.has_store_permission(tests.fx('store_a'), 'orders.read'), 'catalog_manager: no ve pedidos');
select ok(not app.has_store_permission(tests.fx('store_a'), 'store.update'), 'catalog_manager: no edita la tienda');
select ok(not app.has_store_permission(tests.fx('store_a'), 'payments.manage'), 'catalog_manager: no toca pagos');
select ok(not app.has_store_permission(tests.fx('store_a'), 'staff.manage'), 'catalog_manager: no gestiona el equipo');
select ok(not app.has_store_permission(tests.fx('store_a2'), 'products.read'), 'catalog_manager de A: nada en A2 (misma organización)');
select ok(app.has_org_permission(tests.fx('org_a'), 'org.read'), 'org_member: ve la organización');
select ok(not app.has_org_permission(tests.fx('org_a'), 'org.billing.read'), 'catalog_manager: NO ve la facturación');
select ok(not app.has_org_permission(tests.fx('org_a'), 'org.billing.manage'), 'catalog_manager: NO modifica la facturación');
select tests.logout();

select tests.login('staff_a2');
select ok(app.has_store_permission(tests.fx('store_a2'), 'store.read'), 'viewer de A2: lee A2');
select ok(not app.has_store_permission(tests.fx('store_a2'), 'products.update'), 'viewer: no escribe');
select ok(not app.has_store_permission(tests.fx('store_a'), 'store.read'), 'viewer de A2: nada en A');
select tests.logout();

-- Suspensiones -------------------------------------------------------------------------------
select tests.login('susp_a');
select ok(not app.has_store_permission(tests.fx('store_a'), 'store.read'),
  'membresía de organización suspendida: pierde el acceso aunque su rol de tienda siga activo');
select tests.logout();

update public.store_members set status = 'suspended' where user_id = tests.fx('orders_a');
select tests.login('orders_a');
select ok(not app.has_store_permission(tests.fx('store_a'), 'orders.read'), 'membresía de tienda suspendida: sin acceso inmediato');
select tests.logout();

update public.stores set status = 'suspended' where id = tests.fx('store_a2');
select tests.login('owner_a');
select ok(not app.has_store_permission(tests.fx('store_a2'), 'store.read'), 'tienda suspendida por la plataforma: ni el dueño accede');
select tests.logout();

-- Modo de acceso de la suscripción (GATE0 §19.4) --------------------------------------------
update public.subscriptions set status = 'paused' where organization_id = tests.fx('org_a');
select tests.login('owner_a');
select ok(app.has_store_permission(tests.fx('store_a'), 'store.read'), 'suscripción pausada: lectura permitida');
select ok(not app.has_store_permission(tests.fx('store_a'), 'store.update'), 'suscripción pausada: escritura denegada');
select ok(app.has_store_permission(tests.fx('store_a'), 'orders.fulfill'), 'suscripción pausada: operaciones con compradores permitidas');
select tests.logout();

update public.subscriptions set status = 'cancelled' where organization_id = tests.fx('org_a');
select tests.login('owner_a');
select ok(not app.has_store_permission(tests.fx('store_a'), 'store.read'), 'sin suscripción vigente: sin acceso al panel');
select ok(app.has_org_permission(tests.fx('org_a'), 'org.billing.manage'), 'sin suscripción vigente: el dueño aún puede pagar');
select ok(not app.has_org_permission(tests.fx('org_a'), 'org.update'), 'sin suscripción vigente: no edita la organización');
select tests.logout();

insert into public.subscriptions (organization_id, plan_id, status, trial_ends_at)
values (tests.fx('org_a'), (select id from public.plans where key = 'test_plan'), 'trialing', now() - interval '1 day');
select tests.login('owner_a');
select ok(not app.has_store_permission(tests.fx('store_a'), 'store.update'), 'trial vencido: solo lectura');
select tests.logout();

update public.subscriptions set status = 'past_due', grace_ends_at = now() + interval '3 days'
 where organization_id = tests.fx('org_a') and status <> 'cancelled';
select tests.login('owner_a');
select ok(app.has_store_permission(tests.fx('store_a'), 'store.update'), 'pago vencido dentro de la gracia: acceso completo');
select tests.logout();

-- Soporte de plataforma (CF-08) --------------------------------------------------------------
select tests.login('support');
select ok(not app.has_store_permission(tests.fx('store_b'), 'store.read'), 'soporte sin concesión: sin acceso');
select tests.logout();

insert into public.support_access_grants (organization_id, store_id, grantee_user_id, granted_by, reason, expires_at)
values (tests.fx('org_b'), tests.fx('store_b'), tests.fx('support'), tests.fx('padmin'),
        'Ticket 4521: el cliente no ve sus pedidos', now() + interval '30 minutes');

select tests.login('support');
select ok(app.has_store_permission(tests.fx('store_b'), 'store.read'), 'soporte con concesión vigente: lectura');
select ok(app.has_store_permission(tests.fx('store_b'), 'orders.read'), 'soporte con concesión: lectura de pedidos');
select ok(not app.has_store_permission(tests.fx('store_b'), 'store.update'), 'soporte: NUNCA escribe');
select ok(not app.has_store_permission(tests.fx('store_b'), 'customers.pii.read'), 'soporte: NUNCA ve datos sensibles');
select ok(not app.has_store_permission(tests.fx('store_a'), 'store.read'), 'la concesión de B no abre A');
select tests.logout();

select tests.login('support', 'aal1');
select ok(not app.has_store_permission(tests.fx('store_b'), 'store.read'), 'soporte sin 2FA: la concesión no aplica');
select tests.logout();

update public.platform_staff set status = 'suspended' where user_id = tests.fx('support');
select tests.login('support');
select ok(not app.has_store_permission(tests.fx('store_b'), 'store.read'), 'soporte suspendido en la plataforma: la concesión no aplica');
select tests.logout();
update public.platform_staff set status = 'active' where user_id = tests.fx('support');

update public.support_access_grants set revoked_at = now(), revoked_by = tests.fx('owner_b')
 where grantee_user_id = tests.fx('support');
select tests.login('support');
select ok(not app.has_store_permission(tests.fx('store_b'), 'store.read'), 'concesión revocada: sin acceso inmediato');
select tests.logout();

insert into public.support_access_grants (organization_id, store_id, grantee_user_id, granted_by, reason,
                                          starts_at, expires_at)
values (tests.fx('org_b'), tests.fx('store_b'), tests.fx('support'), tests.fx('padmin'),
        'Ticket 4522: concesión antigua ya vencida', now() - interval '2 hours', now() - interval '90 minutes');
select tests.login('support');
select ok(not app.has_store_permission(tests.fx('store_b'), 'store.read'), 'concesión vencida: sin acceso');
select tests.logout();

-- Un administrador de plataforma no tiene acceso a datos de tenants por RLS.
select tests.login('padmin');
select ok(not app.has_store_permission(tests.fx('store_b'), 'store.read'), 'platform_admin sin concesión: sin acceso a la tienda');
select tests.logout();

select * from finish();
rollback;
