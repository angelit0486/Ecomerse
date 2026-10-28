-- =============================================================================
-- F10-T01: planes, suscripción manual, excepciones y "Plan y uso". Quién puede
-- qué, que cada transición deja el modo de acceso esperado (§19.4) y que el
-- mantenimiento avanza solo lo vencido.
-- =============================================================================
begin;
select plan(26);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('member', 'member@a.io');
select tests.create_user('support', 'support@p.io');
select tests.create_user('padmin', 'admin@p.io');
select tests.create_tenant('a', 'owner');
select tests.make_platform_staff('support', 'platform_support');
select tests.make_platform_staff('padmin', 'platform_admin');
insert into public.organization_members (organization_id, user_id, role)
values (tests.fx('org_a'), tests.fx('member'), 'org_member');

create function tests.mode() returns text language sql security definer set search_path = '' as $$
  select app.org_access_mode(tests.fx('org_a')) $$;
create function tests.sub_status() returns text language sql security definer set search_path = '' as $$
  select s.status from public.subscriptions s
   where s.organization_id = tests.fx('org_a') and s.status <> 'cancelled' $$;
create function tests.age_sub(p_sql text) returns void language plpgsql security definer set search_path = '' as $$
begin execute p_sql; end $$;
create function tests.audits(p_action text) returns bigint language sql security definer set search_path = '' as $$
  select count(*) from audit.audit_logs l where l.action = p_action $$;
grant execute on all functions in schema tests to authenticated;

create function pg_temp.ents(p_products integer) returns jsonb language sql as $$
  select jsonb_build_object('max_stores', 2, 'max_products', p_products, 'max_variants_per_product', 50,
                            'max_staff', 5, 'max_locations', 1, 'max_custom_domains', 1, 'storage_mb', 500,
                            'custom_domains', true) $$;

-- 1. Planes: solo dueño/administrador de la plataforma, con todos los límites.
select tests.login('support');
select ok(jsonb_array_length(public.platform_list_plans()) >= 1, 'soporte ve los planes');
select is(pg_temp.err($$select public.platform_save_plan('basico', 'Básico', 'active', 1, pg_temp.ents(100))$$),
          'forbidden', 'soporte no edita planes');
select tests.logout();

select tests.login('padmin');
select is(pg_temp.err($$select public.platform_save_plan('basico', 'Básico', 'active', 1,
                                                         pg_temp.ents(100) - 'storage_mb')$$),
          'validation_failed/storage_mb', 'un plan sin un límite numérico no se guarda (valdría 0)');
select is(pg_temp.err($$select public.platform_save_plan('basico', 'Básico', 'active', 1,
                                                         pg_temp.ents(100) || '{"inventada": 1}')$$),
          'validation_failed/inventada', 'una clave que no existe tampoco');
select is(pg_temp.err($$select public.platform_save_plan('basico', 'Básico', 'active', 1, pg_temp.ents(100))$$),
          'ok', 'la administradora crea el plan Básico');
select is((select p -> 'entitlements' ->> 'max_products' from jsonb_array_elements(public.platform_list_plans()) p
            where p ->> 'key' = 'basico'), '100', 'con sus límites');
select is(pg_temp.err($$select public.platform_save_plan('basico', 'Básico', 'active', 1, pg_temp.ents(250))$$),
          'ok', 'y lo edita');
select tests.logout();
select is(tests.audits('plan.saved'), 2::bigint, 'cada cambio de plan queda auditado');

-- 2. Plan y uso: dueña sí, miembro no; sin notas internas.
select tests.login('owner');
select is(public.org_plan_usage(tests.fx('store_a')) -> 'plan' ->> 'key', 'test_plan', 'la dueña ve su plan');
select ok((public.org_plan_usage(tests.fx('store_a')) -> 'entitlements' -> 'max_stores' ->> 'used')::int = 1,
          'y su uso en vivo (1 tienda)');
select ok(not (public.org_plan_usage(tests.fx('store_a')) -> 'subscription' ? 'notes'), 'nunca las notas internas');
select tests.logout();
select tests.login('member');
select is(pg_temp.err(format('select public.org_plan_usage(%L)', tests.fx('store_a'))), 'forbidden',
          'un miembro sin permiso de facturación no lo ve');
