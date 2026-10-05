# Gate 1 — Informe de cierre: Fase 0 (cierre) + Fase 1 (Foundation)

**Fecha:** 2026-10-05 · **Rama:** `claude/ecommerce-regulated-platform-41vu1e`
**Contrato:** `docs/architecture/GATE0-ARCHITECTURE-REVIEW.md` §38 (PHASE 0 y PHASE 1)

## Alcance de Gate 1

1. **Cierre de la Fase 0:** el contrato técnico aprobado entra al repositorio (`/docs`, `CLAUDE.md`, registro de decisiones).
2. **Fase 1 — Foundation:** proyecto ejecutable, seguro por defecto, con CI e infraestructura transversal (cola de jobs, roles de mínimo privilegio, observabilidad, cabeceras de seguridad, design tokens).

No se implementó nada de la Fase 2 (auth, organizaciones, tiendas, RBAC) ni de fases posteriores.

## 1. Cambios realizados

**Fase 0**

- Contrato aprobado y planeación v0.1 versionados en `docs/architecture/` (copias exactas de lo revisado).
- `docs/DECISIONS.md`: aprobación del propietario (Q-B1…Q-B5), notas de interpretación N-1…N-4, 14 decisiones de implementación D-F1-xx y estado de los spikes.
- `CLAUDE.md`: comandos, mapa del código y reglas de no regresión.
- `docs/README.md`: índice por tema (sustituye a los 19 documentos del Anexo A, D-F1-14).

**Fase 1**

- **Proyecto:** Next.js 16.3.8 (App Router), React 19.3, TypeScript 6.0.3 estricto (`noUncheckedIndexedAccess`), Tailwind 4.3, pnpm 10 con versiones exactas fijadas, Node 22 (`.nvmrc` + `engines`).
- **Calidad:** ESLint 9 (Next + TypeScript) con reglas de límites de seguridad (`postgres` solo en `src/server/db`, `server/privileged` restringido, `react/no-danger`), Prettier y `pnpm verify`.
- **Entorno:** `src/config/env.ts` (Zod). **El build falla** si falta o es inválida una variable, y los mensajes nunca muestran valores (verificado).
- **Base de datos (3 migraciones):**
  - Esquemas internos no expuestos: `app`, `audit`, `private`, `storefront`, `system`.
  - Se revocan los privilegios por defecto permisivos de Supabase: `anon` sin grants, `service_role` sin acceso a tablas, `EXECUTE` revocado a `PUBLIC`.
  - Roles `storefront_gateway` y `system_worker` sin LOGIN, sin grants de tabla y con `statement_timeout`.
  - Auxiliares: `app.uuid_v7()` (solo funciones nativas), `set_updated_at`, `prevent_tenant_change`, `forbid_mutation`.
  - `public.platform_settings` y cola `system.jobs`: dedupe, `SKIP LOCKED`, backoff de 1 a 64 min, dead-letter, recuperación de bloqueos vencidos y `health_check`.
- **Servidor:**
  - Logger JSON con redacción (claves sensibles, emails, Bearer, JWT, credenciales en URLs).
  - Errores tipados con formato estable.
  - `request_id` propio por request.
  - `safeRedirect`, HMAC con tolerancia anti-replay y comparación en tiempo constante.
