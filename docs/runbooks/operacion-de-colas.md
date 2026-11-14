# Operación de la cola de trabajos y recuperación

Orden 10, mensaje 5 (hallazgo A1 de la auditoría del bloque 2) y mensaje 7 (H3 y H5). Qué mueve la cola, cuánto trabajo hace cada pasada, qué pasa cuando algo se cae y qué falta en la infraestructura para que corra cada minuto.

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

- **Tiempos:** plazo para tomar trabajos de 45 s, tope duro de 55 s y función de 60 s (`maxDuration` en `/api/jobs/run` y en todas las páginas y rutas que arrancan la cola, §2.1).
- **Depende del plan de Vercel [NO VERIFICADO]:** `maxDuration = 60` es lo que pide el código, no lo que garantiza la plataforma. Si el plan contratado tuviera un tope menor, la pasada se cortaría antes de sus 55 s. El plan no se pudo leer. **No se afirma que 60 s estén disponibles en producción** hasta confirmarlo en Vercel → Settings → Functions.
- **Reclamo:** un trabajo por reclamo (`batchSize: 1`); antes de cada uno se comprueba el plazo.
- **Importación** (`import.commit`): una parte o importación por pasada como máximo. Solo empieza si quedan 25 s o más; si no, se aplaza sin gastar intento. Hay 3 intentos.
- **Medido en local** (`tests/integration/queue-cadence.test.ts`, mismos límites que producción): una parte de 4,998 filas se aplicó en una pasada de **30.9 s**. El lote de 6,000 filas en 2 partes, con su publicación, terminó en **2 minutos** de cron [MEDIDO, local; no en Vercel ni en Supabase alojado].
- **Publicación** (`catalog.publish_run`): tandas de 200 productos, cada una en su transacción. Si quedan menos de 8 s, se aplaza.
- **Rendimiento:** con un disparo por minuto, se aplica como mínimo una parte por minuto. Un lote de 10 partes tarda unos 10 a 12 minutos, más su publicación [ESTIMADO a partir de la medición local].

### 2.1 Entradas que arrancan la cola (inventario verificable, H3)

Una acción de servidor corre dentro de la función de la **página que la usa**, con el `maxDuration` de esa página. Por eso cuenta la página que aloja el formulario, no el archivo `actions.ts`.

- **Cómo se obtiene:** `tests/unit/queue-entry-graph.ts` sigue, función por función, página → componente → acción → helper (`finalizePanelUpload`) → `processQueueSoon`, `resumeQueue` o `runQueuedJobs`, más los layouts de cada página e `import()` dinámicos.
- **Qué exige:** `tests/unit/max-duration.test.ts` falla si una entrada que arranca la cola no declara `export const maxDuration = 60;`, y también si una entrada declara 60 s sin arrancar la cola ni tener una razón escrita.
- **Caso negativo:** la misma prueba arma un árbol de prueba con una página sin límite que llega a la cola por acción y helper; el detector la reporta. Otra página que solo usa otra acción del mismo módulo no se marca.
- **Comprobado que falla sin el cambio:** sin los 16 límites nuevos, 16 pruebas fallan.

