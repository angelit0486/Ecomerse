-- =============================================================================
-- Fase 2 · RPC de identidad y tenancy, de punta a punta.
-- Alta asistida → token de invitación (worker) → aceptación con 2FA → branding →
-- resolución host → tienda (storefront_gateway).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- Envolturas para roles que no ven pgTAP (esquema "extensions").
create function tests.worker_issue_token(p_invitation uuid) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('role', 'system_worker', true);
  select t.token into v from system.issue_invitation_token(p_invitation) t;
  perform set_config('role', 'none', true);
  return v;
end $$;

create function tests.gateway_resolve(p_host text)
returns table (store_id uuid, store_status text, primary_hostname text, is_primary boolean)
language plpgsql as $$
begin
  perform set_config('role', 'storefront_gateway', true);
  return query select * from storefront.resolve_host(p_host);
  perform set_config('role', 'none', true);
end $$;

create function tests.gateway_store_public(p_store uuid) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'storefront_gateway', true);
  v := storefront.get_store_public(p_store);
  perform set_config('role', 'none', true);
  return v;
end $$;

select tests.create_user('padmin', 'admin@platform.io');
select tests.create_user('psupport', 'support@platform.io');
select tests.create_user('random', 'random@test.io');
select tests.create_user('duena', 'duena@tienda.io');
select tests.create_user('vista', 'vista@test.io');
select tests.create_user('otro', 'otro@test.io');
select tests.make_platform_staff('padmin', 'platform_admin');
select tests.make_platform_staff('psupport', 'platform_support');
select tests.ensure_plan('starter', 1, 5);

-- Alta asistida del tenant ------------------------------------------------------------------
select tests.login('padmin');
select throws_ok($$ select public.platform_create_organization_with_store(
    'Moda Ana', 'moda-ana', 'MX', 'duena@tienda.io', 'Moda Ana', 'mi-tienda', 'starter') $$,
  'P0001', 'platform_not_configured', 'sin dominio raíz de storefronts configurado: falla de forma explícita');
select tests.logout();

insert into public.platform_settings (key, value) values ('storefront.root_domain', '{"domain": "tiendas.test"}');

select tests.login('random');
select throws_ok($$ select public.platform_create_organization_with_store(
    'Moda Ana', 'moda-ana', 'MX', 'duena@tienda.io', 'Moda Ana', 'mi-tienda', 'starter') $$,
  '42501', 'forbidden', 'un usuario cualquiera no puede crear tenants');
select tests.logout();

select tests.login('psupport');
select throws_ok($$ select public.platform_create_organization_with_store(
    'Moda Ana', 'moda-ana', 'MX', 'duena@tienda.io', 'Moda Ana', 'mi-tienda', 'starter') $$,
  '42501', 'forbidden', 'platform_support no puede crear tenants');
select tests.logout();

select tests.login('padmin', 'aal1');
select throws_ok($$ select public.platform_create_organization_with_store(
    'Moda Ana', 'moda-ana', 'MX', 'duena@tienda.io', 'Moda Ana', 'mi-tienda', 'starter') $$,
  '42501', 'mfa_required', 'platform_admin sin 2FA: mfa_required');
select tests.logout();

select tests.login('padmin');
select throws_ok($$ select public.platform_create_organization_with_store(
    'X', 'org-x', 'MX', 'x@test.io', 'X', 'tienda-x', 'plan-inexistente') $$,
  'P0001', 'validation_failed', 'plan inexistente rechazado');
select lives_ok($$
  select tests.set_fx('org_n', (r ->> 'organization_id')::uuid),
         tests.set_fx('store_n', (r ->> 'store_id')::uuid),
         tests.set_fx('inv_owner', (r ->> 'invitation_id')::uuid)
    from (select public.platform_create_organization_with_store(
            'Moda Ana', 'moda-ana', 'MX', ' Duena@Tienda.io ', 'Moda Ana', 'mi-tienda', 'starter') as r) x
$$, 'platform_admin con 2FA crea el tenant');
select throws_ok($$ select public.platform_create_organization_with_store(
    'Otra', 'otra-org', 'MX', 'o@test.io', 'Otra', 'mi-tienda', 'starter') $$,
  '23505', null, 'handle duplicado rechazado');
select throws_ok($$ select public.platform_create_organization_with_store(
    'Otra', 'otra-org', 'MX', 'o@test.io', 'Otra', 'checkout', 'starter') $$,
  '23514', null, 'handle reservado rechazado');
select tests.logout();

