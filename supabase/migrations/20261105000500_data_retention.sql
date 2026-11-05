-- =============================================================================
-- ADR-060 (aprobado el 2026-11-05): retención y limpieza de datos.
--   * Trabajos de la cola: terminados, 30 días; fallidos («dead»), 90 días.
--   * Importaciones: las filas crudas se borran 30 días después de terminar (el
--     trabajo y sus totales se quedan; rows_purged_at lo dice en el panel). Una
--     vista previa sin confirmar en 30 días se cancela.
--   * Correos entregados (notification_deliveries): 12 meses.
--   * Carritos sin convertir, sin actividad en 90 días y sin ningún pedido.
--   * Nunca se borran pedidos, pagos, eventos de pago, movimientos de inventario,
--     auditoría ni eventos de seguridad (regla 9; ajuste del ADR-060).
-- Corre una vez al día como trabajo `data.retention`, por lotes. La consola →
-- Salud avisa (`retention_stale`) si no corrió en 8 días.
-- Reversa: quitar el trabajo del mantenimiento (volver a la definición de
--   20261105000300), `drop function system.purge_retention(integer)`, volver a
--   poner `app.forbid_mutation()` para DELETE en notification_deliveries y borrar
--   la tabla, la columna y los índices nuevos. Lo ya borrado no vuelve: por eso el ADR.
-- =============================================================================

