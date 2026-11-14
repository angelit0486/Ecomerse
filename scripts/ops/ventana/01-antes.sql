-- =============================================================================
-- Ventana única (Orden 10, mensaje 5, A2) — PASO 3: comprobación ANTES de migrar.
-- Solo lectura. Se corre en staging (editor SQL o execute_sql) justo antes de
-- aplicar las 10 migraciones. Cada fila trae su resultado esperado y ok = true.
-- REGLA: todas las filas son de categoría «bloqueante» (runbook §11.1): si
-- alguna trae ok = false, NO se aplica nada y la ventana no empieza.
-- =============================================================================
with tipos_nuevos(tipo) as (
  -- Tipos de trabajo que registra el código nuevo (src/server/jobs/registry.ts).
  -- tests/unit/ventana-sql.test.ts falla si esta lista y el registro difieren.
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
       '20261110000200' as esperado, public.app_schema_version() = '20261110000200' as ok,
       'bloqueante' as categoria
union all
select 'ninguna de las 10 migraciones aplicada',
       concat_ws(',', to_regclass('public.order_item_costs'), to_regclass('public.import_photo_checks'),
                 to_regclass('public.publish_runs'), to_regclass('public.import_batches')),
       '(vacío)',
       to_regclass('public.order_item_costs') is null and to_regclass('public.import_photo_checks') is null
         and to_regclass('public.publish_runs') is null and to_regclass('public.import_batches') is null, 'bloqueante'
union all
select 'importaciones aplicándose o validándose',
       (select count(*)::text from public.import_jobs where status in ('committing', 'validating')), '0',
       not exists (select 1 from public.import_jobs where status in ('committing', 'validating')), 'bloqueante'
union all
select 'trabajos corriendo', (select count(*)::text from system.jobs where status = 'running'), '0',
       not exists (select 1 from system.jobs where status = 'running'), 'bloqueante'
union all
select 'trabajos en cola que el código nuevo no conoce',
       coalesce((select string_agg(distinct j.type, ',') from system.jobs j
                  where j.status in ('queued', 'running') and j.type not in (select tipo from tipos_nuevos)), ''),
       '(vacío)',
       not exists (select 1 from system.jobs j
                    where j.status in ('queued', 'running') and j.type not in (select tipo from tipos_nuevos)), 'bloqueante'
union all
select 'candados de aviso retenidos', (select count(*)::text from pg_locks where locktype = 'advisory'), '0',
       not exists (select 1 from pg_locks where locktype = 'advisory'), 'bloqueante'
union all
select 'tiendas de prueba pruva-ventana-a y -b, en organizaciones distintas y con dueño',
       (select count(distinct s.organization_id)::text from public.stores s
         where s.handle in ('pruva-ventana-a', 'pruva-ventana-b')
           and exists (select 1 from public.organization_members m
                        where m.organization_id = s.organization_id and m.role = 'org_owner')), '2',
       (select count(distinct s.organization_id) from public.stores s
         where s.handle in ('pruva-ventana-a', 'pruva-ventana-b')
           and exists (select 1 from public.organization_members m
                        where m.organization_id = s.organization_id and m.role = 'org_owner')) = 2,
       'bloqueante';
