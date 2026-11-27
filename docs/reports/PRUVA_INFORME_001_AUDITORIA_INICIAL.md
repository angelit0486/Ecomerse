# PRUVA — Informe 001: Auditoría inicial de solo lectura

| Campo                     | Valor                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Informe                   | 001                                                                                                                                                  |
| Trabajo documentado       | Primer prompt de auditoría: «PRUVA — PRINCIPAL ENGINEERING DIRECTOR · MASTER SYSTEM PROMPT · READ-ONLY AUDIT»                                        |
| Prompt recibido           | 26 nov 2026, 21:29:50 UTC                                                                                                                            |
| Entregables enviados      | 26 nov 2026, 21:39:17 UTC (versión inicial) y 22:01:23 UTC (versión corregida)                                                                       |
| Ejecutor                  | Claude Code (agente), sesión de trabajo con el propietario                                                                                           |
| Redacción de este informe | 27 nov 2026. Se reconstruyó con la bitácora de la sesión (cada comando, su hora y su salida), sin volver a ejecutar la auditoría ni modificar código |
| Destinatario              | Auditor técnico independiente                                                                                                                        |

---

## 0. Cómo leer este informe

**Fuente de la evidencia:** cada dato sale de la bitácora de la sesión (`~/.claude/projects/…/6527ba7e-….jsonl`), que guarda cada comando con su hora y su salida.

**Tres orígenes de evidencia, que se separan en todo el informe:**

| Marca   | Origen                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **[A]** | Acción ejecutada durante la auditoría 001 (21:29:50 → 22:01:23 UTC del 26 nov)                                                                                           |
| **[P]** | Evidencia previa del mismo día (26 nov), producida antes del prompt por trabajo anterior y **reutilizada** en los entregables sin volver a ejecutarse. Se indica la hora |
| **[D]** | Evidencia documental: el repositorio dice algo, pero no se comprobó ejecutándolo                                                                                         |

**Estados de verificación:**

| Estado                      | Significado                                                                |
| --------------------------- | -------------------------------------------------------------------------- |
| **VERIFICADO**              | Evidencia directa: un comando, una consulta o una prueba que se ejecutó    |
| **PARCIALMENTE VERIFICADO** | Evidencia incompleta: solo con simuladores, solo en local o solo una parte |
| **NO VERIFICADO**           | No se pudo comprobar                                                       |
| **FALLIDO**                 | La comprobación encontró un problema                                       |
| **BLOQUEADO**               | Requiere acceso, credenciales o autorización                               |

**Severidades:** la auditoría usó prioridades P0–P3. Aquí se traducen así:

- P0 → CRÍTICA. No hubo ninguna.
- P1 → ALTA.
- P2 → MEDIA.
- P3 → BAJA.
- Lo que no es defecto → INFORMATIVA.

---

## 1. Lo realizado

### 1.1 Objetivo del primer prompt

Auditoría **exclusivamente de lectura**. Estaba prohibido:

- modificar archivos;
- aplicar migraciones;
- cambiar de rama;
- hacer merges;
- desplegar;
- modificar servicios externos;
- alterar datos reales.

Se pidieron 8 entregables más un dictamen:

1. estado actual;
2. arquitectura;
3. seguridad;
4. rendimiento;
5. base de datos;
6. riesgos de regresión;
7. backlog priorizado;
8. línea base de pruebas.

### 1.2 Repositorio

| Dato                                                                         | Antes (21:30:11 UTC)                       | Después (22:01 UTC)                                | Fuente                          |
| ---------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------- | ------------------------------- |
| Repositorio                                                                  | `angelit0486/Ecomerse`                     | igual                                              | `git remote` [A]                |
| Rama local                                                                   | `feature/alien-demon-trust-storefront`     | igual (no se cambió)                               | `git branch --show-current` [A] |
| Commit inicial (HEAD)                                                        | `634b494b4bc6f1e70eeda7167aee5cfad151d1d1` | —                                                  | `git rev-parse HEAD` [A]        |
| Commit final de la auditoría                                                 | —                                          | `634b494` (**ningún commit durante la auditoría**) | ídem                            |
| Cambios sin confirmar                                                        | ninguno (`git status --short` vacío)       | ninguno en el repositorio                          | [A]                             |
| `origin/main`                                                                | `ea0176f` (16 oct 2026)                    | igual                                              | `git rev-parse` [A]             |
| `origin/claude/ecommerce-regulated-platform-41vu1e` (despliega a producción) | `cdc50e0`                                  | igual                                              | [A]                             |
| `origin/producto/orden-10`                                                   | `cdc50e0`                                  | igual                                              | [A]                             |
| `origin/feat/promociones-mayoreo`                                            | `8ebc9c8`                                  | igual                                              | [A]                             |

**Distancias medidas con `git rev-list --left-right --count`** [A]:

| Comparación                              | Detrás | Delante |
| ---------------------------------------- | ------ | ------- |
| HEAD frente a `main`                     | 0      | 393     |
| HEAD frente a la rama de despliegue      | 0      | 1       |
| `feat/promociones-mayoreo` frente a HEAD | 23     | 10      |

`634b494` ya existía antes del prompt: se creó a las 21:29:34, como cierre de la tarea anterior («auditoría completa de cada función del panel»). **No es producto de esta auditoría.**

### 1.3 Archivos y carpetas inspeccionados [A]

| Área                 | Qué se leyó                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuración        | `package.json` (engines, packageManager, dependencias, scripts), `.nvmrc`, `.github/workflows/ci.yml` (primeras 120 líneas), `vercel.json`, `.claude/settings.json` (permisos)                                                                                                                                                                                                                                                              |
| Estructura           | Conteo de `src/**/*.ts(x)`, `supabase/migrations/*.sql`, `supabase/tests/database/*.sql`, `tests/e2e/*.spec.ts`, `tests/integration/*.test.ts`, `*.test.ts`; listado de `src/server/`; los 12 archivos más grandes de `src` (`wc -l`)                                                                                                                                                                                                       |
| Seguridad (código)   | `grep dangerouslySetInnerHTML`; usos de `SUPABASE_SERVICE_ROLE_KEY`/`service_role`; `src/server/supabase/server.ts`, `src/server/media/storage.ts`, `src/server/system/health.ts`; `src/app/api/webhooks/*`; `src/server/payments/stripe.ts:237-252` (firma HMAC); `src/server/payments/mercadopago-webhook.ts` (cabecera); `src/server/storefront/suggestions-guard.ts:1-30`; `src/server/storefront/checkout.ts:55-80` (`checkout_guard`) |
| Rendimiento (código) | Uso de `next/image` y `<img`; `await callRpc` dentro de bucles en `src/app/admin/**/actions.ts` y `src/server/inventory/stock-actions.ts`; usos de caché (`cachedRead`, `revalidateTag`); conteo de `limit(` en páginas del panel; `srcSet`/`loading="lazy"`/`fetchPriority` en la tienda                                                                                                                                                   |
| Pruebas              | `tests/e2e/storefront-look.spec.ts:170-215` y `:291-330`; `src/lib/theme/looks.ts` (búsqueda de `display`/`swap`); búsqueda de `next/font`/`localFont` en la tienda                                                                                                                                                                                                                                                                         |
| Documentación        | `docs/runbooks/operacion-de-colas.md` (cron diario, opción `pg_cron`), `docs/runbooks/respaldos.md` (plan Free, sin PITR), listado de `docs/runbooks/` y `scripts/ops/`, índice de `docs/audit/AUDITORIA-2026-10-27/`                                                                                                                                                                                                                       |
| Versiones            | `src/server/db/schema-version.ts` (`EXPECTED_SCHEMA_VERSION = "20261126000200"`)                                                                                                                                                                                                                                                                                                                                                            |

