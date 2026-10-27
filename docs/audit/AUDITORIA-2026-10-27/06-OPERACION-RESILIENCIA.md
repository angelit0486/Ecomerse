# Auditoría 06 — Operación y resiliencia

Fecha: 2026-10-27. Auditor: operación y resiliencia (solo lectura). HEAD auditado: `be5541d`.
Ámbito: observabilidad, respaldos y restauración, despliegue y reversa, caídas de terceros, runbooks,
riesgo de «único operador» y CI.

**Términos usados.** _Observabilidad_: poder saber qué pasa en el sistema sin entrar a la base
(registros, errores, métricas). _Alerta_: aviso automático a una persona cuando algo falla.
_Job_: tarea en segundo plano que la cola ejecuta después (correo, foto, reconciliación). _Job
muerto_ (`dead`): job que agotó sus reintentos y ya no se volverá a intentar. _Reconciliación_:
preguntar al proveedor de pagos por cobros cuyo aviso (webhook) no llegó. _RPO_: cuántos datos se
pueden perder (tiempo hacia atrás). _RTO_: cuánto tiempo tarda en volver el servicio. _PITR_:
restauración a un punto exacto en el tiempo. _Rollback_: volver al despliegue anterior.
_Bus factor_: cuántas personas tendrían que faltar para que nadie pueda operar.

Etiquetas: **[VERIFICADO]** comprobado leyendo o ejecutando; **[INFERIDO]** deducido del código;
**[NO VERIFICADO]** requiere un servicio o acceso que no tengo (Vercel responde 403).

---

## Resumen

La base técnica es sólida: la cola de jobs tiene reintentos con espera creciente, recupera jobs
abandonados, los webhooks de Mercado Pago se reintentan solos si fallan, el logger redacta secretos
y la CI corre unidad, base de datos, stack real y E2E en cada push. **Lo que falta es la capa de
operación**: hoy nadie se entera de nada. No hay Sentry, ni drenaje de logs, ni monitor externo, ni
alertas; un job muerto, un webhook fallido o una cola detenida solo quedan en un log que nadie mira.
En staging la evidencia lo confirma: **el mantenimiento periódico (expirar pedidos, reconciliar
pagos) nunca se ha ejecutado** y nada lo avisó. A eso se suma que no existe producción, ni
respaldos en el plan actual, ni simulacro de restauración, y que una sola persona (que opera desde
el celular) tiene todas las llaves.

| Severidad | Hallazgos |
| --------- | --------- |
| Crítica   | 1         |
| Alta      | 5         |
| Media     | 9         |
| Baja      | 4         |

---

## Hallazgos

### OPS-01 · Crítica · El mantenimiento de la cola (expirar pedidos, reconciliar pagos) nunca se ha ejecutado en staging, y nada lo detectó

- **Evidencia.**
  - `system.enqueue_maintenance()` (migración `20261014000600_phase7_gate_fixes.sql:838-859`) es lo
    único que encola `orders.expire`, `payments.reconcile`, `orders.complete`, `rate_limits.purge` y
    `media.purge_orphans`. Solo la llama `/api/jobs/run` (`src/app/api/jobs/run/route.ts:44`); el
    arranque inmediato tras una acción (`processQueueSoon`, `src/server/jobs/run-now.ts`) **no** la
    llama.
  - Consulta SELECT en staging (hoy): `system.jobs` agrupado por tipo y estado → solo existen
    `compliance.recheck` (4), `import.commit` (5) y `media.process` (101), todos `succeeded`, el más
    antiguo del 2026-10-16. **Cero** jobs de mantenimiento. Como `system.purge_finished_jobs` nunca
    se programa (ver OPS-17), no se borraron: nunca se crearon. Es decir, en 11 días el cron diario
    de Vercel no completó ni una pasada de `/api/jobs/run`. **[VERIFICADO]** (lado base de datos).
  - Extensiones en staging: `pg_net` sí, `pg_cron` **no**. `vercel.json` programa el runner una vez
    al día (`0 12 * * *`) por el plan Hobby (D-F9-17, N-4). La causa exacta (cron sin `CRON_SECRET`,
    cron no habilitado, 401) es **[NO VERIFICADO]** por el 403 de Vercel.
  - El comentario de `route.ts:16` dice «invocado cada minuto por Vercel Cron», lo cual no es cierto
    hoy.
