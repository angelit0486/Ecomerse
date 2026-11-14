-- =============================================================================
-- Runner de la cola cada minuto desde Supabase (pg_cron + pg_net). Orden 10,
-- mensaje 5 (A1). Alternativa al cron de Vercel cuando el plan de Vercel no
-- permite más de una ejecución al día (Hobby).
--
-- *** NO ESTÁ APLICADO. *** Aplicarlo es una acción REMOTA que requiere la
-- autorización expresa del propietario: docs/runbooks/operacion-de-colas.md §3.
--
-- Requisitos en Supabase (no en este repositorio):
--   1. Extensiones pg_cron y pg_net activas (Database → Extensions).
--   2. El valor de JOBS_HMAC_SECRET (el MISMO que tiene Vercel) guardado en
--      Vault con el nombre 'jobs_hmac_secret'. El secreto nunca va en este
--      archivo ni en un commit.
--   3. Sustituir :APP_URL por la URL pública de la app, sin barra final, en una
--      copia local de este archivo (por ejemplo https://pruva-panel-demo.vercel.app).
--
-- Cómo lo autoriza el runner (src/server/jobs/authorize.ts): POST con
-- x-jobs-timestamp y x-jobs-signature = hex(HMAC-SHA256(secreto,
-- "{timestamp}.{cuerpo}")), tolerancia ±60 s. El cuerpo es '{}'.
-- tests/integration/runner-pg-cron-signature.test.ts comprueba que la firma de
-- abajo es idéntica a la del servidor.
--
-- Seguro con ejecuciones encimadas: cada trabajo se toma con FOR UPDATE SKIP
-- LOCKED (system.claim_jobs); una pasada dura como mucho 55 s.
-- =============================================================================
select cron.schedule(
  'pruva-jobs-runner',
  '* * * * *',
  $job$
  select net.http_post(
    url := ':APP_URL/api/jobs/run',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-jobs-timestamp', f.ts,
      -- firma: inicio
      'x-jobs-signature', encode(extensions.hmac(f.ts || '.' || '{}', f.secret, 'sha256'), 'hex')
      -- firma: fin
    ),
    timeout_milliseconds := 60000
  )
  from (select extract(epoch from now())::bigint::text as ts,
               (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'jobs_hmac_secret') as secret) f;
  $job$
);

-- Para quitarlo:  select cron.unschedule('pruva-jobs-runner');
-- Para revisarlo: select * from cron.job_run_details order by start_time desc limit 20;