| Entrada (`src/app/…`)                                                      | Cómo arranca la cola                                                      | Límite        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------- |
| `api/jobs/run/route.ts`                                                    | `runQueuedJobs` (cron y pg_cron)                                          | 60 s (antes)  |
| `api/webhooks/payments/{mercadopago,stripe}/route.ts`                      | `processQueueSoon` directo                                                | 60 s (M5)     |
| `admin/[storeHandle]/page.tsx` (Inicio)                                    | `resumeQueue` directo                                                     | 60 s (M5)     |
| `admin/[storeHandle]/pedidos/page.tsx`                                     | `resumeQueue` directo                                                     | 60 s (M5)     |
| `admin/[storeHandle]/productos/[productId]/page.tsx`                       | `resumeQueue` directo                                                     | 60 s (M5)     |
| `admin/[storeHandle]/productos/importar/page.tsx`                          | `resumeQueue` directo                                                     | 60 s (M5)     |
| `admin/[storeHandle]/productos/importar/fotos/page.tsx`                    | `resumeQueue` directo                                                     | 60 s (M5)     |
| `admin/[storeHandle]/productos/importar/[jobId]/page.tsx`                  | `resumeQueue` directo                                                     | 60 s (antes)  |
| `admin/[storeHandle]/productos/importar/lote/[batchId]/page.tsx`           | `resumeQueue` directo                                                     | 60 s (antes)  |
| `admin/[storeHandle]/configuracion/page.tsx`                               | `LogoForm` → `finalizeLogoUpload` → `finalizePanelUpload`                 | **60 s (M7)** |
| `admin/[storeHandle]/apariencia/page.tsx`                                  | `HomeEditor` → `finalizeBannerUpload` → `finalizePanelUpload`             | **60 s (M7)** |
| `admin/[storeHandle]/contenido/paginas/[pageId]/page.tsx`                  | `HomeEditor` → `finalizeBannerUpload` → `finalizePanelUpload`             | **60 s (M7)** |
| `admin/[storeHandle]/productos/importar/imagenes/page.tsx` (fotos en lote) | `BulkImages` → `finalizeProductImageUpload` → `finalizePanelUpload`       | **60 s (M7)** |
| `admin/[storeHandle]/productos/nuevo/page.tsx`                             | `QuickProductForm` → `finalizeProductImageUpload` → `finalizePanelUpload` | **60 s (M7)** |
| `admin/[storeHandle]/productos/categorias/page.tsx`                        | `BulkEntityImages` → `attachEntityImage` → `finalizePanelUpload`          | **60 s (M7)** |
| `admin/[storeHandle]/productos/marcas/page.tsx`                            | `BulkEntityImages` → `attachEntityImage` → `finalizePanelUpload`          | **60 s (M7)** |
| `admin/[storeHandle]/pedidos/[orderId]/page.tsx`                           | Formularios del pedido → acciones de `pedidos/actions.ts`                 | **60 s (M7)** |
| `admin/[storeHandle]/pedidos/devoluciones/[returnId]/page.tsx`             | `DecideForms` → `decideReturn`                                            | **60 s (M7)** |
| `admin/[storeHandle]/ajustes/dominio/page.tsx`                             | `DomainActions` → `checkDomain` y demás acciones de dominio               | **60 s (M7)** |
| `admin/tiendas/nueva/page.tsx`                                             | `NewStoreForm` → `createStore`                                            | **60 s (M7)** |
| `platform/organizaciones/nueva/page.tsx`                                   | `CreateTenantForm` → `createTenant`                                       | **60 s (M7)** |
| `platform/organizaciones/[orgId]/tienda-nueva/page.tsx`                    | `AddStoreForm` → `addStore`                                               | **60 s (M7)** |
| `platform/trabajos/page.tsx`                                               | `RetryJobButton` → `retryDeadJob`                                         | **60 s (M7)** |
| `%5Fstore/[storeId]/checkout/page.tsx` (tienda)                            | `CheckoutForm` → `checkout`                                               | **60 s (M7)** |
| `%5Fstore/[storeId]/pago-simulado/[paymentId]/page.tsx`                    | `SimulateForm` → `simulatePayment`                                        | **60 s (M7)** |

- **Con 60 s por otra razón:** `productos/importar/lote/[batchId]/parte/[part]/route.ts` (validar una parte de 5,000 filas, D8).
- **Sin límite, a propósito:** el carrito, los listados y la ficha de producto de la tienda usan `addItem` del mismo `carrito/actions.ts`, que no arranca la cola. Las rutas `route.ts` de la tienda (íconos, robots, sitemap) no tienen layout.
- **Límite del análisis:** es estático y conservador (basta con nombrar la función). No ve llamadas armadas con texto, como `obj["processQueueSoon"]()`; hoy no hay ninguna.

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

  Se comprueba con `scripts/ops/cola/diagnostico-pg_cron.sql` (§9) y con la línea «Runner de jobs completado» (`method: hmac`) en los logs de Vercel.

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
5. Si `pg_cron` ya está activo: §9.

## 9. Diagnóstico de `pg_cron` + `pg_net` (H5)

**Guion:** `scripts/ops/cola/diagnostico-pg_cron.sql`. Solo lectura, solo en Supabase y solo con la plantilla ya aplicada. No lee encabezados (llevan la firma) ni el secreto, y no escribe.

**Probado en local** (`tests/integration/pg-cron-diagnostics.test.ts`): contra tablas con las mismas columnas que documentan pg_cron y pg_net, en una base desechable, en 10 escenarios. Las columnas reales de Supabase y el tiempo que pg_net guarda las respuestas están [NO VERIFICADO]. No se corrió nada de pg_cron ni pg_net en ningún entorno remoto.

**Cinco etapas.** Que pg_cron diga «succeeded» solo significa que **encoló** la solicitud: `net.http_post` regresa de inmediato con un id. Cada etapa se mira por separado.

