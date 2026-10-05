-- =============================================================================
-- Fase 2 · Acceso temporal de soporte (F2-T03): concesión, alcance de solo
-- lectura, caducidad, revocación por ambos lados, aviso al dueño y auditoría.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

select tests.create_user('powner', 'owner@platform.io');
select tests.create_user('padmin', 'admin@platform.io');
select tests.create_user('psupport', 'support@platform.io');
select tests.create_user('psupport2', 'support2@platform.io');
select tests.create_user('psuspended', 'suspended@platform.io');
select tests.create_user('random', 'random@x.io');
select tests.make_platform_staff('powner', 'platform_owner');
select tests.make_platform_staff('padmin', 'platform_admin');
select tests.make_platform_staff('psupport', 'platform_support');
select tests.make_platform_staff('psupport2', 'platform_support');
select tests.make_platform_staff('psuspended', 'platform_support');
update public.platform_staff set status = 'suspended' where user_id = tests.fx('psuspended');

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('admin', 'admin@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_org_member('org_a', 'admin', 'org_admin');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function tests.grant_of(p_user_key text, p_store_key text) returns uuid
language sql security definer set search_path = '' as $$
  select g.id from public.support_access_grants g
   where g.grantee_user_id = tests.fx(p_user_key) and g.store_id = tests.fx('store_' || p_store_key)
   order by g.created_at desc, g.id desc limit 1
$$;
create function tests.can(p_user_key text, p_store_key text, p_perm text, p_aal text default 'aal2')
returns boolean language plpgsql as $$
declare v boolean;
begin
  perform tests.logout();
  perform tests.login(p_user_key, p_aal);
  v := app.has_store_permission(tests.fx('store_' || p_store_key), p_perm);
  perform tests.logout();
  return v;
end $$;
create function tests.visible_grants(p_user_key text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform tests.logout();
  perform tests.login(p_user_key);
  select count(*) into v from public.support_access_grants;
  perform tests.logout();
  return v;
end $$;
grant execute on all functions in schema tests to authenticated;

-- Motivo válido (≥ 20 caracteres).
create function tests.why() returns text language sql immutable as
  $$ select 'Ticket 123: la dueña reporta que no ve sus pedidos'::text $$;
grant execute on function tests.why() to authenticated;

-- ============================================================================ Conceder
select tests.logout(); select tests.login('psupport');
select throws_ok(format($$ select public.platform_grant_support_access(%L, %L, tests.why()) $$,
                        tests.fx('store_a'), tests.fx('psupport2')),
  '42501', 'forbidden', 'platform_support no concede accesos');
select tests.logout(); select tests.login('owner');
select throws_ok(format($$ select public.platform_grant_support_access(%L, %L, tests.why()) $$,
                        tests.fx('store_a'), tests.fx('psupport')),
  '42501', 'forbidden', 'un dueño de tienda no concede accesos de soporte');
select tests.logout(); select tests.login('padmin', 'aal1');
select throws_ok(format($$ select public.platform_grant_support_access(%L, %L, tests.why()) $$,
                        tests.fx('store_a'), tests.fx('psupport')),
  '42501', 'mfa_required', 'conceder exige 2FA');
select tests.logout(); select tests.login('padmin');
select throws_ok(format($$ select public.platform_grant_support_access(%L, %L, tests.why()) $$,
                        tests.fx('store_a'), tests.fx('padmin')),
  '42501', 'forbidden', 'sin autoconcesión');
select throws_ok(format($$ select public.platform_grant_support_access(%L, %L, tests.why()) $$,
                        tests.fx('store_a'), tests.fx('random')),
  'P0001', 'validation_failed', 'el titular debe ser staff de plataforma');
select throws_ok(format($$ select public.platform_grant_support_access(%L, %L, tests.why()) $$,
                        tests.fx('store_a'), tests.fx('psuspended')),
  'P0001', 'validation_failed', 'ni staff suspendido');
select throws_ok(format($$ select public.platform_grant_support_access(%L, %L, 'porque sí') $$,
                        tests.fx('store_a'), tests.fx('psupport')),
  'P0001', 'validation_failed', 'motivo obligatorio de al menos 20 caracteres');
select throws_ok(format($$ select public.platform_grant_support_access(%L, %L, tests.why(), 61) $$,
                        tests.fx('store_a'), tests.fx('psupport')),
  'P0001', 'validation_failed', 'máximo 60 minutos');
select throws_ok(format($$ select public.platform_grant_support_access(%L, %L, tests.why(), 0) $$,
                        tests.fx('store_a'), tests.fx('psupport')),
  'P0001', 'validation_failed', 'mínimo 1 minuto');
select throws_ok(format($$ select public.platform_grant_support_access(%L, %L, tests.why()) $$,
                        gen_random_uuid(), tests.fx('psupport')),
  'P0001', 'not_found', 'tienda inexistente');
select lives_ok(format($$ select public.platform_grant_support_access(%L, %L, tests.why(), 30, 'ZD-123') $$,
                       tests.fx('store_a'), tests.fx('psupport')),
  'platform_admin concede 30 minutos a platform_support');
select throws_ok(format($$ select public.platform_grant_support_access(%L, %L, tests.why()) $$,
                        tests.fx('store_a'), tests.fx('psupport')),
  'P0001', 'conflict', 'sin concesiones superpuestas');
select tests.logout();

select ok((select expires_at - starts_at = interval '30 minutes' and granted_by = tests.fx('padmin')
             and ticket_ref = 'ZD-123' from public.support_access_grants where id = tests.grant_of('psupport', 'a')),
  'duración, emisor y ticket registrados');
select is((select count(*)::int from system.jobs where type = 'access.support_access_notice'
            and payload ->> 'grant_id' = tests.grant_of('psupport', 'a')::text and store_id = tests.fx('store_a')),
  1, 'aviso al dueño encolado en la misma transacción');
select is((select count(*)::int from audit.audit_logs where action = 'support_session.started'
            and support_grant_id = tests.grant_of('psupport', 'a') and actor_user_id = tests.fx('padmin')
            and reason = tests.why()),
  1, 'concesión auditada con motivo, actor y concesión');

-- ============================================================================ Alcance
select ok(tests.can('psupport', 'a', 'store.read'), 'soporte lee la tienda concedida');
select ok(tests.can('psupport', 'a', 'orders.read'), 'soporte lee pedidos');
select ok(not tests.can('psupport', 'a', 'store.update'), 'solo lectura: no modifica la tienda');
select ok(not tests.can('psupport', 'a', 'staff.manage'), 'solo lectura: no gestiona el equipo');
select ok(not tests.can('psupport', 'a', 'products.cost.read'), 'sin costos (sensible)');
select ok(not tests.can('psupport', 'a', 'customers.pii.read'), 'sin PII completa de clientes');
select ok(not tests.can('psupport', 'a', 'audit.read'), 'sin auditoría');
select ok(not tests.can('psupport', 'a', 'exports.run'), 'sin exportaciones');
select ok(not tests.can('psupport', 'b', 'store.read'), 'nada en otra tienda');
select ok(not tests.can('psupport', 'a', 'store.read', 'aal1'), 'sin 2FA no sirve la concesión');
select ok(not tests.can('psupport2', 'a', 'store.read'), 'la concesión es personal');

-- ============================================================================ Visibilidad
select is(tests.visible_grants('owner'), 1::bigint, 'el dueño ve la concesión sobre su tienda');
select is(tests.visible_grants('admin'), 0::bigint, 'un org_admin no la ve (solo el dueño)');
select is(tests.visible_grants('owner_b'), 0::bigint, 'otro tenant no la ve');
select is(tests.visible_grants('psupport'), 1::bigint, 'el titular ve la suya');

-- ============================================================================ Páginas vistas
select tests.logout(); select tests.login('psupport');
select lives_ok(format($$ select public.support_log_page_view(%L, '/admin/tienda-a/pedidos?q=ana#top') $$,
                       tests.grant_of('psupport', 'a')),
  'el soporte registra la página que abre');
select throws_ok(format($$ select public.support_log_page_view(%L, 'javascript:alert(1)') $$,
                        tests.grant_of('psupport', 'a')),
  'P0001', 'validation_failed', 'ruta inválida rechazada');
select tests.logout(); select tests.login('padmin');
select throws_ok(format($$ select public.support_log_page_view(%L, '/admin') $$, tests.grant_of('psupport', 'a')),
  '42501', 'forbidden', 'solo el titular registra páginas de su concesión');
select tests.logout();
select is((select metadata ->> 'path' from audit.audit_logs where action = 'support_session.page_viewed'
            and support_grant_id = tests.grant_of('psupport', 'a')),
  '/admin/tienda-a/pedidos', 'ruta auditada sin query string ni fragmento');

-- ============================================================================ Revocación por el dueño
select tests.logout(); select tests.login('admin');
select throws_ok(format($$ select public.access_revoke_support_access(%L) $$, tests.grant_of('psupport', 'a')),
  'P0001', 'not_found', 'un org_admin no revoca (solo el dueño)');
select tests.logout(); select tests.login('owner_b');
select throws_ok(format($$ select public.access_revoke_support_access(%L) $$, tests.grant_of('psupport', 'a')),
  'P0001', 'not_found', 'el dueño de otro tenant no revoca');
select tests.logout(); select tests.login('owner');
select lives_ok(format($$ select public.access_revoke_support_access(%L) $$, tests.grant_of('psupport', 'a')),
  'el dueño revoca el acceso de soporte');
select throws_ok(format($$ select public.access_revoke_support_access(%L) $$, tests.grant_of('psupport', 'a')),
  'P0001', 'conflict', 'no se revoca dos veces');
select tests.logout();
select ok((select revoked_by = tests.fx('owner') from public.support_access_grants where id = tests.grant_of('psupport', 'a')),
  'revocación registrada con su autor');
select is((select after ->> 'revoked_by' from audit.audit_logs where action = 'support_session.ended'
            and support_grant_id = tests.grant_of('psupport', 'a')),
  'owner', 'fin de sesión auditado');
select ok(not tests.can('psupport', 'a', 'store.read'), 'efecto inmediato: el soporte pierde el acceso');
select tests.logout(); select tests.login('psupport');
select throws_ok(format($$ select public.support_log_page_view(%L, '/admin') $$, tests.grant_of('psupport', 'a')),
  '42501', 'forbidden', 'tampoco registra páginas con la concesión revocada');

-- ============================================================================ Revocación por la plataforma
select tests.logout(); select tests.login('powner');
select lives_ok(format($$ select public.platform_grant_support_access(%L, %L, tests.why(), 60) $$,
                       tests.fx('store_a'), tests.fx('psupport')),
  'tras revocar, se puede conceder otra (extensión = nueva concesión)');
select tests.logout(); select tests.login('psupport2');
select throws_ok(format($$ select public.platform_revoke_support_access(%L) $$, tests.grant_of('psupport', 'a')),
  'P0001', 'not_found', 'otro soporte no revoca concesiones ajenas');
select tests.logout(); select tests.login('psupport');
select lives_ok(format($$ select public.platform_revoke_support_access(%L) $$, tests.grant_of('psupport', 'a')),
  'el titular termina su sesión antes de tiempo');
select tests.logout(); select tests.login('padmin');
select lives_ok(format($$ select public.platform_grant_support_access(%L, %L, tests.why(), 15) $$,
                       tests.fx('store_b'), tests.fx('psupport2')),
  'otra concesión');
select lives_ok(format($$ select public.platform_revoke_support_access(%L) $$, tests.grant_of('psupport2', 'b')),
  'platform_admin revoca cualquier concesión');
select tests.logout();

-- ============================================================================ Caducidad y staff suspendido
insert into public.support_access_grants
  (organization_id, store_id, grantee_user_id, granted_by, reason, starts_at, expires_at)
values (tests.fx('org_b'), tests.fx('store_b'), tests.fx('psupport'), tests.fx('padmin'), tests.why(),
        now() - interval '2 hours', now() - interval '90 minutes');
select ok(not tests.can('psupport', 'b', 'store.read'), 'una concesión caducada no da acceso');
select tests.logout(); select tests.login('padmin');
select throws_ok(format($$ select public.platform_revoke_support_access(%L) $$, tests.grant_of('psupport', 'b')),
  'P0001', 'conflict', 'una concesión caducada ya está cerrada');
select tests.logout();

insert into public.support_access_grants
  (organization_id, store_id, grantee_user_id, granted_by, reason, starts_at, expires_at)
values (tests.fx('org_a'), tests.fx('store_a'), tests.fx('psuspended'), tests.fx('padmin'), tests.why(),
        now(), now() + interval '30 minutes');
select ok(not tests.can('psuspended', 'a', 'store.read'), 'staff suspendido: la concesión vigente no sirve');

select is(tests.sqlstate_as('anon', format('select public.support_log_page_view(%L, %L)',
                                           tests.grant_of('psupport', 'a'), '/admin')),
  '42501', 'anon no ejecuta las RPC de soporte');

select * from finish();
rollback;
