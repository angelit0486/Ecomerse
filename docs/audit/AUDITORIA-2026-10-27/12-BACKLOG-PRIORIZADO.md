# 12 · Backlog priorizado — 2026-10-27

Tareas **propuestas**: ninguna se implementó en esta auditoría, que fue de solo lectura.

**Escalas:**

- Impacto (I) y esfuerzo (E): **A**lto, **M**edio o **B**ajo.
- Esfuerzo B = 1 a 2 días; M = 3 a 7 días; A = más de 1 semana. Son estimaciones del auditor.
- Riesgo: lo que puede salir mal al hacer la tarea.
- Dependencia: lo que hace falta antes.
- **ADR?**: si toca un contrato crítico (GATE0 §43) o una decisión registrada, y por eso requiere una decisión aprobada.

El orden dentro de cada grupo es el orden sugerido.

## A. Bloqueadores de lanzamiento (sin esto no se vende)

| ID    | Tarea                                                                                                                                                                                                                        | Hallazgos                      | I   | E           | Riesgo                                        | Dependencia                                               | ADR?                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --- | ----------- | --------------------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| BL-01 | **Decidir y ejecutar** qué pasa con la tienda «demo» y sus 19 productos asociados con THC y vapeadores: despublicar o archivar, y consultar a un abogado                                                                     | EST-01, REG-01, DEP-01         | A   | B           | Ninguno técnico                               | 🧑 decisión del propietario                               | No                                        |
| BL-02 | Disparador confiable de la cola: cron por minuto (Vercel Pro, `pg_cron` + `pg_net` firmado, o cron externo) más `processQueueSoon` tras checkout y webhook. Prueba E2E de que vence una reserva y de que se concilia un pago | OPS-01, DIN-04, REN-02, DAT-01 | A   | M           | Doble ejecución (ya mitigada con SKIP LOCKED) | Plan de hosting (BL-05)                                   | Sí, si cambia el runner (GATE0 §43, jobs) |
| BL-03 | Regresar el perfil MX a `pending` en producción. Lista de términos prohibidos completa. Firma del asesor regulatorio                                                                                                         | REG-03, REG-04, EST-03         | A   | B (técnico) | Bloquea la publicación hasta la firma         | ⚖️ asesor                                                 | No                                        |
| BL-04 | Credenciales reales de Mercado Pago y prueba de pago, webhook, reembolso y contracargo en modo prueba. Decidir OXXO/SPEI frente a la reserva de 30 min                                                                       | DIN-02, DIN-07, REG-12         | A   | M           | Retención de fondos                           | 🧑 cuenta MP                                              | Sí (OXXO/SPEI: ADR nuevo)                 |
| BL-05 | Hosting de producción en planes comerciales: Vercel Pro y Supabase Pro con PITR                                                                                                                                              | DEP-03, DEP-04, OPS-04, REN-07 | A   | B           | Costo mensual: ver `05`                       | 🧑 pago                                                   | No                                        |
| BL-06 | Respaldos: simulacro de restauración documentado (incluye contraseñas de roles y Storage) y runbook                                                                                                                          | OPS-04, OPS-05, OPS-06         | A   | M           | —                                             | BL-05                                                     | No                                        |
| BL-07 | Monitoreo y alertas: Sentry o equivalente (`instrumentation.ts`, `onRequestError`), monitor externo de `/api/health/ready` (que vea la cola y los jobs muertos) y aviso al celular                                           | OPS-02, OPS-03, OPS-15         | A   | M           | Ruido de alertas                              | —                                                         | No                                        |
| BL-08 | Correo transaccional: Resend con dominio propio y SPF, DKIM y DMARC; timeout en la llamada                                                                                                                                   | OPS-12, DEP-05                 | A   | B           | Entregabilidad                                | 🧑 dominio                                                | No                                        |
| BL-09 | Aviso de privacidad enlazado en el checkout; exigir domicilio y teléfono para abrir la tienda; políticas de devolución con plazo                                                                                             | REG-07, REG-08, REG-09         | M   | B           | —                                             | ⚖️ textos                                                 | No                                        |
| BL-10 | CI en verde y rama protegida con los 4 checks; migraciones solo después del CI                                                                                                                                               | EST-09, OPS-07, ARQ-02, OPS-08 | A   | B           | —                                             | Autorización para corregir el formato de `ESTADO-CALIDAD` | No                                        |
| BL-11 | `payments.allow_fake = false` en producción, verificado en `/api/health/ready` y en el checklist                                                                                                                             | SEC-11, DIN-12                 | A   | B           | —                                             | —                                                         | No                                        |
| BL-12 | Proceso de facturación CFDI, aunque sea manual al inicio con un PAC o el portal del SAT                                                                                                                                      | REG-10, MER-08                 | M   | B (proceso) | —                                             | 🧑 contador                                               | No                                        |