select is((select status from public.stores where id = tests.fx('store_n')), 'draft', 'la tienda nace en borrador');
select is((select tax_rate_bps from public.stores where id = tests.fx('store_n')), 1600, 'IVA 16% por defecto (Q-N1)');
select is((select status from public.subscriptions where organization_id = tests.fx('org_n')), 'trialing',
  'la suscripción nace en prueba');
select is((select hostname from public.store_domains where store_id = tests.fx('store_n') and is_primary),
  'mi-tienda.tiendas.test', 'subdominio primario creado');
select is((select value from public.store_counters where store_id = tests.fx('store_n')), 1000::bigint,
  'contador de pedidos listo (el primer pedido será 1001)');
select ok(exists (select 1 from public.store_themes where store_id = tests.fx('store_n')), 'tema por defecto creado');
select is((select email from public.organization_invitations where id = tests.fx('inv_owner')), 'duena@tienda.io',
  'el email del dueño se normaliza');
select ok((select token_hash is null from public.organization_invitations where id = tests.fx('inv_owner')),
  'la invitación nace SIN token (lo emite el worker al enviar el email)');
select is((select count(*)::int from system.jobs where type = 'access.invitation_email'
            and payload ->> 'invitation_id' = tests.fx('inv_owner')::text), 1, 'email de invitación encolado');
select set_eq($$ select action from audit.audit_logs where organization_id = tests.fx('org_n') $$,
  array['organization.created', 'store.created', 'member.invited', 'config.insert'],
  'alta auditada (config.insert: la suscripción, por el trigger de configuración del gate)');
select is((select distinct actor_type from audit.audit_logs where organization_id = tests.fx('org_n')),
  'platform_staff', 'la auditoría identifica al actor de plataforma');
select is((select count(*)::int from public.organization_members where organization_id = tests.fx('org_n')), 0,
  'nadie tiene acceso hasta aceptar la invitación');

-- Token de invitación: solo su hash se guarda; reemitir invalida el anterior ---------------
create temp table tok as select tests.worker_issue_token(tests.fx('inv_owner')) as t1;
alter table tok add column t2 text;
grant select on tok to authenticated;
update tok set t2 = tests.worker_issue_token(tests.fx('inv_owner'));
select ok((select t1 ~ '^[0-9a-f]{64}$' and t2 ~ '^[0-9a-f]{64}$' and t1 <> t2 from tok),
  'el worker emite tokens de 256 bits distintos');
select ok((select token_hash = sha256(convert_to((select t2 from tok), 'UTF8'))
             from public.organization_invitations where id = tests.fx('inv_owner')),
  'la base guarda solo el SHA-256 del token vigente');

-- Aceptación -----------------------------------------------------------------------------------
select tests.login('duena', 'aal1');
select throws_ok(format('select public.access_accept_invitation(%L)', (select t2 from tok)),
  '42501', 'mfa_required', 'aceptar exige 2FA (onboarding paso 1: cuenta + 2FA)');
select tests.logout();

select tests.login('otro');
select throws_ok(format('select public.access_accept_invitation(%L)', (select t2 from tok)),
  'P0001', 'invitation_email_mismatch', 'la invitación solo la acepta el email invitado');
select tests.logout();

select tests.login('duena');
select throws_ok(format('select public.access_accept_invitation(%L)', (select t1 from tok)),
  'P0001', 'invitation_invalid', 'el token anterior quedó invalidado al reemitir');
select throws_ok($$ select public.access_accept_invitation('no-es-un-token') $$,
  'P0001', 'invitation_invalid', 'token con formato inválido rechazado');
select lives_ok(format('select public.access_accept_invitation(%L)', (select t2 from tok)),
  'la dueña acepta con 2FA');
select throws_ok(format('select public.access_accept_invitation(%L)', (select t2 from tok)),
  'P0001', 'invitation_invalid', 'un token no se puede reutilizar');
select ok(app.has_store_permission(tests.fx('store_n'), 'store.update'), 'la dueña ya administra su tienda');
select tests.logout();

select is((select role from public.organization_members
            where organization_id = tests.fx('org_n') and user_id = tests.fx('duena')), 'org_owner',
  'la dueña queda como org_owner');
select ok(exists (select 1 from audit.audit_logs where organization_id = tests.fx('org_n') and action = 'member.joined'),
  'la aceptación queda auditada');

-- Invitación vencida: el worker no emite token.
insert into public.organization_invitations (organization_id, email, org_role, expires_at)
values (tests.fx('org_n'), 'tarde@test.io', 'org_member', now() - interval '1 minute')
returning tests.set_fx('inv_late', id);
select is(tests.worker_issue_token(tests.fx('inv_late')), null::text, 'invitación vencida: no se emite token');

