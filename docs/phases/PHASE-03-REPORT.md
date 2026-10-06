# Gate F3 — Informe de cierre: Fase 3 (Catalog & Media)

> Contrato: GATE0 §38 (PHASE 3), §13, §14, §23, §25, §44. Decisiones: `docs/DECISIONS.md` D-F3-01 … D-F3-09.
> Rama `claude/ecommerce-regulated-platform-41vu1e`, commits `9ae9edc` … (ver `git log 297b169..HEAD`).
> **Push bloqueado (P0):** GitHub devuelve 403. El CI no ha corrido; todos los resultados son locales. Respaldo: `pruva-f3.bundle`.

## 1. Cambios realizados

| Área                          | Resultado                                                                                                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tablas del catálogo (F3-T01)  | 10 tablas con `store_id`, RLS forzado (solo lectura), FK compuestas en todas las relaciones, "un valor por opción" declarativo, firma de variante verificada por constraint trigger diferido, `search_vector`, min/max de precio, límites del plan. |
| RPC del catálogo (F3-T02)     | Alta/edición transaccional del producto completo, validación de publicación (§14.3), estados, borrado lógico y restauración, duplicar, categorías (árbol con anti-ciclos y 4 niveles), marcas, búsqueda del panel con cursor.                       |
| Medios (F3-T03)               | Subida directa a Storage por URL firmada a un bucket **privado**; worker con magic bytes, decodificador esperado, límite de píxeles y re-codificación con sharp (sin EXIF ni contenido añadido); publicación en `store-media`; purga diaria.        |
| HTML del comerciante (F3-T04) | Lista blanca estricta (`sanitize-html`) al guardar y siempre al renderizar (`SafeHtml`, única excepción a `react/no-danger`).                                                                                                                       |
| UI del catálogo (F3-T05)      | Listado con búsqueda (título o SKU), filtros, cursor y acciones masivas; editor simple o con hasta 3 opciones y tabla de variantes; imágenes; categorías y marcas.                                                                                  |
| Logo (F3-T06)                 | Logo `store_branding` (2 MB) por el mismo pipeline, en el borrador del branding y publicado con el tema; visible en el storefront.                                                                                                                  |
| Stack local                   | Supabase Storage **real** (v1.79.33, compilado de un commit fijado con Node 24 verificado) junto a Auth, PostgREST y Mailpit; CORS como Kong.                                                                                                       |
| Gate                          | Correcciones de las revisiones de código y de seguridad (§6).                                                                                                                                                                                       |

## 2. Archivos principales

- `supabase/migrations/20261009000100…000400`, `20261010000100` (5 migraciones de la fase).
- `src/server/{catalog,media,security/sanitize.ts,privileged/storage-admin.ts}`, `src/ui/safe-html.tsx`.
- `src/app/admin/[storeHandle]/productos/**`, `src/app/admin/[storeHandle]/configuracion/logo-form.tsx`.
- `src/lib/{catalog,money,media}/`.
- `scripts/dev/{stack.sh,gateway.mjs}`, `scripts/db/supabase-shim-storage*.sql`.
- Pruebas: `supabase/tests/database/15…19`, `tests/integration/media-worker.test.ts`, `tests/stack/media.test.ts`, `tests/e2e/{catalog,logo}.spec.ts`.

## 3. Migraciones

Forward-only y probadas desde cero en cada `pnpm db:test`:

- `20261009000100` tablas del catálogo · `…000200` RPC del catálogo · `…000300` medios (buckets, política de Storage, RPC y funciones del worker) · `…000400` logo.
- `20261010000100` correcciones del gate (redefine `catalog_upsert_product`, `catalog_upsert_category`, `catalog_search_products`, `system.media_for_processing`, `system.media_purge_candidates`; CHECK de etiquetas y specs).

## 4. Pruebas y resultados (locales, 2026-10-06)

| Suite                                                     | Resultado |
| --------------------------------------------------------- | --------- |
| `pnpm verify` (lint, formato, tipos, unit, build)         | ✅ 257    |
| `pnpm db:test` — pgTAP (21 archivos)                      | ✅ 671    |
| `pnpm db:test` — integración (worker con `system_worker`) | ✅ 31     |
| `pnpm test:stack` (Auth + Storage reales, PostgREST, app) | ✅ 27     |
| `pnpm test:e2e` (Playwright, Chromium, axe)               | ✅ 12     |

**Fixtures maliciosos** (unit + integración + stack): polyglot JPEG+HTML+ZIP, SVG con `onload` declarado como PNG, MIME falso, GIF y HTML disfrazados, bomba de descompresión (PNG de 100 MP en pocos KB), EXIF con orientación y autor, archivo truncado, original mayor que lo declarado.