## B. Seguridad

| ID    | Tarea                                                                                                                                        | Hallazgos      | I   | E                | ADR?                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --- | ---------------- | --------------------------------- |
| SG-01 | Política de uso aceptable aceptada al crear una tienda, más una lista de bloqueo de términos de bienes prohibidos para toda la plataforma    | REG-02, EST-02 | A   | M                | Sí (nuevo contrato de plataforma) |
| SG-02 | Metatest: toda función `SECURITY DEFINER` de `public` llama a una guarda. Prueba pgTAP de cruce de tienda A a tienda B con un comprador AAL2 | SEC-04         | A   | B                | No                                |
| SG-03 | Límite de intentos propio en el login por código (por email e IP)                                                                            | SEC-01         | M   | B                | No                                |
| SG-04 | Activar la protección contra contraseñas filtradas en Supabase Auth                                                                          | SEC-03         | M   | B (🧑, 1 minuto) | No                                |
| SG-05 | Vigencia o revocación del enlace de pedido de invitado                                                                                       | SEC-02         | B   | M                | Sí (GATE0 §16.5)                  |
| SG-06 | Límites de tasa en carrito, búsqueda y facetas; tope real de cuerpo en webhooks                                                              | SEC-05, SEC-07 | M   | B                | No                                |
| SG-07 | Redacción de logs: nombres, IP, `?t=`, teléfonos y tokens de invitación                                                                      | SEC-09, OPS-18 | M   | B                | No                                |
| SG-08 | Separar secretos por propósito (`ORDER_LINK_SECRET` y `PREVIEW_HMAC_SECRET`)                                                                 | SEC-13         | B   | B                | No                                |
| SG-09 | CSP con `report-to`; HSTS con preload cuando haya dominio propio                                                                             | SEC-12         | B   | B                | No                                |
| SG-10 | Metatest que exija `search_path = ''` exacto                                                                                                 | SEC-08         | B   | B                | No                                |

## C. Confiabilidad (dinero, datos y operación)

| ID    | Tarea                                                                                                                                                                               | Hallazgos                              | I   | E   | ADR?                               |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --- | --- | ---------------------------------- |
| CF-01 | Conciliar también los intentos de MP vencidos o cancelados de los últimos 7 días                                                                                                    | DIN-01                                 | A   | B   | No                                 |
| CF-02 | Manejar contracargos, disputas y reembolsos externos de MP (y Stripe): evento, alerta y bloqueo del surtido                                                                         | DIN-03                                 | A   | M   | Sí (GATE0 diferido en :2227)       |
| CF-03 | Avisar activamente al staff de cobros duplicados y montos distintos; reembolsar el cobro duplicado correcto                                                                         | DIN-05, DIN-08                         | M   | B   | No                                 |
| CF-04 | Job diario de mantenimiento de datos: purgar jobs, carritos y `security_events`, mantener particiones de auditoría y aplicar la retención de GATE0 §36.3                            | DAT-02, DAT-03, DAT-08, REN-04, OPS-17 | M   | B   | No                                 |
| CF-05 | Anonimizar también pedidos, carritos y `auth.users` (respetando la retención fiscal)                                                                                                | DAT-04                                 | M   | M   | Sí (snapshots inmutables, regla 9) |
| CF-06 | Pantalla de jobs muertos con reintento manual en la consola de plataforma                                                                                                           | OPS-11                                 | M   | B   | No                                 |
| CF-07 | Runbooks faltantes (8): despliegue y reversa, restauración, rotación de claves, incidente de pagos, incidente de seguridad, caída de correo, operador de emergencia y cola atascada | OPS-14, ARQ-05                         | A   | M   | No                                 |
| CF-08 | Acceso de emergencia: segundo administrador, códigos de recuperación y procedimiento si se pierde el celular                                                                        | OPS-10                                 | A   | B   | No                                 |
| CF-09 | Reembolso de «Cerrar no enviadas» con IVA y envío correctos                                                                                                                         | DIN-06                                 | M   | B   | No                                 |
| CF-10 | Hacer la prueba `brands.spec` independiente de la carga (esperar el job y no un tiempo fijo)                                                                                        | EST-07                                 | B   | B   | No                                 |

