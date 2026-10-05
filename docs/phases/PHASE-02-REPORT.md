# Gate F2 — Informe de cierre: Fase 2 (Identity, Tenancy & Access)

> Contrato: GATE0 §38 (PHASE 2), §7, §8, §21, §27, §44. Decisiones: `docs/DECISIONS.md` D-F2-01 … D-F2-32.
> Rama `claude/ecommerce-regulated-platform-41vu1e`, commits `4b74b5d` … (ver `git log 473fb44..HEAD`).
> **Push bloqueado (P0):** GitHub devuelve 403. El CI de GitHub no ha corrido; todos los resultados son locales. Respaldo en bundles.

## 1. Cambios realizados

| Área                              | Resultado                                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidad y tenancy (A + B)       | 19 tablas con RLS forzado, roles y matriz de permisos (§8.3), auditoría particionada, eventos de seguridad, límites del plan por trigger.                                                     |
| Stack local sin Docker (F2-T01)   | Supabase Auth real (GoTrue), PostgREST y Mailpit con binarios fijados por sha256; `pnpm stack up`.                                                                                            |
| Equipo (F2-T02)                   | Invitar, cambiar rol (tienda/organización), suspender, reactivar, quitar, revocar, transferir la propiedad, listar el equipo.                                                                 |
| Soporte (F2-T03)                  | Concesión de solo lectura de hasta 60 min, con motivo, sin autoconcesión ni solapes; aviso al dueño; revocación por plataforma, titular o dueño; auditoría de cada página abierta.            |
| Flags y estado de tenant (F2-T04) | Resolución kill switch ▷ tienda ▷ organización ▷ plan ▷ entitlement ▷ default; suspender, reactivar y cerrar con motivo.                                                                      |
| Capa de servidor (F2-T05)         | Contexto de tienda por request (permisos en vivo, nunca en el JWT), sesión verificada con `getClaims`, mapeo de errores a `AppError`.                                                         |
| Proxy (F2-T06)                    | Host del panel frente a host de tienda; `store_id` solo desde `store_domains`; 404 uniforme, 503 de mantenimiento, 301 al primario; vista previa firmada (CF-09); reescritura firmada (gate). |
| Acceso del staff (F2-T07)         | Código por email sin autorregistro → TOTP obligatorio → AAL2; eventos de seguridad sin PII.                                                                                                   |
| Emails (F2-T08)                   | Canal Resend/Mailpit/fake, entregas deduplicadas, invitación y aviso de soporte por la cola.                                                                                                  |
| UI (F2-T09)                       | Dialog, Drawer, Toast, Select, Checkbox, Tabs, Table accesibles (axe).                                                                                                                        |
| Panel y Equipo (F2-T10)           | Aceptación de invitaciones, panel por tienda con selector, Ajustes → Equipo, reset de MFA vía SR-1.                                                                                           |
| Onboarding (F2-T11)               | 4 pasos; contraste validado en la base al guardar y al publicar; pagos según A-02; borrador con vista previa.                                                                                 |
| Consola (F2-T12)                  | `/platform`: organizaciones, alta asistida, suspender/reactivar, accesos de soporte.                                                                                                          |
| Gate                              | Correcciones de la revisión de seguridad (ver §6), `system.user_has_store_permission`, `audit.log_change`.                                                                                    |

## 2. Archivos principales

- `supabase/migrations/2026100[678]*.sql` (14 migraciones de la fase).
- `src/proxy.ts`, `src/server/{auth,db,routing,storefront,notifications,invitations,team,privileged,actions,supabase}/`.
- `src/app/(acceso)/`, `src/app/admin/`, `src/app/platform/`, `src/app/%5Fstore/`.
- `src/ui/primitives/*`, `src/lib/theme/palette.ts`.
- `scripts/dev/{stack.sh,gateway.mjs,keys.mjs}`, `docs/runbooks/local-stack.md`.
- Pruebas: `supabase/tests/database/03…14`, `tests/{integration,stack,e2e}/`.

## 3. Migraciones