- **Proxy (`src/proxy.ts`):** CSP con nonce por request + `strict-dynamic`, HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` y COOP.
- **Jobs:** runner con plazo máximo, registro de handlers, `PermanentJobError`, errores redactados. `/api/jobs/run` autoriza por Vercel Cron (Bearer) o por firma HMAC.
- **Health:** `/api/health` (liveness) y `/api/health/ready` (base de datos con `system_worker` + retraso de la cola; respuesta pública sin detalles).
- **UI:** tokens del panel con contraste AA verificado por prueba; primitivas `Button`, `Field`, `Input`, `Skeleton` y `EmptyState`; layout dinámico (nonce); página provisional.
- **Infraestructura del repositorio:**
  - CI con 3 jobs: verify, base de datos y escaneo de secretos.
  - `CODEOWNERS` en las zonas de seguridad.
  - `vercel.json` con Vercel Cron cada minuto.
  - `.gitignore` y `.env.example`.

## 2. Archivos

| Área                     | Archivos                                                                                                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuración            | `package.json`, `pnpm-lock.yaml`, `.nvmrc`, `.gitignore`, `.env.example`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `postcss.config.mjs`, `vitest.config.mts`, `vercel.json`                                                 |
| Supabase                 | `supabase/config.toml` (generado con la CLI 2.119.0; `project_id = "pruva"`), `supabase/migrations/2026100500{01,02,03}00_*.sql`, `supabase/tests/database/0{0,1,2}_*.test.sql`                                                                                                   |
| Scripts de base de datos | `scripts/db/test.sh`, `scripts/db/supabase-shim.sql` (solo pruebas), `scripts/db/local-roles.sql` (solo local/CI)                                                                                                                                                                 |
| Servidor                 | `src/config/env.ts`, `src/server/{env,errors}.ts`, `src/server/observability/{logger,redact,request-id}.ts`, `src/server/security/{headers,hmac,safe-redirect}.ts`, `src/server/db/role-clients.ts`, `src/server/jobs/{types,store,runner,registry,authorize}.ts`, `src/proxy.ts` |
| Rutas                    | `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/app/api/health/route.ts`, `src/app/api/health/ready/route.ts`, `src/app/api/jobs/run/route.ts`                                                                                                              |
| UI                       | `src/ui/tokens.css`, `src/ui/primitives/{button,field,input,skeleton,empty-state}.tsx`, `src/lib/cn.ts`, `src/lib/color/contrast.ts`                                                                                                                                              |
| Pruebas                  | 13 archivos unitarios (`src/**/*.test.ts(x)`, `tests/unit/`), `tests/integration/jobs.test.ts`, `tests/support/server-only-stub.ts`                                                                                                                                               |
| CI y propiedad           | `.github/workflows/ci.yml`, `.github/CODEOWNERS`                                                                                                                                                                                                                                  |
| Documentación            | `CLAUDE.md`, `docs/README.md`, `docs/DECISIONS.md`, `docs/runbooks/database-roles.md`, `docs/architecture/{GATE0-ARCHITECTURE-REVIEW,BLUEPRINT-v0.1}.md`, este informe                                                                                                            |

No se modificó `CAMBIOS-FASE-1-2.md` (archivo de otro proyecto).

## 3. Migraciones

| Migración                                         | Contenido                                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `20261005000100_foundation_schemas_and_roles.sql` | Esquemas internos; revocación de privilegios por defecto; roles `storefront_gateway` y `system_worker` (NOLOGIN, timeouts).               |
| `20261005000200_foundation_helpers.sql`           | `app.uuid_v7`, `app.set_updated_at`, `app.prevent_tenant_change`, `app.forbid_mutation`.                                                  |
| `20261005000300_foundation_jobs_and_settings.sql` | `public.platform_settings`; `system.jobs`; `app.enqueue_job`; `system.claim_jobs/complete_job/fail_job/purge_finished_jobs/health_check`. |

Las tres se aplicaron desde cero sobre PostgreSQL 16 con un shim que reproduce los privilegios permisivos de Supabase. **No se aplicaron a ningún proyecto Supabase**: todavía no existe ninguno.

## 4. Pruebas y resultados

| Suite                                                  | Resultado                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `pnpm lint` (ESLint, `--max-warnings=0`)               | ✅ sin errores ni avisos                                                                        |
| `pnpm format:check` (Prettier)                         | ✅                                                                                              |
| `pnpm typecheck` (tsc estricto)                        | ✅                                                                                              |
| `pnpm test` (Vitest unit)                              | ✅ **13 archivos, 76 pruebas**                                                                  |
| `pnpm build` (producción)                              | ✅ todas las rutas dinámicas (requisito del nonce)                                              |
| pgTAP (`pnpm db:test`)                                 | ✅ **3 archivos, 47 pruebas**                                                                   |
| Integración (`pnpm db:test`, rol real `system_worker`) | ✅ **4 pruebas** (concurrencia de reclamo, runner de punta a punta, permisos denegados, health) |
| gitleaks 8.28.0 sobre los archivos a commitear         | ✅ sin hallazgos (`.env.local` excluido por `.gitignore`)                                       |

**Verificaciones adicionales hechas a mano sobre `next start`:**

- `/` responde con CSP + nonce, HSTS y el resto de cabeceras; **8 de 8 scripts** llevan el nonce.
- Chromium headless: **cero violaciones de CSP**; los estilos de los tokens se aplican. El único 404 es `/favicon.ico`, porque aún no hay identidad de la plataforma.
- `/api/health` → 200; `/api/health/ready` → 200 con la base real y el rol `system_worker`.
- `/api/jobs/run`:

  | Caso                  | Resultado                                                                   |
  | --------------------- | --------------------------------------------------------------------------- |
  | Sin credencial        | 401                                                                         |
  | Bearer incorrecto     | 401                                                                         |
  | Bearer de Vercel Cron | 200, y procesó un job real (tipo desconocido → `dead` + `unknown_job_type`) |
  | HMAC válido           | 200                                                                         |
  | HMAC vencido (−300 s) | 401                                                                         |
  | Cuerpo alterado       | 401                                                                         |

  Los logs salen en JSON con `request_id`.

- Build sin variables de entorno → **falla** con la lista de variables y sin mostrar valores.

**Prueba de mutación de los metatests:** se introdujeron 10 violaciones deliberadas y los metatests detectaron las 10:

- tabla sin RLS;
- grants a `anon` y a `service_role`;
- función `SECURITY DEFINER` sin `search_path` y ejecutable por `PUBLIC`;
- vista sin `security_invoker`;
- FK no compuesta;
- tabla con `store_id` sin trigger;
- grant de tabla a `system_worker`.

**CI de GitHub Actions:** se ejecuta con el push de este commit. Su resultado se reporta aparte (no se da por verde antes de verlo).

## 5. Criterios de aceptación (roadmap §38, PHASE 1)

| Criterio                                               | Estado                                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` verde en local                           | ✅                                                                                                                          |
| `pnpm verify` verde en CI                              | ⏳ pendiente del primer run (este push)                                                                                     |
| Cabeceras de seguridad verificadas                     | ✅ (pruebas unitarias + `next start` + Chromium)                                                                            |
| Spike S-5 resuelto y documentado                       | ✅ (D-F1-02)                                                                                                                |
| Spike S-1 resuelto y documentado                       | ⚠️ **No resuelto.** Requiere un proyecto Supabase real; documentado como pendiente con prueba mínima y plan B (runbook §2). |
| Cero secretos en el repositorio                        | ✅ (gitleaks)                                                                                                               |
| Metatests de esquema pasan con el esquema base         | ✅ (y detectan violaciones, probado por mutación)                                                                           |
| Un job encolado en una transacción revertida no existe | ✅ (pgTAP)                                                                                                                  |
| Worker: idempotencia y reintentos                      | ✅ (pgTAP + unit + integración)                                                                                             |

