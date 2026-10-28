-- =============================================================================
-- Misión vendible F1.6: salud de la plataforma. Quién la ve, que sin problemas
-- dice «ok», que detecta cola detenida, trabajos atorados o muertos y errores de
-- pago, y que solo devuelve conteos (nunca payloads ni datos de compradores).
-- =============================================================================
begin;
select plan(11);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text;
  return v_msg;
end $$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('support', 'support@p.io');
select tests.create_user('padmin', 'admin@p.io');
select tests.make_platform_staff('support', 'platform_support');
select tests.make_platform_staff('padmin', 'platform_admin');

-- Base limpia para esta prueba: sin trabajos ni eventos previos.
delete from system.jobs;

select is(system.platform_health() ->> 'status', 'ok', 'sin problemas: ok');

select tests.login('owner');
select is(pg_temp.err('select public.platform_health()'), 'forbidden', 'una tienda no ve la salud de la plataforma');
select tests.logout();
select tests.login('support');
select is(public.platform_health() ->> 'status', 'ok', 'soporte sí la ve');
select tests.logout();

select ok(not has_function_privilege('authenticated', 'system.platform_health()', 'execute')
          and not has_function_privilege('authenticated', 'system.platform_alert_recipients()', 'execute'),
          'la versión del worker y los destinatarios no los llama nadie más');

-- Cola detenida: un trabajo listo hace 20 minutos.
insert into system.jobs (type, payload, status, run_after)
values ('orders.expire', '{"secreto":"no-debe-salir"}', 'queued', now() - interval '20 minutes');
select ok(system.platform_health() -> 'issues' @> '[{"code":"queue_stalled","severity":"critical"}]',
          'cola detenida: aviso crítico');
select is(system.platform_health() ->> 'status', 'critical', 'el estado general pasa a crítico');
select ok(system.platform_health()::text not like '%no-debe-salir%', 'nunca expone el payload');

-- Trabajo atorado y trabajo muerto.
insert into system.jobs (type, status, locked_at, locked_by, attempts)
values ('media.process', 'running', now() - interval '30 minutes', 'w1', 1);
insert into system.jobs (type, status, finished_at, attempts, last_error)
values ('order.paid', 'dead', now() - interval '1 hour', 8, 'Resend 401');
select ok(system.platform_health() -> 'issues' @> '[{"code":"jobs_stuck"},{"code":"jobs_dead"}]',
          'detecta trabajos atorados y muertos');
select is((system.platform_health() -> 'queue' -> 'dead_by_type' ->> 'order.paid')::int, 1,
          'y cuenta los muertos por tipo');

-- Destinatarios de las alertas: solo dueño y administración activos.
select is(array(select email from system.platform_alert_recipients()), array['admin@p.io'],
          'avisa a la administración, no a soporte ni a las tiendas');

-- El mantenimiento encola la revisión de salud.
select system.enqueue_maintenance();
select ok(exists (select 1 from system.jobs j where j.type = 'platform.health_check'),
          'el mantenimiento encola la revisión cada 15 minutos');

select * from finish();
rollback;
