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
| F1.2  | Migraciones en staging / `MIGRATION_DATABASE_URL`          | hecha (manual con sha256)                      | staging al día (17 aplicadas el 2026-10-29); método: `database-roles.md` §7                                                                                                        |
| F1.3  | Resend + Send Email Hook                                   | guía lista; bloqueada (propietario)            | `docs/runbooks/correo-resend.md` (dominio, SPF/DKIM/DMARC, clave, Vercel, hook de Supabase, comprobación)                                                                   |
| F1.4  | Escenarios de Mercado Pago                                 | 15 de 15 cubiertos [SIMULADOR]; real pendiente | `docs/runbooks/mercadopago-escenarios.md`; ADR-043 (contracargos) aprobado e implementado, migración `20261029000100`, pgTAP 106                                            |
| F1.5  | Correo de confirmación con la dirección completa           | hecha                                          | `4b85dd7`; migración `20261028000300`, pgTAP 33 (+2), unitarias de plantilla (+2)                                                                                           |
| F1.6  | Salud de la plataforma y alertas                           | hecha                                          | Migración `20261028000400`, pgTAP 105, integración `platform-health`, unitarias, E2E `platform.spec` (Salud)                                                                |
| F1.7  | Respaldos con restauración probada, RTO/RPO                | hecha en local; Pro/PITR (propietario)         | `scripts/ops/restore-drill.sh` ×2 correcto (8 s, 147,865 filas); `docs/runbooks/respaldos.md`. Staging en plan Free: **sin respaldos automáticos**                          |
| F1.8  | Monitoreo (Sentry)                                         | pendiente (DSN del propietario)                |                                                                                                                                                                             |
| F1.9  | Seguridad: CSP, límites, Origin, 2FA, revisión adversarial | hecha en lo que no depende del propietario     | `docs/phases/VENDIBLE-F1.9-SEGURIDAD.md`: SEC-04, 07, 08, 09, 10 y CSRF de `/salir` corregidos; migración `20261028000500`; abiertos SEC-02 (ADR), 03, 05, 13 (propietario) |
| F1.10 | Política de categorías prohibidas y Términos               | aplazada por el propietario (2026-10-29)       | ADR-042 aplazado; borrador `docs/legal/politica-de-contenido.md` sin usar                                                                                                   |

### Fases 2 a 6 (2026-10-29)

Detalle archivado en `docs/plan/archive/PROGRESS-2026-10-28-a-29.md`. Informes: `docs/phases/VENDIBLE-FASE-2-INFORME.md`, `VENDIBLE-FASE-3-INFORME.md` y `VENDIBLE-FASE-4-INFORME.md`.

### Infraestructura (2026-10-29)

- Línea base: `docs/plan/LINEA-BASE-2026-10-29.md`. Todas las suites pasaron ×2 sin pruebas inestables.
- Staging al día:
  - 17 migraciones aplicadas con sha256 (hasta `20261029000900`);
  - 137 registradas, igual que el repo [VERIFICADO].
  - Pendiente: `20261029001000` (correo completo y rebotes) tras su push.
- Aviso de versión de esquema:
  - la tienda muestra «Tienda en mantenimiento»;
  - la consola avisa.
- Runbooks: `despliegue-y-rollback.md`, `rotacion-de-claves.md`.

### Comprar y pagar sin errores (2026-10-29) · en curso

- **Correo de confirmación completo:**
  - miniatura, presentación y precio unitario;
  - método de pago sin datos de la tarjeta;
  - entrega estimada y enlace «Seguir mi pedido».
- **La tienda recibe los mismos datos** y el enlace al panel.
- **Envío parcial:** correo distinto.
- **Correos que rebotan o se quejan quedan suprimidos:**
  - webhook de Resend con firma Svix [NO VERIFICADO contra Resend];
  - rechazo definitivo al enviar.
- Migración `20261029001000`, pgTAP 115.
- **Propuestos, esperan decisión** (DECISIONS §30):
  - ADR-050: aviso de pago pendiente;
  - ADR-051: respaldo si se suspende Mercado Pago;
  - ADR-052: fraude;
  - ADR-053: categorías bloqueadas.
- Runbook: `docs/runbooks/pagos.md`.
- Mercado Pago real y correo real: [NO VERIFICADO]. Faltan las credenciales de prueba y Resend.

## Bloqueos (requieren al propietario)

| ID  | Bloqueo                                                                     | Efecto                                                      |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| B1  | `MIGRATION_DATABASE_URL` en Vercel (opcional; hoy se migra a mano con sha256) | Cada migración nueva hay que aplicarla a mano               |
| B2  | Autorizar el conector de Vercel (equipo `angelit0486s-projects`)            | No se pueden leer variables, despliegues ni logs            |
| B3  | Resend: API key y dominio con SPF/DKIM/DMARC                                | No salen correos ni alertas en staging                      |
| B4  | Credenciales de prueba de Mercado Pago como secretos del entorno de la sesión | Pagos solo probados con API simulada                        |
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
