-- =============================================================================
-- Misión «vendible» F1.6: salud de la plataforma y alertas. Lo que antes solo se
-- veía con SQL (cola detenida, trabajos muertos, eventos de pago con error,
-- webhooks rechazados, pagos en línea sin confirmar) se resume en una sola
-- función. La consola la muestra a todo el staff de la plataforma; el worker la
-- revisa cada 15 minutos y avisa por correo a dueño y administración, una vez por
-- problema y por hora.
--
-- Umbrales (documentados en docs/runbooks/salud-y-alertas.md):
--   queue_stalled      un trabajo listo lleva más de 10 min sin tomarse  → crítico
--   jobs_stuck         un trabajo "running" lleva más de 15 min            → crítico
--   jobs_dead          trabajos muertos en las últimas 24 h               → aviso
--   payment_events     eventos de pago con error en 24 h                  → crítico
--   webhook_rejected   webhooks de pago rechazados en 24 h (≥ 5)          → aviso
--   payments_stale     pagos en línea abiertos hace más de 2 h            → aviso
-- Nunca expone payloads, correos ni montos de un comprador: solo conteos.
-- =============================================================================

create function system.platform_health()
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
                                   'webhooks_rejected_24h', v_rejected, 'open_over_2h', v_stale_payments),
    'emails', jsonb_build_object(
      'sent_24h', (select count(*) from public.notification_deliveries d
                    where d.status = 'sent' and d.created_at > now() - interval '24 hours'),
      'suppressed_24h', (select count(*) from public.notification_deliveries d
                          where d.status = 'suppressed' and d.created_at > now() - interval '24 hours')),
    'orders_24h', v_orders);
end
$$;
revoke all on function system.platform_health() from public;
grant execute on function system.platform_health() to system_worker;

-- Consola: todo el staff de la plataforma (solo lectura de conteos).
create function public.platform_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin', 'platform_support']);
  return system.platform_health();
end
$$;
revoke all on function public.platform_health() from public;
grant execute on function public.platform_health() to authenticated;

-- A quién avisar: dueño y administración activos de la plataforma.
create function system.platform_alert_recipients()
returns table (email text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text from public.platform_staff ps
    join auth.users u on u.id = ps.user_id
   where ps.status = 'active' and ps.role in ('platform_owner', 'platform_admin') and u.email is not null
   order by u.email
$$;
revoke all on function system.platform_alert_recipients() from public;
grant execute on function system.platform_alert_recipients() to system_worker;

create or replace function system.enqueue_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
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
  -- Misión vendible F1.6: revisión de salud cada 15 minutos (el job solo avisa si hay problemas).
  perform app.enqueue_job('platform.health_check', '{}'::jsonb, null,
                          'platform.health_check:' || to_char(date_trunc('hour', now() at time zone 'utc')
                            + floor(extract(minute from now() at time zone 'utc') / 15) * interval '15 minutes',
                            'YYYY-MM-DD"T"HH24:MI'), now(), 3);
end
$$;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261028000400'::text
$$;
