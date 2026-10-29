-- =============================================================================
-- ADR-044 paso 2: cobro de la suscripción con Stripe Billing.
-- =============================================================================
begin;
select plan(26);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_user('admin_a', 'tienda@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'admin_a', 'store_admin');
update public.plans set price_monthly = 49900, price_annual = 479000 where key = 'test_plan';
insert into public.plans (key, name, status) values ('gratis', 'Gratis', 'active');

select tests.set_fx('org_a', (select organization_id from public.stores where id = tests.fx('store_a')));

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
-- Evento de Stripe ya verificado, aplicado como el webhook (system_worker).
create function pg_temp.ev(p_id text, p_created bigint, p_status text, p_sub text default 'sub_A',
                           p_type text default 'customer.subscription.updated', p_interval text default 'monthly')
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_role('system_worker');
  v := system.billing_apply_stripe_event(jsonb_build_object(
    'event_id', p_id, 'created', p_created, 'type', p_type, 'organization_id', tests.fx('org_a'),
    'customer_id', 'cus_A', 'subscription_id', p_sub, 'status', p_status, 'plan_key', 'test_plan',
    'interval', p_interval, 'current_period_end', p_created + 2592000));
  perform tests.logout();
  return v;
end $$;
create function pg_temp.sub_a() returns public.subscriptions language sql as $$
  select s.* from public.subscriptions s where s.organization_id = tests.fx('org_a') and s.status <> 'cancelled'
$$;

-- ---------------------------------------------------------------- Abrir el Checkout
select tests.login('owner_a');
select is(public.org_billing_checkout_input(tests.fx('store_a'), 'test_plan', 'monthly') ->> 'amount', '49900',
          'la dueña obtiene el precio mensual del plan desde la base');
select is(public.org_billing_checkout_input(tests.fx('store_a'), 'test_plan', 'annual') ->> 'amount', '479000',
          'y el anual');
select is(pg_temp.err(format('select public.org_billing_checkout_input(%L, %L, %L)', tests.fx('store_a'), 'gratis', 'monthly')),
          'conflict/plan_without_price', 'un plan sin precio no se cobra con tarjeta');
select is(pg_temp.err(format('select public.org_billing_checkout_input(%L, %L, %L)', tests.fx('store_a'), 'test_plan', 'semanal')),
          'validation_failed/interval', 'solo mensual o anual');
select is(pg_temp.err(format('select public.org_billing_checkout_input(%L, %L, %L)', tests.fx('store_b'), 'test_plan', 'monthly')),
          'forbidden', 'no puede pagar por otra organización');
select is(jsonb_array_length(public.org_billing_plans(tests.fx('store_a'))), 1,
          'solo se ofrecen planes activos con precio (no el gratis)');
select is(public.org_billing_plans(tests.fx('store_a')) -> 0 ->> 'price_monthly', '49900', 'con su precio');
select is(pg_temp.err(format('select public.org_billing_plans(%L)', tests.fx('store_b'))), 'forbidden',
          'los planes de otra organización no se consultan desde aquí');
select tests.logout();
select tests.login('admin_a');
select is(pg_temp.err(format('select public.org_billing_checkout_input(%L, %L, %L)', tests.fx('store_a'), 'test_plan', 'monthly')),
          'forbidden', 'la administradora de la tienda no gestiona la facturación (solo la dueña)');
select tests.logout();
select tests.login('owner_a', 'aal1');
select is(pg_temp.err(format('select public.org_billing_checkout_input(%L, %L, %L)', tests.fx('store_a'), 'test_plan', 'monthly')),
          'mfa_required', 'sin la verificación en dos pasos no se paga');
select tests.logout();

-- ---------------------------------------------------------------- Eventos de Stripe
select tests.login('owner_a');
select is(pg_temp.err($$ select system.billing_apply_stripe_event('{}'::jsonb) $$), 'permission denied for schema system',
          'una persona no puede aplicar eventos de cobro');
select tests.logout();

select is(pg_temp.ev('evt_1', 1800000000, 'active') ->> 'outcome', 'updated', 'pago aprobado: actualiza la suscripción');
select is((pg_temp.sub_a()).provider, 'stripe', 'queda como suscripción de Stripe');
select is((pg_temp.sub_a()).status, 'active', 'activa');
select is((pg_temp.sub_a()).current_period_end, to_timestamp(1800000000 + 2592000), 'con el fin de periodo de Stripe');
select is(pg_temp.ev('evt_1', 1800000000, 'active') ->> 'outcome', 'duplicate', 'el mismo aviso dos veces no hace nada');

select tests.login('owner_a');
select is(public.org_billing_plans(tests.fx('store_a')), '[]'::jsonb,
          'con la suscripción de Stripe activa ya no se ofrece pagar otra');
select tests.logout();
select is(pg_temp.ev('evt_2', 1800000100, 'past_due') ->> 'status', 'past_due', 'cobro fallido: pago vencido');
select ok((pg_temp.sub_a()).grace_ends_at > now() + interval '6 days', 'con 7 días de gracia');
create temp table g as select (pg_temp.sub_a()).grace_ends_at as v;
select pg_temp.ev('evt_3', 1800000200, 'past_due');
select is((pg_temp.sub_a()).grace_ends_at, (select v from g), 'un reintento fallido no alarga la gracia');

select is(pg_temp.ev('evt_old', 1800000050, 'active') ->> 'reason', 'stale',
          'un aviso más viejo que llega tarde se ignora');
select is((pg_temp.sub_a()).status, 'past_due', 'y no revive la suscripción');

select is(pg_temp.ev('evt_4', 1800000300, 'canceled', 'sub_VIEJA') ->> 'reason', 'other_subscription',
          'la cancelación de otra suscripción de Stripe no toca la vigente');

select is(pg_temp.ev('evt_5', 1800000400, 'canceled') ->> 'status', 'cancelled', 'cancelada en Stripe: cancelada aquí');
select is((select count(*)::int from public.subscriptions where organization_id = tests.fx('org_a') and status <> 'cancelled'),
          0, 'la organización queda sin suscripción vigente (como al cancelar en la consola)');
select is((select count(*)::int from audit.audit_logs where action like 'subscription.provider_%'
            and organization_id = tests.fx('org_a')), 4, 'cada cambio de Stripe queda en la auditoría');

select * from finish();
rollback;
