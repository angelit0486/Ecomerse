-- =============================================================================
-- Auditoría de autorización 2026-11-17, hallazgo 1: límite de intentos del
-- segundo factor (TOTP) del staff, por usuario, por factor y por IP.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- UUID fijo por número: usuarios y factores distintos sin depender del azar.
create function pg_temp.id(p_kind text, p_n integer) returns uuid language sql immutable as $$
  select (case p_kind when 'user' then '00000000-0000-4000-8000-' else '00000000-0000-4000-9000-' end
          || lpad(p_n::text, 12, '0'))::uuid
$$;
create function pg_temp.attempts(p_user uuid, p_factor uuid, p_ip text, p_n integer) returns text
language plpgsql as $$
declare v text := '';
begin
  perform tests.as_role('system_worker');
  for i in 1..p_n loop
    v := v || case when system.take_staff_mfa_attempt(p_user, p_factor, p_ip) then 't' else 'f' end;
  end loop;
  perform tests.logout();
  return v;
end $$;
create function pg_temp.events(p_limit text) returns integer language sql security definer as $$
  select count(*)::int from audit.security_events
   where type = 'auth.mfa_rate_limited' and metadata ->> 'limit' = p_limit
$$;
create function pg_temp.bucket(p_bucket text) returns boolean language sql security definer as $$
  select exists (select 1 from system.rate_limits where bucket = p_bucket)
$$;

-- Por usuario.
select is(pg_temp.attempts(pg_temp.id('user', 1), pg_temp.id('factor', 1), repeat('a', 64), 6), 'tttttf',
          '5 intentos por usuario en 15 minutos; el 6.º se rechaza');
select is(pg_temp.attempts(pg_temp.id('user', 1), pg_temp.id('factor', 2), repeat('b', 64), 1), 'f',
          'otro factor y otra IP no reinician el límite del usuario');
select ok(not pg_temp.bucket('staff_mfa:factor:' || pg_temp.id('factor', 2)),
          'un intento rechazado por usuario no gasta el presupuesto del factor');
select is((select count(*)::int from audit.security_events
            where type = 'auth.mfa_rate_limited' and severity = 'warning'
              and user_id = pg_temp.id('user', 1) and metadata ->> 'ip_hash' = repeat('a', 16)),
          1, 'el rechazo queda como evento con el usuario y la IP recortada a 16');
select is(pg_temp.events('user'), 2, 'cada rechazo por usuario queda como evento');

-- Por factor: usuarios distintos con el mismo factor.
select is((select string_agg(pg_temp.attempts(pg_temp.id('user', 100 + g), pg_temp.id('factor', 3),
                                               repeat('c', 64), 1), '' order by g)
             from generate_series(1, 6) g),
          'tttttf', '5 intentos por factor aunque cambie el usuario');
select is(pg_temp.events('factor'), 1, 'el rechazo por factor queda como evento');

-- Por IP: usuarios y factores distintos desde la misma IP.
select is((select string_agg(pg_temp.attempts(pg_temp.id('user', 200 + g), pg_temp.id('factor', 200 + g),
                                               repeat('d', 64), 1), '' order by g)
             from generate_series(1, 31) g),
          repeat('t', 30) || 'f', '30 por IP aunque cambien el usuario y el factor');
select ok(not pg_temp.bucket('staff_mfa:user:' || pg_temp.id('user', 231))
          and not pg_temp.bucket('staff_mfa:factor:' || pg_temp.id('factor', 231)),
          'un intento rechazado por IP no gasta el presupuesto del usuario ni del factor');
select is(pg_temp.events('ip'), 1, 'el rechazo por IP queda como evento');

-- Validación.
select throws_ok($$select system.take_staff_mfa_attempt(gen_random_uuid(), gen_random_uuid(), 'no-es-hash')$$,
                 'P0001', 'validation_failed', 'la IP debe llegar como hash');
select throws_ok($$select system.take_staff_mfa_attempt(null, gen_random_uuid(), repeat('e', 64))$$,
                 'P0001', 'validation_failed', 'el usuario es obligatorio');

-- Solo el worker.
select tests.create_user('staff', 'staff@a.io');
select tests.login('staff', 'aal1');
select throws_ok($$select system.take_staff_mfa_attempt(gen_random_uuid(), gen_random_uuid(), repeat('f', 64))$$,
                 '42501', null, 'un usuario autenticado no puede llamarla');
select tests.as_role('anon');
select throws_ok($$select system.take_staff_mfa_attempt(gen_random_uuid(), gen_random_uuid(), repeat('f', 64))$$,
                 '42501', null, 'anon no puede llamarla');
select tests.logout();

select * from finish();
rollback;
