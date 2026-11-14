-- =============================================================================
-- Ventana única (Orden 10, mensaje 5, A2) — CONTINGENCIA §5.3. *** ESCRIBE ***
-- Solo con autorización y SOLO cuando 02-despues.sql ya está en verde con el
-- código nuevo desplegado (si no, el código anterior las volvería a descartar).
--
-- Vuelve a encolar las publicaciones que terminaron fallidas porque su trabajo
-- murió durante la ventana (código anterior: «unknown_job_type»). No publica
-- nada por sí mismo: el trabajo vuelve a pasar cada producto por las reglas de
-- publicación vigentes. Sustituir :INICIO_VENTANA por la hora UTC del paso 6.
-- =============================================================================
with retomadas as (
  update public.publish_runs r
     set status = 'queued', error = null, finished_at = null, resumes = 0
   where r.status = 'failed'
     and r.error like 'La publicación no terminó después de varios intentos%'
     and r.created_at >= ':INICIO_VENTANA'::timestamptz
  returning r.id, r.store_id
)
select app.enqueue_job('catalog.publish_run', jsonb_build_object('run_id', id), store_id,
                       format('catalog.publish_run:%s:ventana', id), now(), 5) as trabajo
  from retomadas;