| Etapa | Qué prueba                     | Dónde se ve                                                                            |
| ----- | ------------------------------ | -------------------------------------------------------------------------------------- |
| 1     | pg_cron corrió la sentencia    | `cron.job` (activo) y `cron.job_run_details` (estado y `return_message`)               |
| 2     | pg_net envió la solicitud      | `net.http_request_queue`: lo que sigue sin enviar                                      |
| 3     | Llegó una respuesta HTTP       | `net._http_response`: `status_code`, `timed_out`, `error_msg`, `created`               |
| 4     | El runner se ejecutó de verdad | Respuesta `{"ok":true,…}` y, en Vercel, «Runner de jobs completado» con `method: hmac` |
| 5     | La cola avanzó                 | `system.jobs`: trabajos terminados y listos atrasados                                  |

**Qué hacer en cada caso** (la columna `caso` del guion):

| Caso | Síntoma                                                                              | Causa probable                                                                                      | Qué hacer                                                                                           |
| ---- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A    | Sin trabajo activo o menos de 25 corridas en 30 min                                  | La plantilla no se aplicó, se desactivó o pg_cron está detenido                                     | Revisar `cron.job`. Reaplicar la plantilla solo con autorización                                    |
| B    | Corridas fallidas                                                                    | El secreto no está en el Vault, falta una extensión o la URL es inválida                            | Leer `return_message` (consulta 1 abajo). Corregir con autorización                                 |
| C    | Solicitudes acumuladas en `net.http_request_queue`                                   | El proceso de pg_net no envía                                                                       | Revisar el estado de pg_net en Supabase; escalar a soporte de Supabase si sigue                     |
| D    | Corridas sin respuesta registrada                                                    | Solicitudes perdidas, o respuestas ya borradas por pg_net                                           | Repetir el diagnóstico pronto; revisar los logs de Vercel por la hora                               |
| E    | `error_msg` sin tiempo agotado                                                       | DNS, URL o conexión                                                                                 | Revisar la URL de la plantilla (`:APP_URL`)                                                         |
| F    | Tiempo agotado (60 s)                                                                | La pasada pasó de 60 s o la función no respondió                                                    | Revisar en Vercel la duración de `/api/jobs/run` y el tope del plan (§2)                            |
| G    | 401 con el JSON de la app (`"code":"unauthenticated"`)                               | La firma no cuadra: `JOBS_HMAC_SECRET` distinto en Vault y en Vercel, o reloj desfasado más de 60 s | Comparar que los dos valores sean el mismo **sin imprimirlos**: rotar ambos juntos con autorización |
| H    | 401 o 403 sin JSON (página HTML)                                                     | La protección de despliegues de Vercel o un firewall bloquea antes de la app                        | Usar un dominio sin protección o el mecanismo de excepción de Vercel; decisión del propietario      |
| I    | 5xx                                                                                  | Error en la app o en la base                                                                        | Logs de Vercel: «Fallo del runner de jobs» con su `request_id`                                      |
| J    | Ningún 200 del runner en 30 min                                                      | Consecuencia de A a I                                                                               | Resolver la etapa anterior que falló                                                                |
| K    | Trabajos listos de más de 10 min                                                     | La cola no avanza a tiempo                                                                          | Si todo lo anterior está bien, ver L                                                                |
| L    | Éxito sin avance: hay 200 del runner, la cola está atrasada y nada terminó en 30 min | El runner responde pero no toma trabajos: otra base, otro rol o una pasada que se aplaza siempre    | Logs de Vercel: `claimed` y `deferred` en «Runner de jobs completado»; Consola → Trabajos           |

**Consultas de detalle** (solo lectura):

```sql
-- 1. Últimas corridas de pg_cron, con su mensaje.
select d.runid, d.status, d.return_message, d.start_time, d.end_time
  from cron.job_run_details d join cron.job j on j.jobid = d.jobid
 where j.jobname = 'pruva-jobs-runner' order by d.start_time desc limit 10;

-- 2. Últimas respuestas HTTP (sin encabezados).
select id, status_code, timed_out, error_msg, left(content, 160) as inicio, created
  from net._http_response order by created desc limit 10;

-- 3. La cola: lo atrasado y lo terminado.
select status, count(*), min(run_after) as mas_viejo
  from system.jobs where status in ('queued', 'running') group by status;
```

- **Otras respuestas en `net._http_response`:** el paso 4 de la ventana usa `net.http_get` para bajar los archivos de migración. Esas respuestas (200 con texto SQL) también aparecen; el guion solo cuenta como del runner las que traen `{"ok":…}`.
- **Logs de Vercel:** «Runner de jobs completado» trae `method` (`cron` o `hmac`), `claimed`, `succeeded`, `deferred` y `dead`. Si pg_cron corre y no aparece ninguna línea con `hmac`, el problema está en las etapas 2 a 4.
