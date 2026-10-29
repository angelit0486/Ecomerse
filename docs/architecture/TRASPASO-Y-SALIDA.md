# Traspaso del proyecto y plan de salida (2026-10-29)

Para que otro ingeniero retome PRUVA sin depender de una sola persona, y para salir de Vercel o Supabase si hiciera falta.

## 1. Cómo retomar el proyecto en un día

| Paso | Qué leer o hacer                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| 1    | `CLAUDE.md`: reglas de no regresión, comandos y mapa del código                                                       |
| 2    | `docs/architecture/GATE0-ARCHITECTURE-REVIEW.md`: contrato técnico (§43 contratos críticos, §44 reglas)               |
| 3    | `docs/DECISIONS.md`: por qué es como es (ADR-001 a ADR-054)                                                           |
| 4    | `docs/plan/PROGRESS.md`: estado actual y bloqueos                                                                     |
| 5    | `docs/runbooks/local-stack.md`: `pnpm install`, `pnpm stack up`, `pnpm dev`. Sin Docker; los binarios se fijan con sha256 |
| 6    | `pnpm verify`, `pnpm db:test` y `pnpm exec playwright test`: deben quedar en verde antes de tocar nada               |
| 7    | `docs/runbooks/despliegue-y-rollback.md`, `pagos.md`, `rotacion-de-claves.md`, `respaldos.md`                         |

### Piezas del sistema

- **Aplicación:**
  - Next.js 16 (App Router).
  - Un solo despliegue sirve panel, consola y todas las tiendas (por `Host`).
  - El proxy (`src/proxy.ts`) resuelve la tienda y firma la ruta.
- **Base de datos:**
  - PostgreSQL 17 con RLS forzado.
  - Toda regla de negocio crítica vive en funciones SQL (precios, inventario, pedidos, pagos).
  - Las migraciones son forward-only, en `supabase/migrations/`.
- **Roles de base:**
  - `authenticated` (panel), vía PostgREST;
  - `storefront_gateway` (tienda) y `system_worker` (cola), por conexión directa;
  - `service_role` solo para Auth y Storage Admin.
- **Cola:** tabla `system.jobs` procesada por `/api/jobs/run` (cron de Vercel y disparo inmediato).
- **Proveedores:**
  - Mercado Pago y Stripe (pagos);
  - Resend (correo);
  - Supabase Auth y Storage;
  - Vercel (hosting y dominios).

### Cuentas y accesos que hay que traspasar

| Servicio       | Cuenta hoy                                   | Qué se necesita                                                                 |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| GitHub         | `angelit0486/Ecomerse` y `angelii33/pruva`   | Unificar en una organización del propietario (R-18) e invitar al nuevo ingeniero |
| Vercel         | equipo `angelit0486s-projects`               | Rol de miembro para el ingeniero; el propietario sigue como dueño               |
| Supabase       | organización `fczpcrhwmbrposilltog`          | Miembro con rol Developer; nunca compartir la contraseña de la base             |
| Mercado Pago, Stripe, Resend | del propietario                  | Acceso de solo lectura cuando haga falta; las claves viven solo en Vercel      |

## 2. Plan de salida (lock-in)

| Dependencia      | Qué es propietario de ese proveedor                                    | Cómo salir                                                                                                                                                                                                                                                                        | Esfuerzo estimado |
| ---------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **Supabase**     | Auth (GoTrue), Storage, PostgREST y el panel; la base es PostgreSQL normal | La base se lleva con `pg_dump`, más los roles de `scripts/db/local-roles.sql`. Auth, Storage y PostgREST son de código abierto: el stack local (`scripts/dev/stack.sh`) ya los corre **sin** Supabase. Destino posible: PostgreSQL administrado más esos tres servicios en contenedores | 1–2 semanas       |
| **Vercel**       | Hosting de Next.js, cron, dominios automáticos (`VERCEL_DOMAINS_TOKEN`)  | Next.js corre con `pnpm build && pnpm start` en cualquier servidor Node 22 (el CI ya lo hace). El cron pasa a un programador externo que llame `/api/jobs/run` con `CRON_SECRET`. Los dominios propios pasan a otro proveedor de certificados (el adaptador está en `src/server/domains/provider.ts`) | 1 semana          |
| **Resend**       | Envío de correo                                                         | Canal detrás de `EmailChannel` (`src/server/notifications/channels.ts`): otro proveedor es un adaptador nuevo                                                                                                                                                                      | 1–2 días          |
| **Mercado Pago / Stripe** | Cobros                                                        | Adaptadores detrás de `PaymentProvider`; ADR-051 evalúa un tercero                                                                                                                                                                                                                 | 2–3 semanas por proveedor |

### Ensayo

El CI corre en cada push la app completa contra el stack local, sin Supabase alojado ni Vercel. Esa es la prueba de que se puede salir: el sistema funciona fuera de ambos proveedores.
