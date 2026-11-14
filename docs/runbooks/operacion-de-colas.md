# Operación de la cola de trabajos y recuperación

Orden 10, mensaje 5 (hallazgo A1 de la auditoría del bloque 2). Qué mueve la cola, cuánto trabajo hace cada pasada, qué pasa cuando algo se cae y qué falta en la infraestructura para que corra cada minuto.

> **Estado al 2026-11-14.**
>
> - Configuración versionada: cron de Vercel **una vez al día** (`vercel.json`, `0 12 * * *`).
> - Cada minuto: **preparado, no activo**. Requiere una de las dos opciones de §3 y una autorización aparte.
> - El plan contratado de Vercel no se pudo leer [NO VERIFICADO].

## 1. Qué mueve la cola

La cola es la tabla `system.jobs`. Una «pasada» del runner (`runQueuedJobs`, `src/server/jobs/run-now.ts`) toma trabajos y los ejecuta. Hay tres disparadores:

| Disparador                                                                                                                                       | Cuándo                                    | Necesita la página abierta |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | -------------------------- |
| Cron de Vercel → `GET /api/jobs/run` con `Authorization: Bearer CRON_SECRET`                                                                     | Según `vercel.json` (hoy, una vez al día) | No                         |
| `pg_cron` + `pg_net` de Supabase → `POST /api/jobs/run` firmado con HMAC (`JOBS_HMAC_SECRET`)                                                    | Cada minuto, si se activa (§3, opción B)  | No                         |
| El panel después de una acción (`processQueueSoon`) o al mirar una página que espera trabajo (`resumeQueue`, como mucho cada 10 s por instancia) | Con actividad en el panel                 | Sí                         |

**Con el cron diario y la página cerrada, un lote avanza una parte al día.** Por eso hace falta §3 antes de ofrecer lotes a comercios.

## 2. Límites de una pasada

- **Tiempos:** plazo para tomar trabajos de 45 s, tope duro de 55 s y función de 60 s (`maxDuration` en `/api/jobs/run` y en todas las páginas y rutas que arrancan la cola). Lo vigila `tests/unit/max-duration.test.ts`.
- **Reclamo:** un trabajo por reclamo (`batchSize: 1`); antes de cada uno se comprueba el plazo.
- **Importación** (`import.commit`): una parte o importación por pasada como máximo. Solo empieza si quedan 25 s o más; si no, se aplaza sin gastar intento. Hay 3 intentos.
- **Medido en local** (`tests/integration/queue-cadence.test.ts`, mismos límites que producción): una parte de 4,998 filas se aplicó en una pasada de **30.9 s**. El lote de 6,000 filas en 2 partes, con su publicación, terminó en **2 minutos** de cron [MEDIDO, local; no en Vercel ni en Supabase alojado].
- **Publicación** (`catalog.publish_run`): tandas de 200 productos, cada una en su transacción. Si quedan menos de 8 s, se aplaza.
- **Rendimiento:** con un disparo por minuto, se aplica como mínimo una parte por minuto. Un lote de 10 partes tarda unos 10 a 12 minutos, más su publicación [ESTIMADO a partir de la medición local].

## 3. Activar «cada minuto» (requiere autorización)

### Opción A: Vercel Pro

- **Requisito:** el plan Pro de Vercel. En Hobby, Vercel solo permite crons diarios y **un `vercel.json` con un cron más frecuente hace fallar el despliegue**. Por eso el repositorio conserva el diario.
- **Cambio (en un commit propio, después de confirmar el plan en Vercel → Settings → Billing):**

  ```diff
  - "crons": [{ "path": "/api/jobs/run", "schedule": "0 12 * * *" }],
  + "crons": [{ "path": "/api/jobs/run", "schedule": "* * * * *" }],
  ```

- **Comprobación:** Vercel → Settings → Cron Jobs muestra `/api/jobs/run` cada minuto. A los 5 minutos, `scripts/ops/ventana/02-despues.sql` sale con la fila «trabajos listos sin tomar hace más de 10 min» en `ok = true`.

### Opción B: Supabase `pg_cron` (cualquier plan de Vercel)

- **Plantilla:** `scripts/ops/cola/runner-cada-minuto.pg_cron.sql`, versionada y **no aplicada**.
- **Requisitos en Supabase:**
  - extensiones `pg_cron` y `pg_net`;
  - `JOBS_HMAC_SECRET` en Vault con el nombre `jobs_hmac_secret`, con el mismo valor que en Vercel;
  - la URL pública de la app.
