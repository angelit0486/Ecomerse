-- =============================================================================
-- ADR-068 (precios aprobados el 2026-11-17): cuota única de arranque por plan.
-- Se cobra una vez, en el primer pago con tarjeta; la plataforma la puede marcar
-- como cobrada por fuera o condonada, con motivo y auditoría.
-- =============================================================================
begin;
select plan(27);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('padmin', 'admin@plataforma.io');
select tests.create_user('psupport', 'soporte@plataforma.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');
select tests.make_platform_staff('padmin', 'platform_admin');
select tests.make_platform_staff('psupport', 'platform_support');
select tests.set_fx('org_a', (select organization_id from public.stores where id = tests.fx('store_a')));
select tests.set_fx('org_b', (select organization_id from public.stores where id = tests.fx('store_b')));

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

-- ---------------------------------------------------------------- Esquema
select has_column('public', 'plans', 'setup_fee', 'los planes guardan la cuota de arranque');
select has_column('public', 'organizations', 'setup_fee_settled_at', 'y la organización si ya quedó saldada');
select is((select setup_fee from public.plans where key = 'test_plan'), null::bigint,
          'ningún plan trae cuota hasta que la plataforma la captura');
select ok(not has_function_privilege('authenticated', 'app.org_setup_fee_due(uuid)', 'execute'),
          'el cálculo interno no se llama directo');

-- ---------------------------------------------------------------- Capturar la cuota
select tests.login('owner_a');
select is(pg_temp.err($$ select public.platform_set_plan_pricing('test_plan', 69900, 699000, 14, 290000) $$),
          'forbidden', 'una dueña de tienda no fija precios de la plataforma');
select tests.logout();
select tests.login('psupport');
select is(pg_temp.err($$ select public.platform_set_plan_pricing('test_plan', 69900, 699000, 14, 290000) $$),
          'forbidden', 'soporte tampoco');
select tests.logout();

select tests.login('padmin');
select is(pg_temp.err($$ select public.platform_set_plan_pricing('test_plan', 69900, 699000, 14, -1) $$),
          'validation_failed/setup_fee', 'cuota negativa rechazada');
select is(pg_temp.err($$ select public.platform_set_plan_pricing('test_plan', 69900, 699000, 14, 100000001) $$),
          'validation_failed/setup_fee', 'cuota fuera de rango rechazada');
select lives_ok($$ select public.platform_set_plan_pricing('test_plan', 69900, 699000, 14, 290000) $$,
                'la administración fija $699 al mes, $6,990 al año, 14 días y $2,900 de arranque');
select is((select p -> 'setup_fee' from jsonb_array_elements(public.platform_list_plans()) p
            where p ->> 'key' = 'test_plan'), '290000'::jsonb, 'la consola lista la cuota');
-- La versión de 4 argumentos (código anterior) cambia precios sin borrar la cuota.
select lives_ok($$ select public.platform_set_plan_pricing('test_plan', 69900, 699000, 14) $$,
                'la versión anterior de 4 argumentos sigue funcionando');
select is((select setup_fee from public.plans where key = 'test_plan'), 290000::bigint,
          'y no toca la cuota de arranque');
select tests.logout();
select is((select count(*)::int from audit.audit_logs
            where action = 'plan.pricing_saved' and after ->> 'setup_fee' = '290000'), 1,
          'la cuota queda en la auditoría');

-- ---------------------------------------------------------------- Primer pago con tarjeta
select tests.login('owner_a');
select is(public.org_billing_plans(tests.fx('store_a')) -> 0 ->> 'setup_fee', '290000',
          '«Plan y uso» muestra la cuota que se cobrará');
select is(public.org_billing_checkout_input(tests.fx('store_a'), 'test_plan', 'monthly') ->> 'setup_fee', '290000',
          'el Checkout la incluye en el primer pago');
select is(public.org_billing_checkout_input(tests.fx('store_a'), 'test_plan', 'annual') ->> 'amount', '699000',
          'el anual sigue saliendo de la base');
select tests.logout();

-- Ya pagó con tarjeta antes (cliente de Stripe) y volvió: no se cobra otra vez.
update public.subscriptions set provider = 'stripe', provider_customer_id = 'cus_A', status = 'paused'
 where organization_id = tests.fx('org_a');
select tests.login('owner_a');
select is(public.org_billing_checkout_input(tests.fx('store_a'), 'test_plan', 'monthly') ->> 'setup_fee', '0',
          'quien ya pagó con tarjeta no vuelve a pagar la cuota');
select is(public.org_billing_plans(tests.fx('store_a')) -> 0 ->> 'setup_fee', '0', 'ni se le muestra');
select tests.logout();

-- ---------------------------------------------------------------- Cobrada por fuera o condonada
select tests.login('owner_b');
select is(pg_temp.err(format('select public.platform_set_setup_fee_settled(%L, true, %L)', tests.fx('org_b'), 'Pagó por transferencia')),
          'forbidden', 'la dueña no puede marcar su propia cuota como pagada');
select tests.logout();
select tests.login('psupport');
select is(public.platform_org_setup_fee(tests.fx('org_b')) ->> 'due', 'true', 'soporte ve que b la debe');
select is(pg_temp.err(format('select public.platform_set_setup_fee_settled(%L, true, %L)', tests.fx('org_b'), 'Pagó por transferencia')),
          'forbidden', 'pero no la puede marcar');
select tests.logout();
select tests.login('padmin');
select is(pg_temp.err(format('select public.platform_set_setup_fee_settled(%L, true, %L)', tests.fx('org_b'), 'no')),
          'validation_failed/reason', 'sin motivo no se marca');
select lives_ok(format('select public.platform_set_setup_fee_settled(%L, true, %L)', tests.fx('org_b'),
                       'Pagó el arranque por transferencia'), 'la administración la marca como cobrada');
select is(public.platform_org_setup_fee(tests.fx('org_b')) ->> 'due', 'false', 'ya no se debe');
select tests.logout();
select tests.login('owner_b');
select is(public.org_billing_checkout_input(tests.fx('store_b'), 'test_plan', 'monthly') ->> 'setup_fee', '0',
          'y su primer pago con tarjeta no la incluye');
select tests.logout();
select tests.login('padmin');
select lives_ok(format('select public.platform_set_setup_fee_settled(%L, false, %L)', tests.fx('org_b'),
                       'Se marcó por error'), 'se puede volver a deber, con motivo');
select tests.logout();
select is((select count(*)::int from audit.audit_logs
            where action in ('organization.setup_fee_settled', 'organization.setup_fee_reopened')
              and organization_id = tests.fx('org_b')), 2, 'cada marca queda en la auditoría');

select * from finish();
rollback;