**Pruebas de mutación** (cada regresión inyectada fue detectada y revertida): política de subida sin creador ni ventana (pgTAP y contra el Storage real), slug y visibilidad de categoría sobrescritos, SKU exacto repetido en el cursor, `react/no-danger` fuera de `SafeHtml`.

## 5. Criterios de aceptación (GATE0 §38, PHASE 3)

| Criterio                                                                       | Estado                                                                                                                  |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Invariantes de §14 probadas (SKU, combinación, FK compuestas, ciclos, límites) | ✅ pgTAP 15, 16, 19                                                                                                     |
| Ningún medio sin procesar se sirve                                             | ✅ original en bucket privado; stack: la URL pública del original falla y la del rechazado no existe                    |
| Uploads maliciosos → `rejected`                                                | ✅                                                                                                                      |
| Aislamiento ampliado (catálogo + Storage)                                      | ✅ suite genérica de aislamiento + política de Storage contra el servidor real (otra tienda, sin 2FA, ruta sin reserva) |
| E2E: "Playera" de 6 variantes → publicar → archivar → restaurar                | ✅ `catalog.spec` (además: imagen real, eliminar, acciones masivas, agregar opción conservando la variante)             |
| axe sin violaciones serias en el editor                                        | ✅ en listado, editor, producto con imagen, categorías y configuración                                                  |
| Unit: generador, firma, sanitización                                           | ✅                                                                                                                      |

## 6. Revisión del gate

Dos revisiones adversariales independientes del diff de la fase.

**Seguridad: sin hallazgos críticos ni altos** (ninguna vía para leer o modificar datos de otra tienda). Corregido:

1. Editar un producto **publicado** podía dejarlo con precio 0 o sin variantes activas (se esquivaba §14.3) → la RPC valida al guardar un producto activo.
2. La cuota `storage_mb` se podía esquivar declarando un tamaño menor → el worker rechaza (`too_large`) un original mayor que lo declarado.
3. Imágenes pesadas podían agotar el tiempo del runner y retrasar jobs de otras tiendas → `sharp.timeout(15 s)`, AVIF con menos esfuerzo y un job por reclamo con el plazo comprobado antes de cada uno.
4. Etiquetas y specs sin límite en la base (la Data API no pasa por Zod) → CHECK en `products`.
5. Aceptado y documentado: las imágenes de un producto eliminado siguen accesibles por su URL (no listable, no adivinable) mientras sea restaurable.

**Código** (13 hallazgos, todos corregidos):

- Alto: las categorías se guardaban siempre ocultas; el editor perdía id, SKU, costo y código de barras de las variantes al agregar o renombrar opciones (y el SKU reutilizado chocaba consigo mismo).
- Medio: el SKU exacto se repetía en cada página del cursor; cada guardado sobrescribía peso, medidas, inventario y specs no mostrados; renombrar una categoría cambiaba su dirección; sin tope de combinaciones en el editor; un objeto con nombre ajeno bloqueaba la purga.
- Bajo: selección masiva obsoleta, filtro de categoría perdido en «Primera página», subidas atascadas si falla la red, mensajes de error de opciones y de slug, logo vigente no encontrado tras muchas subidas.
- Encontrado por las pruebas nuevas: dos llamadas a `catalog_upsert_product` en la misma transacción fallaban (relevante para la importación de la Fase 8) → la RPC vuelve a diferir las invariantes al entrar.

## 7. Riesgos

- **S-3 en el proyecto real:** vigencia de la URL firmada de subida (2 h en Supabase alojado; la política solo actúa al firmar), que `postgres` lea `storage.objects` desde funciones SECURITY DEFINER, costo de las transformaciones de imagen (§25.3.5).
- El procesamiento de imágenes corre en la función serverless del runner; con mucho volumen convendrá un worker dedicado (D-F3-04).
- Permiso `products.cost.read` también permite escribir costos (D-F3-02); revisar con el propietario si se quiere separar.

## 8. Pendientes

- Progreso porcentual de subida (hoy «Subiendo…» por archivo): `fetch` no expone el progreso del envío; requiere `XMLHttpRequest`.
- Editor de apariencia después del lanzamiento (Fase 5): hoy el logo y los colores se editan en «Configurar tienda» y la publicación del tema no tiene UI.
- Imagen por variante, logo de marca e imagen de categoría: el modelo los soporta; la UI llega con el storefront (Fase 5).
- Consola de plataforma: selector de tienda con búsqueda cuando haya cientos de tenants.
- Owner: acceso de escritura a GitHub (P0), proyectos Supabase y Vercel.

## 9. Definition of Done

- [x] Suite completa en verde (local).
- [x] axe sin violaciones serias en el editor y el listado.
- [x] Migraciones forward-only probadas desde cero.
- [x] Decisiones y desviaciones registradas (D-F3-01 … D-F3-09).
- [ ] CI de GitHub (bloqueado por P0).
