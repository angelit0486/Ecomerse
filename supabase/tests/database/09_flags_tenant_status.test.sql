-- =============================================================================
-- Fase 2 · Feature flags (orden de resolución, kill switch, caducidad,
-- entitlements) y estado de tenant (suspender, reactivar, cerrar) — F2-T04.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(64);

select tests.create_user('padmin', 'admin@platform.io');
select tests.create_user('psupport', 'support@platform.io');
select tests.make_platform_staff('padmin', 'platform_admin');
select tests.make_platform_staff('psupport', 'platform_support');
select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_store('a2', 'org_a');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b', 'pro');
select tests.create_user('owner_c', 'owner@c.io');
select tests.create_tenant('c', 'owner_c');
select tests.set_fx('plan_test', (select id from public.plans where key = 'test_plan'));

create function tests.flag(p_key text, p_store_key text) returns boolean
language sql security definer set search_path = '' as $$
  select app.flag_enabled(p_key, tests.fx('store_' || p_store_key))
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
create function tests.gateway_status(p_host text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('role', 'storefront_gateway', true);
  select r.store_status into v from storefront.resolve_host(p_host) r;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function tests.gateway_flag(p_store_key text, p_key text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('role', 'storefront_gateway', true);
  select f.enabled into v from storefront.get_store_flags(tests.fx('store_' || p_store_key)) f where f.key = p_key;
  perform set_config('role', 'none', true);
  return v;
end $$;
create function tests.store_status(p_store_key text) returns text
language sql security definer set search_path = '' as $$
  select s.status from public.stores s where s.id = tests.fx('store_' || p_store_key)
$$;
grant execute on all functions in schema tests to authenticated, storefront_gateway;

-- ============================================================================ Resolución
select is(app.flag_enabled('no_existe', tests.fx('store_a')), false, 'flag inexistente = apagado');
select is(tests.flag('new_checkout', 'a'), false, 'flags iniciales apagados por defecto');

select tests.logout(); select tests.login('psupport');
select throws_ok($$ select public.platform_upsert_feature_flag('demo', 'Flag de prueba', true, 'qa') $$,
  '42501', 'forbidden', 'platform_support no gestiona flags');
select tests.logout(); select tests.login('owner');
select throws_ok($$ select public.platform_upsert_feature_flag('demo', 'Flag de prueba', true, 'qa') $$,
  '42501', 'forbidden', 'un dueño de tienda no gestiona flags');
select tests.logout(); select tests.login('padmin', 'aal1');
select throws_ok($$ select public.platform_upsert_feature_flag('demo', 'Flag de prueba', true, 'qa') $$,
  '42501', 'mfa_required', 'gestionar flags exige 2FA');
select tests.logout(); select tests.login('padmin');
select throws_ok($$ select public.platform_upsert_feature_flag('Demo Flag', 'Flag de prueba', true, 'qa') $$,
  'P0001', 'validation_failed', 'clave con formato inválido');
select throws_ok($$ select public.platform_upsert_feature_flag('demo', 'Flag de prueba', true, 'qa', 'max_staff') $$,
  'P0001', 'validation_failed', 'solo se liga a entitlements booleanos');
select lives_ok($$ select public.platform_upsert_feature_flag('demo', 'Flag de prueba', true, 'qa') $$,
  'platform_admin crea un flag encendido por defecto');
select tests.logout();
select is(app.flag_enabled('demo'), true, 'default_enabled global');
select is(tests.flag('demo', 'a'), true, 'default_enabled en una tienda');

select tests.logout(); select tests.login('padmin');
select lives_ok(format($$ select public.platform_set_flag_override('demo', 'plan', %L, false, 'Plan de pruebas sin demo') $$,
                       tests.fx('plan_test')), 'override de plan');
select tests.logout();
select is(tests.flag('demo', 'a'), false, '4. override de plan gana al default');
select is(tests.flag('demo', 'b'), true, 'otro plan no se ve afectado');

select tests.logout(); select tests.login('padmin');
select lives_ok(format($$ select public.platform_set_flag_override('demo', 'organization', %L, true, 'Cliente piloto') $$,
                       tests.fx('org_a')), 'override de organización');
select tests.logout();
select is(tests.flag('demo', 'a'), true, '3. override de organización gana al de plan');
select is(tests.flag('demo', 'c'), false, 'otra organización del mismo plan sigue con el de plan');

select tests.logout(); select tests.login('padmin');
select lives_ok(format($$ select public.platform_set_flag_override('demo', 'store', %L, false, 'Tienda con incidencia') $$,
                       tests.fx('store_a2')), 'override de tienda');
select tests.logout();
select is(tests.flag('demo', 'a2'), false, '2. override de tienda gana al de organización');
select is(tests.flag('demo', 'a'), true, 'la otra tienda de la organización conserva el de organización');

update public.feature_flag_overrides set expires_at = now() - interval '1 minute'
 where scope = 'store' and scope_id = tests.fx('store_a2');
select is(tests.flag('demo', 'a2'), true, 'un override caducado se ignora');

select tests.logout(); select tests.login('padmin');
select throws_ok($$ select public.platform_set_flag_kill_switch('demo', true, '') $$,
  'P0001', 'validation_failed', 'el kill switch exige motivo');
select lives_ok($$ select public.platform_set_flag_kill_switch('demo', true, 'Incidente 42: errores en producción') $$,
  'kill switch encendido');
select tests.logout();
select ok(not tests.flag('demo', 'a') and not tests.flag('demo', 'b') and not app.flag_enabled('demo'),
  '1. el kill switch apaga el flag en todas partes, incluso con overrides');
select tests.logout(); select tests.login('padmin');
select lives_ok($$ select public.platform_set_flag_kill_switch('demo', false, 'Incidente 42 resuelto') $$,
  'kill switch apagado');
select tests.logout();
select is(tests.flag('demo', 'a'), true, 'al apagar el kill switch vuelve la resolución normal');

-- Entitlement ligado (advanced_analytics).
select is(tests.flag('advanced_analytics', 'a'), false, '5. entitlement ausente en el plan = apagado');
insert into public.plan_entitlements (plan_id, key, value_bool) values (tests.fx('plan_test'), 'advanced_analytics', true);
select is(tests.flag('advanced_analytics', 'a'), true, '5. el plan da el entitlement → flag encendido');
insert into public.organization_entitlement_overrides (organization_id, key, value_bool, reason)
values (tests.fx('org_a'), 'advanced_analytics', false, 'Retirado por impago');
select is(tests.flag('advanced_analytics', 'a'), false, 'el override de entitlement de la organización manda sobre el plan');
select is(tests.flag('advanced_analytics', 'c'), true, 'otra organización del plan lo conserva');

-- Validaciones y borrado de overrides.
select tests.logout(); select tests.login('padmin');
select throws_ok(format($$ select public.platform_set_flag_override('demo', 'user', %L, true, 'motivo válido') $$, tests.fx('owner')),
  'P0001', 'validation_failed', 'scope de usuario no existe en el MVP');
select throws_ok(format($$ select public.platform_set_flag_override('demo', 'store', %L, true, 'motivo válido') $$, gen_random_uuid()),
  'P0001', 'not_found', 'tienda inexistente');
select throws_ok(format($$ select public.platform_set_flag_override('demo', 'store', %L, true, 'motivo válido', now() - interval '1 day') $$,
                        tests.fx('store_a')),
  'P0001', 'validation_failed', 'caducidad en el pasado');
select throws_ok(format($$ select public.platform_set_flag_override('nada', 'store', %L, true, 'motivo válido') $$, tests.fx('store_a')),
  'P0001', 'not_found', 'flag inexistente');
select lives_ok(format($$ select public.platform_delete_flag_override('demo', 'organization', %L, 'Fin del piloto') $$, tests.fx('org_a')),
  'borrar un override');
select throws_ok(format($$ select public.platform_delete_flag_override('demo', 'organization', %L, 'Fin del piloto') $$, tests.fx('org_a')),
  'P0001', 'not_found', 'no se borra dos veces');
select tests.logout();
select is(tests.flag('demo', 'a'), false, 'sin override de organización, vuelve a mandar el de plan');
select is((select count(*)::int from audit.audit_logs where action = 'override.created'
            and store_id = tests.fx('store_a2') and organization_id = tests.fx('org_a')),
  1, 'override de tienda auditado con su tienda y organización');

-- Lectura de flags.
select tests.logout(); select tests.login('owner');
select is((select enabled from public.access_store_flags(tests.fx('store_a')) where key = 'advanced_analytics'),
  false, 'el panel recibe los flags resueltos de su tienda');
select tests.logout(); select tests.login('owner_b');
select throws_ok(format($$ select * from public.access_store_flags(%L) $$, tests.fx('store_a')),
  '42501', 'forbidden', 'otro tenant no lee los flags de la tienda');
select tests.logout();
select is(tests.gateway_flag('b', 'demo'), true, 'el storefront recibe los flags resueltos');
select is(tests.sqlstate_as('authenticated', 'select * from public.feature_flags'), '42501',
  'las tablas de flags no se leen directamente');
select is(tests.sqlstate_as('storefront_gateway', 'select app.flag_enabled(''demo'')'), '42501',
  'el gateway no ejecuta la resolución interna');

-- ============================================================================ Estado de tenant
select tests.logout(); select tests.login('psupport');
select throws_ok(format($$ select public.platform_set_tenant_status(%L, 'suspended', 'Fraude reportado por el banco') $$, tests.fx('org_a')),
  '42501', 'forbidden', 'platform_support no suspende tenants');
select tests.logout(); select tests.login('owner');
select throws_ok(format($$ select public.platform_set_tenant_status(%L, 'active', 'Quiero reactivarme yo mismo') $$, tests.fx('org_a')),
  '42501', 'forbidden', 'un tenant no cambia su propio estado');
select tests.logout(); select tests.login('padmin');
select throws_ok(format($$ select public.platform_set_tenant_status(%L, 'suspended', 'corto') $$, tests.fx('org_a')),
  'P0001', 'validation_failed', 'motivo obligatorio');
select throws_ok(format($$ select public.platform_set_tenant_status(%L, 'borrada', 'Motivo suficientemente largo') $$, tests.fx('org_a')),
  'P0001', 'validation_failed', 'estado inválido');
select lives_ok(format($$ select public.platform_set_tenant_status(%L, 'suspended', 'Fraude reportado por el banco') $$, tests.fx('org_a')),
  'platform_admin suspende la organización');
select tests.logout();
select ok(not tests.can('owner', 'a', 'store.read') and not tests.can('owner', 'a2', 'store.read'),
  'organización suspendida: el dueño pierde el acceso a todas sus tiendas al instante');
select is(tests.gateway_status('tienda-a.tiendas.test'), 'suspended', 'el storefront la ve suspendida (mantenimiento)');
select is((select reason from audit.audit_logs where action = 'tenant.suspended' and entity_id = tests.fx('org_a')),
  'Fraude reportado por el banco', 'suspensión auditada con motivo');
select tests.logout(); select tests.login('padmin');
select lives_ok(format($$ select public.platform_set_tenant_status(%L, 'active', 'Verificación completada con el banco') $$, tests.fx('org_a')),
  'y la reactiva');
select tests.logout();
select ok(tests.can('owner', 'a', 'store.read'), 'reactivada: recupera el acceso');

-- Tienda individual.
update public.stores set launched_at = now(), status = 'active' where id = tests.fx('store_a');
select tests.logout(); select tests.login('padmin');
select lives_ok(format($$ select public.platform_set_tenant_status(%L, 'suspended', 'Contenido denunciado', %L) $$,
                       tests.fx('org_a'), tests.fx('store_a')), 'suspende una sola tienda');
select lives_ok(format($$ select public.platform_set_tenant_status(%L, 'suspended', 'Contenido denunciado', %L) $$,
                       tests.fx('org_a'), tests.fx('store_a')), 'suspender dos veces no falla');
select tests.logout();
select ok(not tests.can('owner', 'a', 'store.read') and tests.can('owner', 'a2', 'store.read'),
  'solo esa tienda pierde el acceso');
select tests.logout(); select tests.login('padmin');
select lives_ok(format($$ select public.platform_set_tenant_status(%L, 'active', 'Contenido retirado por el dueño', %L) $$,
                       tests.fx('org_a'), tests.fx('store_a')), 'reactiva la tienda');
select lives_ok(format($$ select public.platform_set_tenant_status(%L, 'suspended', 'Revisión de cumplimiento', %L) $$,
                       tests.fx('org_a'), tests.fx('store_a2')), 'suspende una tienda nunca lanzada');
select lives_ok(format($$ select public.platform_set_tenant_status(%L, 'active', 'Revisión de cumplimiento terminada', %L) $$,
                       tests.fx('org_a'), tests.fx('store_a2')), 'y la reactiva');
select throws_ok(format($$ select public.platform_set_tenant_status(%L, 'suspended', 'Motivo suficientemente largo', %L) $$,
                        tests.fx('org_a'), tests.fx('store_b')),
  'P0001', 'not_found', 'la tienda debe pertenecer a la organización indicada');
select tests.logout();
select is(tests.store_status('a') || '/' || tests.store_status('a2'), 'paused/draft',
  'reactivar nunca publica: paused si ya se lanzó, draft si no');

-- Cierre definitivo.
select tests.logout(); select tests.login('padmin');
select lives_ok(format($$ select public.platform_set_tenant_status(%L, 'closed', 'Cliente canceló el servicio') $$, tests.fx('org_b')),
  'cierra la organización');
select throws_ok(format($$ select public.platform_set_tenant_status(%L, 'active', 'Cliente quiere volver') $$, tests.fx('org_b')),
  'P0001', 'conflict', 'cerrar es definitivo');
select tests.logout();
select ok((select status = 'closed' and closed_at is not null from public.organizations where id = tests.fx('org_b'))
          and tests.store_status('b') = 'closed',
  'la organización y sus tiendas quedan cerradas');

select is(tests.sqlstate_as('anon', format('select public.platform_set_tenant_status(%L, %L, %L)',
                                           tests.fx('org_a'), 'suspended', 'Motivo suficientemente largo')),
  '42501', 'anon no ejecuta funciones de plataforma');

select * from finish();
rollback;
