-- =============================================================================
-- Diagnóstico del disparador pg_cron + pg_net de la cola (Orden 10, mensaje 7, H5).
-- SOLO LECTURA. Solo en Supabase y solo si la plantilla
-- runner-cada-minuto.pg_cron.sql ya se aplicó (con su autorización). No lee
-- encabezados (llevan la firma) ni el secreto.
--
-- Separa las cinco etapas, porque cada una falla distinto:
--   1. pg_cron corrió el trabajo         → cron.job_run_details
--   2. pg_net encoló la solicitud        → net.http_request_queue (pendientes)
--   3. llegó una respuesta HTTP          → net._http_response
--   4. el runner se ejecutó de verdad    → respuesta JSON {"ok":true,...} y, en
--                                          los logs de Vercel, «Runner de jobs
--                                          completado» con method = hmac
--   5. la cola avanzó                    → system.jobs
-- Una fila en falso dice qué etapa falló; qué hacer en cada caso está en
-- docs/runbooks/operacion-de-colas.md §9.
--
-- [NO VERIFICADO en Supabase] Los nombres de columnas de cron.* y net.* siguen la
-- documentación de pg_cron y pg_net; aquí se probaron contra tablas equivalentes
-- (tests/integration/pg-cron-diagnostics.test.ts). pg_net borra sus respuestas
-- después de unas horas: correr esto poco después del problema.
-- =============================================================================
with
corridas as (
  select d.status, d.start_time
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where j.jobname = 'pruva-jobs-runner' and d.start_time > now() - interval '30 minutes'
),
respuestas as (
  select r.status_code, r.timed_out, r.error_msg, coalesce(r.content, '') as content,
         coalesce(r.content, '') like '{"ok":%' as es_json_del_runner
    from net._http_response r
   where r.created > now() - interval '30 minutes'
),
cola as (
  select (select count(*) from system.jobs
           where status = 'queued' and run_after < now() - interval '10 minutes') as listos_atrasados,
         (select count(*) from system.jobs
           where status in ('succeeded', 'dead') and finished_at > now() - interval '30 minutes') as terminados
)
select 'etapa 1: trabajo pruva-jobs-runner registrado y activo' as senal,
       (select count(*)::text from cron.job where jobname = 'pruva-jobs-runner' and active) as valor,
       '1' as esperado,
       (select count(*) from cron.job where jobname = 'pruva-jobs-runner' and active) = 1 as ok,
       'A: sin trabajo o desactivado' as caso
union all
select 'etapa 1: corridas de pg_cron en 30 min', (select count(*)::text from corridas), '>= 25',
       (select count(*) from corridas) >= 25, 'A: pg_cron no corre cada minuto'
union all
select 'etapa 1: corridas fallidas de pg_cron en 30 min',
       (select count(*)::text from corridas where status = 'failed'), '0',
       not exists (select 1 from corridas where status = 'failed'), 'B: la sentencia falló (Vault, extensión, URL)'
union all
select 'etapa 2: solicitudes de pg_net sin enviar', (select count(*)::text from net.http_request_queue), '<= 2',
       (select count(*) from net.http_request_queue) <= 2, 'C: pg_net no está enviando'
union all
select 'etapa 3: corridas sin respuesta HTTP en 30 min',
       greatest((select count(*) from corridas where status = 'succeeded') - (select count(*) from respuestas), 0)::text,
       '<= 2',
       (select count(*) from corridas where status = 'succeeded') - (select count(*) from respuestas) <= 2,
       'D: solicitudes perdidas'
union all
select 'etapa 3: sin respuesta (error de red o DNS)',
       (select count(*)::text from respuestas where error_msg is not null and not coalesce(timed_out, false)), '0',
       not exists (select 1 from respuestas where error_msg is not null and not coalesce(timed_out, false)),
       'E: URL o red'
union all
select 'etapa 3: tiempo agotado (60 s)', (select count(*)::text from respuestas where timed_out), '0',
       not exists (select 1 from respuestas where timed_out), 'F: tiempo agotado'
union all
select 'etapa 4: 401 del runner (firma o secreto)',
       (select count(*)::text from respuestas where status_code = 401 and es_json_del_runner), '0',
       not exists (select 1 from respuestas where status_code = 401 and es_json_del_runner), 'G: 401 de la app'
union all
select 'etapa 4: 401 o 403 sin JSON (protección de Vercel o firewall)',
       (select count(*)::text from respuestas where status_code in (401, 403) and not es_json_del_runner), '0',
       not exists (select 1 from respuestas where status_code in (401, 403) and not es_json_del_runner),
       'H: bloqueo antes de la app'
union all
select 'etapa 4: errores 5xx', (select count(*)::text from respuestas where status_code >= 500), '0',
       not exists (select 1 from respuestas where status_code >= 500), 'I: error del servidor'
union all
select 'etapa 4: respuestas 200 del runner en 30 min',
       (select count(*)::text from respuestas where status_code = 200 and content like '{"ok":true%'), '>= 1',
       exists (select 1 from respuestas where status_code = 200 and content like '{"ok":true%'),
       'J: el runner no respondió bien ninguna vez'
union all
select 'etapa 5: trabajos listos sin tomar hace más de 10 min',
       (select listos_atrasados::text from cola), '0', (select listos_atrasados = 0 from cola), 'K: la cola no avanza'
union all
select 'etapa 5: éxito sin avance (200 del runner, cola atrasada y nada terminado en 30 min)',
       (select case when listos_atrasados > 0 and terminados = 0
                     and exists (select 1 from respuestas where status_code = 200 and content like '{"ok":true%')
                    then 'sí' else 'no' end from cola),
       'no',
       (select not (listos_atrasados > 0 and terminados = 0
                    and exists (select 1 from respuestas where status_code = 200 and content like '{"ok":true%'))
          from cola),
       'L: éxito sin avance';