### 1.4 Arquitectura identificada [A + D]

- **Aplicación:** una sola app Next.js con tres superficies.
  - Tienda pública: `src/app/%5Fstore/[storeId]/`.
  - Panel: `src/app/admin/[storeHandle]/`.
  - Consola: `src/app/platform/`.
- **Datos:** PostgreSQL (Supabase) con RLS forzado. La lógica crítica está en funciones SQL (`public.*` para el panel; `storefront.*`, `system.*` y `app.*`).
- **Proxy:** `src/proxy.ts` resuelve la tienda por host y pone `request_id` y CSP con _nonce_. No autoriza.
- **Roles de base de mínimo privilegio:** `storefront_gateway` para la tienda, `system_worker` para la cola y la sesión del usuario para el panel. `service_role` solo en `src/server/privileged/*`.
- **Cola:** trabajos en `system.jobs`, ejecutados por `/api/jobs/run`. Se disparan por cron diario (`vercel.json`) y desde el panel o las subidas.
- **Sin rediseño:** el dictamen de arquitectura no recomienda reconstruir. Los riesgos están en la operación de ramas y en archivos de UI grandes.

### 1.5 Tecnologías y dependencias verificadas [A]

| Pieza                           | Versión                                    | Fuente                            |
| ------------------------------- | ------------------------------------------ | --------------------------------- |
| Node                            | `>=24.0.0 <25`; `.nvmrc` = 24              | `package.json`                    |
| pnpm                            | 10.28.0                                    | `packageManager`                  |
| Next.js / React / TypeScript    | 16.4.6 / 19.3.1 / 6.0.3                    | `package.json`                    |
| supabase-js / ssr               | 2.117.2 / 0.12.7                           | ídem                              |
| zod / postgres / sharp / resend | 4.6.6 / 3.4.9 / 0.35.5 / 6.38.1            | ídem                              |
| Vitest / Playwright             | 5.0.5 / 1.56.1                             | ídem                              |
| Dependencias                    | 22 de producción, 19 de desarrollo         | ídem                              |
| PostgreSQL de staging           | 17.11.0.003, `us-east-1`, `ACTIVE_HEALTHY` | `mcp__Supabase__get_project`      |
| Organización de Supabase        | plan `free`                                | `mcp__Supabase__get_organization` |
| Equipo de Vercel                | `team_Ak79PEqCQo1ftKOvTEWekKPT`            | `mcp__Vercel__get_team`           |

**Tamaño del sistema** [A]:

- 792 archivos TS/TSX con 101,748 líneas.
- 182 migraciones (`20261005000100` → `20261126000200`).
- 159 archivos pgTAP.
- 100 specs E2E.
- 43 archivos de integración.
- 204 archivos unitarios.

### 1.6 Módulos y funcionalidades auditados

La auditoría armó una matriz de 18 áreas: acceso, multi-tienda, lanzamiento, catálogo, importación, inventario, personalización, tienda pública, carrito y checkout, pagos, pedidos, clientes, envíos, correos, dominio propio, consola, analítica y operación. Para cada una, la evidencia fue **el nombre de las pruebas que la cubren** más el resultado de la última corrida completa (ver 1.10). **No se ejecutó una prueba nueva por módulo durante 001.**

### 1.7 Comprobaciones de seguridad

