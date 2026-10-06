# Gate F5 — Informe de cierre: Fase 5 (Storefront, Content & SEO)

> Contrato: GATE0 §38 (PHASE 5), §13, §20-25, §44. Decisiones: `docs/DECISIONS.md` D-F5-01 … D-F5-07.
> Rama `claude/ecommerce-regulated-platform-41vu1e`, commits `eccf63d` … (ver `git log a691c4c..HEAD`).
> **Push bloqueado (P0):** GitHub devuelve 403. El CI no ha corrido; todos los resultados son locales. Respaldo: `pruva-f5.bundle`.

## 1. Cambios realizados

| Área                       | Resultado                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contenido (F5-T01)         | `menus` (main/footer), `menu_items` (2 niveles, destino polimórfico validado), `store_pages`; cada tienda nace con 4 políticas en **borrador** (guías con marcadores, sin texto legal inventado). |
| Lecturas públicas (F5-T02) | `storefront.*` solo para `storefront_gateway`: listado con cursor, ficha, categoría, marca, menús con fallback, páginas, inicio, disponibilidad por estado y sitemap.                             |
| Tema base (F5-T03)         | Inicio, catálogo, ficha con selector de variantes, categoría, marca, búsqueda, páginas, 404/503, barra de vista previa; tema por variables CSS de lista blanca con nonce.                         |
| Caché (F5-T04)             | Datos cacheados por tienda (`store:{id}`, TTL 60 s), invalidados desde cada acción del panel y el worker de medios; HTML dinámico con CSP por nonce (ADR D-F5-04).                                |
| SEO (F5-T05)               | Canonical al dominio primario, Open Graph/Twitter, JSON-LD (OnlineStore, WebSite, Product, BreadcrumbList, CollectionPage), sitemap y robots por host, noindex en borrador y vista previa.        |
| Editor (F5-T06)            | Panel «Contenido»: páginas (crear, editar HTML básico sanitizado, publicar, eliminar) y menús principal y del pie.                                                                                |
| Gate                       | Correcciones de Lighthouse y de la revisión adversarial (§5).                                                                                                                                     |

## 2. Migraciones

`20261012000100` contenido · `…000200` lecturas `storefront.*` · `…000300` hostname primario · `…000400` RPC del editor · `…000500` correcciones del gate. Forward-only, probadas desde cero.

## 3. Pruebas y resultados (locales, 2026-10-06)

| Suite                                             | Resultado |
| ------------------------------------------------- | --------- |
| `pnpm verify` (lint, formato, tipos, unit, build) | ✅ 266    |
| `pnpm db:test` — pgTAP (27 archivos)              | ✅ 809    |
| `pnpm db:test` — integración                      | ✅ 36     |
| `pnpm test:stack`                                 | ✅ 29     |
| `pnpm test:e2e` (con axe)                         | ✅ 18     |

**Lighthouse 12** (móvil, local, tienda con datos sintéticos; tras las correcciones del gate):

| Página              | Rendimiento | Accesibilidad | Buenas prácticas | SEO | LCP    |
| ------------------- | ----------- | ------------- | ---------------- | --- | ------ |
| `/`                 | 100         | 100           | 100              | 100 | 1,75 s |
| `/productos`        | 100         | 100           | 100              | 100 | 1,61 s |
| `/productos/{slug}` | 100         | 100           | 100              | 100 | 1,61 s |

Primera medición: rendimiento 99-100, accesibilidad 98-100, buenas prácticas 96, SEO 92-100. Corregido: `favicon.ico` 404 (luego 500 por un 204 en ruta estática), falta de meta description, salto de h1 a h3 en las tarjetas del listado. **Mutación:** sin la verificación de ancestros de `app.category_public`, 6 pruebas del gate y 1 del sitemap fallan.

## 4. Criterios de aceptación (GATE0 §38, PHASE 5)

