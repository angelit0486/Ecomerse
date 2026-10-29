-- =============================================================================
-- ADR-044 paso 1: precios en los planes y MRR en Consola → Métricas.
-- =============================================================================
begin;
select plan(13);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('owner_c', 'owner@c.io');
select tests.create_user('padmin', 'admin@plataforma.io');
select tests.create_user('psupport', 'soporte@plataforma.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');
select tests.create_tenant('c', 'owner_c');
select tests.make_platform_staff('padmin', 'platform_admin');
select tests.make_platform_staff('psupport', 'platform_support');

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

-- a: mensual activa; b: anual activa; c: en prueba (no cuenta en el MRR).
update public.subscriptions s set billing_interval = 'annual'
  from public.stores st where st.id = tests.fx('store_b') and s.organization_id = st.organization_id;
update public.subscriptions s set status = 'trialing', trial_ends_at = now() + interval '10 days'
  from public.stores st where st.id = tests.fx('store_c') and s.organization_id = st.organization_id;

-- Permisos.
select tests.login('owner_a');
select is(pg_temp.err($$ select public.platform_set_plan_pricing('test_plan', 49900, 499000, 14) $$), 'forbidden',
          'una dueña de tienda no fija precios de la plataforma');
select tests.logout();
select tests.login('psupport');
select is(pg_temp.err($$ select public.platform_set_plan_pricing('test_plan', 49900, 499000, 14) $$), 'forbidden',
          'soporte tampoco');
select tests.logout();

select tests.login('padmin');
-- Sin precios, el MRR no se inventa: las suscripciones que pagan se cuentan aparte.
select is(public.platform_metrics(30) -> 'mrr', '[]'::jsonb, 'sin precios no hay MRR');
select is((public.platform_metrics(30) ->> 'paying_without_price')::int, 2,
          'dos suscripciones que pagan sin precio cargado');

select is(pg_temp.err($$ select public.platform_set_plan_pricing('test_plan', -1, null, null) $$),
          'validation_failed/price_monthly', 'precio negativo rechazado');
select is(pg_temp.err($$ select public.platform_set_plan_pricing('test_plan', 100, null, 91) $$),
          'validation_failed/trial_days', 'prueba de más de 90 días rechazada');
select is(pg_temp.err($$ select public.platform_set_plan_pricing('no_existe', 100, null, null) $$),
          'not_found/plan', 'plan inexistente');

select lives_ok($$ select public.platform_set_plan_pricing('test_plan', 49900, 479000, 14) $$,
                'la administración fija $499 al mes, $4,790 al año y 14 días de prueba');
select is((select p -> 'price_monthly' from jsonb_array_elements(public.platform_list_plans()) p
            where p ->> 'key' = 'test_plan'), '49900'::jsonb, 'la lista de planes trae el precio');

-- MRR = 49900 (mensual) + round(479000 / 12) = 49900 + 39917 = 89817.
select is((public.platform_metrics(30) -> 'mrr' -> 0 ->> 'amount')::bigint, 89817::bigint,
          'MRR: la mensual completa y la anual entre 12; la de prueba no cuenta');
select is((public.platform_metrics(30) -> 'mrr' -> 0 ->> 'subscriptions')::int, 2, 'dos suscripciones en el MRR');
select is((public.platform_metrics(30) ->> 'paying_without_price')::int, 0, 'ya ninguna sin precio');
select tests.logout();

select is((select count(*)::int from audit.audit_logs where action = 'plan.pricing_saved'), 1,
          'el cambio de precios queda en la auditoría');

select * from finish();
rollback;
