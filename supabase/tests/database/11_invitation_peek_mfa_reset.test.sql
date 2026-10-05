-- =============================================================================
-- Fase 2 · Vista previa de invitación (worker) y reset de MFA (F2-T10).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('admin', 'admin@a.io');
select tests.create_user('member', 'member@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_org_member('org_a', 'admin', 'org_admin');
select tests.add_org_member('org_a', 'member', 'org_member');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

insert into public.organization_invitations (organization_id, store_id, email, store_role_id, expires_at,
                                             token_hash)
values (tests.fx('org_a'), tests.fx('store_a'), 'nueva@a.io',
        (select id from public.roles where key = 'viewer' and organization_id is null),
        now() + interval '7 days', app.token_hash(repeat('ab', 32)));

create function tests.peek(p_token text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('role', 'system_worker', true);
  select p.email || '|' || p.organization_name || '|' || coalesce(p.store_name, '-') into v
    from system.peek_invitation(p_token) p;
  perform set_config('role', 'none', true);
  return v;
end $$;
grant execute on all functions in schema tests to authenticated, system_worker;

select is(tests.peek(repeat('ab', 32)), 'nueva@a.io|Org a|Tienda a', 'token vigente: email y destino');
select is(tests.peek(repeat('cd', 32)), null::text, 'token inexistente: nada');
select is(tests.peek('no-es-token'), null::text, 'formato inválido: nada');
update public.organization_invitations set expires_at = now() - interval '1 minute' where email = 'nueva@a.io';
select is(tests.peek(repeat('ab', 32)), null::text, 'invitación caducada: nada');
update public.organization_invitations set expires_at = now() + interval '1 day', revoked_at = now()
 where email = 'nueva@a.io';
select is(tests.peek(repeat('ab', 32)), null::text, 'invitación revocada: nada');
select is(tests.sqlstate_as('authenticated', format('select * from system.peek_invitation(%L)', repeat('ab', 32))),
  '42501', 'solo el worker consulta invitaciones por token');

-- Reset de MFA.
select tests.logout(); select tests.login('owner');
select lives_ok(format($$ select public.access_authorize_mfa_reset(%L, %L) $$, tests.fx('org_a'), tests.fx('member')),
  'el dueño autoriza el reset de MFA de un miembro');
select tests.logout();
select is((select count(*)::int from audit.audit_logs where action = 'member.mfa_reset'
            and entity_id = tests.fx('member') and actor_user_id = tests.fx('owner')),
  1, 'reset auditado con su autor');
select tests.logout(); select tests.login('admin');
select throws_ok(format($$ select public.access_authorize_mfa_reset(%L, %L) $$, tests.fx('org_a'), tests.fx('owner')),
  '42501', 'forbidden', 'nadie resetea la MFA del dueño');
select throws_ok(format($$ select public.access_authorize_mfa_reset(%L, %L) $$, tests.fx('org_a'), tests.fx('admin')),
  '42501', 'forbidden', 'nadie resetea su propia MFA por esta vía');
select tests.logout(); select tests.login('owner_b');
select throws_ok(format($$ select public.access_authorize_mfa_reset(%L, %L) $$, tests.fx('org_a'), tests.fx('member')),
  '42501', 'forbidden', 'otro tenant no puede');
select tests.logout(); select tests.login('owner', 'aal1');
select throws_ok(format($$ select public.access_authorize_mfa_reset(%L, %L) $$, tests.fx('org_a'), tests.fx('member')),
  '42501', 'mfa_required', 'exige 2FA');
select tests.logout();
select is(tests.sqlstate_as('anon', format('select public.access_authorize_mfa_reset(%L, %L)',
                                           tests.fx('org_a'), tests.fx('member'))),
  '42501', 'anon no ejecuta');

select * from finish();
rollback;