| Criterio                                                 | Estado                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Dos tiendas en dos hosts sin mezcla de datos ni de caché | ✅ E2E + stack (cabeceras falsas, `/_store` directo, prefetch)                   |
| Host desconocido → 404 uniforme; suspendida → 503        | ✅ E2E + stack                                                                   |
| Vista previa (válida, expirada, de otra tienda)          | ✅ unit + stack                                                                  |
| SEO: canonical, JSON-LD, sitemap por host, robots        | ✅ unit + E2E                                                                    |
| `SafeHtml`, CSP del storefront, `noindex` en borrador    | ✅ E2E (script eliminado), cabeceras                                             |
| axe sin violaciones serias                               | ✅ E2E en storefront y panel                                                     |
| Lighthouse ≥ 90                                          | ✅ local (Lighthouse CI con presupuestos y staging: pendiente de P0 y proyectos) |
| Editor mínimo de menús y páginas                         | ✅ pgTAP + E2E                                                                   |

## 5. Revisión del gate

Revisión adversarial (aislamiento, fugas, XSS, funciones SECURITY DEFINER, DoS, corrección): **sin fugas entre tiendas** (claves de `unstable_cache` incluyen todos los argumentos; todas las consultas filtran `store_id`; destinos de menú de la misma tienda; cabeceras internas eliminadas por el proxy) **y sin XSS**. Corregido:

1. Medio: la ficha de un producto activo sin variantes vendibles respondía 500 (JSON-LD con `Math.min([])`). La base ya impide guardarlo (Gate F3); la página ya no construye la oferta sin variantes.
2. Medio: cada cursor o búsqueda creaba una entrada de caché nueva (crecimiento ilimitado) → solo se cachea la primera página sin búsqueda. Riesgo residual en §6.
3. Bajo/medio: productos de una subcategoría bajo un ancestro **oculto** aparecían en la categoría visible, con migas y enlaces de menú a un 404; además un ancestro borrado con el mismo path ocultaba a la categoría viva → `app.category_public` (recorre `parent_id`) en listado, ficha, categoría, menús y sitemap.
4. Bajo/medio: un destino de menú borrado bloqueaba guardar todo el menú sin decir cuál → se marca, se vacía y se explica; los productos ya enlazados siguen disponibles aunque no estén entre los 200 recientes.
5. Bajo: una página publicada se podía vaciar al editarla; entradas inválidas por la Data API (uuid, `children`) daban 22P02/22023 → `validation_failed`.
6. Bajo: sin dominio primario activo el canonical apuntaba a `https://{handle}` → subdominio de plataforma activo.
7. Bajo: un %-escape malformado respondía 500 en cualquier host (router de Next) → el proxy responde 404.
8. Bajo: el extracto mostraba entidades (`&amp;`); precio ascendente ponía primero productos sin precio.

Aceptado sin cambio: `appearance_publish_theme` no tiene botón en el panel todavía (editor de tema completo = F9), por eso la vista previa muestra el tema publicado (D-F5-07); la suspensión de una organización la aplica el proxy con TTL de 60 s (D-F5-04).

## 6. Riesgos

- `list_products` con `disponible=1` o relevancia calcula el estado por producto antes de paginar: costo lineal en el tamaño de la tienda (acotado por `max_products` del plan). Precalcular la disponibilidad por producto si los presupuestos de §33 no se cumplen en staging.
- Invalidación desde Server Actions: una RPC llamada directamente por la Data API no invalida (TTL 60 s como red de seguridad). Evaluar invalidación emitida por la base (outbox) con los webhooks de la Fase 7.

## 7. Pendientes

- Lighthouse CI con presupuestos y medición en staging (requiere CI: P0, y proyectos Supabase/Vercel).
- Editor de tema completo, secciones configurables del inicio y favicon por tienda (F9).
- Owner: acceso de escritura a GitHub (P0), proyectos Supabase y Vercel, Stripe antes de la F7.

## 8. Definition of Done

- [x] Suite completa en verde (local).
- [x] Migraciones forward-only probadas desde cero.
- [x] Lighthouse ≥ 90 (local).
- [x] Decisiones registradas (D-F5-01 … D-F5-07).
- [ ] CI de GitHub (bloqueado por P0).