select tests.logout();

-- 3. Transiciones manuales.
select tests.login('support');
select is(pg_temp.err(format($$select public.platform_set_subscription(%L, 'pause', null, null, 'No pagó')$$,
                             tests.fx('org_a'))), 'forbidden', 'soporte no cambia suscripciones');
select tests.logout();
select tests.login('padmin');
select is(pg_temp.err(format($$select public.platform_set_subscription(%L, 'pause', null, null, 'x')$$,
                             tests.fx('org_a'))), 'validation_failed/reason', 'sin motivo, nada');
select public.platform_set_subscription(tests.fx('org_a'), 'change_plan', 'basico', null, 'Pasa al plan Básico');
select is(public.platform_get_org_billing(tests.fx('org_a')) -> 'plan' ->> 'key', 'basico', 'cambia de plan');
select public.platform_set_subscription(tests.fx('org_a'), 'past_due', null, 3, 'Pago de octubre pendiente');
select is(tests.mode(), 'full', 'pago vencido dentro de la gracia: sigue completo');
select public.platform_set_subscription(tests.fx('org_a'), 'pause', null, null, 'Sin pago tras la gracia');
select is(tests.mode(), 'read_only', 'pausada: solo lectura');
select public.platform_set_subscription(tests.fx('org_a'), 'activate', null, 30, 'Pagó noviembre');
select is(tests.mode(), 'full', 'al registrar el pago vuelve a completo');
select ok((public.platform_get_org_billing(tests.fx('org_a')) -> 'subscription' ->> 'current_period_end')::timestamptz
            > now() + interval '29 days', 'con el periodo pagado');
select public.platform_set_subscription(tests.fx('org_a'), 'cancel', null, null, 'Deja la plataforma');
select is(tests.mode(), 'suspended', 'cancelada: sin acceso');
select is(pg_temp.err(format($$select public.platform_set_subscription(%L, 'pause', null, null, 'Pausar')$$,
                             tests.fx('org_a'))), 'conflict/no_subscription', 'sin suscripción no hay qué pausar');
select public.platform_set_subscription(tests.fx('org_a'), 'extend_trial', 'basico', 14, 'Regresa con prueba');
select is(tests.sub_status() || ':' || tests.mode(), 'trialing:full', 'vuelve con una prueba nueva');

-- 4. Excepciones por organización.
select public.platform_set_entitlement_override(tests.fx('org_a'), 'max_products', '5000', null,
                                                'Promoción de lanzamiento');
select is(public.platform_get_org_billing(tests.fx('org_a')) -> 'entitlements' -> 'max_products' ->> 'value',
          '5000', 'la excepción manda sobre el plan');
select tests.logout();

-- 5. El mantenimiento avanza solo lo vencido: activa vencida → pago pendiente → pausa → suspendida.
select tests.login('padmin');
select public.platform_set_subscription(tests.fx('org_a'), 'activate', null, 30, 'Pago anual');
select tests.logout();
select tests.age_sub(format($$update public.subscriptions set current_period_end = now() - interval '1 day'
                               where organization_id = %L and status = 'active'$$, tests.fx('org_a')));
select system.subscriptions_advance();
select is(tests.sub_status() || ':' || tests.mode(), 'past_due:full', 'periodo vencido: pago pendiente con gracia');
select tests.age_sub(format($$update public.subscriptions set grace_ends_at = now() - interval '1 minute'
                               where organization_id = %L and status = 'past_due'$$, tests.fx('org_a')));
select system.subscriptions_advance();
select is(tests.sub_status() || ':' || tests.mode(), 'paused:read_only', 'gracia vencida: pausada');
select tests.age_sub(format($$update public.subscriptions set paused_at = now() - interval '31 days'
                               where organization_id = %L and status = 'paused'$$, tests.fx('org_a')));
select is(tests.mode(), 'suspended', 'pausada más de 30 días: suspendida');

select * from finish();
rollback;