-- Invitación a un rol de tienda (viewer).
insert into public.organization_invitations (organization_id, store_id, email, store_role_id, expires_at)
values (tests.fx('org_n'), tests.fx('store_n'), 'vista@test.io',
        (select id from public.roles where key = 'viewer'), now() + interval '7 days')
returning tests.set_fx('inv_viewer', id);
update tok set t1 = tests.worker_issue_token(tests.fx('inv_viewer'));
select tests.login('vista');
select lives_ok(format('select public.access_accept_invitation(%L)', (select t1 from tok)),
  'un viewer invitado acepta');
select ok(app.has_store_permission(tests.fx('store_n'), 'store.read')
          and not app.has_store_permission(tests.fx('store_n'), 'store.update'),
  'el viewer obtiene exactamente su rol (lee, no escribe)');
select throws_ok($$ select public.appearance_publish_theme(tests.fx('store_n'), tests.theme_rev(tests.fx('store_n'))) $$, '42501', 'forbidden',
  'el viewer no puede publicar el branding');
select tests.logout();

-- Una segunda invitación de dueño no puede quitarle la propiedad a nadie.
insert into public.organization_invitations (organization_id, email, org_role, expires_at)
values (tests.fx('org_n'), 'otro@test.io', 'org_owner', now() + interval '7 days')
returning tests.set_fx('inv_owner2', id);
update tok set t1 = tests.worker_issue_token(tests.fx('inv_owner2'));
select tests.login('otro');
select throws_ok(format('select public.access_accept_invitation(%L)', (select t1 from tok)),
  'P0001', 'conflict', 'la propiedad solo cambia por transferencia explícita');
select tests.logout();

-- Branding: borrador → publicar --------------------------------------------------------------
select tests.login('duena');
-- Desde F2-T11 el borrador se guarda con la RPC que valida contraste (D-F2-31).
select public.appearance_save_theme_draft(tests.fx('store_n'), '{"colors":{"primary":"#be123c"}}', tests.theme_rev(tests.fx('store_n')));
select lives_ok($$ select public.appearance_publish_theme(tests.fx('store_n'), tests.theme_rev(tests.fx('store_n'))) $$, 'la dueña publica su branding');
select throws_ok($$ select public.appearance_publish_theme(tests.fx('store_n'), tests.theme_rev(tests.fx('store_n'))) $$, 'P0001', 'validation_failed',
  'publicar sin borrador pendiente es un error explícito');
select public.appearance_save_theme_draft(tests.fx('store_n'), '{"colors":{"primary":"#000000"}}', tests.theme_rev(tests.fx('store_n')));
select tests.logout();

select is(tests.gateway_store_public(tests.fx('store_n')) #>> '{theme,settings,colors,primary}', '#be123c',
  'el storefront muestra el branding PUBLICADO, nunca el borrador');

-- Resolución host → tienda (storefront_gateway) -------------------------------------------------
select is((select store_status from tests.gateway_resolve('mi-tienda.tiendas.test')), 'draft',
  'host del subdominio → tienda (en borrador)');
select is((select store_id from tests.gateway_resolve(' MI-Tienda.Tiendas.Test.:443 ')), tests.fx('store_n'),
  'el host se normaliza (mayúsculas, puerto, punto final, espacios)');
select is((select count(*)::int from tests.gateway_resolve('no-existe.tiendas.test')), 0,
  'host desconocido: sin resultado');
select is((select count(*)::int from tests.gateway_resolve('evil.com/../mi-tienda.tiendas.test')), 0,
  'host malformado: sin resultado');

update public.organizations set status = 'suspended' where id = tests.fx('org_n');
select is((select store_status from tests.gateway_resolve('mi-tienda.tiendas.test')), 'suspended',
  'organización suspendida: la tienda se resuelve como suspendida (503)');

update public.stores set status = 'closed', closed_at = now() where id = tests.fx('store_n');
select is((select count(*)::int from tests.gateway_resolve('mi-tienda.tiendas.test')), 0,
  'tienda cerrada: no se resuelve (respuesta uniforme con "no existe")');

-- Confinamiento de roles ------------------------------------------------------------------------
select tests.login('random');
select throws_ok($$ select * from storefront.resolve_host('mi-tienda.tiendas.test') $$, '42501', null,
  'un usuario autenticado no puede invocar funciones del storefront (esquema no expuesto)');
select tests.logout();
select is(tests.sqlstate_as('storefront_gateway',
  $$ select public.platform_create_organization_with_store('a','org-a','MX','a@t.io','a','tienda-a','starter') $$),
  '42501', 'storefront_gateway no puede invocar RPC de plataforma');

select * from finish();
rollback;
