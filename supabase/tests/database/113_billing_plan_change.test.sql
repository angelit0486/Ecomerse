-- =============================================================================
-- ADR-044: cambiar de plan o de periodo una suscripción que ya se paga con Stripe.
-- =============================================================================
begin;
select plan(17);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_user('admin_a', 'tienda@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'admin_a', 'store_admin');
update public.plans set price_monthly = 49900, price_annual = 479000 where key = 'test_plan';
select tests.ensure_plan('grande', 10, 10);
update public.plans set price_monthly = 99900, price_annual = 959000, status = 'active' where key = 'grande';
select tests.ensure_plan('chico', 0, 10);
update public.plans set price_monthly = 9900, status = 'active' where key = 'chico';
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
create function pg_temp.ev(p_id text, p_created bigint, p_status text, p_plan text default 'test_plan',
                           p_interval text default 'monthly')
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_role('system_worker');
  v := system.billing_apply_stripe_event(jsonb_build_object(
    'event_id', p_id, 'created', p_created, 'type', 'customer.subscription.updated',
    'organization_id', tests.fx('org_a'), 'customer_id', 'cus_A', 'subscription_id', 'sub_A',
    'status', p_status, 'plan_key', p_plan, 'interval', p_interval,
    'current_period_end', p_created + 2592000));
  perform tests.logout();
  return v;
end $$;
create function pg_temp.change(p_store text, p_plan text, p_interval text) returns text language sql as $$
  select pg_temp.err(format('select public.org_billing_change_input(%L, %L, %L)',
                            tests.fx('store_' || p_store), p_plan, p_interval))
$$;

-- Sin suscripción de Stripe no hay nada que cambiar (se paga con «Pagar con tarjeta»).
select tests.login('owner_a');
select is(pg_temp.change('a', 'grande', 'monthly'), 'conflict/no_card_subscription',
          'sin suscripción de Stripe no se cambia de plan aquí');
select is(public.org_billing_change_options(tests.fx('store_a')), null, 'y no se ofrecen opciones de cambio');
select tests.logout();

select pg_temp.ev('evt_1', 1800000000, 'active');

select tests.login('owner_a');
select is(public.org_billing_change_input(tests.fx('store_a'), 'grande', 'annual') ->> 'amount', '959000',
          'el precio del plan nuevo sale de la base');
select is(public.org_billing_change_input(tests.fx('store_a'), 'grande', 'annual') ->> 'subscription_id', 'sub_A',
          'con la suscripción de Stripe a modificar');
select is(public.org_billing_change_input(tests.fx('store_a'), 'test_plan', 'annual') ->> 'interval', 'annual',
          'cambiar solo el periodo también es un cambio');
select is(pg_temp.change('a', 'test_plan', 'monthly'), 'conflict/same_plan', 'el mismo plan y periodo no es un cambio');
select is(pg_temp.change('a', 'gratis', 'monthly'), 'conflict/plan_without_price', 'un plan sin precio no se cobra');
select is(pg_temp.change('a', 'chico', 'monthly'), 'conflict/over_limit:max_stores',
          'bajar a un plan que no alcanza para sus tiendas no se permite');
select is(pg_temp.change('a', 'grande', 'semanal'), 'validation_failed/interval', 'solo mensual o anual');
select is(pg_temp.change('b', 'grande', 'monthly'), 'forbidden', 'no cambia el plan de otra organización');
select is(public.org_billing_change_options(tests.fx('store_a')) -> 'current' ->> 'plan_key', 'test_plan',
          'las opciones dicen el plan actual');
select is(jsonb_array_length(public.org_billing_change_options(tests.fx('store_a')) -> 'plans'), 3,
          'y los planes con precio');
select tests.logout();

select tests.login('admin_a');
select is(pg_temp.change('a', 'grande', 'monthly'), 'forbidden', 'la administradora de la tienda no cambia el plan');
select tests.logout();
select tests.login('owner_a', 'aal1');
select is(pg_temp.change('a', 'grande', 'monthly'), 'mfa_required', 'sin verificación en dos pasos no se cambia');
select tests.logout();

-- El cambio se aplica solo cuando llega el webhook firmado de Stripe.
select pg_temp.ev('evt_2', 1800000100, 'active', 'grande', 'annual');
select is((select p.key || '|' || s.billing_interval from public.subscriptions s join public.plans p on p.id = s.plan_id
            where s.organization_id = tests.fx('org_a') and s.status <> 'cancelled'), 'grande|annual',
          'el webhook aplica el plan y el periodo nuevos');

select pg_temp.ev('evt_3', 1800000200, 'past_due', 'grande', 'annual');
select tests.login('owner_a');
select is(pg_temp.change('a', 'test_plan', 'monthly'), 'conflict/past_due', 'con un cobro pendiente primero se paga');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.change('b', 'grande', 'monthly'), 'conflict/no_card_subscription',
          'otra organización sin Stripe no puede cambiar');
select tests.logout();

select * from finish();
rollback;