## 6. Riesgos

| Riesgo                                                                                  | Mitigación / estado                                                                                                                |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **S-1:** Supavisor podría no aceptar roles de login personalizados.                     | Plan B (ADR-016) listo; verificar al crear el proyecto (runbook §2). Afecta al runner y al health en producción, no al desarrollo. |
| Diferencia de versión: pruebas en PG16, producción en PG17 (D-F1-11).                   | SQL limitado a funciones de PG15+; ejecutar `supabase test db` contra el proyecto real.                                            |
| Disparo pg_cron + pg_net sin verificar (D-F1-05).                                       | Vercel Cron es el disparador primario; el HMAC está probado a nivel HTTP.                                                          |
| CSP con nonce impide el cacheo estático del storefront (D-F1-02).                       | Decisión con ADR en la Fase 5 (SRI experimental frente a renderizado dinámico).                                                    |
| Ecosistema: TS 7 y ESLint 10 no se pueden usar aún (D-F1-01).                           | Revisión periódica; sin impacto funcional.                                                                                         |
| El job de CI de base de datos depende de la versión de PostgreSQL del runner de GitHub. | El script detecta la versión instalada y usa el paquete pgTAP correspondiente.                                                     |

## 7. Pendientes

**Dependen de ti:**

1. Crear el proyecto Supabase (plan Pro + PITR, Q-B5) y el proyecto en Vercel (plan Pro por el cron, N-4). Con eso se resuelve S-1 y se ejecuta `supabase test db` contra el proyecto real.
2. Definir los **nombres de los dos dominios** (N-3). Se necesitan antes del despliegue de la Fase 5.
3. Confirmar el **primer proveedor de pagos**, Stripe o Mercado Pago (N-1). Se necesita antes de la Fase 7.

**Técnicos, ya asignados a la Fase 2:**

- Primitivas `Dialog`, `Drawer`, `Toast`, `Select`, `Checkbox` y `Table` (D-F1-08).
- `audit.log_change` (D-F1-10).
- `gatewayDb` (D-F1-12).
- Grants mínimos de `uuid_v7` para `authenticated` (D-F1-13).
- Programar `purge_finished_jobs`.

## 8. Definition of Done de la fase

- [x] CI configurado (lint, formato, tipos, unit, build, base de datos, secretos).
- [x] Cero secretos versionados.
- [x] `docs/` actualizado con el resultado de los spikes (S-5 resuelto, S-1 pendiente y documentado).
- [ ] CI verde en GitHub (se verifica tras el push).
- [ ] Aprobación humana para iniciar la Fase 2.
