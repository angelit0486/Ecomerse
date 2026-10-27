-- =============================================================================
-- Trabajos fallidos en la consola (paso 17): quién los ve, quién los reintenta,
-- qué vuelve a la cola y que nunca se expone el payload.
-- =============================================================================
begin;
select plan(11);

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
select tests.create_user('support', 'support@p.io');
select tests.create_user('padmin', 'admin@p.io');
select tests.create_tenant('a', 'owner');
select tests.make_platform_staff('support', 'platform_support');
select tests.make_platform_staff('padmin', 'platform_admin');

insert into system.jobs (id, store_id, type, payload, status, attempts, max_attempts, last_error, finished_at)
values ('00000000-0000-7000-8000-00000000d001', tests.fx('store_a'), 'email.send',
        '{"to":"secreto@cliente.mx"}', 'dead', 8, 8, repeat('x', 500), now()),
       ('00000000-0000-7000-8000-00000000d002', null, 'orders.expire', '{}', 'succeeded', 1, 8, null, now());

create function tests.job_state(p_id uuid) returns text language sql security definer set search_path = '' as $$
  select j.status || ':' || j.attempts || ':' || (j.finished_at is null)::text from system.jobs j where j.id = p_id $$;
create function tests.retried_audits() returns bigint language sql security definer set search_path = '' as $$
  select count(*) from audit.audit_logs l where l.action = 'job.retried' $$;
grant execute on all functions in schema tests to authenticated;

-- 1. Quién ve la lista.
select tests.login('owner');
select is(pg_temp.err('select public.platform_list_dead_jobs()'), 'forbidden',
          'la dueña de una tienda no ve la cola de la plataforma');
select tests.logout();
select tests.login('padmin', 'aal1');
select is(pg_temp.err('select public.platform_list_dead_jobs()'), 'mfa_required',
          'sin verificación en dos pasos, nada');
select tests.logout();

select tests.login('support');
select is(jsonb_array_length(public.platform_list_dead_jobs()), 1, 'soporte ve solo los jobs muertos');
select is(public.platform_list_dead_jobs() -> 0 ->> 'type', 'email.send', 'con su tipo');
select ok(not (public.platform_list_dead_jobs() -> 0 ? 'payload'), 'nunca el payload');
select is(length(public.platform_list_dead_jobs() -> 0 ->> 'last_error'), 300, 'el error va recortado');
select is(pg_temp.err($$select public.platform_retry_dead_job('00000000-0000-7000-8000-00000000d001')$$),
          'forbidden', 'soporte no reintenta');
select tests.logout();

-- 2. Reintentar.
select tests.login('padmin');
select is(pg_temp.err($$select public.platform_retry_dead_job('00000000-0000-7000-8000-00000000d002')$$),
          'not_found/dead_job', 'solo se reintenta un job muerto');
select is(pg_temp.err($$select public.platform_retry_dead_job('00000000-0000-7000-8000-00000000d001')$$),
          'ok', 'la administradora lo reintenta');
select tests.logout();

select is(tests.job_state('00000000-0000-7000-8000-00000000d001'), 'queued:0:true',
          'vuelve a la cola con intentos en cero');
select is(tests.retried_audits(), 1::bigint, 'y queda en la auditoría');

select * from finish();
rollback;