Forward-only y probadas desde cero en cada `pnpm db:test` y `pnpm stack reset`:

- `20261006000100…000500`: modelo, auditoría, autorización, RLS y RPC base.
- `20261007000100`: equipo. `…000200`: soporte. `…000300`: flags y estado de tenant. `…000400`: contexto por request. `…000500`: notificaciones. `…000600`: peek de invitación y reset de MFA. `…000700`: onboarding. `…000800`: consola.
- `20261008000100`: endurecimiento del gate. `20261008000200`: reactivación con la organización suspendida.

## 4. Pruebas y resultados (locales, 2026-10-05)

| Suite                                                                    | Resultado                                |
| ------------------------------------------------------------------------ | ---------------------------------------- |
| `pnpm verify` (lint, formato, tipos, unit, build)                        | ✅ 175 unit                              |
| `pnpm db:test` — pgTAP (16 archivos)                                     | ✅ 478                                   |
| `pnpm db:test` — integración (system_worker, paridad TS ↔ SQL, permisos) | ✅ 21                                    |
| `pnpm test:stack` (Auth real + PostgREST + app compilada)                | ✅ 22                                    |
| `pnpm test:e2e` (Playwright, Chromium)                                   | ✅ 10                                    |
| gitleaks (árbol de trabajo)                                              | ✅ sin hallazgos en archivos versionados |

**Pruebas de mutación** (cada regresión inyectada fue detectada y revertida): AAL2 desactivada, rango de `store_admin`, protección del dueño, `org_admin` invitando a `org_admin`, listado sin permiso, titular de soporte cualquiera, página de soporte ajena, revocación por `org_admin`, concesiones superpuestas, kill switch ignorado, caducidad ignorada, reactivar publicando, soporte suspendiendo tenants.

**Fallos reales encontrados por las pruebas y corregidos:**

- NULL en la comprobación del dueño al revocar soporte: un dueño ajeno podía revocar (F2-T03).
- jsonb doblemente codificado en eventos de seguridad (F2-T07).
- Reescritura del proxy tratada como proxy externo (F2-T06).
- Regla de contraste imposible de incumplir (F2-T11).
- Aceptar la invitación del dueño no llevaba a su tienda (gate).

## 5. Criterios de aceptación (GATE0 §38, PHASE 2)

| Criterio                                                                                          | Estado                                                                                              |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Un usuario de B no puede leer ni modificar nada de A                                              | ✅ suite genérica de aislamiento (pgTAP) + PostgREST real + E2E                                     |
| Escalada imposible                                                                                | ✅ un caso por regla de §8.3 + ataques entre tenants + acciones forzadas por la API (403)           |
| Auditoría presente                                                                                | ✅ membresías, concesiones, páginas de soporte, flags, tenant, tema, datos de tienda, configuración |
| aal1 frente a aal2                                                                                | ✅ base, PostgREST y E2E                                                                            |
| Miembro suspendido sin acceso inmediato                                                           | ✅ pgTAP + E2E                                                                                      |
| Soporte sin concesión, con concesión y caducado                                                   | ✅ pgTAP + E2E                                                                                      |
| Modo `read_only` deniega `write`                                                                  | ✅ pgTAP                                                                                            |
| E2E: plataforma crea tenant → dueño acepta → MFA → invita a `catalog_manager` → este no ve Equipo | ✅ (`platform.spec` + `team.spec`)                                                                  |
| Rate limit de login                                                                               | ✅ límites de Supabase Auth (`[auth.rate_limit]`); la UI no los revela                              |
| Supabase advisors sin hallazgos                                                                   | ⏳ requiere el proyecto Supabase real                                                               |

## 6. Revisión de seguridad del gate

Revisión adversarial independiente del diff completo de la fase. Hallazgos y estado:

| #   | Severidad          | Hallazgo                                                                                               | Estado                                                                       |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1   | Media (Alta en F5) | El matcher del proxy eximía las cabeceras de prefetch: `/_store/{id}` accesible sin resolución de host | ✅ Corregido + firma HMAC de la reescritura + prueba de stack con el exploit |
| 2   | Media              | El reset de MFA de una organización borraba factores usados en otra organización o en la plataforma    | ✅ Rechazado en ese caso (pgTAP)                                             |
| 3   | Media-baja         | Auditoría de páginas de soporte solo en la primera carga                                               | ✅ En `template.tsx`, por navegación                                         |
| 4   | Baja               | Enumeración de cuentas por el mensaje de límite de frecuencia                                          | ✅ Respuesta idéntica                                                        |
| 5   | Baja               | Comparaciones NULL en sentencias separadas                                                             | ✅ `is distinct from`                                                        |

### Revisión de código del gate

Revisión independiente de corrección del mismo diff (8 hallazgos, ninguno bloqueante; todos corregidos):

| #   | Hallazgo                                                                                 | Corrección                                                                                               |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | Las acciones de la consola convertían `redirect()`/`notFound()` en "error inesperado"    | `reportActionError` deja pasar los errores de control de Next (`unstable_rethrow`) en todas las acciones |
| 2   | React 19 vaciaba los formularios tras un error                                           | Las acciones devuelven lo escrito y los campos lo usan como valor inicial (prueba E2E)                   |
| 3   | Errores de campos sin campo visible (p. ej. `ticket_ref`) no se mostraban                | Error general si ningún campo mostrado lo recoge; `ticket_ref` cableado                                  |
| 4   | Fecha formateada en el cliente: desajuste de hidratación                                 | Formateada en el servidor con la zona horaria de la tienda                                               |
| 5   | "Reactivar" en la tienda con la organización suspendida informaba éxito sin cambiar nada | Error explícito `member_org_suspended` (migración `20261008000200`, pgTAP)                               |
| 6   | "Revocar" en la consola ocultaba los errores                                             | Se muestran                                                                                              |
| 7   | Mensajes engañosos (mínimo del motivo, slug duplicado)                                   | Mensajes por acción                                                                                      |
| 8   | Una invitación caducada en la cookie redirigía en cada acceso                            | Se verifica y, si no está vigente, se borra                                                              |

## 7. Riesgos

| Riesgo                                                                    | Mitigación / estado                                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| P0: sin push ni CI de GitHub                                              | Bundles verificados en el scratchpad; el job `stack` de CI está listo pero sin ejecutar.                                      |
| S-1 (Supavisor + roles propios) y S-2 alojado (recovery, Send Email Hook) | Verificar al crear el proyecto real; el modelo ya está probado contra GoTrue v2.197.0.                                        |
| Pruebas en PG16; producción PG17                                          | SQL compatible con PG15+; ejecutar `supabase test db` en el proyecto real.                                                    |
| Caché de resolución de host por instancia (60 s)                          | Una tienda suspendida puede tardar hasta 60 s en mostrar mantenimiento por instancia; la autorización del panel es inmediata. |

## 8. Pendientes

**Dependen del propietario:**

1. Dar acceso de escritura a GitHub (P0).
2. Crear el proyecto Supabase (Pro + PITR) y el de Vercel; con ellos: S-1, S-2, advisors, `supabase test db`.
3. Nombres de los dos dominios (N-3) y proveedor de pagos (N-1, antes de la F7).

**Técnicos, ya asignados:**

- Fase 7: aviso al dueño de suspensión de tenant y de transferencia de propiedad (D-F2-16, D-F2-20).
- Programar `purge_finished_jobs` y `maintain_audit_partitions` (job periódico; Fase 11 a más tardar).
- Fase 5: ADR de CSP del storefront (A-05) y storefront real sobre `/_store`.

## 9. Definition of Done

- [x] Todas las tareas F2-T01 … F2-T12 hechas con pruebas.
- [x] Suites verdes en local; mutaciones detectadas.
- [x] Revisiones de seguridad y de código hechas; hallazgos corregidos.
- [x] `docs/` al día (decisiones, runbooks, progreso).
- [ ] CI verde en GitHub (bloqueado por P0).
- [ ] Supabase advisors (requiere el proyecto real).