- **Probado en local:** `tests/integration/runner-pg-cron-signature.test.ts` comprueba que la firma que calcula la plantilla en SQL es idéntica a la del servidor y que el runner la acepta.
- **[NO VERIFICADO]:**
  - que `pg_cron` y `pg_net` estén disponibles en el proyecto de staging;
  - que la protección de despliegues de Vercel (SSO, «todos menos dominios propios») deje pasar el POST a la URL elegida;
  - que `pg_net` mande el cuerpo exactamente como `{}`.

  Se comprueba con `select * from cron.job_run_details order by start_time desc limit 5` y con la línea «Runner de jobs completado» (`method: hmac`) en los logs de Vercel.

## 4. Ejecuciones encimadas y repetidas

- **Sin duplicados:** cada trabajo se toma con `FOR UPDATE SKIP LOCKED` (`system.claim_jobs`), así que dos pasadas a la vez nunca toman el mismo.
- **Lotes y publicaciones:** el lote avanza con candado de fila y cada tanda de publicación bloquea su corrida.
- **Probado:** `queue-cadence.test.ts` corre dos runners en cada «minuto». Cada parte se aplicó con **un solo trabajo y un solo intento**, sin productos ni variantes repetidos.
- **Idempotencia:** volver a encolar el mismo trabajo no lo duplica (`dedupe_key`). Una parte aplicada no se vuelve a aplicar, y una corrida terminada responde «ya estaba».

## 5. Recuperación cuando algo se cae

| Qué pasa                                                           | Qué hace el sistema                                                                                                     | Probado en                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| La pasada se queda sin tiempo                                      | El trabajo se aplaza sin gastar intento y **conserva su lugar** (`system.release_job` no cambia su hora)                | `queue-cadence.test.ts`                           |
| El proceso del worker muere a la mitad                             | La transacción se revierte; tras 5 min (`lock_timeout`) la cola lo devuelve y otra pasada lo retoma                     | `import-batch-18k.test.ts`                        |
| Un trabajo agota sus intentos                                      | Una parte de lote queda fallida y **detiene su lote** con el motivo; una importación suelta queda fallida sin cambios   | pgTAP `147`                                       |
| Una importación lleva más de 30 min «aplicándose» sin trabajo vivo | El mantenimiento la marca fallida y detiene su lote                                                                     | pgTAP `147`                                       |
| Un trabajo espera 24 h en la cola (cron diario)                    | **No** se da por atascado mientras siga en la cola; la siguiente pasada lo toma                                         | `queue-cadence.test.ts`                           |
| Una publicación se queda sin trabajo vivo                          | El mantenimiento la retoma hasta 3 veces (cada 15 min); después queda fallida con el motivo y los productos en borrador | pgTAP `147`, `window-publish-contingency.test.ts` |

## 6. Una tienda con mucha cola

- **Orden:** la cola se atiende por llegada (`run_after`). Lo que llegó después espera a lo que llegó antes, de cualquier tienda.
- **Cuánto se puede retener la cabeza:** un trabajo aplazado conserva su lugar y se retoma primero, como mucho lo que dura **ese** trabajo. Cada trabajo está acotado: una importación o parte tiene hasta 5,000 filas y una corrida de publicación hasta 5,000 productos.
- **Lotes:** cada parte nueva entra con su propia hora, así que un lote de 10 partes se intercala con el trabajo de otras tiendas.
- **Espera:** la de otra tienda es acotada, no indefinida (`queue-cadence.test.ts`).
- **No hay reparto por tienda:** una tienda con 30 importaciones seguidas (el tope por hora) retrasa a las demás lo que duren esas 30. [PROPUESTA para el piloto: reparto por tienda en `system.claim_jobs`, con migración y su ADR.]

## 7. Alertas

`system.platform_health()` (Consola → Salud) avisa de:

- `queue_stalled`: un trabajo listo lleva más de 10 min sin tomarse;
- `jobs_stuck`: un trabajo lleva más de 15 min «en curso»;
- `jobs_dead`: trabajos que agotaron sus intentos en 24 h.

Ver `salud-y-alertas.md`. **Los correos de alerta dependen de Resend, que no está configurado:** hoy las alertas solo se ven en la consola [NO VERIFICADO con correo real]. Con el cron diario, `queue_stalled` aparece casi siempre: es el síntoma de §1.

## 8. Qué revisar si la cola no avanza

1. `scripts/ops/ventana/02-despues.sql` (solo lectura): trabajos listos sin tomar, en curso, desconocidos, publicaciones sin trabajo.
2. Consola → Trabajos: los muertos con su error. «Reintentar» después de corregir la causa.
3. Logs de Vercel: «Runner de jobs completado» con `method` `cron` o `hmac`. Si no aparece, el disparador no está corriendo (§3).
4. Si el disparador no corre y hay urgencia: abrir la página que espera el trabajo (lote, importación, fotos). El panel retoma la cola, como mucho cada 10 s por instancia.
