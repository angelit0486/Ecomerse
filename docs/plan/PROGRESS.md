# Progreso del modo autónomo

> Memoria entre sesiones. Se lee al empezar y se actualiza **después de cada tarea**.
> Estados: `pendiente` · `en curso` · `hecha` · `bloqueada`. IDs y detalle: `docs/plan/AUTONOMOUS_PLAN.md` §4.
> Historial completo hasta el 2026-10-28 (84 KB): `docs/plan/archive/PROGRESS-hasta-2026-10-28.md`.

## Ahora: misión «vendible» (2026-10-28)

Objetivo: (A) vender la plataforma y (B) vender tiendas como servicio. Fases 0–7; estado real en `docs/plan/ESTADO-2026-10-28.md`.

| Paso  | Qué                                                        | Estado                                         | Evidencia                                                                                                                                                                   |
| ----- | ---------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F0    | Estado real                                                | hecha                                          | `02c7641`; verify 979 ×2, pgTAP 2,421 ×2, integración 360 ×2, E2E 103/103 ×2; CI corrida 108 verde                                                                          |
| F1.1  | CI en verde                                                | hecha                                          | gitleaks con valores de prueba de baja entropía (`02c7641`)                                                                                                                 |
| F1.2  | Migraciones en staging / `MIGRATION_DATABASE_URL`          | bloqueada (propietario)                        | 8 migraciones pendientes: `docs/runbooks/migraciones-2026-10-27.md`                                                                                                         |
| F1.3  | Resend + Send Email Hook                                   | guía lista; bloqueada (propietario)            | `docs/runbooks/correo-resend.md` (dominio, SPF/DKIM/DMARC, clave, Vercel, hook de Supabase, comprobación)                                                                   |
| F1.4  | Escenarios de Mercado Pago                                 | 14 de 15 cubiertos [SIMULADOR]; real pendiente | `docs/runbooks/mercadopago-escenarios.md`. Hallazgo: contracargo y reembolso desde Mercado Pago se ignoran → **ADR-043 propuesto**                                          |
| F1.5  | Correo de confirmación con la dirección completa           | hecha                                          | `4b85dd7`; migración `20261028000300`, pgTAP 33 (+2), unitarias de plantilla (+2)                                                                                           |
| F1.6  | Salud de la plataforma y alertas                           | hecha                                          | Migración `20261028000400`, pgTAP 105, integración `platform-health`, unitarias, E2E `platform.spec` (Salud)                                                                |
| F1.7  | Respaldos con restauración probada, RTO/RPO                | hecha en local; Pro/PITR (propietario)         | `scripts/ops/restore-drill.sh` ×2 correcto (8 s, 147,865 filas); `docs/runbooks/respaldos.md`. Staging en plan Free: **sin respaldos automáticos**                          |
| F1.8  | Monitoreo (Sentry)                                         | pendiente (DSN del propietario)                |                                                                                                                                                                             |
| F1.9  | Seguridad: CSP, límites, Origin, 2FA, revisión adversarial | hecha en lo que no depende del propietario     | `docs/phases/VENDIBLE-F1.9-SEGURIDAD.md`: SEC-04, 07, 08, 09, 10 y CSRF de `/salir` corregidos; migración `20261028000500`; abiertos SEC-02 (ADR), 03, 05, 13 (propietario) |
| F1.10 | Política de categorías prohibidas y Términos               | **ADR-042 propuesto**; borrador legal          | `docs/legal/politica-de-contenido.md` (PENDIENTE DE REVISIÓN); espera aprobación                                                                                            |

### F1.6 en detalle

- `system.platform_health()`: cola (trabajo listo más antiguo, atorados, fallidos 24 h por tipo), pagos (avisos, errores, rechazos de firma, abiertos > 2 h), correos y pedidos 24 h. Solo conteos.
- Consola → **Salud** (`/platform/salud`) para dueño, administración y soporte.
- Trabajo `platform.health_check` cada 15 min: un correo por problema, destinatario y hora a dueño y administración activos (soporte no). Runbook: `docs/runbooks/salud-y-alertas.md`.

## Hecho justo antes de la misión (2026-10-27/28)

- **Panel y tienda más profesionales:** pasos 0–19 menos 20; migraciones `20261027000100` (Consola → Trabajos), `000200` (importar solo lo válido, ADR-040), `000300` (fotos con `srcset`).
- **Fase 10:** Consola → Planes, ficha de organización con suscripción y excepciones, «Plan y uso» en el panel, avance automático de estados. Migración `20261028000100`, pgTAP 103, E2E `plans.spec`.
- **ADR-041:** cada comercio cobra en su propia cuenta de Mercado Pago (OAuth con PKCE, llaves cifradas). Migración `20261028000200`, pgTAP 104. Falta: migración en staging, tres variables en Vercel y prueba con la aplicación real.

## Bloqueos (requieren al propietario)

| ID  | Bloqueo                                                                     | Efecto                                                      |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| B1  | Aplicar 8 migraciones en staging o configurar `MIGRATION_DATABASE_URL`      | Pantallas nuevas no cargan en staging                       |
| B2  | Autorizar el conector de Vercel (equipo `angelit0486s-projects`)            | No se pueden leer variables, despliegues ni logs            |
| B3  | Resend: API key y dominio con SPF/DKIM/DMARC                                | No salen correos ni alertas en staging                      |
| B4  | Credenciales de Mercado Pago (aplicación de prueba)                         | Pagos solo probados con API simulada                        |
| B5  | `angelii33/pruva` responde 403; el trabajo se sube a `angelit0486/Ecomerse` | Aclarar la propiedad del código antes de vender (data room) |
| B6  | Pasar Supabase a Pro (+ PITR antes del primer comercio de pago)             | Hoy no hay respaldos automáticos de staging                 |
| R0  | Reglas y leyendas sanitarias de suplementos (asesor regulatorio)            | El perfil de México nace `pending` y bloquea la publicación |

## Verificaciones pendientes con servicios reales

- Supabase Auth alojado (recovery, Send Email Hook); toda la batería pgTAP contra el proyecto real.
- Storage alojado: vigencia de URL firmada y costo de transformaciones.
- Mercado Pago, Resend, dominios propios: [NO VERIFICADO] hasta tener credenciales.

## Entorno

- Tras reiniciar el contenedor: `pg_ctlcluster 16 main start`; `bash scripts/dev/stack.sh up`; `pnpm build` y `pnpm start -H localhost -p 3000` con `.env.local` y `stack.sh env`.
- Push: remoto `angelit0486/Ecomerse`, rama `claude/ecommerce-regulated-platform-41vu1e`.
- E2E: con la app levantada, `pnpm exec playwright test`. La primera prueba justo después de reiniciar el stack puede fallar por arranque en frío de Auth; se repite la corrida completa, no la prueba.

## Pendientes menores registrados

- Aviso al dueño de suspensión/reactivación de tenant (D-F2-20) y de transferencia de propiedad (D-F2-16).
- Endurecer con `is distinct from` las comparaciones `<> 'org_owner'` de la migración de equipo (D-F2-18).
