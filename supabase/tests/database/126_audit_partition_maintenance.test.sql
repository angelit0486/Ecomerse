-- =============================================================================
-- Auditoría global B1: el mantenimiento mantiene 24 meses de particiones de
-- auditoría por delante y la salud avisa si faltan o si algo cayó en «default».
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create function pg_temp.part(p_months integer) returns regclass language sql as $$
  select to_regclass(format('audit.%I', 'audit_logs_'
         || to_char(date_trunc('month', now()) + make_interval(months => p_months), 'YYYYMM')))
$$;
create function pg_temp.audit_issue() returns jsonb language sql as $$
  select i from jsonb_array_elements(system.platform_health() -> 'issues') i
   where i ->> 'code' = 'audit_partitions'
$$;

select ok(pg_temp.part(24) is not null, 'hoy hay partición para el mes +24');
select is(pg_temp.audit_issue(), null, 'sin aviso con la cobertura completa');

-- Simula que pasó el tiempo sin mantenimiento: faltan los meses +3 a +24.
do $$ begin
  for i in 3..24 loop
    execute format('drop table if exists audit.%I', 'audit_logs_'
      || to_char(date_trunc('month', now()) + make_interval(months => i), 'YYYYMM'));
  end loop;
end $$;
select is(pg_temp.audit_issue() ->> 'severity', 'warning', 'con menos de 3 meses: aviso');
select is((pg_temp.audit_issue() ->> 'value')::int, 2, 'dice cuántos meses quedan');

-- Como el worker (si fallara, la transacción aborta y el plan no cuadra).
select tests.as_role('system_worker');
select system.enqueue_maintenance();
select tests.logout();
select pass('el worker corre el mantenimiento');
select ok(pg_temp.part(24) is not null and pg_temp.part(12) is not null,
          'el mantenimiento recrea las particiones que faltaban');
select is(pg_temp.audit_issue(), null, 'y el aviso desaparece');

select * from finish();
rollback;