-- 1. Última corrida de cada tarea de mantenimiento (para la salud). Sin store_id:
--    es de la plataforma; ningún rol de aplicación la ve.
create table system.maintenance_runs (
  task        text primary key check (task ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$' and char_length(task) <= 60),
  last_run_at timestamptz not null,
  last_result jsonb not null default '{}'::jsonb check (jsonb_typeof(last_result) = 'object')
);
alter table system.maintenance_runs enable row level security;
alter table system.maintenance_runs force row level security;
revoke all on table system.maintenance_runs
  from public, anon, authenticated, service_role, storefront_gateway, system_worker;
-- La instalación cuenta como la primera corrida: 8 días de margen antes del aviso.
insert into system.maintenance_runs (task, last_run_at) values ('data.retention', now());

-- 2. Correos entregados: siguen sin UPDATE; DELETE solo dentro de la purga de
--    retención (marca local app.retention_purge) y solo con más de 12 meses.
--    Mismo patrón que inventory_movements (app.inventory_purge, 20261011000400).
drop trigger notification_deliveries_append_only on public.notification_deliveries;
create trigger notification_deliveries_no_update before update on public.notification_deliveries
  for each row execute function app.forbid_mutation();

create function app.notification_deliveries_delete_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.retention_purge', true), '') <> 'on'
     or old.created_at >= now() - interval '12 months' then
    raise exception using errcode = '42501', message = 'append_only',
      detail = 'public.notification_deliveries solo se borra por retención, con más de 12 meses';
  end if;
  return old;
end
$$;
revoke all on function app.notification_deliveries_delete_guard() from public;
create trigger notification_deliveries_no_delete before delete on public.notification_deliveries
  for each row execute function app.notification_deliveries_delete_guard();

-- 3. Índices para que la purga diaria no recorra tablas enteras.
create index notification_deliveries_created_idx on public.notification_deliveries (created_at);
create index carts_retention_idx on public.carts (last_activity_at) where status <> 'converted';

-- 4. Importaciones: cuándo se borraron sus filas (el panel lo explica).
alter table public.import_jobs add column rows_purged_at timestamptz;
create index import_jobs_retention_idx on public.import_jobs (created_at) where rows_purged_at is null;

-- 5. La purga. Por lotes (p_batch filas por tabla); `more` dice si quedó trabajo.
create function system.purge_retention(p_batch integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch   integer := least(greatest(coalesce(p_batch, 5000), 1), 50000);
  v_job     record;
  v_n       integer;
  v_jobs    integer;
  v_imports integer := 0;
  v_rows    integer := 0;
  v_notif   integer;
  v_carts   integer;
  v_result  jsonb;
begin
  -- Trabajos de la cola (función existente, con los plazos del ADR-060).
  v_jobs := system.purge_finished_jobs(interval '30 days', interval '90 days');

  -- Importaciones terminadas (o vistas previas abandonadas) hace más de 30 días.
  -- No toca las que están validando o confirmando.
  for v_job in
    select j.store_id, j.id from public.import_jobs j
     where j.rows_purged_at is null
       and j.status not in ('validating', 'committing')
       and coalesce(j.committed_at, j.created_at) < now() - interval '30 days'
     order by j.created_at
     limit 200
  loop
    delete from public.import_job_rows r where r.store_id = v_job.store_id and r.import_job_id = v_job.id;
    get diagnostics v_n = row_count;
    v_rows := v_rows + v_n;
    update public.import_jobs j
       set rows_purged_at = now(),
           error  = case when j.status in ('uploaded', 'validated')
                         then 'La vista previa venció a los 30 días: vuelve a subir el archivo.' else j.error end,
           status = case when j.status in ('uploaded', 'validated') then 'cancelled' else j.status end
     where j.store_id = v_job.store_id and j.id = v_job.id;
    v_imports := v_imports + 1;
  end loop;

  -- Correos entregados hace más de 12 meses (el guardia exige la marca y la edad).
  perform set_config('app.retention_purge', 'on', true);
  delete from public.notification_deliveries d
   where d.id in (select d2.id from public.notification_deliveries d2
                   where d2.created_at < now() - interval '12 months'
                   order by d2.created_at limit v_batch);
  get diagnostics v_notif = row_count;
  perform set_config('app.retention_purge', 'off', true);

  -- Carritos sin convertir, sin actividad en 90 días y que ningún pedido usa
  -- (sus partidas se van en cascada; el pedido guarda su propia copia).
  delete from public.carts c
   where c.id in (select c2.id from public.carts c2
                   where c2.status <> 'converted'
                     and c2.last_activity_at < now() - interval '90 days'
                     and not exists (select 1 from public.orders o
                                      where o.store_id = c2.store_id and o.cart_id = c2.id)
                   order by c2.last_activity_at limit v_batch);
  get diagnostics v_carts = row_count;

  v_result := jsonb_build_object('jobs', v_jobs, 'import_jobs', v_imports, 'import_rows', v_rows,
                                 'notifications', v_notif, 'carts', v_carts,
                                 'more', v_imports = 200 or v_notif = v_batch or v_carts = v_batch);
  insert into system.maintenance_runs as m (task, last_run_at, last_result)
  values ('data.retention', now(), v_result)
  on conflict (task) do update set last_run_at = excluded.last_run_at, last_result = excluded.last_result;
  if v_jobs + v_rows + v_notif + v_carts > 0 then
    perform audit.record('data.retention', 'platform', null, null, null, null, v_result, 'ADR-060');
  end if;
  return v_result;
end
$$;
revoke all on function system.purge_retention(integer) from public;
grant execute on function system.purge_retention(integer) to system_worker;

-- 6. El mantenimiento encola la purga una vez al día.
create or replace function system.enqueue_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Auditoría global 2026-11-05 (B1): la auditoría siempre con 24 meses de
  -- particiones por delante. Solo hace DDL cuando falta la del mes +24 (una vez al mes).
  if to_regclass(format('audit.%I', 'audit_logs_'
       || to_char(date_trunc('month', now()) + interval '24 months', 'YYYYMM'))) is null then
    perform audit.ensure_partitions(24);
  end if;
  perform app.enqueue_job('media.purge_orphans', '{}'::jsonb, null,
                          'media.purge_orphans:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  perform app.enqueue_job('orders.expire', '{}'::jsonb, null,
                          'orders.expire:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  perform app.enqueue_job('rate_limits.purge', '{}'::jsonb, null,
                          'rate_limits.purge:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  perform app.enqueue_job('payments.reconcile', '{}'::jsonb, null,
                          'payments.reconcile:' || to_char(date_trunc('hour', now() at time zone 'utc')
                            + floor(extract(minute from now() at time zone 'utc') / 10) * interval '10 minutes',
                            'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  perform app.enqueue_job('orders.complete', '{}'::jsonb, null,
                          'orders.complete:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  -- Tanda 7: publicaciones programadas que ya vencieron.
  perform app.enqueue_job('catalog.publish_scheduled', '{}'::jsonb, null,
                          'catalog.publish_scheduled:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'),
                          now(), 3);
  -- ADR-030: ofertas con fechas que empiezan o terminan.
  perform app.enqueue_job('catalog.apply_sales', '{}'::jsonb, null,
                          'catalog.apply_sales:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'),
                          now(), 3);
  -- Paso 8: copias en varios tamaños de las fotos que aún no las tienen (por hora).
  if exists (select 1 from public.media m
              where m.status = 'ready' and not m.variants_done and m.deleted_at is null) then
    perform app.enqueue_job('media.backfill_variants', '{}'::jsonb, null,
                            'media.backfill_variants:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24'),
                            now(), 3);
  end if;
  perform system.fail_stuck_imports();
  -- F10: periodos vencidos → pago pendiente → pausa (§19.4). Solo toca filas vencidas.
  perform system.subscriptions_advance();
  -- ADR-041: llaves de Mercado Pago de los comercios que vencen en menos de 30 días.
  perform system.mercadopago_enqueue_refresh();
  -- ADR-046: datos personales de tiendas cerradas hace más de 30 días.
  perform system.anonymize_closed_stores(5);
  -- ADR-048: recordatorios de carritos (cada 15 minutos; solo tiendas que lo activaron).
  if exists (select 1 from public.store_notification_settings n where n.cart_recovery) then
    perform app.enqueue_job('carts.recover', '{}'::jsonb, null,
                            'carts.recover:' || to_char(date_trunc('hour', now() at time zone 'utc')
                              + floor(extract(minute from now() at time zone 'utc') / 15) * interval '15 minutes',
                              'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  end if;
  -- Paso 19 (auditoría global): resumen semanal a la dueña, una vez por semana ISO,
  -- solo si alguna tienda lo encendió (o si la plataforma lo enciende por defecto).
  if system.weekly_summary_window(now()) is not null
     and (exists (select 1 from public.feature_flag_overrides o
                   where o.flag_key = 'weekly_summary' and o.enabled)
          or exists (select 1 from public.feature_flags f
                      where f.key = 'weekly_summary' and f.default_enabled and not f.kill_switch)) then
    perform app.enqueue_job('stores.weekly_summary',
                            jsonb_build_object('week', system.weekly_summary_window(now())), null,
                            'stores.weekly_summary:' || system.weekly_summary_window(now()), now(), 3);
  end if;
  -- ADR-060: retención de datos, una vez al día (system.purge_retention).
  perform app.enqueue_job('data.retention', '{}'::jsonb, null,
                          'data.retention:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  -- Misión vendible F1.6: revisión de salud cada 15 minutos (el job solo avisa si hay problemas).
  perform app.enqueue_job('platform.health_check', '{}'::jsonb, null,
                          'platform.health_check:' || to_char(date_trunc('hour', now() at time zone 'utc')
                            + floor(extract(minute from now() at time zone 'utc') / 15) * interval '15 minutes',
                            'YYYY-MM-DD"T"HH24:MI'), now(), 3);
end
$$;

-- 7. Salud: aviso si la purga no corrió en 8 días y tamaño de lo que nunca se borra.
create or replace function system.platform_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_oldest_ready   numeric;
  v_stuck          integer;
  v_dead           integer;
  v_dead_types     jsonb;
  v_pay_errors     integer;
  v_pay_events     integer;
  v_rejected       integer;
  v_stale_payments integer;
  v_orders         integer;
  v_reversals      integer;
  v_audit_ahead    integer;
  v_audit_default  boolean;
  v_retention_at   timestamptz;
  v_issues         jsonb := '[]'::jsonb;
begin
  select extract(epoch from now() - min(j.run_after)) into v_oldest_ready
    from system.jobs j where j.status = 'queued' and j.run_after <= now();
  select count(*) into v_stuck from system.jobs j
   where j.status = 'running' and j.locked_at < now() - interval '15 minutes';
  select count(*) into v_dead from system.jobs j
   where j.status = 'dead' and j.finished_at > now() - interval '24 hours';
  select coalesce(jsonb_object_agg(t.type, t.n), '{}'::jsonb) into v_dead_types
    from (select j.type, count(*) as n from system.jobs j
           where j.status = 'dead' and j.finished_at > now() - interval '24 hours'
           group by j.type order by count(*) desc limit 5) t;
  select count(*) filter (where e.processing_error is not null), count(*)
    into v_pay_errors, v_pay_events
    from public.payment_events e where e.received_at > now() - interval '24 hours';
  select count(*) into v_rejected from audit.security_events s
   where s.type like 'payment.webhook\_%' and s.occurred_at > now() - interval '24 hours';
  select count(*) into v_stale_payments from public.payments p
   where p.provider in ('stripe', 'mercadopago') and p.status in ('created', 'pending', 'authorized')
     and p.provider_checkout_id is not null and p.created_at < now() - interval '2 hours'
     and p.created_at > now() - interval '7 days';
  select count(*) into v_orders from public.orders o where o.created_at > now() - interval '24 hours';
  select count(*) into v_reversals from public.order_events e
   where e.type = 'payment.external_reversal' and e.created_at > now() - interval '24 hours';

  -- Particiones de auditoría: meses cubiertos por delante y filas caídas en «default».
  select coalesce(max((extract(year from m) - extract(year from now())) * 12
                      + extract(month from m) - extract(month from now()))::integer, -1)
    into v_audit_ahead
    from (select to_date(substring(c.relname from '^audit_logs_([0-9]{6})$'), 'YYYYMM') as m
            from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'audit' and c.relname ~ '^audit_logs_[0-9]{6}$') p;
  select exists (select 1 from audit.audit_logs_default) into v_audit_default;
  if v_audit_default then
    v_issues := v_issues || jsonb_build_object('code', 'audit_partitions', 'severity', 'critical',
                                               'value', greatest(v_audit_ahead, 0));
  elsif v_audit_ahead < 3 then
    v_issues := v_issues || jsonb_build_object('code', 'audit_partitions', 'severity', 'warning',
                                               'value', greatest(v_audit_ahead, 0));
  end if;
  -- ADR-060: la limpieza diaria de datos no corrió en 8 días.
  select r.last_run_at into v_retention_at from system.maintenance_runs r where r.task = 'data.retention';
  if v_retention_at is null or v_retention_at < now() - interval '8 days' then
    v_issues := v_issues || jsonb_build_object('code', 'retention_stale', 'severity', 'warning',
                                               'value', coalesce(floor(extract(epoch from now() - v_retention_at) / 86400), 0));
  end if;
  if coalesce(v_oldest_ready, 0) > 600 then
    v_issues := v_issues || jsonb_build_object('code', 'queue_stalled', 'severity', 'critical',
                                               'value', round(v_oldest_ready / 60));
  end if;
  if v_stuck > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'jobs_stuck', 'severity', 'critical', 'value', v_stuck);
  end if;
  if v_pay_errors > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'payment_events', 'severity', 'critical',
                                               'value', v_pay_errors);
  end if;
  if v_dead > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'jobs_dead', 'severity', 'warning', 'value', v_dead);
  end if;
  if v_rejected >= 5 then
    v_issues := v_issues || jsonb_build_object('code', 'webhook_rejected', 'severity', 'warning',
                                               'value', v_rejected);
  end if;
  if v_reversals > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'payment_reversals', 'severity', 'warning',
                                               'value', v_reversals);
  end if;
  if v_stale_payments > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'payments_stale', 'severity', 'warning',
                                               'value', v_stale_payments);
  end if;

  return jsonb_build_object(
    'checked_at', now(),
    'status', case when v_issues @> '[{"severity":"critical"}]' then 'critical'
                   when jsonb_array_length(v_issues) > 0 then 'warning' else 'ok' end,
    'issues', v_issues,
    'queue', jsonb_build_object('oldest_ready_seconds', coalesce(round(v_oldest_ready), 0),
                                'stuck', v_stuck, 'dead_24h', v_dead, 'dead_by_type', v_dead_types),
    'payments', jsonb_build_object('events_24h', v_pay_events, 'events_failed_24h', v_pay_errors,
                                   'webhooks_rejected_24h', v_rejected, 'open_over_2h', v_stale_payments,
                                   'reversals_24h', v_reversals),
    'emails', jsonb_build_object(
      'sent_24h', (select count(*) from public.notification_deliveries d
                    where d.status = 'sent' and d.created_at > now() - interval '24 hours'),
      'suppressed_24h', (select count(*) from public.notification_deliveries d
                          where d.status = 'suppressed' and d.created_at > now() - interval '24 hours')),
    'orders_24h', v_orders,
    'audit', jsonb_build_object('months_ahead', v_audit_ahead, 'default_has_rows', v_audit_default),
    -- Lo que no se borra nunca (regla 9) se vigila por tamaño estimado (pg_class, sin recorrer la tabla).
    'retention', jsonb_build_object(
      'last_run_at', v_retention_at,
      'payment_events_rows', (select greatest(c.reltuples, 0)::bigint from pg_catalog.pg_class c
                               where c.oid = 'public.payment_events'::regclass),
      'security_events_rows', (select greatest(c.reltuples, 0)::bigint from pg_catalog.pg_class c
                                where c.oid = 'audit.security_events'::regclass)));
end
$$;
create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261105000500'::text
$$;
