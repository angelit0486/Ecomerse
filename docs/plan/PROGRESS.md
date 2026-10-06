# Progreso del modo autónomo

> Memoria entre sesiones. Se lee al empezar y se actualiza **después de cada tarea**.
> Estados: `pendiente` · `en curso` · `hecha` · `bloqueada`. IDs y detalle: `docs/plan/AUTONOMOUS_PLAN.md` §4.

## Ahora

- **Fase actual:** 5 — Storefront (Fase 4 cerrada en local: `docs/phases/PHASE-04-REPORT.md`; CI pendiente por P0).
- **Siguiente tarea:** F5-T06 (editor mínimo de menús y páginas en el panel).
- **Siguiente paso exacto:** RPC `content_upsert_page`, `content_publish_page`, `content_delete_page` (content.manage, sanitizado) y `menu_set_items` (appearance.manage, destinos verificados en la tienda); páginas del panel `/admin/[h]/contenido`; E2E.
- **E2E:** `eval "$(node scripts/dev/keys.mjs | sed 's/^/export /')"; pnpm test:e2e` con la app levantada.
- **Arranque del entorno:** `pg_ctlcluster 16 main start` si PostgreSQL está apagado; `pnpm stack up` para el stack local; `pnpm build && (set -a; . ./.env.local; set +a; pnpm start -H localhost -p 3000)` para la app.

## Bloqueos (requieren al propietario)

| ID  | Bloqueo                                                                                                                                                                    | Desde      | Efecto                                                           | Mitigación activa                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| P0  | `git push` devuelve 403: la app de Claude no tiene acceso de escritura a `angelii33/pruva`. Arreglo: https://claude.ai/connect-github + instalar la app en el repositorio. | 2026-10-05 | El trabajo solo existe en el contenedor; el CI nunca ha corrido. | Bundles de respaldo en el scratchpad (último: `pruva-gate-f2.bundle`, todos los commits sin subir). |

## Commits sin subir

Todos desde `7549db7` (Gate 1) hasta F5-T05. Bundle de respaldo: `pruva-f3.bundle` en el scratchpad.

## Tablero

