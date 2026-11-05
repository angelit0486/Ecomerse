-- =============================================================================
-- Auditoría global 2026-11-05, hallazgo B1 (docs/plan/AUDITORIA-GLOBAL-2026-11-05.md):
-- las particiones de auditoría se crearon una sola vez (24 meses, hasta 2028-10)
-- y nadie las mantenía. Desde aquí:
--   1. system.enqueue_maintenance crea las que falten cuando no existe la del mes
--      +24 (DDL una vez al mes; nunca borra nada);
--   2. system.platform_health avisa si quedan menos de 3 meses (aviso) o si algún
--      registro cayó en la partición «default» (urgente: impediría crear las siguientes).
-- No toca datos, pedidos, pagos, RLS ni permisos. Ambas funciones conservan su
-- firma, dueño y grants; solo se agrega lo descrito.
--
-- Reversa: volver a aplicar las definiciones de 20261029000700_cart_recovery.sql
-- (enqueue_maintenance) y 20261029000100_external_reversals.sql (platform_health).
-- Las particiones creadas pueden quedarse (están vacías hasta su mes).
-- =============================================================================

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
  -- Misión vendible F1.6: revisión de salud cada 15 minutos (el job solo avisa si hay problemas).
  perform app.enqueue_job('platform.health_check', '{}'::jsonb, null,
                          'platform.health_check:' || to_char(date_trunc('hour', now() at time zone 'utc')
                            + floor(extract(minute from now() at time zone 'utc') / 15) * interval '15 minutes',
                            'YYYY-MM-DD"T"HH24:MI'), now(), 3);
end
$$;

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
    'audit', jsonb_build_object('months_ahead', v_audit_ahead, 'default_has_rows', v_audit_default));
end
$$;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261105000100'::text
$$;
