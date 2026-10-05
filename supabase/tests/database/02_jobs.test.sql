-- =============================================================================
-- Cola transaccional system.jobs (Fase 1). GATE0 §28, §34.1.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- Encolado transaccional ------------------------------------------------------
savepoint before_enqueue;
select app.enqueue_job('test.rollback', '{}'::jsonb);
rollback to savepoint before_enqueue;
select is((select count(*)::int from system.jobs where type = 'test.rollback'), 0,
  'un job encolado en una transacción revertida no existe');

-- Idempotencia por dedupe_key -------------------------------------------------
select is(
  app.enqueue_job('test.dedupe', '{"n":1}', null, 'evt-1:notifications'),
  app.enqueue_job('test.dedupe', '{"n":2}', null, 'evt-1:notifications'),
  'enqueue_job con el mismo dedupe_key devuelve el mismo job'
);
select is((select count(*)::int from system.jobs where dedupe_key = 'evt-1:notifications'), 1,
  'dedupe_key: un solo job');

-- Validaciones del esquema ----------------------------------------------------
select throws_ok($$ select app.enqueue_job('SinPunto', '{}') $$, '23514', null,
  'type debe tener formato modulo.accion');
select throws_ok($$ select app.enqueue_job('test.payload', '[]'::jsonb) $$, '23514', null,
  'payload debe ser un objeto JSON');

-- Reclamo, éxito y aislamiento entre workers -----------------------------------
delete from system.jobs;
select app.enqueue_job('test.a', '{}', null, null, now() - interval '2 seconds');
select app.enqueue_job('test.b', '{}', null, null, now() - interval '1 second');
select app.enqueue_job('test.future', '{}', null, null, now() + interval '1 hour');

create temp table claimed as select * from system.claim_jobs('worker-1', 10);
select is((select count(*)::int from claimed), 2, 'claim_jobs toma solo los jobs listos (no los futuros)');
select is((select job_type from claimed order by job_type limit 1), 'test.a', 'claim_jobs respeta el orden por run_after');
select ok((select bool_and(job_attempts = 1) from claimed), 'claim_jobs incrementa attempts');
select is((select count(*)::int from system.claim_jobs('worker-2', 10)), 0,
  'otro worker no puede reclamar jobs ya tomados');

select ok(not system.complete_job((select job_id from claimed where job_type = 'test.a'), 'worker-2'),
  'complete_job rechaza a un worker distinto del que tomó el job');
select ok(system.complete_job((select job_id from claimed where job_type = 'test.a'), 'worker-1'),
  'complete_job marca el éxito');
select is((select status from system.jobs where type = 'test.a'), 'succeeded', 'estado succeeded');
select isnt((select finished_at from system.jobs where type = 'test.a'), null, 'finished_at registrado');

-- Fallo con reintento y backoff exponencial ------------------------------------
select is(system.fail_job((select job_id from claimed where job_type = 'test.b'), 'worker-1', 'boom'),
  'queued', 'fail_job con intentos restantes reencola');
select ok(
  (select run_after between now() + interval '59 seconds' and now() + interval '61 seconds'
     from system.jobs where type = 'test.b'),
  'backoff del primer reintento = 1 minuto'
);
select is((select last_error from system.jobs where type = 'test.b'), 'boom', 'last_error registrado');

-- Fallo permanente → dead -------------------------------------------------------
update system.jobs set run_after = now() - interval '1 second' where type = 'test.b';
select is((select count(*)::int from system.claim_jobs('worker-1', 10)), 1, 'el job reintentable vuelve a reclamarse');
select is(system.fail_job((select id from system.jobs where type = 'test.b'), 'worker-1', 'fatal', true),
  'dead', 'fail_job permanente → dead');

-- Intentos agotados → dead -------------------------------------------------------
select app.enqueue_job('test.exhaust', '{}', null, null, now() - interval '1 second', 1);
select is((select count(*)::int from system.claim_jobs('worker-1', 10)), 1, 'claim del job con max_attempts=1');
select is(system.fail_job((select id from system.jobs where type = 'test.exhaust'), 'worker-1', 'x'),
  'dead', 'intentos agotados → dead');

-- Recuperación de jobs bloqueados (worker caído) ----------------------------------
select app.enqueue_job('test.stuck', '{}', null, null, now() - interval '1 second');
select is((select count(*)::int from system.claim_jobs('worker-crashed', 10)), 1, 'claim por un worker que luego cae');
update system.jobs set locked_at = now() - interval '10 minutes' where type = 'test.stuck';
select is((select job_type from system.claim_jobs('worker-1', 10, 300)), 'test.stuck',
  'un job con bloqueo vencido se recupera y se vuelve a reclamar');

-- Permisos del rol system_worker -------------------------------------------------
-- El cambio de rol ocurre solo durante la sentencia probada (pgTAP vive en el
-- esquema "extensions", al que system_worker no tiene acceso a propósito).
create function pg_temp.exec_as(p_role text, p_sql text) returns void
language plpgsql as $f$
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
  exception when others then
    reset role;
    raise;
  end;
  reset role;
end
$f$;

select throws_ok($$ select pg_temp.exec_as('system_worker', 'select count(*) from system.jobs') $$,
  '42501', null, 'system_worker NO puede leer la tabla directamente');
select throws_ok($$ select pg_temp.exec_as('system_worker', 'select app.enqueue_job(''test.x'', ''{}'')') $$,
  '42501', null, 'system_worker NO puede usar app.enqueue_job');

select * from finish();
rollback;