| Comprobación                      | Origen                                           | Resultado                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dangerouslySetInnerHTML`         | [A] grep                                         | Un solo uso, en `src/ui/safe-html.tsx:20`, con `sanitize-html`. El JSON-LD se emite como texto escapado                                                                                              |
| `service_role`                    | [A] grep                                         | `src/server/privileged/*`, `src/config/env.ts`, el aviso de `src/server/system/health.ts` y un comentario en `src/server/media/storage.ts`. `server.ts:12`: «nunca se usa service_role aquí»         |
| Firma de Stripe                   | [A] lectura                                      | HMAC-SHA256 de `t.rawBody`, comparación en tiempo constante (`constantTimeEqual`) y tolerancia de 300 s (`stripe.ts:240-252`)                                                                        |
| Firma de Mercado Pago             | [A] lectura                                      | `x-signature` ±5 min (`mercadopago-webhook.ts:10`)                                                                                                                                                   |
| Resend                            | [A] listado                                      | La ruta `src/app/api/webhooks/email/resend/route.ts` existe; la verificación `svix-signature` no se leyó línea por línea → **PARCIAL**                                                               |
| Freno del checkout                | [A] lectura                                      | `storefront.checkout_guard(storeId, ipHash, email)` antes de `place_order`; si falla, `AppError("rate_limited")`                                                                                     |
| Freno de sugerencias              | [A] lectura                                      | Por instancia: 30 cada 10 s por IP y 1 en curso. El comentario delega el límite global al WAF de Vercel                                                                                              |
| Escaneo de secretos (gitleaks)    | [A] CI #472                                      | `success`                                                                                                                                                                                            |
| Asesores de seguridad de Supabase | [P] 21:16:20 UTC                                 | `auth_leaked_password_protection` (WARN), `authenticated_security_definer_function_executable` (210, WARN), `extension_in_public` (`pg_net`), `rls_enabled_no_policy` (47, particiones de auditoría) |
| Encabezados HTTP de staging       | [P] 21:04 UTC (`/api/health`)                    | CSP con _nonce_ y `strict-dynamic`, HSTS, `x-frame-options: DENY`, `nosniff`, `permissions-policy`                                                                                                   |
| Permisos por rol en el panel      | [P] recorrido de la tarea anterior (≈ 21:08 UTC) | 33 rutas × 5 roles sin errores; lo no permitido responde 404                                                                                                                                         |

### 1.8 Supabase, PostgreSQL y RLS

**Base local** `pruva_dev`, con las 182 migraciones, consultada con `psql` [A] a las 21:32:02:

| #   | Consulta                                                                                             | Resultado                                                                            |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Tablas `public` con `store_id` sin `relrowsecurity` **y** `relforcerowsecurity`                      | **0** (de 68)                                                                        |
| 2   | `SECURITY DEFINER` en esquemas propios sin `search_path` fijo                                        | **0**                                                                                |
| 3   | Funciones de esquemas propios ejecutables por `PUBLIC`                                               | **0**                                                                                |
| 4   | Permisos de tabla de `anon`                                                                          | 70, **todos en el esquema `storage`** (Supabase, 21:32:06); **0** en tablas de PRUVA |
| 5   | Permisos de tabla de `storefront_gateway` / `system_worker`                                          | **0**                                                                                |
| 6   | Tablas `public` / con `store_id`                                                                     | 87 / 68                                                                              |
| 7   | FK de `public` sin índice que las cubra                                                              | **51**                                                                               |
| 8   | Esquemas expuestos por PostgREST (config local)                                                      | **Error**: `unrecognized configuration parameter "pgrst.db_schemas"` → NO VERIFICADO |
| 9   | Columnas de dinero (`price/total/amount/cost/spent/subtotal`) con tipo distinto de entero (21:35:35) | **0**                                                                                |

**Staging (Supabase):**

- Durante 001 solo se leyeron los metadatos: proyecto y organización.
- **No se ejecutó SQL contra la base remota.**
- Los asesores son evidencia **[P]** (21:16 UTC):
  - `unindexed_foreign_keys`: 54.
  - `no_primary_key`: 98 tablas del esquema `respaldo_20261118`.
  - `multiple_permissive_policies`: 2, en `customers`.
  - `unused_index`: 64.

### 1.9 Autenticación y autorización

- **Revisado en código [A]:**
  - la sesión del panel usa el JWT del usuario (`server.ts:12`);
  - las funciones privilegiadas no son ejecutables por `PUBLIC` (consulta 3);
  - los roles de tienda y cola no tienen permisos de tabla (consulta 5).
- **Recorrido por roles [P]:** viewer, order_manager, catalog_manager, designer y support_agent.
- **Asesor [P]:** «contraseñas filtradas» apagado.
- **Durante 001 no se probó en vivo:**
  - el inicio de sesión con TOTP;
  - el límite de intentos;
  - la caducidad de sesión.

  Lo cubren las E2E `staff-auth` y `password-login`, que pasaron en la corrida completa (ver 1.10).

### 1.10 Pruebas automatizadas

| Suite                                                  | Origen                                                                              | Código probado                                                 | Resultado                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` (lint, formato, tipos, unitarias, build) | [P] 21:20:43 UTC                                                                    | Árbol de trabajo que se confirmó como `634b494` a las 21:29:34 | 1,795 unitarias pasan; verify `exit=0`                                                                                             |
| `pnpm db:test`: pgTAP                                  | [P] 21:16:54 UTC                                                                    | Ídem (634b494 no toca SQL: 8 archivos, ninguno en `supabase/`) | `Files=159, Tests=3327, Result: PASS` (34 s)                                                                                       |
| `pnpm db:test`: integración                            | [P] 21:20:38 UTC                                                                    | Ídem                                                           | `Test Files 43 passed (43)`, `Tests 468 passed` (243 s)                                                                            |
| E2E afectadas por los cambios de 634b494               | [P] 21:20:43 UTC                                                                    | Ídem                                                           | 8 de 8 (4.3 min)                                                                                                                   |
| E2E completa                                           | [P] 20:57:25 UTC                                                                    | `cdc50e0`                                                      | **198 passed (30.2 m)**                                                                                                            |
| E2E completa                                           | [A]: se lanzó a las 21:29:38, 12 s antes del prompt, y se leyó durante la auditoría | `634b494`                                                      | Al entregar (21:38): «en curso, 54 de 198, 0 fallas». Terminó a las **22:01:05 UTC: 198 passed (31.3 m)**. El informe se actualizó |

**Nota de integridad:** la E2E completa crea tiendas de prueba en la base **local** (`pruva_dev`). No toca datos remotos.

### 1.11 CI/CD y despliegue

**CI de GitHub (rama de despliegue)** [A]:

- **Run #472** (`cdc50e0`, id 45894835506): `failure`.
  - Pasaron: escaneo de secretos, verify y migraciones con pgTAP e integración.
  - Falló el trabajo E2E: **192 passed, 1 failed, 5 did not run** (17.1 m).
  - Prueba fallida: `tests/e2e/storefront-look.spec.ts:179`. Mensaje: `CLS en /`, `Expected: < 0.05`, `Received: 0.2854551224368189`.
- **Runs anteriores** (ids 45850223181, 45881856859 y 45793564400; cada uno con 1 failed): las fallas fueron `storefront-look.spec.ts:179` (CLS) y, en un run, `:291` (nave) con CLS `0.2849007620431499` y límite 0.1.
- **Conclusión:** los runs #463, #466, #469 y #472 fallaron en el trabajo E2E por el mismo salto de diseño. El resto de los trabajos pasó.

**Vercel:**

- **Production branch:** `claude/ecommerce-regulated-platform-41vu1e` [D/P].
- **Ramas ignoradas:** `vercel.json` ignora `producto/*` y `audit/*` (`ignoreCommand`) [A, lectura].
- **Cron:** `0 12 * * *` → `/api/jobs/run` (una vez al día) [A].
- **Despliegue de `cdc50e0`** (`dpl_GcGpPGAFktjH74m73scbTWpw8rSi`) READY, con el CI #472 en rojo [P] 21:04 UTC. Por tanto, Vercel publica aunque el CI falle.
- **Variables del proyecto** (solo nombres y valores no secretos) [P] 19:29:30 UTC:
  - `EMAIL_PROVIDER=fake`;
  - `SUPABASE_SERVICE_ROLE_KEY` solo en _production_;
  - `VERCEL_DOMAINS_TOKEN` no existe.

### 1.12 Documentación técnica consultada [A]

- `docs/runbooks/operacion-de-colas.md`, líneas 7, 17, 18, 21 y 29:
  - cron diario;
  - opción `pg_cron` + `pg_net` cada minuto;
  - «un lote avanza una parte al día».
- `docs/runbooks/respaldos.md`: «Respaldos automáticos diarios: No hay» y «PITR… No disponible en Free».
- `docs/audit/AUDITORIA-2026-10-27/`: solo el índice, como referencia de la auditoría anterior.
- `CLAUDE.md` y `docs/architecture/GATE0-ARCHITECTURE-REVIEW.md`: reglas de la sesión, no releídas durante 001.

### 1.13 Comandos ejecutados y resultados relevantes

Las 51 llamadas de la auditoría, agrupadas, en UTC del 26 nov:

| Hora                           | Herramienta                                | Qué hizo                                                                                 | Resultado relevante                                                                              |
| ------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 21:30:11                       | Bash (git)                                 | Rama, HEAD, `fetch`, refs de 5 ramas, distancias                                         | Ver 1.2                                                                                          |
| 21:30:20                       | Bash (git)                                 | Commits y migraciones de `feat/promociones-mayoreo`                                      | 23 commits; base común `62d4dc6`; trae migraciones `20261125000100–0400`                         |
| 21:30:24–29                    | Bash                                       | `package.json`, `.nvmrc`, `ci.yml`, `vercel.json`, `.claude/settings.json`               | Ver 1.5 y 1.11                                                                                   |
| 21:30:34                       | GitHub `actions_list`                      | Últimos 5 runs de `ci.yml` en la rama de despliegue                                      | #472 `failure`                                                                                   |
| 21:30:37                       | GitHub `list_workflow_jobs`                | Trabajos del #472                                                                        | Solo falla el E2E                                                                                |
| 21:30:41–21:31:26              | GitHub `get_job_logs` + Python/grep        | Logs del #472 y de 3 runs fallidos anteriores                                            | Ver 1.11                                                                                         |
| 21:31:32                       | Bash (grep)                                | Umbrales de `storefront-look.spec.ts`, `display` en `looks.ts`, `next/font` en la tienda | Umbral de la nave: CLS < 0.1                                                                     |
| 21:31:42                       | Bash                                       | Conteos de código y pruebas; `src/server`; `dangerouslySetInnerHTML`; `service_role`     | Ver 1.5 y 1.7                                                                                    |
| 21:31:45–51                    | Bash (grep/sed)                            | Webhooks, frenos de abuso, `checkout_guard`                                              | Ver 1.7                                                                                          |
| 21:32:02                       | psql (local)                               | 8 consultas de seguridad multi-tienda                                                    | Ver 1.8                                                                                          |
| 21:32:06                       | psql (local)                               | Desglose de los permisos de `anon`                                                       | 70, todos en `storage`                                                                           |
| 21:32:14–17                    | Bash (grep)                                | `next/image`, `<img`, awaits en bucle, caché, `limit(`, `srcSet`                         | 0 `next/image`; 6 `<img` en el panel; bucles en 3 archivos de acciones; 44 usos de `srcSet`/lazy |
| 21:32:22                       | Bash (grep)                                | Runbooks de colas y respaldos                                                            | Ver 1.12                                                                                         |
| 21:32:27–30                    | Supabase `get_project`, `get_organization` | Metadatos                                                                                | PG 17, `ACTIVE_HEALTHY`, plan `free`                                                             |
| 21:32:36                       | Vercel `get_team`                          | Metadatos del equipo                                                                     | —                                                                                                |
| 21:32:41 / 21:36:33 / 21:38:35 | Bash                                       | Avance de la E2E en segundo plano                                                        | 23, 53 y 54 de 198, sin fallas                                                                   |
| 21:32:49                       | Bash                                       | Archivos más grandes y lista de specs                                                    | `home-editor.tsx`: 2,759 líneas, etc.                                                            |
| 21:32:52–55                    | Bash                                       | Firma de Stripe                                                                          | Ver 1.7                                                                                          |
| 21:33:25                       | Bash                                       | Versiones exactas, `EXPECTED_SCHEMA_VERSION`, SHA de la rama de despliegue               | Ver 1.5                                                                                          |
| 21:35:35                       | psql (local)                               | Tipos de las columnas de dinero                                                          | 0 con decimales                                                                                  |
| 21:34:00–21:39:07              | Write/Edit                                 | 9 documentos en el scratchpad (fuera del repositorio)                                    | Ver sección 3                                                                                    |
| 21:39:10                       | Bash (`zip`)                               | `PRUVA_AUDITORIA_2026-11-26.zip`                                                         | 9 archivos                                                                                       |
| 21:39:17                       | SendUserFile                               | Entrega al propietario                                                                   | 10 archivos                                                                                      |
| 22:01:05–23                    | Bash, SendUserFile                         | E2E completa terminada; actualización de 3 documentos; nuevo zip; reenvío                | 198/198 sobre `634b494`; corrección de la cifra del run de la nave                               |

---

## 2. Correcciones hechas a los propios entregables

Se transparentan porque el auditor puede tener la versión inicial:

1. **Línea base de E2E sobre `634b494`:** a las 21:38 decía «en curso, 54 de 198». A las 22:01, al terminar la suite, se cambió a «198 de 198, 31.3 min».
2. **Falla del run de la nave:** la versión inicial decía `expected 7027 to be less than 5000`. Esa cadena aparece en el log, pero la aserción que falló fue la de CLS (`0.2849007620431499`, límite 0.1). Se corrigió en `PRUVA_PERFORMANCE_AUDIT.md` y `PRUVA_BASELINE_TEST_REPORT.md`.
3. **Dictamen:** se le agregó que la E2E completa sobre `634b494` pasó y que ese commit se publicó. La publicación la autorizó el propietario a las 21:39:34, **después** de entregar la auditoría, y no forma parte de ella.

---

## 3. Registro de cambios de la auditoría 001

**La auditoría fue de solo lectura respecto del repositorio, las ramas, las bases remotas y los servicios externos.**

| Tipo                                                             | Detalle                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Archivos del repositorio modificados                             | **Ninguno**                                                                                                                                                                                                                                                                                                |
| Archivos del repositorio creados / eliminados                    | **Ninguno**                                                                                                                                                                                                                                                                                                |
| Archivos creados fuera del repositorio (scratchpad de la sesión) | `pruva-audit/00_DICTAMEN.md`, `PRUVA_CURRENT_STATE.md`, `PRUVA_ARCHITECTURE_AUDIT.md`, `PRUVA_SECURITY_AUDIT.md`, `PRUVA_PERFORMANCE_AUDIT.md`, `PRUVA_DATABASE_AUDIT.md`, `PRUVA_REGRESSION_RISKS.md`, `PRUVA_PRIORITIZED_BACKLOG.md`, `PRUVA_BASELINE_TEST_REPORT.md` y `PRUVA_AUDITORIA_2026-11-26.zip` |
| Migraciones creadas / ejecutadas                                 | **Ninguna**                                                                                                                                                                                                                                                                                                |
| Commits                                                          | **Ninguno** (HEAD `634b494` antes y después)                                                                                                                                                                                                                                                               |
| Pushes, merges, cambios de rama                                  | **Ninguno**                                                                                                                                                                                                                                                                                                |
| Configuración, dependencias, infraestructura                     | **Sin cambios**                                                                                                                                                                                                                                                                                            |
| Servicios externos                                               | Solo lecturas: GitHub Actions (runs, jobs, logs), Supabase (proyecto, organización) y Vercel (equipo)                                                                                                                                                                                                      |
| SQL                                                              | Solo contra la base **local** `pruva_dev`, y solo `SELECT` sobre catálogos                                                                                                                                                                                                                                 |
| Escrituras locales indirectas                                    | La E2E completa, lanzada antes del prompt, creó tiendas de prueba en la base local, como en cada corrida                                                                                                                                                                                                   |

**Después de 001** (fuera de su alcance, para que el estado actual no se confunda):

- 21:39:44 — se publicó `634b494`, con autorización explícita.
- 21:43 — commit `5ea8fb3`: pruebas de CLS con diagnóstico.
- 21:46 — commit `c532e69`: formato.
- 26 nov — commit `b6004f1`: corrige PERF-01.
- 27 nov — commit `8a1354f`: B-12.
- 27 nov — commit `9fd3e34`: PERF-02, con la migración `20261127000100` aplicada en staging con autorización.

El estado de esos puntos está en el **Anexo A**.

---

## 4. Matriz de hallazgos (estado al cierre de la auditoría 001)

Ordenada por severidad.

| ID               | Módulo                      | Hallazgo                                                                                                                                                          | Evidencia                                                       | Severidad   | Estado                                                                      | Acción recomendada                                                                                              |
| ---------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| DB-05            | Base de datos / continuidad | Sin respaldos automáticos ni PITR (plan Free). La meta de GATE0 §36.2 es RPO ≤ 5 min y RTO ≤ 4 h                                                                  | `get_organization` → `plan: free` [A]; `respaldos.md` [A]       | ALTA        | FALLIDO (control ausente) / BLOQUEADO (decisión de costo)                   | Supabase Pro + PITR antes del primer cliente que pague; mientras, `backup-export.sh` programado y copiado fuera |
| OPS-01           | Notificaciones              | Staging no envía correos a compradores: `EMAIL_PROVIDER=fake`, y hay una tienda publicada sobre ese despliegue                                                    | `filter_project_envs` [P 19:29]                                 | ALTA        | FALLIDO / BLOQUEADO (llave del propietario)                                 | Proveedor real (Resend ya soportado), dominio del remitente verificado, llave en Vercel                         |
| OPS-02           | CI/CD                       | Producción se publica aunque el CI falle (4 runs seguidos en rojo; `cdc50e0` READY con el #472 en rojo)                                                           | Runs #463/#466/#469/#472 [A]; despliegue READY [P 21:04]        | MEDIA       | FALLIDO                                                                     | Exigir checks verdes antes de promover (Vercel Deployment Checks o rama `release`)                              |
| PERF-01          | Tienda (tema Nocturno)      | La portada salta al cargar: CLS 0.285 en CI (umbral 0.05); no se reproduce en local                                                                               | Log del #472: `Received: 0.2854551224368189` [A]                | MEDIA       | FALLIDO (causa sin confirmar en 001)                                        | Medir con `LayoutShift.sources` y corregir; recuperar el CI verde                                               |
| PERF-02          | Consola                     | «Mis clientes» tarda ≈ 3.6 s con 8,597 tiendas locales                                                                                                            | `\timing` como `platform_admin` (aal2): 3,578.8 ms [P 18:23]    | MEDIA       | FALLIDO (rendimiento)                                                       | Reescribir con agregados por `store_id`; migración autorizada                                                   |
| OPS-03           | Cola de trabajos            | La cola solo corre por cron una vez al día si nadie abre el panel                                                                                                 | `vercel.json` [A]; `operacion-de-colas.md:21` [A]               | MEDIA       | VERIFICADO (configuración) / BLOQUEADO (plan o `pg_cron`)                   | `pg_cron` + `pg_net` cada minuto (runbook §3) o cron frecuente en Pro                                           |
| OPS-04           | Observabilidad              | Sin monitoreo de errores ni alertas externas                                                                                                                      | Sin Sentry/Datadog/Axiom/Logtail en `src` ni `package.json` [A] | MEDIA       | VERIFICADO (ausencia)                                                       | Alertas de Vercel o drenado de logs, más monitor de `/api/health`                                               |
| OPS-05           | Dominio propio              | No se puede verificar un dominio en staging: falta `VERCEL_DOMAINS_TOKEN`                                                                                         | `filter_project_envs` [P 19:29]                                 | MEDIA       | BLOQUEADO                                                                   | El propietario crea el token                                                                                    |
| SEC-01           | Auth                        | Protección contra contraseñas filtradas apagada                                                                                                                   | Asesor `auth_leaked_password_protection` [P 21:16]              | MEDIA       | FALLIDO / BLOQUEADO (cambio en Supabase)                                    | Activarla en Supabase Auth                                                                                      |
| SEC-02           | Datos                       | 98 tablas de respaldo (`respaldo_20261118`) dentro de la base de staging, fuera de las políticas originales                                                       | Asesor `no_primary_key` [P 21:16]                               | MEDIA       | PARCIALMENTE VERIFICADO (no se comprobó si el esquema está expuesto)        | Confirmar que no está expuesto; exportar fuera de la base y borrar (destructivo, requiere autorización)         |
| ARQ-01           | Ramas                       | `main` está 393 commits atrás de lo publicado (16 oct)                                                                                                            | `rev-list` [A]                                                  | MEDIA       | VERIFICADO                                                                  | Fast-forward de `main` al SHA publicado y protección de rama (requiere autorización)                            |
| DB-03            | Migraciones                 | `feat/promociones-mayoreo` trae migraciones `20261125*` con fecha anterior a las ya aplicadas en staging (`20261126*`)                                            | `git diff --name-only` [A]                                      | MEDIA       | VERIFICADO                                                                  | Si alguna vez se integra, renombrar los timestamps antes de aplicar. Ver sección 7.6                            |
| DB-01            | Base de datos               | FK sin índice que las cubra: 51 en local y 54 según el asesor                                                                                                     | Consulta 7 [A]; asesor [P]                                      | BAJA        | VERIFICADO                                                                  | Migración con `create index concurrently` + metatest                                                            |
| DB-02            | Base de datos               | Dos políticas permisivas por acción en `customers` (SELECT y UPDATE)                                                                                              | Asesor [P]                                                      | BAJA        | VERIFICADO                                                                  | Una política por acción; pgTAP comprador frente a equipo                                                        |
| DB-04            | Base de datos               | `pg_net` instalada en `public`                                                                                                                                    | Asesor `extension_in_public` [P]                                | BAJA        | VERIFICADO                                                                  | Moverla a `extensions` en una ventana de mantenimiento                                                          |
| SEC-03           | Rutas públicas              | Frenos de abuso por instancia en `/buscar/sugerencias` y `/visita`                                                                                                | `suggestions-guard.ts:7-14` [A]                                 | BAJA        | VERIFICADO                                                                  | Regla de WAF por IP (requiere autorización)                                                                     |
| PERF-03 / ARQ-03 | Panel                       | Acciones en bloque con `await callRpc` secuencial (hasta 100 viajes por clic)                                                                                     | grep en 3 archivos de acciones [A]                              | BAJA        | VERIFICADO (código); impacto NO VERIFICADO (no medido en staging)           | RPC por lote cuando un comercio lo necesite                                                                     |
| ARQ-02           | Panel                       | Archivos de UI grandes (`home-editor.tsx`: 2,759 líneas)                                                                                                          | `wc -l` [A]                                                     | BAJA        | VERIFICADO                                                                  | Extracciones pequeñas con las E2E como red                                                                      |
| OPS-06           | Configuración               | `SUPABASE_SERVICE_ROLE_KEY` solo en _production_; las vistas previas no procesan fotos                                                                            | `filter_project_envs` [P]                                       | BAJA        | VERIFICADO                                                                  | Decidir y documentar                                                                                            |
| FUN-01           | Pedidos                     | La lista de pedidos no muestra al cliente                                                                                                                         | `pedidos/page.tsx:70-71` (lectura de la tarea anterior) [P]     | BAJA        | VERIFICADO                                                                  | RPC de lista con PII enmascarada según el permiso                                                               |
| B-12             | Pruebas                     | Ningún metatest exige dinero en enteros (hoy hay 0 columnas con decimales)                                                                                        | Consulta 9 [A]; `00_schema_security` sin chequeo de tipos [A]   | BAJA        | VERIFICADO                                                                  | Aserción pgTAP genérica                                                                                         |
| SEC-04           | Base de datos               | 210 funciones `SECURITY DEFINER` ejecutables por `authenticated`                                                                                                  | Asesor [P]                                                      | INFORMATIVA | VERIFICADO: intencional (validan permisos por dentro, con pgTAP de rechazo) | Mantener el metatest `00_schema_security`                                                                       |
| INF-01           | Seguridad                   | Controles multi-tienda en regla: RLS forzado 68/68, 0 DEFINER sin `search_path`, 0 `EXECUTE` de `PUBLIC`, 0 permisos de PRUVA a `anon`, 0 tablas a gateway/worker | Consultas 1–5 [A]                                               | INFORMATIVA | VERIFICADO (base local; staging no se consultó por SQL)                     | Ninguna                                                                                                         |
| INF-02           | Pagos                       | Firmas de webhooks verificadas (Stripe HMAC con tiempo constante, MP ±5 min); el total del cliente se rechaza si se manipula                                      | Lectura de código [A]; E2E `checkout` [P]                       | INFORMATIVA | VERIFICADO contra simuladores; **pagos reales NO VERIFICADOS**              | Prueba con cuentas reales de sandbox                                                                            |
| INF-03           | Datos de PostgREST          | Esquemas expuestos por la Data API, en local y en staging                                                                                                         | Consulta 8 dio error [A]                                        | INFORMATIVA | NO VERIFICADO                                                               | Revisar en el panel de Supabase (staging)                                                                       |

**No se reprodujo ningún hallazgo CRÍTICO:** ni fuga entre tiendas, ni manipulación de precio, ni corrupción de inventario o de pagos.

---

## 5. Comparación con la guía oficial de PRUVA

**Referencia:** documento funcional «PRUVA: guía completa de la plataforma» (Claude Doc del 26 nov; leído el 27 nov para este informe, sin modificarlo).

**Base del contraste:** solo la evidencia de 001 (matriz de `PRUVA_CURRENT_STATE.md` §6 y hallazgos). **Que exista código o una sección en la guía no cuenta como verificación.**

### 5.1 Verificadas

Existe una prueba automatizada que ejercita el flujo y pasó en la última corrida completa: E2E 198/198 sobre `cdc50e0` y `634b494`, pgTAP 3,327 e integración 468.

| Función de la guía                                                                | Pruebas citadas en 001                                                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Acceso con contraseña y verificación en dos pasos; roles del equipo               | `staff-auth`, `password-login`, `team`, pgTAP de permisos                                                     |
| Varias tiendas por organización, aislamiento                                      | `multi-store`, `two-stores`, `org-create-store`, pgTAP con ≥ 2 tiendas                                        |
| «Configura tu tienda», plantillas, publicar                                       | `launch-guide`, `launch`, `onboarding`, `store-templates`                                                     |
| Productos, variantes, categorías, marcas, atributos, ofertas                      | `catalog`, `product-management`, `quick-product`, `sheet-variants`, `attributes`, `brands`, `scheduled-sales` |
| Inventario: «Marcar agotado», ajustes, «Qué pedir», proveedores                   | `inventory`, `inventory-quick`, `suppliers`, pgTAP de movimientos                                             |
| Tienda pública: portada, catálogo, ficha, búsqueda                                | `storefront`, `product-page`, `discovery`, `navigation`, `nav-bar`                                            |
| Carrito y pago: total en el servidor, envío por zona, IVA                         | `checkout`, `checkout-shipping`, `price-consistency`, `free-shipping-everywhere`                              |
| Pedidos: surtir, entregar, reembolsar, cancelar, imprimir, WhatsApp, devoluciones | `order-ops`, `order-printing`, `whatsapp-*`, `returns`                                                        |
| Clientes y cuenta del comprador; enlace con vigencia                              | `customers`, `account`, `guest-link-expiry`                                                                   |
| Envíos: todo México en un paso, zonas por estado                                  | `shipping-rates`, `shipping-national`                                                                         |
| Consola: «Mis clientes», organizaciones, planes, soporte, trabajos                | `platform`, `platform-clients`, `plans`                                                                       |
| Inicio: ventas, visitantes, alertas                                               | `dashboard`, `home-control-center`, `store-visits`, `home-alerts`                                             |
| Salud, exportar, mantenimiento, versión de esquema                                | `store-health`, `exports`, `maintenance`, `schema-version`                                                    |

### 5.2 Parcialmente verificadas

| Función de la guía                                                   | Qué falta                                                                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Pagos con Mercado Pago y Stripe                                      | Solo contra simuladores (`mercadopago-checkout`, `billing-card`, unitarias de firma). Cuentas reales: **NO VERIFICADO**                  |
| Correos al comprador (confirmación, pago, envío, carrito abandonado) | Pasan en local con Mailpit (`email-texts`, `cart-recovery`). En staging **no salen** (`EMAIL_PROVIDER=fake`): FALLIDO en el entorno real |
| Dominio propio con verificación y certificado                        | Pasa contra un proveedor simulado (`custom-domain`). En staging está **BLOQUEADO** (sin token)                                           |
| Importación grande por partes                                        | Verificada en local. En staging, el avance depende del cron diario (OPS-03)                                                              |
| Personalización / tema Nocturno                                      | Pasa en local; `storefront-look` fallaba en CI (PERF-01)                                                                                 |
| «Mis clientes»                                                       | Funciona, pero lenta con miles de tiendas (PERF-02)                                                                                      |

### 5.3 Documentadas en la guía y no evaluadas en la matriz de 001

Su funcionamiento real **no se comprobó en 001**. Puede haber pruebas en la suite completa, pero 001 no las vinculó a la función.

- Descuentos (códigos con límites de uso).
- Opiniones (moderación de reseñas).
- Impuestos (IVA incluido o sumado), como pantalla de ajustes.
- Cumplimiento sanitario, en panel y consola.
- Plan y uso.
- Actividad (bitácora).
- Notificaciones al equipo.
- Funciones (interruptores por tienda).
- Rentabilidad (detrás de interruptor).
- «14 plantillas por giro»: el número no se contó en 001.
- Precios de ADR-068 ($699 / $1,299 MXN): es una decisión documentada, no una función comprobada.

### 5.4 Faltan o están solo como propuesta

- Comprar el dominio desde el panel (ADR-069): **propuesta**, sin implementar.
- Guías de paquetería con Skydropx (ADR-057): solo existe la base del adaptador. Falta la cuenta y el flujo completo.
- Venta de mostrador (ADR-066): propuesta.
- Facturación CFDI (ADR-058): propuesta.

### 5.5 Discrepancias entre la guía y la evidencia

| La guía dice                                                  | La evidencia de 001 dice                                         | Estado                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| «Producción sale de una rama aprobada tras pasar las pruebas» | Vercel publicó `cdc50e0` con el CI #472 en rojo; 4 runs seguidos | **FALLIDO** (OPS-02)                   |
| «1,794 pruebas» unitarias                                     | 1,795                                                            | Desfase menor de la guía (INFORMATIVA) |
| «197 recorridos» E2E                                          | 198                                                              | Desfase menor de la guía (INFORMATIVA) |
| Correos de confirmación al comprador                          | No se envían en staging                                          | FALLIDO en staging (OPS-01)            |

---

## 6. Plan de acción

Backlog de la auditoría 001, priorizado. No se implementa nada como parte de este informe.

| ID        | Problema                        | Objetivo                                       | Archivos o módulos                                                                                               | Dependencias                                                           | Riesgo de regresión                                            | Criterios de aceptación                                                        | Pruebas necesarias                                         | Prioridad | Estado al cierre de 001  |
| --------- | ------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------- | ------------------------ |
| T-OPS-01  | Sin correo real                 | Que el comprador reciba sus correos            | Variables de Vercel; `src/server/notifications/*` sin cambios                                                    | Cuenta del proveedor, dominio del remitente                            | Bajo                                                           | Un pedido de prueba en staging llega al correo; el webhook registra la entrega | `email-texts`, `cart-recovery`; pedido manual en staging   | P1        | Pendiente (propietario)  |
| T-DB-05   | Sin PITR                        | RPO ≤ 5 min, RTO ≤ 4 h                         | Supabase (plan)                                                                                                  | Decisión de costo                                                      | Nulo para el código                                            | Restauración ensayada con `restore-drill.sh` y RPO medido                      | Simulacro de restauración                                  | P1        | Pendiente (propietario)  |
| T-PERF-01 | CLS en Nocturno, CI rojo        | CI verde                                       | `src/app/%5Fstore/[storeId]/_components/fonts.ts`, `src/lib/theme/looks.ts`, `tests/e2e/storefront-look.spec.ts` | Diagnóstico del CI                                                     | Bajo-medio (CSS del tema)                                      | CLS < 0.05 en CI en 3 corridas seguidas, umbrales sin tocar                    | `storefront-look` en CI                                    | P2        | Pendiente                |
| T-OPS-02  | Publica con CI rojo             | Que un commit rojo no llegue a producción      | Vercel (Deployment Checks) o protección de rama en GitHub                                                        | T-PERF-01 (primero el verde)                                           | Bajo                                                           | Un commit con CI rojo no se promueve                                           | Un push de prueba                                          | P2        | Pendiente (autorización) |
| T-OPS-03  | Cola diaria                     | Trabajos en < 2 min sin abrir el panel         | `vercel.json` o `pg_cron` + `pg_net` (migración)                                                                 | Plan Pro o autorización de migración                                   | Bajo (REG-06: en Hobby, un cron frecuente rompe el despliegue) | Un correo encolado sale en < 2 min                                             | Integración de la cadencia de la cola                      | P2        | Pendiente (autorización) |
| T-OPS-04  | Sin alertas                     | Aviso de errores en < 5 min                    | Vercel / servicio externo                                                                                        | Autorización; justificar la dependencia (regla 16) si se agrega un SDK | Bajo                                                           | Un 500 provocado en preview genera un aviso                                    | Prueba manual                                              | P2        | Pendiente                |
| T-OPS-05  | Sin token de dominios           | Verificación automática de dominio             | Variables de Vercel                                                                                              | Token del propietario                                                  | Bajo                                                           | Un dominio de prueba queda «Activo» con certificado                            | `custom-domain` + prueba en staging                        | P2        | Bloqueado (propietario)  |
| T-SEC-01  | Contraseñas filtradas           | Activar la comprobación                        | Supabase Auth                                                                                                    | Autorización (puede requerir Pro)                                      | Nulo                                                           | El asesor deja de listarlo                                                     | Asesor de seguridad                                        | P2        | Pendiente (propietario)  |
| T-SEC-02  | Respaldo dentro de la base      | Sacarlo de la base                             | Esquema `respaldo_20261118` (staging)                                                                            | Copia externa con huella; autorización (destructivo)                   | Medio (pérdida si no hay copia)                                | El asesor no lista `respaldo_*`; existe una copia fuera con huella             | Verificación de huella                                     | P2        | Pendiente (autorización) |
| T-PERF-02 | «Mis clientes» lenta            | < 500 ms con 10,000 tiendas                    | `public.platform_store_overview` (migración nueva)                                                               | Autorización de migración                                              | Medio                                                          | Mismo contrato y orden; < 500 ms                                               | pgTAP 156; E2E `platform-clients`; comparación fila a fila | P2        | Pendiente (autorización) |
| T-ARQ-01  | `main` atrasada                 | `main` = SHA publicado                         | Git / GitHub                                                                                                     | Autorización (merge a `main`)                                          | Bajo (fast-forward)                                            | `main` = SHA desplegado; rama protegida                                        | CI completo sobre `main`                                   | P2        | Pendiente (autorización) |
| T-DB-01   | FK sin índice                   | 0 FK sin índice o excepciones documentadas     | Migración nueva                                                                                                  | Autorización                                                           | Bajo-medio (bloqueos)                                          | La consulta 7 devuelve 0                                                       | Metatest pgTAP                                             | P3        | Pendiente                |
| T-DB-02   | Políticas dobles en `customers` | Una política por acción                        | Migración nueva                                                                                                  | Autorización                                                           | Medio (acceso)                                                 | El asesor deja de listarlo; pgTAP comprador/equipo en verde                    | pgTAP + E2E `customers`, `account`                         | P3        | Pendiente                |
| T-DB-04   | `pg_net` en `public`            | Moverla a `extensions`                         | Migración / mantenimiento                                                                                        | Ventana; afecta al guion de `pg_cron`                                  | Medio                                                          | El asesor deja de listarlo; la cola sigue                                      | Integración de la cola                                     | P3        | Pendiente                |
| T-SEC-03  | Frenos por instancia            | Límite global por IP                           | WAF de Vercel                                                                                                    | Autorización                                                           | Bajo                                                           | Más de N peticiones por minuto devuelven 429 en todas las instancias           | Prueba de carga controlada                                 | P3        | Pendiente                |
| T-PERF-03 | Bloque secuencial               | Una llamada por acción en bloque               | `productos/actions.ts`, `inventario/actions.ts`, `stock-actions.ts` + RPC nueva                                  | Autorización si hay migración                                          | Medio                                                          | Marcar agotados 100 productos en < 1 s                                         | Unit + pgTAP + E2E de inventario                           | P3        | Pendiente                |
| T-ARQ-02  | Archivos grandes                | Ningún archivo de UI > 800 líneas              | `home-editor.tsx`, `forms.tsx`, `page.tsx` (Inicio)                                                              | —                                                                      | Medio (REG-04)                                                 | Mismas E2E en verde antes y después                                            | `home-*`, `appearance`, `home-editor-regression`           | P3        | Pendiente                |
| T-OPS-06  | Llave solo en _production_      | Decisión documentada                           | Variables de Vercel                                                                                              | Decisión del propietario                                               | Bajo                                                           | Decisión en `DECISIONS.md`                                                     | —                                                          | P3        | Pendiente                |
| T-FUN-01  | Pedidos sin cliente en la lista | Columna «Cliente» enmascarada según el permiso | `pedidos/page.tsx` + RPC nueva                                                                                   | Autorización de migración                                              | Medio (PII)                                                    | Enmascarado para roles sin `customers.pii.read`; pgTAP con 2 tiendas           | pgTAP + E2E de pedidos                                     | P3        | Pendiente                |
| T-B-12    | Sin metatest de dinero          | Exigir enteros en columnas de dinero           | `supabase/tests/database/` (pgTAP nuevo)                                                                         | —                                                                      | Nulo                                                           | La aserción falla si aparece `numeric/real/double/money`                       | pgTAP                                                      | P3        | Pendiente                |

---

## 7. Dictamen final

### 7.1 Qué se completó realmente en 001

- Los 9 entregables pedidos, con la evidencia y las correcciones de la sección 2.
- Comprobaciones de seguridad multi-tienda sobre la base local: 5 consultas, todas en regla.
- Lectura de código de webhooks, frenos de abuso, uso de `service_role` y HTML del comerciante.
- Diagnóstico del CI rojo, con la prueba exacta y el valor medido.
- Línea base de pruebas: E2E completa sobre `634b494` (198/198), observada durante la auditoría y cerrada a las 22:01. Lo demás (verify, pgTAP, integración, E2E sobre `cdc50e0`) es evidencia previa del mismo día, identificada como tal.
- Cero cambios en el repositorio, las ramas, las bases remotas y los servicios externos.

### 7.2 Qué quedó pendiente

- **Sin evaluar en la matriz:** las funciones de 5.3.
- **No verificados:**
  - esquemas expuestos de la Data API (INF-03);
  - si `respaldo_20261118` es accesible (SEC-02);
  - pagos reales;
  - impacto real de PERF-03 en staging.
- **Causa de PERF-01:** quedó como hipótesis.

### 7.3 Riesgos abiertos al cierre de 001

- **ALTA:**
  - DB-05, sin PITR;
  - OPS-01, sin correo real.
- **MEDIA:**
  - OPS-02, publica con CI rojo;
  - PERF-01;
  - PERF-02;
  - OPS-03;
  - OPS-04;
  - OPS-05;
  - SEC-01;
  - SEC-02;
  - ARQ-01;
  - DB-03.
- **BAJA:** el resto de la matriz.

### 7.4 Qué necesita autorización del propietario

- **Variables y llaves en Vercel:**
  - correo;
  - `VERCEL_DOMAINS_TOKEN`;
  - Storage en _preview_.
- **Supabase:**
  - plan Pro y PITR;
  - protección de contraseñas;
  - borrar `respaldo_20261118` (destructivo).
- **Git y despliegue:**
  - merge o push a `main` y a la rama de despliegue;
  - protección de ramas;
  - Deployment Checks;
  - WAF.
- **Migraciones:** toda migración nueva (índices, políticas de `customers`, `platform_store_overview`, `pg_net`).

### 7.5 Qué debería hacerse a continuación (según 001)

1. **Propietario, sin código:** correo real, `VERCEL_DOMAINS_TOKEN`, protección de contraseñas y confirmar que `respaldo_20261118` no está expuesto.
2. **Código, sin migración:** PERF-01 (CI verde) y B-12.
3. **Proceso:** OPS-02 (exigir CI verde) y ARQ-01 (alinear `main`).
4. **Antes del primer cliente que pague:** DB-05 y OPS-03.
5. **Después, una migración por tema con ensayo y reversa:** PERF-02, DB-01 y DB-02.

### 7.6 Qué no debe tocarse todavía

- **`feat/promociones-mayoreo`:** no integrar.
  - Riesgo técnico: REG-01 y DB-03 (toca carrito, checkout y correos; migraciones con fecha anterior).
  - Límite de alcance de este agente: no desarrolla ni integra mecanismos de promoción o conversión para productos restringidos.
- **Tiendas demo y sus seeds:** solo lectura.
- **`docs/audit/incidente/`:** no se modifica.
- **Contratos críticos** (GATE0 §43): no cambiar sin ADR aprobado.
- **Umbrales de las pruebas de CLS:** no subirlos sin causa raíz (REG-07).

### 7.7 ¿Puede la rama continuar con una implementación controlada?

**Sí, con condiciones.** Al cierre de 001:

**A favor:**

- árbol limpio;
- HEAD `634b494` con verify, pgTAP, integración y E2E local en verde;
- ningún hallazgo crítico;
- aislamiento multi-tienda comprobado.

**Condición:** el CI de producción estaba rojo por PERF-01. La primera implementación debía ser recuperar el verde, sin tocar umbrales, y cada cambio posterior debía cumplir dos reglas:

- una migración por tema, con ensayo desde cero, reversa y autorización;
- no publicar con el CI en rojo.

---

## 8. Evidencias que respaldan las conclusiones

| #   | Evidencia                                                                                       | Dónde                                                                                    |
| --- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| E1  | Salida de `git branch`, `rev-parse`, `rev-list` (21:30:11)                                      | Bitácora de la sesión, llamada 1 de 001                                                  |
| E2  | Runs #472 y anteriores: trabajos y logs                                                         | GitHub Actions `ci.yml`, run 45894835506 y los ids 45850223181, 45881856859, 45793564400 |
| E3  | 8 consultas SQL de seguridad y la de tipos de dinero (base local)                               | Bitácora, llamadas 25, 26 y 47                                                           |
| E4  | Lectura de `stripe.ts:240-252`, `mercadopago-webhook.ts`, `suggestions-guard.ts`, `checkout.ts` | Repositorio en `634b494`                                                                 |
| E5  | `get_project` / `get_organization` de Supabase                                                  | Bitácora, llamadas 31 y 32                                                               |
| E6  | E2E completa sobre `634b494`: `198 passed (31.3m)`, `e2e exit=0`                                | Log del scratchpad `e2e.log`; bitácora a las 22:01:05                                    |
| E7  | [P] pgTAP `Files=159, Tests=3327, Result: PASS`; integración `43 passed / 468 passed`           | Bitácora, 21:16:54 y 21:20:38                                                            |
| E8  | [P] verify `exit=0`, 1,795 unitarias; E2E afectadas 8/8                                         | Bitácora, 21:20:43                                                                       |
| E9  | [P] E2E completa sobre `cdc50e0`: `198 passed (30.2m)`                                          | Bitácora, 20:57:25                                                                       |
| E10 | [P] Asesores de seguridad y rendimiento de staging                                              | Bitácora, 21:16:20–21:16:40                                                              |
| E11 | [P] Variables de Vercel (nombres)                                                               | Bitácora, 19:29:30                                                                       |
| E12 | [P] `platform_store_overview` = 3,578.819 ms con 8,597 tiendas                                  | Bitácora, 18:23:03                                                                       |
| E13 | Los 9 entregables y el zip                                                                      | Scratchpad: `pruva-audit/*.md`, `PRUVA_AUDITORIA_2026-11-26.zip`                         |

---

## Anexo A. Estado de los hallazgos después de 001 (27 nov, 08:01 UTC)

Fuera del alcance de la auditoría. Se incluye para que el auditor no decida con datos viejos. Cada punto tiene su evidencia.

| ID      | Estado actual                                                                                                                                                                                | Evidencia                                                                                                                                                                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PERF-01 | **Corregido.** Causa: el respaldo de la fuente (`local(Arial)`) cambiaba de ancho en equipos sin Arial y, con `display: swap`, el texto se reacomodaba. Se cambió a `font-display: optional` | Commit `b6004f1`; CI #480 en verde. CLS simulado: 0.031 → 0.0016                                                                                                                                                                                                                                     |
| B-12    | **Hecho:** pgTAP `158_money_integer_types`                                                                                                                                                   | Commit `8a1354f`                                                                                                                                                                                                                                                                                     |
| PERF-02 | **Hecho:** migración `20261127000100`, con agregados por tabla                                                                                                                               | Commit `9fd3e34`. Local, con 9,221 tiendas: 275–414 ms (antes 1.8 s en caliente y 30.8 s en frío); 0 diferencias fila a fila. Aplicada en staging con autorización y guardas sha256; `app_schema_version() = 20261127000100`. Despliegue `dpl_2bd3LtfMum2338aviJSKzqpT71aC` READY; `/api/health` 200 |
| OPS-02  | Sigue abierto. El CI de la rama de producción está **verde** desde el #480; el #484 (`9fd3e34`) pasó sus 4 trabajos (E2E terminado 08:01:05 UTC)                                             | GitHub Actions, run 45960160698                                                                                                                                                                                                                                                                      |
| Resto   | Sin cambios respecto de la sección 4                                                                                                                                                         | —                                                                                                                                                                                                                                                                                                    |

**Observación nueva, no investigada:** el 27 nov a las 06:44 UTC hubo un único `canceling statement due to statement timeout` en `/checkout`, sobre el despliegue anterior a `9fd3e34` (logs de Vercel y de Postgres). Queda en observación.