| Fase | Tarea                                         | Estado                      | Evidencia                                                                                                       |
| ---- | --------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0    | Contrato aprobado y versionado                | hecha                       | `7549db7`                                                                                                       |
| 1    | Foundation                                    | hecha (CI pendiente por P0) | `7549db7` · 76 unit, 47 pgTAP, 4 integración                                                                    |
| 2    | A + B: identidad, tenancy, RLS, RPC base      | hecha                       | `4b74b5d` · 196 pgTAP + mutaciones                                                                              |
| 2    | F2-T01 Spike S-6 stack local                  | hecha                       | F2-T01 · 10 pruebas `test:stack` + mutación                                                                     |
| 2    | F2-T02 RPC de equipo                          | hecha                       | F2-T02 · 86 pgTAP (282 total) + 4 mutaciones                                                                    |
| 2    | F2-T03 RPC de soporte                         | hecha                       | F2-T03 · 51 pgTAP (333 total) + 4 mutaciones                                                                    |
| 2    | F2-T04 Feature flags + estado de tenant       | hecha                       | F2-T04 · 64 pgTAP (397 total) + 4 mutaciones                                                                    |
| 2    | F2-T05 Capa de servidor                       | hecha                       | F2-T05 · 16 pgTAP, 17 unit, 2 integración, 1 stack                                                              |
| 2    | F2-T06 Proxy de dominios y vista previa       | hecha                       | `69920f0`                                                                                                       |
| 2    | F2-T07 Auth de staff (OTP + TOTP)             | hecha                       | `aa62e9b`                                                                                                       |
| 2    | F2-T08 Job de email de invitación             | hecha                       | `7189916`                                                                                                       |
| 2    | F2-T09 Primitivas de UI                       | hecha                       | `471137d`                                                                                                       |
| 2    | F2-T10 Panel y Equipo                         | hecha                       | `41eabbb`                                                                                                       |
| 2    | F2-T11 Onboarding en 4 pasos                  | hecha                       | `43152d6`                                                                                                       |
| 2    | F2-T12 Consola de plataforma mínima           | hecha                       | `06bf25d`                                                                                                       |
| 2    | Gate F2                                       | hecha                       | `297b169` · informe `docs/phases/PHASE-02-REPORT.md`                                                            |
| 3    | F3-T01 Tablas del catálogo                    | hecha                       | `9ae9edc` · 42 pgTAP                                                                                            |
| 3    | F3-T02 RPC del catálogo                       | hecha                       | `2a4ed6e` · 54 pgTAP                                                                                            |
| 3    | F3-T03 Medios (Storage, worker, purga)        | hecha                       | F3-T03 · 65 pgTAP, 12 unit, 9 integración, 5 stack con Storage real + mutaciones                                |
| 3    | F3-T04 SafeHtml                               | hecha                       | F3-T04 · 45 unit de XSS + SafeHtml + esquema; mutación de `react/no-danger`                                     |
| 3    | F3-T05 UI del catálogo                        | hecha                       | F3-T05 · E2E de la Playera (6 variantes, imagen real, publicar/archivar/eliminar/restaurar, masivas) con axe    |
| 3    | F3-T06 Logo de la tienda                      | hecha                       | `bd335c5` · 16 pgTAP + E2E (SVG rechazado, logo sin EXIF en la tienda)                                          |
| 3    | Gate F3                                       | hecha                       | `b1afc12` · informe `docs/phases/PHASE-03-REPORT.md` · 18 hallazgos corregidos                                  |
| 4    | F4-T01/T02 Tablas, ledger, ajustes y reservas | hecha                       | 44 pgTAP + concurrencia (20 compradores por 1 unidad → 1; 40 pedidos cruzados sin deadlock) con mutación        |
| 4    | F4-T03 UI de inventario                       | hecha                       | `inventory_search` (5 pgTAP) + E2E (motivo obligatorio, daño, fijar, stock bajo, historial) con axe             |
| 4    | Gate F4                                       | hecha                       | informe `docs/phases/PHASE-04-REPORT.md` · 7 hallazgos corregidos                                               |
| 5    | F5-T01 Menús, páginas y plantillas            | hecha                       | 13 pgTAP + aislamiento                                                                                          |
| 5    | F5-T02 Lecturas `storefront.*`                | hecha                       | 30 pgTAP como `storefront_gateway` (sin borradores, costos, cantidades ni otra tienda)                          |
| 5    | F5-T03 Tema base del storefront               | hecha                       | E2E en dos hosts (catálogo, ficha, categoría, marca, búsqueda, páginas, 404, 503) con axe y capturas a 375/1280 |
| 5    | F5-T04 Caché por tags + ADR CSP               | hecha                       | E2E de invalidación (con mutación) y aislamiento A/B                                                            |
| 5    | F5-T05 SEO por host                           | hecha                       | 4 unit + E2E (canonical, JSON-LD, sitemap y robots por host)                                                    |
| 5–11 | Ver el plan §4                                | pendiente                   |                                                                                                                 |

## Verificaciones pendientes con servicios reales (para el informe final)

- S-1: roles personalizados a través de Supavisor.
- S-2: Supabase Auth **alojado** (recovery, Send Email Hook). El claim `aal` y TOTP ya se verificaron con GoTrue v2.197.0 en local.
- `supabase test db` contra el proyecto real (PG17).
- S-3 (Storage alojado): vigencia real de la URL firmada de subida (2 h por defecto), que `postgres` lea `storage.objects` desde funciones SECURITY DEFINER (`media_finalize`, purga) y costo de las transformaciones de imagen (§25.3.5).
- CI de GitHub Actions (primer run, incluido el job nuevo `stack`).

## Pendientes menores registrados

- Fase 7 (notificaciones completas): aviso al dueño de suspensión/reactivación de tenant (D-F2-20) y de transferencia de propiedad (D-F2-16), con el mismo canal y `notification_deliveries`.
- Consola de plataforma: el selector de tienda para conceder soporte lista todas las tiendas; con cientos de tenants necesita búsqueda (el `Select` ya limita su altura y desplaza).
- Gate F2: endurecer con `is distinct from` las comparaciones `<> 'org_owner'` de la migración de equipo (hoy son seguras porque antes se exige `has_org_permission`; D-F2-18).

## Ideas para después (no se implementan sin aprobación)

_(vacío)_