## D. Crecimiento

Para cada propuesta: supuestos de ingreso en `10`.

| ID    | Tarea                                                                                                     | Hallazgos              | I   | E   | ADR?                   |
| ----- | --------------------------------------------------------------------------------------------------------- | ---------------------- | --- | --- | ---------------------- |
| CR-01 | Variantes de imagen (AVIF/WebP en 3 a 4 tamaños) con `srcset` y `sizes`, antes de cargar el catálogo real | REN-01                 | A   | M   | No                     |
| CR-02 | `prefetch={false}` en enlaces masivos (reduce unas 5 veces las peticiones y el costo)                     | REN-03                 | M   | B   | No                     |
| CR-03 | Cotización de envío y guías (Skydropx o Envía); umbral de envío gratis basado en datos                    | OPO-01, MER-07, R-13   | A   | A   | Sí (envíos, GATE0 §43) |
| CR-04 | Recuperación de carritos abandonados (con consentimiento)                                                 | OPO-04, MER-06         | A   | M   | No                     |
| CR-05 | Recordatorio de recompra calculado con las porciones                                                      | OPO-05a                | A   | M   | No                     |
| CR-06 | Analítica de embudo propia (vista, carrito, checkout, pago)                                               | OPO-12                 | A   | M   | No                     |
| CR-07 | Meses sin intereses vía Mercado Pago                                                                      | MER-04                 | M   | B   | No                     |
| CR-08 | SaaS vendible: cobro de suscripción, registro público y Mercado Pago por tienda (OAuth)                   | MER-02, DEP-02, OPO-14 | A   | A   | Sí (ADR-028)           |
| CR-09 | Estado del pedido por WhatsApp (mensajes de utilidad)                                                     | OPO-03                 | M   | M   | No                     |
| CR-10 | CFDI automático (API de un PAC)                                                                           | OPO-02                 | M   | M   | No                     |
| CR-11 | Blog y guías para SEO de contenido                                                                        | MER-10, OPO-13         | M   | M   | No                     |
| CR-12 | «Avísame cuando haya inventario»                                                                          | MER-06                 | M   | B   | No                     |

## E. Deuda técnica

| ID    | Tarea                                                                                                   | Hallazgos              | I   | E   |
| ----- | ------------------------------------------------------------------------------------------------------- | ---------------------- | --- | --- |
| DT-01 | README raíz y PROGRESS.md al día (quitar bloqueos viejos); snapshot `schema.sql` generado en CI         | ARQ-01, ARQ-05, EST-05 | M   | B   |
| DT-02 | Unos 12 índices de FKs calientes con `create index concurrently`                                        | DAT-05                 | M   | B   |
| DT-03 | Cobertura medida (`@vitest/coverage-v8`, dependencia nueva con justificación) y E2E de pago y reembolso | ARQ-04                 | M   | B   |
| DT-04 | Mover el acceso a datos de `src/app` a `src/server`; dividir `home-editor.tsx` (1,925 líneas)           | ARQ-03                 | M   | A   |
| DT-05 | CLS de la portada del panel (fuente Inter)                                                              | REN-06                 | B   | B   |
| DT-06 | Limpiar tablas auxiliares `supabase_migrations.pruva_*` en staging                                      | EST-06                 | B   | B   |
| DT-07 | Fijar las acciones de CI por SHA y subir a Node 22 en CI                                                | OPS-16                 | B   | B   |
| DT-08 | Prueba de `app_schema_version` contra la última migración                                               | ARQ-10                 | B   | B   |
| DT-09 | Caché con claves acotadas en búsqueda y filtros                                                         | REN-05                 | B   | B   |
