# Progreso del modo autónomo

> Memoria entre sesiones. Se lee al empezar y se actualiza **después de cada tarea**.
> Estados: `pendiente` · `en curso` · `hecha` · `bloqueada`. IDs y detalle: `docs/plan/AUTONOMOUS_PLAN.md` §4.

## Ahora

- **Fase actual:** 2 — Identity, Tenancy & Access (A + B hechas).
- **Siguiente tarea:** Gate F2 (revisión de seguridad y de código de toda la Fase 2, endurecimiento pendiente D-F2-18, informe `docs/phases/PHASE-02-REPORT.md`).
- **Siguiente paso exacto:** ejecutar la revisión de seguridad y la de código sobre el diff de la Fase 2 (`git diff 473fb44..HEAD`), corregir lo confirmado y escribir el informe con resultados de todas las suites.
- **E2E:** `eval "$(node scripts/dev/keys.mjs | sed 's/^/export /')"; pnpm test:e2e` con la app levantada.
- **Arranque del entorno:** `pg_ctlcluster 16 main start` si PostgreSQL está apagado; `pnpm stack up` para el stack local; `pnpm build && (set -a; . ./.env.local; set +a; pnpm start -H localhost -p 3000)` para la app.

## Bloqueos (requieren al propietario)

| ID  | Bloqueo                                                                                                                                                                    | Desde      | Efecto                                                           | Mitigación activa                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| P0  | `git push` devuelve 403: la app de Claude no tiene acceso de escritura a `angelii33/pruva`. Arreglo: https://claude.ai/connect-github + instalar la app en el repositorio. | 2026-10-05 | El trabajo solo existe en el contenedor; el CI nunca ha corrido. | Bundles de respaldo en el scratchpad (último: `pruva-f2-t12.bundle`, todos los commits sin subir). |

## Commits sin subir

`7549db7` (Gate 1) · `4b74b5d` (Fase 2 A+B) · `473fb44` (plan autónomo) · F2-T01

## Tablero

| Fase | Tarea                                    | Estado                      | Evidencia                                          |
| ---- | ---------------------------------------- | --------------------------- | -------------------------------------------------- |
| 0    | Contrato aprobado y versionado           | hecha                       | `7549db7`                                          |
| 1    | Foundation                               | hecha (CI pendiente por P0) | `7549db7` · 76 unit, 47 pgTAP, 4 integración       |
| 2    | A + B: identidad, tenancy, RLS, RPC base | hecha                       | `4b74b5d` · 196 pgTAP + mutaciones                 |
| 2    | F2-T01 Spike S-6 stack local             | hecha                       | F2-T01 · 10 pruebas `test:stack` + mutación        |
| 2    | F2-T02 RPC de equipo                     | hecha                       | F2-T02 · 86 pgTAP (282 total) + 4 mutaciones       |
| 2    | F2-T03 RPC de soporte                    | hecha                       | F2-T03 · 51 pgTAP (333 total) + 4 mutaciones       |
| 2    | F2-T04 Feature flags + estado de tenant  | hecha                       | F2-T04 · 64 pgTAP (397 total) + 4 mutaciones       |
| 2    | F2-T05 Capa de servidor                  | hecha                       | F2-T05 · 16 pgTAP, 17 unit, 2 integración, 1 stack |
| 2    | F2-T06 Proxy de dominios y vista previa  | pendiente                   |                                                    |
| 2    | F2-T07 Auth de staff (OTP + TOTP)        | pendiente                   |                                                    |
| 2    | F2-T08 Job de email de invitación        | pendiente                   |                                                    |
| 2    | F2-T09 Primitivas de UI                  | pendiente                   |                                                    |
| 2    | F2-T10 Panel y Equipo                    | pendiente                   |                                                    |
| 2    | F2-T11 Onboarding en 4 pasos             | pendiente                   |                                                    |
| 2    | F2-T12 Consola de plataforma mínima      | pendiente                   |                                                    |
| 2    | Gate F2                                  | pendiente                   |                                                    |
| 3–11 | Ver el plan §4                           | pendiente                   |                                                    |

## Verificaciones pendientes con servicios reales (para el informe final)

- S-1: roles personalizados a través de Supavisor.
- S-2: Supabase Auth **alojado** (recovery, Send Email Hook). El claim `aal` y TOTP ya se verificaron con GoTrue v2.197.0 en local.
- `supabase test db` contra el proyecto real (PG17).
- CI de GitHub Actions (primer run, incluido el job nuevo `stack`).

## Pendientes menores registrados

- Fase 7 (notificaciones completas): aviso al dueño de suspensión/reactivación de tenant (D-F2-20) y de transferencia de propiedad (D-F2-16), con el mismo canal y `notification_deliveries`.
- Gate F2: endurecer con `is distinct from` las comparaciones `<> 'org_owner'` de la migración de equipo (hoy son seguras porque antes se exige `has_org_permission`; D-F2-18).

## Ideas para después (no se implementan sin aprobación)

_(vacío)_