- **Impacto.** `system.expire_orders` (migración `20261013000400_payments_expiry.sql:291`) es lo que
  libera las existencias reservadas por checkouts abandonados. Sin él, cada checkout abandonado deja
  unidades apartadas para siempre: con pocas existencias, **los productos aparecen agotados y la
  tienda deja de vender**. Además, un pago de Mercado Pago cuyo webhook se pierda no se reconcilia
  nunca (el runbook promete «cada 10 minutos»). Ninguna alerta lo detectaría (OPS-02). Hoy staging
  tiene 0 pedidos, por eso no ha dolido.
- **Recomendación.** (1) Diagnosticar por qué el cron de staging no corre (logs de Vercel Cron,
  `CRON_SECRET`). (2) Antes de vender: Vercel Pro con cron cada minuto **o** activar pg_cron + pg_net
  con HMAC (ya implementado, falta programarlo). (3) Registrar la última pasada exitosa del
  mantenimiento (`last_maintenance_at`) y hacer que `/api/health/ready` responda `degraded` si pasa
  de 5 minutos. (4) Alerta externa sobre ese estado (OPS-02).

### OPS-02 · Alta · No hay seguimiento de errores, drenaje de logs, monitor externo ni alertas

- **Evidencia.** Sin dependencia de Sentry ni de otro proveedor en `package.json`; sin
  `src/instrumentation.ts`; sin referencias a log drain, Axiom o Better Stack en código o runbooks
  (búsqueda `grep -rni "sentry|drain|uptime|alert"`). GATE0 §35 (líneas 1969-1975) exige Sentry,
  logs drenados con retención de 30 días y «monitor externo cada minuto»; T-09 pide «alerta si > 5
  firmas inválidas en 10 min». Nada de eso existe. `PLAN-LANZAMIENTO.md:114` lo lista como pendiente
  de la Etapa 5. **[VERIFICADO]**
- **Quién se entera hoy de…**
  | Evento                                                | Dónde queda                                                               | ¿Alguien se entera?     |
  | ----------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------- |
  | Webhook de pago que falla al procesarse               | `log.error("payment.webhook_failed")` + `payment_events.processing_error` | No                      |
  | Firma de webhook inválida (posible ataque)            | `system.record_webhook_rejection` (evento de seguridad)                   | No                      |
  | Job muerto (correo de pedido, foto, reembolso)        | `system.jobs.status = 'dead'`                                             | No                      |
  | Cola detenida o cron sin correr                       | Nada (OPS-01)                                                             | No                      |
  | Pedido «en atención» (doble cobro, reembolso fallido) | Correo al staff vía Resend                                                | Solo si Resend funciona |
  | Error 500 en el panel o la tienda                     | Log de Vercel (retención del plan, **[NO VERIFICADO]**)                   | No                      |
- **Impacto.** Cualquier incidente se descubre cuando un cliente se queja. Con un único operador que
  usa el celular, esto alarga mucho el tiempo de detección.
- **Recomendación.** Mínimo viable antes de la primera venta: (a) Sentry (plan gratuito) con
  `onRequestError` en `instrumentation.ts`, `sendDefaultPii=false` y el mismo `redact`; (b) monitor
  externo gratuito (UptimeRobot, Better Stack) contra `/api/health/ready` cada 1-5 min, con aviso
  por push o SMS al celular; (c) alerta por correo o push cuando haya jobs muertos nuevos, eventos de
  pago con `processing_error` o pagos `pending` de más de 1 h.

### OPS-03 · Alta · `/api/health/ready` no refleja jobs muertos ni Storage, y nadie lo consulta

- **Evidencia.** `src/app/api/health/ready/route.ts:36` marca `degraded` solo si la base no responde
  o el job listo más antiguo espera más de 300 s; `dead_jobs` y `running_jobs` se calculan
  (`system.health_check`) pero solo se registran en el log. No revisa Storage (GATE0 §35 lo pide). No
  hay ningún monitor configurado que lo llame (OPS-02). Además, `oldest_ready_seconds` no detecta un
  cron parado si no hay jobs encolados (caso OPS-01). **[VERIFICADO]**
- **Impacto.** El único semáforo de salud existe pero está ciego a los fallos más probables.
- **Recomendación.** Añadir a `health_check`: jobs muertos en las últimas 24 h, antigüedad de la
  última pasada de mantenimiento, pagos `pending` vencidos y un `HEAD` a Storage. Mostrar el detalle
  (sin datos internos) en una pantalla «Estado del sistema» de la consola de plataforma.

