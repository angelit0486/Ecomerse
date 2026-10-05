-- =============================================================================
-- Fase 2 · RPC de equipo (F2-T02): escalada de privilegios y ataques entre tenants.
-- Un caso por restricción de GATE0 §8.3 + límites (§7.2, §19.3) + auditoría.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(86);

-- Tenant A: dueño, dos org_admin, un org_member, y staff de la tienda A.
select tests.create_user('owner', 'owner@a.io');
select tests.create_user('admin', 'admin@a.io');
select tests.create_user('admin2', 'admin2@a.io');
select tests.create_user('member', 'member@a.io');
select tests.create_user('sadmin', 'sadmin@a.io');
select tests.create_user('cat', 'cat@a.io');
select tests.create_user('view', 'view@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_store('a2', 'org_a');
select tests.add_org_member('org_a', 'admin', 'org_admin');
select tests.add_org_member('org_a', 'admin2', 'org_admin');
select tests.add_org_member('org_a', 'member', 'org_member');
select tests.add_store_member('a', 'sadmin', 'store_admin');
select tests.add_store_member('a', 'cat', 'catalog_manager');
select tests.add_store_member('a', 'view', 'viewer');
-- Tenant B (atacante entre tenants).
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('cat_b', 'cat@b.io');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('b', 'cat_b', 'catalog_manager');
-- Tenant C con max_staff = 2 para probar el límite.
select tests.create_user('owner_c', 'owner@c.io');
select tests.create_user('extra_c', 'extra@c.io');
select tests.create_tenant('c', 'owner_c', 'tiny');
select tests.ensure_plan('tiny', 1, 2); -- create_tenant aplica los límites por defecto
select tests.create_user('outsider', 'outsider@x.io');

create function tests.inv(p_email text) returns uuid language sql security definer set search_path = '' as $$
  select i.id from public.organization_invitations i
   where i.email = p_email and i.accepted_at is null and i.revoked_at is null
$$;
create function tests.store_role_of(p_store_key text, p_user_key text) returns text
language sql security definer set search_path = '' as $$
  select r.key from public.store_members sm join public.roles r on r.id = sm.role_id
   where sm.store_id = tests.fx('store_' || p_store_key) and sm.user_id = tests.fx(p_user_key)
$$;
create function tests.org_role_of(p_org_key text, p_user_key text) returns text
language sql security definer set search_path = '' as $$
  select m.role from public.organization_members m
   where m.organization_id = tests.fx('org_' || p_org_key) and m.user_id = tests.fx(p_user_key)
$$;
create function tests.can(p_user_key text, p_store_key text, p_perm text) returns boolean
language plpgsql as $$
declare v boolean;
begin
  perform tests.logout();
  perform tests.login(p_user_key);
  v := app.has_store_permission(tests.fx('store_' || p_store_key), p_perm);
  perform tests.logout();
  return v;
end $$;
grant execute on all functions in schema tests to authenticated;

-- ============================================================================ Invitar
select tests.logout(); select tests.login('owner', 'aal1');
select throws_ok(format($$ select public.access_invite_member(%L, 'n1@a.io', 'org_member') $$, tests.fx('org_a')),
  '42501', 'mfa_required', 'invitar sin 2FA: mfa_required');
select tests.logout(); select tests.login('outsider');
select throws_ok(format($$ select public.access_invite_member(%L, 'n1@a.io', 'org_member') $$, tests.fx('org_a')),
  '42501', 'forbidden', 'un ajeno no invita a la organización');
select tests.logout(); select tests.login('owner_b');
select throws_ok(format($$ select public.access_invite_member(%L, 'n1@a.io', 'org_member') $$, tests.fx('org_a')),
  '42501', 'forbidden', 'el dueño de B no invita a la organización A');
select throws_ok(format($$ select public.access_invite_member(%L, 'n1@a.io', null, %L, 'viewer') $$,
                        tests.fx('org_b'), tests.fx('store_a')),
  '42501', 'forbidden', 'ataque: org B + tienda de A → forbidden');
select tests.logout(); select tests.login('cat');
select throws_ok(format($$ select public.access_invite_member(%L, 'n1@a.io', null, %L, 'viewer') $$,
                        tests.fx('org_a'), tests.fx('store_a')),
  '42501', 'forbidden', 'catalog_manager no tiene staff.manage');

select tests.logout(); select tests.login('owner');
select lives_ok(format($$ select public.access_invite_member(%L, 'Nuevo.Admin@A.io ', 'org_admin') $$, tests.fx('org_a')),
  'el dueño invita a un org_admin (email normalizado)');
select tests.logout();
select ok((select expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute'
             from public.organization_invitations where id = tests.inv('nuevo.admin@a.io')),
  'la invitación caduca a los 7 días');
select is((select count(*)::int from system.jobs
            where type = 'access.invitation_email' and payload ->> 'invitation_id' = tests.inv('nuevo.admin@a.io')::text),
  1, 'se encola el email de invitación');
select is((select count(*)::int from audit.audit_logs
            where action = 'member.invited' and entity_id = tests.inv('nuevo.admin@a.io')),
  1, 'la invitación queda auditada');
select is((select token_hash from public.organization_invitations where id = tests.inv('nuevo.admin@a.io')),
  null::bytea, 'el token lo emite el worker, no la RPC');

select tests.logout(); select tests.login('admin');
select throws_ok(format($$ select public.access_invite_member(%L, 'otro.admin@a.io', 'org_admin') $$, tests.fx('org_a')),
  '42501', 'forbidden', 'org_admin no crea otro org_admin');
select lives_ok(format($$ select public.access_invite_member(%L, 'nuevo.miembro@a.io', 'org_member') $$, tests.fx('org_a')),
  'org_admin invita a un org_member');
select throws_ok(format($$ select public.access_invite_member(%L, 'dueno2@a.io', 'org_owner') $$, tests.fx('org_a')),
  '42501', 'forbidden', 'org_admin no invita a un org_owner');
select tests.logout(); select tests.login('owner');
select throws_ok(format($$ select public.access_invite_member(%L, 'dueno2@a.io', 'org_owner') $$, tests.fx('org_a')),
  '42501', 'forbidden', 'ni el dueño: la propiedad solo se transfiere');

select tests.logout(); select tests.login('sadmin');
select lives_ok(format($$ select public.access_invite_member(%L, 'nuevo.viewer@a.io', null, %L, 'viewer') $$,
                       tests.fx('org_a'), tests.fx('store_a')),
  'store_admin invita a un viewer a su tienda');
select throws_ok(format($$ select public.access_invite_member(%L, 'otro.sadmin@a.io', null, %L, 'store_admin') $$,
                        tests.fx('org_a'), tests.fx('store_a')),
  '42501', 'forbidden', 'regla 3: store_admin no crea store_admin');
select throws_ok(format($$ select public.access_invite_member(%L, 'x@a.io', 'org_member') $$, tests.fx('org_a')),
  '42501', 'forbidden', 'store_admin no invita a nivel de organización');
select throws_ok(format($$ select public.access_invite_member(%L, 'x@a.io', null, %L, 'viewer') $$,
                        tests.fx('org_a'), tests.fx('store_a2')),
  '42501', 'forbidden', 'store_admin no invita a otra tienda de su organización');
select throws_ok(format($$ select public.access_invite_member(%L, 'x@a.io', null, %L, 'viewer') $$,
                        tests.fx('org_a'), tests.fx('store_b')),
  '42501', 'forbidden', 'ataque: org A + tienda de B → forbidden');

select tests.logout(); select tests.login('admin');
select lives_ok(format($$ select public.access_invite_member(%L, 'nuevo.sadmin@a.io', null, %L, 'store_admin') $$,
                       tests.fx('org_a'), tests.fx('store_a')),
  'org_admin sí crea store_admin');
select throws_ok(format($$ select public.access_invite_member(%L, 'no-es-email', 'org_member') $$, tests.fx('org_a')),
  'P0001', 'validation_failed', 'email inválido');
select throws_ok(format($$ select public.access_invite_member(%L, 'y@a.io', 'org_member', %L, 'viewer') $$,
                        tests.fx('org_a'), tests.fx('store_a')),
  'P0001', 'validation_failed', 'rol de organización y de tienda a la vez');
select throws_ok(format($$ select public.access_invite_member(%L, 'y@a.io', null, %L, 'superusuario') $$,
                        tests.fx('org_a'), tests.fx('store_a')),
  'P0001', 'validation_failed', 'rol de tienda inexistente');
select throws_ok(format($$ select public.access_invite_member(%L, 'nuevo.miembro@a.io', 'org_member') $$, tests.fx('org_a')),
  'P0001', 'conflict', 'ya hay una invitación pendiente para ese email');
select throws_ok(format($$ select public.access_invite_member(%L, 'cat@a.io', null, %L, 'viewer') $$,
                        tests.fx('org_a'), tests.fx('store_a')),
  'P0001', 'conflict', 'ya es miembro de la tienda: usar cambio de rol');
select lives_ok(format($$ select public.access_invite_member(%L, 'cat@a.io', null, %L, 'viewer') $$,
                       tests.fx('org_a'), tests.fx('store_a2')),
  'un miembro existente puede ser invitado a otra tienda');
select tests.logout();

-- Una invitación caducada no bloquea una nueva.
update public.organization_invitations set expires_at = now() - interval '1 minute'
 where id = tests.inv('nuevo.miembro@a.io');
select tests.logout(); select tests.login('admin');
select lives_ok(format($$ select public.access_invite_member(%L, 'nuevo.miembro@a.io', 'org_member') $$, tests.fx('org_a')),
  'la invitación caducada se cierra y se emite otra');
select tests.logout();

-- Anti-abuso: 20 pendientes por organización.
insert into public.organization_invitations (organization_id, email, org_role, expires_at)
select tests.fx('org_a'), 'relleno' || g || '@a.io', 'org_member', now() + interval '7 days'
  from generate_series(1, 20 - (select count(*)::int from public.organization_invitations
                                  where organization_id = tests.fx('org_a') and accepted_at is null
                                    and revoked_at is null and expires_at > now())) g;
select tests.logout(); select tests.login('owner');
select throws_ok(format($$ select public.access_invite_member(%L, 'z@a.io', 'org_member') $$, tests.fx('org_a')),
  'P0001', 'limit_reached', 'máximo 20 invitaciones pendientes');
select tests.logout();
delete from public.organization_invitations where email like 'relleno%@a.io';

-- Límite max_staff (plan tiny: 2).
select tests.logout(); select tests.login('owner_c');
select lives_ok(format($$ select public.access_invite_member(%L, 'extra@c.io', 'org_member') $$, tests.fx('org_c')),
  'dentro del límite de staff');
select tests.logout();
select tests.add_org_member('org_c', 'extra_c', 'org_member');
select tests.logout(); select tests.login('owner_c');
select throws_ok(format($$ select public.access_invite_member(%L, 'tercero@c.io', 'org_member') $$, tests.fx('org_c')),
  'P0001', 'limit_reached', 'límite de staff alcanzado: aviso al invitar');
select tests.logout();

-- ============================================================================ Revocar
select tests.logout(); select tests.login('sadmin');
select throws_ok(format($$ select public.access_revoke_invitation(%L) $$, tests.inv('nuevo.sadmin@a.io')),
  'P0001', 'not_found', 'store_admin no revoca una invitación de store_admin');
select lives_ok(format($$ select public.access_revoke_invitation(%L) $$, tests.inv('nuevo.viewer@a.io')),
  'store_admin revoca la invitación de viewer que emitió');
select tests.logout();
select ok((select revoked_at is not null and token_hash is null from public.organization_invitations
            where email = 'nuevo.viewer@a.io'), 'revocada: fecha y sin hash de token');
select tests.logout(); select tests.login('sadmin');
select throws_ok(format($$ select public.access_revoke_invitation(%L) $$,
                        (select id from public.organization_invitations where email = 'nuevo.viewer@a.io')),
  'P0001', 'conflict', 'no se revoca dos veces');
select tests.logout(); select tests.login('owner_b');
select throws_ok(format($$ select public.access_revoke_invitation(%L) $$, tests.inv('nuevo.miembro@a.io')),
  'P0001', 'not_found', 'el dueño de B no ve ni revoca invitaciones de A');
select tests.logout(); select tests.login('admin');
select throws_ok(format($$ select public.access_revoke_invitation(%L) $$, tests.inv('nuevo.admin@a.io')),
  'P0001', 'not_found', 'org_admin no revoca la invitación de un org_admin');
select tests.logout(); select tests.login('owner');
select lives_ok(format($$ select public.access_revoke_invitation(%L) $$, tests.inv('nuevo.admin@a.io')),
  'el dueño sí');
select tests.logout();

-- ============================================================================ Rol de tienda
select tests.logout(); select tests.login('sadmin');
select lives_ok(format($$ select public.access_change_member_role(%L, %L, 'viewer') $$, tests.fx('store_a'), tests.fx('cat')),
  'store_admin cambia catalog_manager → viewer');
select tests.logout();
select is(tests.store_role_of('a', 'cat'), 'viewer', 'rol actualizado');
select is((select before ->> 'role' || '→' || (after ->> 'role') from audit.audit_logs
            where action = 'member.role_changed' and entity_id = tests.fx('cat')),
  'catalog_manager→viewer', 'cambio auditado con antes y después');
select tests.logout(); select tests.login('sadmin');
select throws_ok(format($$ select public.access_change_member_role(%L, %L, 'store_admin') $$, tests.fx('store_a'), tests.fx('view')),
  '42501', 'forbidden', 'regla 1/3: no asigna un rol de su mismo rango');
select throws_ok(format($$ select public.access_change_member_role(%L, %L, 'viewer') $$, tests.fx('store_a'), tests.fx('sadmin')),
  '42501', 'forbidden', 'nadie cambia su propio rol');
select throws_ok(format($$ select public.access_change_member_role(%L, %L, 'viewer') $$, tests.fx('store_a'), tests.fx('admin')),
  '42501', 'forbidden', 'store_admin no toca a un org_admin');
select throws_ok(format($$ select public.access_change_member_role(%L, %L, 'viewer') $$, tests.fx('store_a'), tests.fx('owner')),
  '42501', 'forbidden', 'regla 2: store_admin no toca al dueño');
select throws_ok(format($$ select public.access_change_member_role(%L, %L, 'viewer') $$, tests.fx('store_a'), tests.fx('outsider')),
  'P0001', 'not_found', 'no es miembro de la tienda');
select tests.logout(); select tests.login('view');
select throws_ok(format($$ select public.access_change_member_role(%L, %L, 'store_admin') $$, tests.fx('store_a'), tests.fx('view')),
  '42501', 'forbidden', 'un viewer no se autoasciende');
select tests.logout(); select tests.login('owner_b');
select throws_ok(format($$ select public.access_change_member_role(%L, %L, 'viewer') $$, tests.fx('store_a'), tests.fx('sadmin')),
  '42501', 'forbidden', 'el dueño de B no cambia roles en A');
select tests.logout(); select tests.login('cat_b');
select throws_ok(format($$ select public.access_change_member_role(%L, %L, 'store_admin') $$, tests.fx('store_b'), tests.fx('cat_b')),
  '42501', 'forbidden', 'catalog_manager de B no se autoasciende');
select tests.logout(); select tests.login('admin');
select lives_ok(format($$ select public.access_change_member_role(%L, %L, 'catalog_manager') $$, tests.fx('store_a'), tests.fx('cat')),
  'org_admin cambia roles de tienda');
select tests.logout();

-- ============================================================================ Rol de organización
select tests.logout(); select tests.login('admin');
select throws_ok(format($$ select public.access_change_org_role(%L, %L, 'org_admin') $$, tests.fx('org_a'), tests.fx('member')),
  '42501', 'forbidden', 'org_admin no asciende a otro a org_admin');
select throws_ok(format($$ select public.access_change_org_role(%L, %L, 'org_member') $$, tests.fx('org_a'), tests.fx('admin2')),
  '42501', 'forbidden', 'org_admin no degrada a otro org_admin');
select throws_ok(format($$ select public.access_change_org_role(%L, %L, 'org_member') $$, tests.fx('org_a'), tests.fx('owner')),
  '42501', 'forbidden', 'regla 2: nadie degrada al dueño');
select tests.logout(); select tests.login('owner');
select throws_ok(format($$ select public.access_change_org_role(%L, %L, 'org_owner') $$, tests.fx('org_a'), tests.fx('admin')),
  '42501', 'forbidden', 'org_owner solo por transferencia');
select lives_ok(format($$ select public.access_change_org_role(%L, %L, 'org_member') $$, tests.fx('org_a'), tests.fx('admin2')),
  'el dueño degrada a un org_admin');
select tests.logout();
select is(tests.org_role_of('a', 'admin2'), 'org_member', 'degradado');

-- ============================================================================ Suspender / reactivar
select tests.logout(); select tests.login('admin');
select throws_ok(format($$ select public.access_suspend_member(%L, %L) $$, tests.fx('org_a'), tests.fx('owner')),
  '42501', 'forbidden', 'nadie suspende al dueño');
select tests.logout(); select tests.login('sadmin');
select throws_ok(format($$ select public.access_suspend_member(%L, %L) $$, tests.fx('org_a'), tests.fx('sadmin')),
  '42501', 'forbidden', 'nadie se suspende a sí mismo');
select lives_ok(format($$ select public.access_suspend_member(%L, %L, %L) $$, tests.fx('org_a'), tests.fx('view'), tests.fx('store_a')),
  'store_admin suspende a un viewer en su tienda');
select tests.logout();
select ok(not tests.can('view', 'a', 'store.read'), 'suspendido en la tienda: pierde el acceso al instante');
select tests.logout(); select tests.login('sadmin');
select lives_ok(format($$ select public.access_reactivate_member(%L, %L, %L) $$, tests.fx('org_a'), tests.fx('view'), tests.fx('store_a')),
  'y lo reactiva');
select tests.logout();
select ok(tests.can('view', 'a', 'store.read'), 'reactivado: recupera el acceso');
select tests.logout(); select tests.login('admin');
select lives_ok(format($$ select public.access_suspend_member(%L, %L) $$, tests.fx('org_a'), tests.fx('cat')),
  'org_admin suspende a un miembro en toda la organización');
select tests.logout();
select ok(not tests.can('cat', 'a', 'products.read'), 'suspendido en la organización: sin acceso a sus tiendas');
select tests.logout(); select tests.login('owner_b');
select throws_ok(format($$ select public.access_reactivate_member(%L, %L) $$, tests.fx('org_a'), tests.fx('cat')),
  '42501', 'forbidden', 'el dueño de B no reactiva miembros de A');
select tests.logout();

select tests.logout(); select tests.login('owner_c');
select lives_ok(format($$ select public.access_suspend_member(%L, %L) $$, tests.fx('org_c'), tests.fx('extra_c')),
  'suspender libera un lugar de staff');
select tests.logout();
select tests.create_user('cuarto_c', 'cuarto@c.io');
select tests.add_org_member('org_c', 'cuarto_c', 'org_member');
select tests.logout(); select tests.login('owner_c');
select throws_ok(format($$ select public.access_reactivate_member(%L, %L) $$, tests.fx('org_c'), tests.fx('extra_c')),
  'P0001', 'limit_reached', 'reactivar respeta max_staff');
select tests.logout();

-- ============================================================================ Quitar
select tests.logout(); select tests.login('admin');
select throws_ok(format($$ select public.access_remove_member(%L, %L) $$, tests.fx('org_a'), tests.fx('owner')),
  '42501', 'forbidden', 'nadie quita al dueño');
select tests.logout(); select tests.login('sadmin');
select lives_ok(format($$ select public.access_remove_member(%L, %L, %L) $$, tests.fx('org_a'), tests.fx('view'), tests.fx('store_a')),
  'store_admin quita a un viewer de su tienda');
select tests.logout();
select is(tests.store_role_of('a', 'view'), null::text, 'ya no es miembro de la tienda');
select is(tests.org_role_of('a', 'view'), 'org_member', 'sigue en la organización');
select tests.logout(); select tests.login('owner_b');
select throws_ok(format($$ select public.access_remove_member(%L, %L) $$, tests.fx('org_a'), tests.fx('sadmin')),
  '42501', 'forbidden', 'el dueño de B no quita miembros de A');
select tests.logout(); select tests.login('admin');
select lives_ok(format($$ select public.access_remove_member(%L, %L) $$, tests.fx('org_a'), tests.fx('cat')),
  'org_admin quita a un miembro de la organización');
select tests.logout();
select ok(tests.org_role_of('a', 'cat') is null and tests.store_role_of('a', 'cat') is null
          and tests.store_role_of('a2', 'cat') is null,
  'quitar de la organización borra sus membresías de tienda');

-- ============================================================================ Transferir la propiedad
select tests.logout(); select tests.login('admin');
select throws_ok(format($$ select public.access_transfer_ownership(%L, %L) $$, tests.fx('org_a'), tests.fx('admin')),
  '42501', 'forbidden', 'org_admin no transfiere la propiedad');
select tests.logout(); select tests.login('owner');
select throws_ok(format($$ select public.access_transfer_ownership(%L, %L) $$, tests.fx('org_a'), tests.fx('outsider')),
  'P0001', 'not_found', 'solo a un miembro de la organización');
select throws_ok(format($$ select public.access_transfer_ownership(%L, %L) $$, tests.fx('org_a'), tests.fx('owner')),
  'P0001', 'validation_failed', 'no a sí mismo');
select tests.logout(); select tests.login('owner', 'aal1');
select throws_ok(format($$ select public.access_transfer_ownership(%L, %L) $$, tests.fx('org_a'), tests.fx('admin')),
  '42501', 'mfa_required', 'transferir exige 2FA');
select tests.logout(); select tests.login('owner');
select lives_ok(format($$ select public.access_transfer_ownership(%L, %L) $$, tests.fx('org_a'), tests.fx('admin')),
  'el dueño transfiere a un org_admin');
select tests.logout();
select is(tests.org_role_of('a', 'admin') || '/' || tests.org_role_of('a', 'owner'), 'org_owner/org_admin',
  'roles intercambiados de forma atómica');
select is((select count(*)::int from public.organization_members
            where organization_id = tests.fx('org_a') and role = 'org_owner'), 1, 'regla 4: exactamente un dueño');
select tests.logout(); select tests.login('owner');
select throws_ok(format($$ select public.access_transfer_ownership(%L, %L) $$, tests.fx('org_a'), tests.fx('owner')),
  '42501', 'forbidden', 'el dueño anterior ya no puede transferir');
select tests.logout();

-- ============================================================================ Listado del equipo
select tests.logout(); select tests.login('sadmin');
select is((select array_agg(email order by email) from public.access_list_store_members(tests.fx('store_a'))),
  array['admin@a.io', 'owner@a.io', 'sadmin@a.io'],
  'store_admin ve el equipo de su tienda con emails (incluye dueño y admins)');
select tests.logout(); select tests.login('view');
select throws_ok(format($$ select * from public.access_list_store_members(%L) $$, tests.fx('store_a')),
  '42501', 'forbidden', 'quien ya no es miembro no lista el equipo');
select tests.logout(); select tests.login('owner_b');
select throws_ok(format($$ select * from public.access_list_store_members(%L) $$, tests.fx('store_a')),
  '42501', 'forbidden', 'el dueño de B no lista el equipo de A');
select tests.logout();

-- ============================================================================ Superficie
select is(tests.sqlstate_as('anon', format('select public.access_invite_member(%L, %L, %L)',
                                           tests.fx('org_a'), 'x@a.io', 'org_member')),
  '42501', 'anon no ejecuta las RPC de equipo');
select is((select count(*)::int from information_schema.routine_privileges
            where routine_schema = 'app' and grantee = 'authenticated'
              and routine_name in ('actor_store_rank', 'member_store_rank', 'store_role_assignable',
                                   'assert_can_manage_store_member', 'assert_can_manage_org_member',
                                   'set_member_status', 'resolve_store_role', 'assert_store_in_org')),
  0, 'los helpers internos no son ejecutables por authenticated');

select * from finish();
rollback;
