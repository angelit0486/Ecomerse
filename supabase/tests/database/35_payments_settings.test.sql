-- =============================================================================
-- Fase 7 · Ajustes → Pagos (F7-T06): cuentas de Stripe Connect.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function tests.stripe_status(p_store uuid) returns text language sql as
  $$ select status from public.payment_accounts where store_id = p_store and provider = 'stripe' $$;

-- ============================================================================ Permisos
select tests.login('viewer');
select throws_ok(format($$ select public.payments_get_stripe(%L) $$, tests.fx('store_a')), '42501', 'forbidden',
  'viewer no ve la configuración de pagos');
select tests.logout();
select tests.login('owner');
select is(public.payments_get_stripe(tests.fx('store_a')) -> 'account', 'null'::jsonb, 'sin cuenta conectada');
select tests.logout();
select ok(not has_function_privilege('authenticated', 'system.stripe_attach_account(uuid,text,text)', 'execute')
       and not has_function_privilege('authenticated', 'system.stripe_sync_account(text,boolean,boolean)', 'execute'),
  'ningún usuario asocia ni activa una cuenta: solo el worker');

-- ============================================================================ Asociar (worker)
select throws_ok(format($$ select system.stripe_attach_account(%L, 'acct_mal', 'test') $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'id de cuenta inválido: rechazado');
select is(system.stripe_attach_account(tests.fx('store_a'), 'acct_AAAAAAAAAA01', 'test'), 'acct_AAAAAAAAAA01',
  'cuenta asociada');
select is(system.stripe_attach_account(tests.fx('store_a'), 'acct_AAAAAAAAAA02', 'test'), 'acct_AAAAAAAAAA01',
  'segunda creación: se conserva la primera (idempotente)');
select is(tests.stripe_status(tests.fx('store_a')), 'pending', 'nace pendiente');
select throws_ok(format($$ select system.stripe_attach_account(%L, 'acct_AAAAAAAAAA01', 'test') $$, tests.fx('store_b')),
  '23505', null, 'otra tienda no puede asociar la misma cuenta');

-- ============================================================================ Estado según Stripe
select is(system.stripe_sync_account('acct_AAAAAAAAAA01', false, true), 'pending', 'sin cobros habilitados: pendiente');
select is(system.stripe_sync_account('acct_AAAAAAAAAA01', true, true), 'active', 'Stripe habilita cobros: activa');

select tests.login('owner');
select is(public.payments_set_stripe_enabled(tests.fx('store_a'), false), 'disabled', 'la tienda la desactiva');
select tests.logout();
select is(system.stripe_sync_account('acct_AAAAAAAAAA01', true, true), 'disabled',
  'una sincronización no reactiva lo que la tienda desactivó');
select tests.login('owner');
select is(public.payments_set_stripe_enabled(tests.fx('store_a'), true), 'pending',
  'reactivar nunca activa directamente');
select tests.logout();
select tests.login('owner_b');
select throws_ok(format($$ select public.payments_set_stripe_enabled(%L, true) $$, tests.fx('store_a')),
  '42501', 'forbidden', 'B no cambia los pagos de A');
select tests.logout();
select ok(exists (select 1 from audit.audit_logs where action = 'payments.stripe_status_changed'
                   and store_id = tests.fx('store_a')), 'cambios de estado auditados');

select * from finish();
rollback;