### OPS-04 · Alta · Sin respaldos en el plan actual, sin producción, sin simulacro de restauración ni runbook de restauración

- **Evidencia.**
  - Staging es plan gratuito (D-F9-17). Documentación oficial «Database Backups»
    (https://supabase.com/docs/guides/platform/backups, consultada 2026-10-27): «We automatically
    back up all Pro, Team, and Enterprise Plan projects on a daily basis. Pro Plan projects can access
    the last 7 days […] Team Plan […] 14 days, […] Enterprise […] up to 30 days»; para el plan
    gratuito recomienda exportar con `supabase db dump` y guardar copias fuera. PITR: «Pro, Team and
    Enterprise Plan projects can enable PITR as an add-on» (requiere al menos cómputo Small); «in the
    worst case scenario, PITR achieves a Recovery Point Objective (RPO) of two minutes»; precio
    publicado ≈ US$100/mes por 7 días de retención. «Production Checklist»
    (https://supabase.com/docs/guides/deployment/going-into-prod, consultada 2026-10-27): «Database
    backups are not available for download for Free Plan projects» y «We may pause applications on
    the Free Plan that exhibit low activity in a 7-day period». **[VERIFICADO]** (documentación).
  - No hay runbook de restauración ni evidencia de un simulacro (`docs/runbooks/` solo tiene
    `database-roles.md`, `local-stack.md`, `mercadopago.md`). GATE0 §36 y `PLAN-LANZAMIENTO.md:113,140`
    lo exigen antes de lanzar. No hay script de `pg_dump` programado. **[VERIFICADO]**
  - El proyecto de producción todavía no existe (PLAN-LANZAMIENTO Etapa 5).
- **RPO/RTO estimados (supuestos explícitos).**
  | Escenario                                                                                       | RPO                                      | RTO estimado                                                                                                                                  |
  | ----------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
  | Hoy (staging, plan gratuito)                                                                    | Sin respaldo: todo desde la creación     | No hay forma de restaurar; habría que re-sembrar                                                                                              |
  | Pro sin PITR                                                                                    | Hasta 24 h (respaldo diario)             | 2-6 h: restauración (bloquea el proyecto, depende del tamaño) + reponer contraseñas de roles (OPS-05) + verificación; supone runbook ensayado |
  | Pro + PITR 7 días                                                                               | ≤ 2 min (documentación)                  | 2-6 h, mismo proceso                                                                                                                          |
  | Fotos (Storage)                                                                                 | **Sin respaldo en ningún plan** (OPS-06) | Re-subir a mano                                                                                                                               |
  | Supuestos: base de menos de 1 GB, operador disponible y con acceso a Supabase y Vercel, runbook |
  | escrito y ensayado una vez. Sin runbook ni operador disponible, el RTO real es indeterminado.   |
- **Impacto.** Antes del lanzamiento no hay datos reales, por eso es Alta y no Crítica; **al vender
  sin esto, pasaría a Crítica** (pedidos y pagos son registros legales que no se pueden perder).
- **Recomendación.** Producción en Pro desde el día uno; decidir PITR (≈ US$100/mes) frente a
  respaldo diario + `pg_dump` lógico diario a un almacenamiento externo (GitHub Actions programado o
  similar, cifrado). Escribir y ensayar `runbooks/restauracion.md` en un proyecto aparte, midiendo el
  RTO real.

### OPS-05 · Media · Restaurar un respaldo deja la app caída hasta reponer las contraseñas de los roles propios

- **Evidencia.** Documentación de respaldos (misma URL, 2026-10-27): «daily backups do not store
  passwords for custom roles […] If you restore from a daily backup and use custom roles, you will
  need to reset their passwords after the restoration completes.» La app se conecta con roles
  propios `storefront_gateway` y `system_worker` (`docs/runbooks/database-roles.md`). El runbook de
  rotación (§4) cubre `system_worker`, pero no hay un procedimiento de «después de restaurar» que
  cubra ambos roles, las URL en Vercel y el redespliegue. **[VERIFICADO]** (doc) / **[INFERIDO]**
  (efecto).
- **Impacto.** Tras una restauración, tienda y cola quedarían fuera hasta que alguien recuerde este
  paso.
- **Recomendación.** Incluirlo como paso obligatorio del runbook de restauración, con verificación
  `GET /api/health/ready` = 200 y una compra de prueba.

### OPS-06 · Media · Las fotos (Supabase Storage) no están en ningún respaldo

- **Evidencia.** Documentación de respaldos: «Database backups do not include objects you store via
  the Storage API […] Restoring an old backup does not restore objects you deleted after that
  backup.» Las fotos de productos viven en el bucket `store-media` (`src/server/jobs/registry.ts`,
  `mediaUrl`), y el job diario `media.purge_orphans` borra archivos. **[VERIFICADO]** (doc).
- **Impacto.** Un borrado accidental o un error del purgador de huérfanos no tiene vuelta atrás; tras
  restaurar la base, las filas de medios apuntarían a archivos inexistentes.
- **Recomendación.** Copia periódica del bucket a otro almacenamiento, o conservar los originales
  fuera de la plataforma; documentarlo en el runbook de restauración.

### OPS-07 · Alta · La CI no es una barrera: rama sin protección, HEAD en rojo y Vercel despliega igual

- **Evidencia.**
  - `gh api repos/angelit0486/Ecomerse/branches`: la rama por defecto
    `claude/ecommerce-regulated-platform-41vu1e` tiene `"protected": false`, sin checks requeridos;
    `rulesets` = `[]`. **[VERIFICADO]**
  - La ejecución de CI del HEAD `be5541d` (run 40477420785, 2026-10-27 08:59 UTC) **falló**: el job
    «Lint · Formato · Tipos · Unit · Build» se detuvo en `pnpm format:check`, así que tipos, unit y
    build ni se ejecutaron en CI para ese commit. Reproducido localmente: `pnpm format:check` →
    `[warn] docs/plan/ESTADO-CALIDAD-2026-10-27.md`. Contradice la línea base («últimas en verde»).
    **[VERIFICADO]**
  - El `build` de Vercel (`package.json`: `node scripts/deploy/migrate.mjs && next build`) no depende
    del resultado de GitHub Actions: un commit con CI en rojo se despliega y, si existe
    `MIGRATION_DATABASE_URL`, **migra la base**. **[INFERIDO]**; la configuración de Vercel es
    **[NO VERIFICADO]**.
- **Impacto.** Hoy el fallo es solo de formato, pero el mismo camino permite que llegue a la base
  una migración que la CI rechazó.
- **Recomendación.** Proteger la rama por defecto con los 4 checks requeridos; en Vercel, activar
  «esperar a los checks» o desplegar a producción solo desde una rama protegida/promoción manual.
  Corregir el formato del archivo señalado.

### OPS-08 · Media · `migrate.mjs` corre dentro del build: sin candado, aplicación parcial y riesgo con vistas previas

- **Evidencia.** `scripts/deploy/migrate.mjs`:
  - Sin `pg_advisory_lock`: dos builds simultáneos (p. ej. producción y vista previa contra la misma
    base) compiten por la misma migración. Cada archivo va en su transacción, así que el perdedor
    falla por la PK de `schema_migrations`, pero el build queda roto. **[INFERIDO]**
  - Aplicación parcial: si la migración 3 de 5 falla, las 1-2 quedan aplicadas y el despliegue no
    sale; la base queda adelante del código en producción (por diseño expand/contract debería
    tolerarse, pero no hay prueba que lo garantice, OPS-09). **[INFERIDO]**
  - Si `next build` falla después de migrar, igual: base nueva, código viejo. **[INFERIDO]**
  - Si `MIGRATION_DATABASE_URL` se define también para el entorno «Preview» de Vercel con la URL de
    producción, cada rama empujada migraría producción. **[NO VERIFICADO]** (403).
  - Controles presentes: checksum sha256 por archivo, detiene si una migración aplicada cambió, no
    imprime la cadena de conexión. **[VERIFICADO]**
- **Recomendación.** Candado consultivo al inicio; variable solo en «Production»; respaldo manual
  previo cuando una release traiga migraciones (lo pide PLAN-LANZAMIENTO §0.5); considerar un paso de
  migración separado (GitHub Action manual) en lugar de dentro del build.

### OPS-09 · Media · La reversa de un despliegue malo está limitada y no está escrita

- **Evidencia.**
  - Documentación de Vercel (`vercel rollback`, consultada 2026-10-27 vía el buscador de docs de
    Vercel, https://vercel.com/docs/cli/rollback): «Hobby plan accounts can only roll back to the
    immediately previous production deployment»; el rollback a un despliegue específico es de Pro y
    Enterprise. El proyecto `ecomerse` está en Hobby (D-F9-17). **[VERIFICADO]** (doc).
  - El rollback de Vercel no revierte la base: las migraciones ya aplicadas se quedan
    (forward-only). La regla expand/contract (GATE0 §36, CLAUDE.md regla 17) es política, pero no hay
    prueba automática que corra el código N−1 contra el esquema N. **[VERIFICADO]** (búsqueda en CI).
  - El aviso de versión de esquema (`src/server/db/schema-version.ts`, usado en
    `src/app/admin/[storeHandle]/layout.tsx:30`) avisa solo si la base está **atrás** del código
    (`current >= EXPECTED`), así que un rollback de código no lo dispara (correcto) y una migración
    pendiente sí (bien). **[VERIFICADO]**
  - No hay `runbooks/despliegue-y-reversa.md`.
- **Recomendación.** Runbook de despliegue y reversa (qué mirar, cómo hacer rollback desde el
  celular en el panel de Vercel, cuándo NO hacerlo por una migración «contract»); en CI, un job que
  compile el commit anterior y corra `test:stack` contra el esquema nuevo cuando cambie
  `supabase/migrations`.

### OPS-10 · Alta · Riesgo de único operador (bus factor = 1) sin acceso de emergencia documentado

- **Evidencia.**
  - Staging: `public.platform_staff` tiene **1** fila (`platform_owner`); 1 factor MFA verificado
    en `auth.mfa_factors`. **[VERIFICADO]** (SELECT).
  - El alta del `platform_owner` es un `insert` SQL manual (`database-roles.md:49-52`). No hay
    códigos de recuperación de TOTP ni procedimiento si el dueño pierde el celular: el
    restablecimiento de MFA (`src/server/team/mfa-reset.ts`) lo hace un administrador de la
    organización, que no existe aparte del dueño. La única salida sería entrar al dashboard de
    Supabase y borrar el factor por SQL. **[VERIFICADO]** (código) / **[INFERIDO]** (efecto).
  - Las cuentas de Vercel, Supabase, GitHub, Mercado Pago y Resend dependen del propietario; el
    equipo de Vercel ni siquiera es accesible para el asistente (403) y el remoto `origin` da 403.
    No consta que haya un segundo owner en la organización de Supabase (la propia guía de producción
    de Supabase lo recomienda: «Consider adding multiple owners on your Supabase org»).
    **[NO VERIFICADO]**
  - No existe un documento para que un tercero opere (inventario de cuentas, dónde están los
    secretos, a quién llamar, qué hacer primero).
- **Impacto.** Si el propietario no está disponible (viaje, enfermedad, celular perdido), nadie puede
  atender un incidente de pagos, restaurar, rotar una clave comprometida ni responder a un cliente
  desde el panel.
- **Recomendación.** (1) Segundo owner (persona de confianza) en Supabase, Vercel y GitHub, con MFA.
  (2) Gestor de contraseñas con acceso de emergencia (p. ej. el «emergency access» de Bitwarden o
  1Password). (3) Segundo `platform_owner` o `platform_admin`. (4) Respaldo del TOTP (segunda app
  o llave física). (5) `runbooks/operador-de-emergencia.md`: inventario de cuentas, contactos de
  soporte y los 5 primeros pasos ante cada incidente.

### OPS-11 · Media · Jobs muertos: sin pantalla, sin reintento manual y sin aviso

- **Evidencia.** No hay función ni pantalla para ver o re-encolar jobs `dead` (búsqueda
  `requeue|retry` en migraciones y `src/`: sin resultados). La consola `/platform` solo tiene
  organizaciones, cumplimiento y soporte. Un correo de pedido o un reembolso que muere tras 8 intentos
  (1, 2, 4… 64 min; `20261005000300_foundation_jobs_and_settings.sql:210-235`) queda así para
  siempre. **[VERIFICADO]**
- **Recomendación.** Vista de cola en la consola de plataforma (pendientes, muertos por tipo, último
  error redactado) y acción auditada «reintentar».

### OPS-12 · Media · Caída de Resend: correos de pedido mueren en ~2 h, el aviso al staff usa el mismo canal y los compradores no pueden entrar con código

- **Evidencia.**
  - Los correos van por jobs: 429/5xx se reintentan, 4xx es permanente
    (`src/server/notifications/channels.ts:15-20`). Con 8 intentos el job muere tras ~2 h de caída
    (suma 1+2+4+…+64 min) sin aviso (OPS-11). **[INFERIDO]**
  - El aviso «pedido en atención» al staff también sale por Resend
    (`src/server/notifications/order-handlers.ts:262`): si Resend cae, la alerta tampoco llega.
    **[VERIFICADO]**
  - El `fetch` a Resend no tiene `AbortSignal.timeout` (los de Mercado Pago, Stripe y dominios sí,
    10 s). En el Send Email Hook de Auth un Resend lento puede hacer fallar el envío del código.
    **[VERIFICADO]** (código).
  - Acceso: el panel admite contraseña (`src/app/(acceso)/actions.ts:105`) y en staging los 4
    usuarios tienen contraseña (SELECT), así que el dueño **sí** puede entrar al panel si Resend cae.
    Los compradores entran a «Mi cuenta» con código por correo
    (`database-roles.md` §3), así que no podrían; la compra como invitado no depende del correo.
    **[INFERIDO]**
- **Recomendación.** Timeout de 10 s en Resend; `max_attempts` mayor (o reintento manual) para
  correos de pedido; alertas por un canal distinto (push del monitor, Sentry); runbook «caída de
  correo».

### OPS-13 · Media · Caída de Mercado Pago y de Supabase: manejo correcto en código, pero sin modo degradado ni comunicación

- **Evidencia.**
  - Mercado Pago: si la consulta del pago falla en el webhook, el evento queda sin `processed_at` y
    se responde 500 para que Mercado Pago reintente (`src/server/payments/mercadopago-webhook.ts:121-127`,
    `system.finish_payment_event`). La reconciliación por referencia cubre webhooks perdidos (solo si
    corre el cron, OPS-01). Si Mercado Pago cae al iniciar el checkout, el comprador ve un error y
    las existencias quedan reservadas hasta que expire el pedido. **[VERIFICADO]** (código).
  - Supabase caído: la tienda depende de `storefront_gateway` para todo; no hay página de
    mantenimiento ni aviso a compradores; las páginas en la caché de datos de Next podrían seguir
    mostrándose, pero el checkout no funciona. **[INFERIDO]**
  - Vercel caído: no hay plan alterno (aceptable a esta escala), pero tampoco página de estado.
- **Recomendación.** Runbook «incidente de pagos» (cómo revisar pagos `pending`, forzar
  reconciliación, reembolsar duplicados) y «caída de proveedor» (qué esperar, qué comunicar por
  WhatsApp/redes, cuándo pausar la tienda).

### OPS-14 · Media · Faltan la mayoría de los runbooks necesarios

| Runbook                                                                                | Estado                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles de base, alta de plataforma, rotación `system_worker`                            | Existe (`database-roles.md`), parcial: no cubre `storefront_gateway`, `CRON_SECRET`, `JOBS_HMAC_SECRET`, `ORDER_LINK_SECRET`, `PREVIEW_HMAC_SECRET`, `SEND_EMAIL_HOOK_SECRET` ni claves de MP/Resend |
| Mercado Pago (configuración y prueba)                                                  | Existe (`mercadopago.md`); no cubre incidentes                                                                                                                                                       |
| Stack local                                                                            | Existe (`local-stack.md`)                                                                                                                                                                            |
| Despliegue y reversa                                                                   | **Falta**                                                                                                                                                                                            |
| Restauración (incluye roles y Storage)                                                 | **Falta**                                                                                                                                                                                            |
| Rotación de todas las claves (incluye sospecha de fuga)                                | **Falta**                                                                                                                                                                                            |
| Incidente de pagos (webhook caído, doble cobro, pago sin confirmar)                    | **Falta**                                                                                                                                                                                            |
| Incidente de seguridad (cuenta comprometida, fuga de datos, aviso a titulares LFPDPPP) | **Falta**                                                                                                                                                                                            |
| Caída de correo                                                                        | **Falta**                                                                                                                                                                                            |
| Operador de emergencia (tercero)                                                       | **Falta**                                                                                                                                                                                            |
| Cola atascada / jobs muertos                                                           | **Falta**                                                                                                                                                                                            |

**[VERIFICADO]**. Recomendación: escribirlos en formato de lista corta que se pueda seguir desde el
celular; lo legal (aviso a titulares) es orientación informativa: validar con abogado o asesor
regulatorio.

### OPS-15 · Media · Los errores de páginas y acciones del servidor no pasan por el logger estructurado

- **Evidencia.** No existe `src/instrumentation.ts` (`onRequestError`) ni `app/global-error.tsx`; los
  `error.tsx` solo muestran el `digest` al usuario. Los errores no capturados en Server Components y
  Server Actions los imprime Next por su cuenta, sin `request_id` ni la redacción de
  `src/server/observability/redact.ts`. Las rutas `/api/*` sí usan el logger. **[INFERIDO]**
- **Impacto.** Los errores más comunes del panel no se pueden correlacionar con un `request_id` y
  podrían escribir datos personales en el log.
- **Recomendación.** `instrumentation.ts` con `onRequestError` que use `log.error` (y Sentry).

### OPS-16 · Baja · CI: acciones fijadas por etiqueta, aviso de Node 20 y duración

- **Evidencia.** `.github/workflows/ci.yml` usa `actions/checkout@v4`, `setup-node@v4`,
  `pnpm/action-setup@v4`, `upload-artifact@v4`, `gitleaks/gitleaks-action@v2` por etiqueta, no por
  SHA. Anotación del run 40477420785: «Node.js 20 is deprecated […] forced to run on Node.js 24».
  Duración de las últimas corridas completas: 12-26 min; el job «Stack local + E2E» es el más largo
  (~18 min). E2E **sí** corre en CI. **[VERIFICADO]**
- **Recomendación.** Fijar por SHA (con Dependabot para actualizarlas) y subir a las versiones con
  Node 24.

### OPS-17 · Baja · `system.purge_finished_jobs` nunca se programa

- **Evidencia.** Solo se define (`20261005000300_foundation_jobs_and_settings.sql:250`); ninguna
  migración, job ni ruta la llama. `database-roles.md` §6 dice «se programará en la Fase 2».
  **[VERIFICADO]**
- **Recomendación.** Añadirla a `enqueue_maintenance` (diaria).

### OPS-18 · Baja · La redacción del logger no cubre teléfonos ni nombres en texto libre

- **Evidencia.** `src/server/observability/redact.ts`: por clave cubre `phone`, `address`, `email`,
  etc.; dentro de textos solo detecta URL con credenciales, Bearer, JWT y correos. Un teléfono o
  nombre incrustado en un mensaje de error pasa tal cual. **[VERIFICADO]**
- **Recomendación.** Patrón para teléfonos de 10+ dígitos; mantener la regla de no interpolar PII en
  mensajes.

### OPS-19 · Baja · Staging en plan gratuito puede pausarse por inactividad

- **Evidencia.** Guía de producción de Supabase (2026-10-27): «We may pause applications on the Free
  Plan that exhibit low activity in a 7-day period». La vista previa es lo que el propietario usa
  para revisar. **[VERIFICADO]** (doc).
- **Recomendación.** Saberlo y tener el paso de reactivación en el runbook; no aplica a producción
  en Pro.

---

## Controles verificados (no son hallazgos)

- **Logger y redacción**: JSON una línea por evento, redacción recursiva por clave y por patrón
  (credenciales en URL, Bearer, JWT, correo), límites de profundidad y longitud, `Error` serializado
  sin cuerpo; con pruebas (`logger.test.ts`, `redact.test.ts`). **[VERIFICADO]**
- **request_id**: el proxy siempre lo sobrescribe; `requestIdFrom` solo acepta UUID; la cabecera
  original de Mercado Pago se preserva aparte para la firma (`request-id.ts`). **[VERIFICADO]**
- **Errores públicos**: `toErrorEnvelope` nunca filtra detalles internos e incluye `request_id`
  (`src/server/errors.ts`). **[VERIFICADO]**
- **Cola**: `FOR UPDATE SKIP LOCKED`, reintentos con espera exponencial 1→64 min y 8 intentos,
  recuperación de jobs `running` abandonados (bloqueo de 300 s), error redactado y truncado, el
  fallo de un job no detiene el lote, aplazamiento por plazo de la función. **[VERIFICADO]**
- **Webhook de Mercado Pago**: firma verificada, eventos idempotentes por
  `(payment_account_id, provider_event_id)`, un fallo deja el evento sin procesar y responde 500
  para que el proveedor reintente; re-consulta del pago al proveedor; rechazos registrados.
  **[VERIFICADO]** (código).
- **Timeouts de red**: Mercado Pago, Stripe y Vercel Domains con `AbortSignal.timeout(10_000)`.
  **[VERIFICADO]**
- **Migraciones**: forward-only con checksum sha256, se detiene si una aplicada cambió, cada archivo
  en su transacción, nunca imprime la conexión (`migrate.mjs`). Staging tiene 120/120 aplicadas
  (línea base). **[VERIFICADO]**
- **Aviso de versión de esquema** en el panel cuando la base está atrasada. **[VERIFICADO]**
- **Health**: `/api/health` (liveness) y `/api/health/ready` (readiness con el rol `system_worker`,
  timeout de 3 s, respuesta pública solo ok/degraded). **[VERIFICADO]**
- **Configuración incompleta visible**: `configIssues()` avisa en el panel si falta la clave de
  Storage o el correo es simulado (`src/server/system/health.ts`). **[VERIFICADO]**
- **Arranque seguro**: las variables de Mercado Pago van juntas o la app no arranca
  (`docs/runbooks/mercadopago.md`); producción exige Resend y la clave de servicio. **[INFERIDO]**
  (descrito; validado en `env.ts` según PLAN-LANZAMIENTO).
- **CI**: 4 jobs en cada push (lint/formato/tipos/unit/build; migraciones + pgTAP + integración;
  stack real + `test:stack` + E2E Playwright; gitleaks sobre todo el historial), con
  `cancel-in-progress` y `permissions: contents: read`. **[VERIFICADO]**

---

## Tareas propuestas (en orden)

| #   | Tarea                                                                                                                                | Hallazgos                 | Esfuerzo        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | --------------- |
| 1   | Diagnosticar el cron de staging; en producción, cron cada minuto (Vercel Pro o pg_cron + HMAC)                                       | OPS-01                    | S               |
| 2   | Readiness con «última pasada de mantenimiento», jobs muertos, pagos vencidos y Storage                                               | OPS-01, OPS-03            | S               |
| 3   | Sentry + `instrumentation.ts` + monitor externo con aviso al celular                                                                 | OPS-02, OPS-15            | M               |
| 4   | Proteger la rama por defecto con checks requeridos; Vercel espera a la CI; corregir formato                                          | OPS-07                    | S               |
| 5   | Segundo owner en Supabase/Vercel/GitHub, gestor de contraseñas con acceso de emergencia, respaldo TOTP                               | OPS-10                    | S (propietario) |
| 6   | Producción en Pro; decidir PITR; `pg_dump` diario externo; copia de Storage                                                          | OPS-04, OPS-06            | M               |
| 7   | Runbooks: restauración (con roles), despliegue y reversa, rotación de claves, pagos, seguridad, correo, operador de emergencia, cola | OPS-05, OPS-09, OPS-12-14 | M               |
| 8   | Simulacro de restauración en proyecto aparte, midiendo el RTO real                                                                   | OPS-04                    | S               |
| 9   | Pantalla «Estado del sistema» y reintento auditado de jobs muertos                                                                   | OPS-11                    | M               |
| 10  | Candado consultivo en `migrate.mjs`; variable solo en Production; prueba N−1 contra esquema N                                        | OPS-08, OPS-09            | M               |
| 11  | Timeout en Resend; alertas fuera de Resend                                                                                           | OPS-12                    | S               |
| 12  | Higiene: purga de jobs, redacción de teléfonos, acciones por SHA                                                                     | OPS-16-18                 | S               |

---

## Qué no se pudo verificar

- **Vercel** (403): variables (`MIGRATION_DATABASE_URL`, `CRON_SECRET`), ejecuciones del cron, logs
  y su retención, si los despliegues esperan a la CI, plan exacto, miembros del equipo.
- **Organización de Supabase**: número de owners y MFA de las cuentas (sin acceso al dashboard).
- **GitHub**: colaboradores del repositorio (el proxy niega esa ruta de la API) y logs completos del
  job fallido (403 al descargar; el paso fallido sí se vio por la API de checks).
- **Servicios reales** de Mercado Pago y Resend: el comportamiento ante caídas se dedujo del código.
- Documentación de Supabase y Vercel leída mediante sus buscadores oficiales de documentación (el
  contenedor no resuelve `supabase.com` ni `vercel.com` directamente).
