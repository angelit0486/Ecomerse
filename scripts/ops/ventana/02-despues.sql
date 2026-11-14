-- =============================================================================
-- Ventana única (Orden 10, mensaje 5, A2) — PASO 9: comprobación DESPUÉS de
-- desplegar el código nuevo. Solo lectura. Se repite a los 5 y a los 15 minutos.
-- REGLA: si alguna fila trae ok = false a los 15 minutos, se sigue §5.3
-- (contingencia); no se abre la tienda a importaciones.
-- =============================================================================
with tipos_nuevos(tipo) as (
  select unnest(array[
    'access.invitation_email', 'access.support_access_notice', 'carts.recover',
    'catalog.apply_sales', 'catalog.publish_run', 'catalog.publish_scheduled',
    'compliance.recheck', 'data.retention', 'domains.attach_platform', 'domains.verify',
    'import.commit', 'media.backfill_variants', 'media.copy', 'media.fetch_remote',
    'media.process', 'media.purge_orphans', 'order.cancelled', 'order.created', 'order.delivered',
    'order.link_renewed', 'order.paid', 'order.shipped', 'orders.complete', 'orders.expire',
    'payment.after_cancel', 'payment.expire_checkout', 'payment.external_reversal',
    'payment.failed', 'payment.late_without_stock', 'payment.pending', 'payments.reconcile',
    'platform.health_check', 'privacy.purge_anonymized', 'rate_limits.purge', 'refund.execute',
    'refund.succeeded', 'return.approved', 'return.rejected', 'return.requested',
    'stores.weekly_summary', 'tenant.owner_notice'
  ]::text[])
)
select 'versión del esquema' as comprobacion, public.app_schema_version() as valor,
       '20261113000400' as esperado, public.app_schema_version() = '20261113000400' as ok
union all
select 'tablas nuevas con RLS forzado',
       (select count(*)::text from pg_class
         where oid in ('public.import_photo_checks'::regclass, 'public.publish_runs'::regclass,
                       'public.publish_run_items'::regclass, 'public.import_batches'::regclass)
           and relrowsecurity and relforcerowsecurity), '4',
       (select count(*) from pg_class
         where oid in ('public.import_photo_checks'::regclass, 'public.publish_runs'::regclass,
                       'public.publish_run_items'::regclass, 'public.import_batches'::regclass)
           and relrowsecurity and relforcerowsecurity) = 4
union all
select 'trabajos descartados por tipo desconocido (últimos 15 min)',
       (select count(*)::text from system.jobs
         where last_error = 'unknown_job_type' and finished_at > now() - interval '15 minutes'), '0',
       not exists (select 1 from system.jobs
                    where last_error = 'unknown_job_type' and finished_at > now() - interval '15 minutes')
union all
select 'trabajos en cola que el código nuevo no conoce',
       coalesce((select string_agg(distinct j.type, ',') from system.jobs j
                  where j.status in ('queued', 'running') and j.type not in (select tipo from tipos_nuevos)), ''),
       '(vacío)',
       not exists (select 1 from system.jobs j
                    where j.status in ('queued', 'running') and j.type not in (select tipo from tipos_nuevos))
union all
select 'trabajos listos sin tomar hace más de 10 min',
       (select count(*)::text from system.jobs where status = 'queued' and run_after < now() - interval '10 minutes'),
       '0',
       not exists (select 1 from system.jobs where status = 'queued' and run_after < now() - interval '10 minutes')
union all
select 'publicaciones abiertas sin trabajo vivo',
       (select count(*)::text from public.publish_runs r
         where r.status in ('queued', 'running')
           and not exists (select 1 from system.jobs q where q.type = 'catalog.publish_run'
                            and q.status in ('queued', 'running') and q.payload ->> 'run_id' = r.id::text)), '0',
       not exists (select 1 from public.publish_runs r
                    where r.status in ('queued', 'running')
                      and not exists (select 1 from system.jobs q where q.type = 'catalog.publish_run'
                                       and q.status in ('queued', 'running') and q.payload ->> 'run_id' = r.id::text))
union all
select 'importaciones aplicándose hace más de 30 min',
       (select count(*)::text from public.import_jobs
         where status = 'committing' and commit_requested_at < now() - interval '30 minutes'), '0',
       not exists (select 1 from public.import_jobs
                    where status = 'committing' and commit_requested_at < now() - interval '30 minutes');
