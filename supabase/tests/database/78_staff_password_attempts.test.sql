-- =============================================================================
-- ADR-031: límite de intentos de contraseña del staff (por email y por IP).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

create function pg_temp.attempts(p_email text, p_ip text, p_n integer) returns text language plpgsql as $$
declare v text := '';
begin
  perform tests.as_role('system_worker');
  for i in 1..p_n loop
    v := v || case when system.take_staff_login_attempt(p_email, p_ip) then 't' else 'f' end;
  end loop;
  perform tests.logout();
  return v;
end $$;
create function pg_temp.events() returns integer language sql security definer as $$
  select count(*)::int from audit.security_events where type = 'auth.password_rate_limited'
$$;

select is(pg_temp.attempts('Dueña@Tienda.mx', repeat('a', 64), 11), 'ttttttttttf',
          '10 intentos por email en 15 minutos; el 11 se rechaza');
select is(pg_temp.attempts('dueña@tienda.mx ', repeat('b', 64), 1), 'f',
          'el email se normaliza: otra IP no reinicia el límite de la cuenta');
select is(pg_temp.events(), 2, 'cada rechazo queda como evento de seguridad');
select is((select string_agg(pg_temp.attempts('u' || g || '@x.mx', repeat('c', 64), 1), '' order by g)
             from generate_series(1, 31) g),
          repeat('t', 30) || 'f', 'y 30 por IP aunque cambie el email');
select throws_ok($$select system.take_staff_login_attempt('a@b.mx', 'no-es-hash')$$,
                 'P0001', 'validation_failed', 'la IP debe llegar como hash');

select tests.create_user('staff', 'staff@a.io');
select tests.login('staff');
select throws_ok($$select system.take_staff_login_attempt('a@b.mx', repeat('d', 64))$$,
                 '42501', null, 'un usuario autenticado no puede llamarla');
select tests.logout();

select * from finish();
rollback;
