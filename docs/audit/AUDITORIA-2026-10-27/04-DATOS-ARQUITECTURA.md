# 04 — Datos, base de datos, código y arquitectura

Súper auditoría de solo lectura del 2026-10-27, sobre HEAD `be5541d`.
Prefijos: **DAT-** para datos y base de datos, **ARQ-** para código y arquitectura.

**Fuentes usadas**

- Base `pruva_test`: esquema recién migrado por `pnpm db:test`, con las 120 migraciones.
- Base `pruva_dev`: la del stack local, con datos de pruebas E2E (569 pedidos, 442 pagados).
- Lectura del repositorio y `knip@5` vía `npx`.

Solo se usaron `SELECT` y `EXPLAIN ANALYZE` sobre funciones `stable` de solo lectura. No se escribió nada en ninguna base.

**Glosario mínimo**

- **FK** (llave foránea): columna que apunta a otra tabla.
- **Índice**: estructura que permite encontrar filas sin leer toda la tabla.
- **Append-only**: tabla en la que solo se insertan filas, nunca se modifican ni se borran.
- **Purga**: borrado programado de filas viejas.
- **Particionado**: dividir una tabla en pedazos, por ejemplo uno por mes.
- **N+1**: hacer una consulta por cada elemento de una lista en lugar de una sola consulta para toda la lista.

Severidad (definida por el orquestador):

- **Crítica**: pérdida o corrupción de datos, o bloqueo de crecimiento inminente.
- **Alta**: degradación probable a volumen moderado.
- **Media**: deuda que encarece los cambios.
- **Baja**: higiene.

---

## 1. Resumen

El esquema es de buena calidad y está muy protegido:

- 109 tablas: 77 en `public`, 28 en `audit` (26 son particiones mensuales) y 4 en `system`.
- Todo el dinero se guarda en `bigint`; hay 0 columnas `float`, `numeric` o `money`.
- Las 109 tablas tienen RLS y `FORCE RLS`.
- Las FK hacia tablas de tienda son compuestas `(store_id, …)`, y un metatest pgTAP lo vigila.
- Los pedidos, pagos y movimientos no se pueden borrar: las FK desde `stores` son `RESTRICT` y hay triggers append-only.

Los riesgos reales no están en el aislamiento, sino en la **operación de los datos a lo largo del tiempo**:

1. Existen purgas que nadie programa (jobs, carritos, `security_events`).
2. La retención de GATE0 §36.3 no está implementada.
3. Con el cron diario de Vercel Hobby, las reservas de inventario vencidas y los correos de pedido esperan hasta 24 h.
4. La anonimización de clientes no alcanza las copias de PII que viven en pedidos y carritos.

En el código y la arquitectura:

- La capa `src/app` concentra el triple de código que `src/server`, con unas 215 llamadas directas a datos.
- La versión vigente de cada función SQL solo se encuentra buscando la última migración que la redefine.
- No existe README raíz ni runbooks de respaldo, restauración o incidentes.

---

## 2. Hallazgos — Datos y base de datos (DAT-)

### DAT-01 · Alta · El cron diario (Hobby) deja reservas de inventario vencidas bloqueando stock hasta 24 h [INFERIDO]

**Evidencia**

- `vercel.json` programa `/api/jobs/run` con `"schedule": "0 12 * * *"`, una vez al día. El runbook `docs/runbooks/database-roles.md:93` lo reconoce: «volver a `* * * * *` al pasar a Pro (N-4)».
- `inventory_levels.available` es una columna generada `on_hand - reserved` (`20261011000100_inventory_tables.sql:42`).
- `reserved` solo baja cuando corre `system.expire_orders(200)` (`20261013000400_payments_expiry.sql:291`), que se encola desde `system.enqueue_maintenance()` y únicamente se ejecuta cuando alguien llama al runner.
- La tienda (`src/app/%5Fstore`) no llama a `processQueueSoon` ni a `resumeQueue`. Solo el panel lo hace, en `src/app/admin/...`.

**Impacto**

- Un pedido sin pagar mantiene su stock reservado hasta el siguiente disparo del runner: hasta unas 24 h, salvo que el comerciante abra el panel. Mientras tanto, otros compradores ven el producto «agotado».
- Los jobs `order.created` y `order.paid`, que envían los correos al comprador, también esperan.
- Lo mismo pasa con la publicación programada (`catalog.publish_scheduled`) y las ofertas con fecha (`catalog.apply_sales`).

**Recomendación**

- Antes de cobrar a clientes, tener un disparo de al menos 1 por minuto. Hay tres caminos:
  - pasar a Vercel Pro;
  - activar el camino alterno pg_cron + pg_net, que ya está implementado pero marcado como NO VERIFICADO en el runbook §5;
  - usar un cron externo firmado con HMAC.
- Añadir una alerta si el job `orders.expire` más reciente tiene más de 5 minutos.

### DAT-02 · Alta · `system.jobs` crece sin límite: la purga existe pero nunca se programa [VERIFICADO]

**Evidencia**

- `system.purge_finished_jobs()` está definida en `20261005000300_foundation_jobs_and_settings.sql:250`.
- `grep purge_finished_jobs src` da 0 usos, y la función no aparece en `system.enqueue_maintenance()` (última versión en `20261018003000_scheduled_sale_prices.sql:551`).
- El runbook §6 dice: «Se programará como job periódico en la Fase 2. Mientras tanto se puede ejecutar a mano».
- En `pruva_dev`: 2,721 jobs, todos `succeeded` salvo 3, entre el 18 y el 27 de octubre, sin borrar ninguno. Pesan unos 471 bytes por fila.

**Impacto**

- Con cron por minuto, `enqueue_maintenance` crea unos 3 jobs por minuto (`orders.expire`, `catalog.publish_scheduled`, `catalog.apply_sales`) más `payments.reconcile` cada 10 minutos. Son unos 4,450 jobs al día solo de mantenimiento, unos 2 MB al día y unos 750 MB al año sin contar los jobs de negocio. Estimación: 471 B × 4,450 × 365.
- La cola se reclama por índice, así que la degradación es lenta, pero el tamaño de la base sí crece.

**Recomendación**

- Encolar `jobs.purge` una vez al día desde `enqueue_maintenance`, llamando a `system.purge_finished_jobs()`.
- Agregar una prueba de integración que verifique que el job queda encolado.

### DAT-03 · Media · La retención de GATE0 §36.3 no está implementada (carritos, `security_events`, auditoría) [VERIFICADO]

**Evidencia**

- GATE0 §36.3 pide: carritos abandonados 30 días, auditoría 24 meses, `security_events` 12 meses.
- En las migraciones no existe ningún `delete from public.carts`. `expire` solo cambia el estado a `'abandoned'` (`20261013000400_payments_expiry.sql:327`).
- `audit.security_events` es append-only (trigger en `20261006000200_audit.sql:173`) y no tiene job de retención. En dev ya tiene 7,590 filas (3.1 MB).
- `audit.ensure_partitions` crea particiones a 24 meses (hasta `audit_logs_202810`), pero ningún job elimina las particiones viejas.
- `notification_deliveries` es append-only y tampoco tiene purga.

**Impacto**

- Crecimiento indefinido de datos.
- PII guardada más tiempo del declarado: los carritos guardan `email` y `shipping_address` en jsonb.
- La política pública de privacidad promete plazos que el sistema no cumple. Esto es orientación informativa; validar con abogado o asesor regulatorio.

**Recomendación**

- Crear un job diario de retención con tres acciones:
  - borrar carritos `abandoned` o `converted` de más de 30 días, conservando los referenciados por `orders.cart_id`, cuya FK es `RESTRICT`;
  - borrar por lotes los `security_events` de más de 12 meses;
  - hacer `detach` y `drop` de las particiones de auditoría con más de 24 meses, previo archivo, como pide §36.3.
- Documentar el plazo real en `docs/legal`.

### DAT-04 · Media · La anonimización (LFPDPPP, derecho de cancelación) no alcanza pedidos ni carritos [VERIFICADO]

**Evidencia**

- `public.customers_anonymize` (`20261015000200_customers_admin.sql:214-248`) hace lo siguiente:
  - borra `customer_addresses`;
  - en `customers` pone en null o reemplaza `email`, nombre, teléfono, nota y `user_id`.
- No toca:
  - en `orders`: `email`, `phone`, `customer_name`, `shipping_address`, `billing_address`, `customer_note`;
  - en `carts`: `email`, `shipping_address`;
  - `auth.users` del comprador.
- Los pedidos son snapshots inmutables por diseño (regla 9).

**Impacto**

- Tras «anonimizar», la PII completa del cliente sigue en todos sus pedidos y carritos, sin plazo.
- La LFPDPPP permite conservar datos durante un periodo de bloqueo cuando existe una obligación legal, por ejemplo fiscal. Pero hace falta definir ese plazo y anonimizar después. Esto es orientación informativa; validar con abogado o asesor regulatorio (R-18 y Q1 siguen abiertos en GATE0).

**Recomendación**

- Escribir un ADR que defina un «periodo de bloqueo» por tipo de dato.
- Crear la función `system.redact_order_pii(store, customer)`, que pase a null o enmascare la PII de contacto de los pedidos cuando venza ese periodo. Requiere una excepción explícita y auditada a la inmutabilidad, solo para las columnas de contacto y nunca para importes ni líneas.
- Hacer que `customers_anonymize` borre también los carritos del cliente.

### DAT-05 · Media · 74 FK sin índice: unas 12 tienen impacto real, el resto está cubierto o es frío [VERIFICADO]

**Evidencia**

- La consulta a `pg_constraint` y `pg_index` en `pruva_test` da exactamente 74, igual que el advisor de staging. El listado completo está en el scratchpad `dat_fk_noidx.txt`.
- Clasificación:

| Grupo                                                                                                                    | Cuántas | Ejemplos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Impacto                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cubiertas en la práctica: la FK compuesta `(store_id, X)` tiene un índice que empieza por `X`, que es un uuid casi único | ~16     | `media(product_id)`, `cart_items(cart_id)`, `inventory_levels(variant_id)`, `product_options(product_id)`, `variant_option_values(variant_id)`, `product_categories(product_id)`, `inventory_reservation_items(reservation_id)`, `shipment_items(shipment_id)`, `discount_redemptions(order_id)`                                                                                                                                                                                                                              | Ninguno. Para el advisor son falsos positivos                                                                                                                                                                               |
| Hacia `auth.users` (`created_by`, `published_by`, `invited_by`…)                                                         | 14      | `media.created_by`, `variant_price_schedules.created_by`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Solo afecta al borrar un usuario (`SET NULL`): escaneo de tablas medianas. Baja                                                                                                                                             |
| Catálogos globales pequeños (`roles`, `plans`, `permissions`, `regulated_categories`)                                    | ~8      | `store_members.role_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Ninguno                                                                                                                                                                                                                     |
| Medios opcionales (`logo_media_id`, `cover_media_id`, `seo_image_media_id`, `image_id`)                                  | ~10     | `brands_logo_fk`, `product_variants.image_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Al borrar un medio (`media.purge_orphans` borra en lote) se escanean `brands`, `categories`, `store_pages`, `product_variants`. Baja o Media                                                                                |
| **Tablas calientes o grandes**                                                                                           | **~12** | `order_items(store_id, variant_id)` y `(store_id, product_id)`, `cart_items(store_id, variant_id)`, `carts(store_id, customer_id)` y `(store_id, shipping_rate_id)`, `orders(store_id, cart_id)`, `refunds(store_id, payment_id)`, `payments(store_id, payment_account_id)`, `payment_events(store_id, payment_account_id)`, `inventory_reservation_items(store_id, level_id)`, `inventory_reservations(store_id, order_id)` (solo existe un índice parcial para `active`/`committed`), `supplier_order_items(order_item_id)` | Los borrados de variantes, tarifas y carritos, así como las consultas «pedidos que contienen la variante X» o los KPIs por producto, escanean tablas que crecen con cada pedido. **Media**, porque hoy hay 0 pedidos reales |

**Recomendación**

- Una migración `expand` con unos 12 `create index concurrently` para el grupo caliente. Requiere fuera de transacción; ver ARQ-07.
- Documentar en `DECISIONS.md` que los otros unos 60 se aceptan, para que el advisor no reabra el tema.

### DAT-06 · Media · `storefront.list_products` calcula la clave de orden para todos los productos del filtro: O(n) por página [INFERIDO; medido con datos chicos]

**Evidencia**

- La CTE `base` (cuerpo vigente leído con `pg_get_functiondef`) calcula `k` con un `CASE` (época, precio, `sales_count` o `ts_rank + similarity`) para cada producto que devuelve `app.listing_products`.
- Además ejecuta, por producto, una subconsulta de `compare_at` y, si se filtra por disponibilidad, `app.product_state(...)`, tanto en `total` como en `page`. El conteo total se hace en la primera página.
- Los índices `products_listing_idx`, `products_price_idx` y `products_sales_idx` existen, pero el orden por una expresión calculada no puede usarlos.
- Tiempos medidos en dev (tienda demo, 16 productos, segunda ejecución en caché):

| Llamada                                 | Tiempo                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `list_products` sin filtros             | 18 ms                                                                    |
| `list_products` con búsqueda «proteina» | 7–24 ms; la primera, 571 ms en frío por cargar el diccionario `unaccent` |
| `get_home`                              | 46–62 ms con 7,491 buffers                                               |
| `get_product`                           | 13 ms                                                                    |
| `related_products`                      | 34 ms                                                                    |
| `search_suggestions`                    | 15 ms                                                                    |
| `resolve_host`                          | 6 ms                                                                     |

**Impacto**

- Hoy es aceptable, y `cachedRead` (`src/server/storefront/cache.ts`, TTL de 60 s por tienda) amortigua el costo.
- Con miles de productos por tienda y filtros que invalidan la caché (búsqueda, facetas, precio), el costo crece linealmente.
- `get_home` ya lee unos 7,500 buffers con 16 productos.
- No se pudo medir a volumen: no hay datos sintéticos grandes y no se crearon.

**Recomendación**

- Crear una prueba de carga con 5,000 productos por tienda en una base desechable y medir p95 de `get_home`, `list_products` y `list_facets`.
- Si p95 supera 150 ms: usar keyset por columna indexada en los órdenes no relevantes (`newest`, `price_*`, `best_selling`) y materializar `product_state` en una columna mantenida por trigger o job.

### DAT-07 · Media · Crecimiento por pedido y ausencia de plan de capacidad [VERIFICADO, conteo en dev]

**Evidencia**

- Filas por pedido medidas en `pruva_dev`, con 1 línea por pedido en las pruebas:

| Tabla                               | Filas por pedido                   |
| ----------------------------------- | ---------------------------------- |
| `order_items`                       | 1.0                                |
| `order_events`                      | 3.57                               |
| `inventory_movements`               | 3.17                               |
| `inventory_reservations`            | 0.69                               |
| `inventory_reservation_items`       | 0.69                               |
| `payments`                          | 0.69                               |
| `notification_deliveries`           | 1.16                               |
| `carts`                             | 0.93                               |
| `system.jobs` (mezclados con otros) | 4.88                               |
| `payment_events`                    | 0, porque el proveedor es simulado |

- Con Mercado Pago real habría unas 2–4 filas más por pago [NO VERIFICADO].
- `orders` pesa unos 1,065 B por fila con índices; `audit_logs` unos 760 B por fila.
- La auditoría de dev está dominada por acciones del panel (`config.update` 4,162, `product.created` 2,001). Por pedido solo se auditan las acciones de staff: `order.fulfilled`, `order.cancelled`, reembolsos.

**Impacto**

- Por pedido de N líneas se generan unas 12 + 3N filas append-only. A 1,000 pedidos al día eso es del orden de 15,000–20,000 filas diarias: manejable en Postgres.
- El riesgo no es el volumen de pedidos, sino lo que no se purga (DAT-02 y DAT-03) y los límites de almacenamiento del plan de Supabase [NO VERIFICADO; no se citan precios].

**Recomendación**

- Agregar al runbook una consulta mensual de tamaño por tabla (`pg_total_relation_size`) con umbrales de alerta.

### DAT-08 · Baja · Particiones de auditoría hasta 2028-10 sin mantenimiento automático [VERIFICADO]

**Evidencia**

- `system.maintain_audit_partitions()` existe (`20261006000200_audit.sql:87`), pero no se llama desde ningún lado (`grep` en `src` y `scripts`: 0).
- Después de 2028-10 las filas caerían en `audit_logs_default`. Un `ensure_partitions` posterior fallaría si la partición default ya contiene filas del rango que se intenta crear.

**Recomendación**

- Incluir `maintain_audit_partitions()` en el job diario de DAT-02 y DAT-03.

### DAT-09 · Baja · Columnas nullables y huecos menores en la regla 2 [VERIFICADO]

**Evidencia**

- `store_id` es nullable en `organization_invitations`, `system.jobs` y `audit.*`. Está justificado: invitaciones de organización, jobs globales y eventos de plataforma.
- Las siguientes tablas no tienen `UNIQUE (store_id, id)`: `inventory_movements`, `shipment_items`, `store_counters`, `variant_costs`, `product_categories`, `store_notification_settings`, `store_themes`, `product_regulatory_info`, `product_attribute_values`, `variant_option_values` y `support_access_grants`. Ninguna es referenciada por otra tabla, así que cumplen la letra de la regla 2: «si es referenciable».
- `system.auth_login_intents` no tiene PK (lo señala el advisor).
- `customers` tiene 4 políticas permisivas, lo que el advisor reporta como «multiple permissive policies».
- `inventory_movements`, `order_events`, `shipment_items` y `supplier_order_items` no tienen `prevent_tenant_change`, pero son append-only (`forbid_mutation` en UPDATE), lo cual es equivalente y está admitido por el metatest 11 de `00_schema_security`.

**Recomendación**

- Agregar una PK a `auth_login_intents` (`id` o `(store_id, nonce_hash)`).
- Fusionar las políticas de `customers` en una sola con `OR`. Es higiene.

### DAT-10 · Baja · `notification_deliveries` tiene `ON DELETE CASCADE` hacia `organizations`, pero es append-only [VERIFICADO]

**Evidencia**

- FK `notification_deliveries_organization_id_fkey … ON DELETE CASCADE` junto con el trigger `notification_deliveries_append_only BEFORE DELETE` (`app.forbid_mutation`).

**Impacto**

- Borrar una organización con correos enviados falla con una excepción en lugar de un error claro. Hoy no hay flujo de borrado de organizaciones, así que es una inconsistencia latente.

**Recomendación**

- Cambiar a `RESTRICT` o a `SET NULL` según la política de cierre de tiendas (Q-N6), con una migración expand.

### DAT-11 · Baja · Índices sin uso (105 en staging): no actuar todavía [NO VERIFICADO]

**Evidencia**

- El advisor de staging reporta 105 índices sin uso. Staging tiene 0 pedidos y tráfico mínimo, así que `pg_stat_user_indexes` no es representativo. En local las estadísticas se reinician con cada recreación.

**Recomendación**

- Revisar el reporte 30 días después de tener tráfico real y antes de borrar cualquier índice.
- Los índices `unique` y los de FK nunca se borran.

---

## 3. Hallazgos — Código y arquitectura (ARQ-)

### ARQ-01 · Media · La versión vigente de cada función SQL solo se conoce leyendo 120 migraciones [VERIFICADO]

**Evidencia**

- Hay 713 sentencias `create [or replace] function` para 496 funciones distintas.
- Las más redefinidas: `storefront.list_products` 8 veces, `system.enqueue_maintenance` 8, `public.imports_create` 8, `storefront.get_product` 7, `public.exports_rows` 6, `public.appearance_publish_theme` 6.
- No existe un volcado del esquema vigente (`supabase/schema.sql` o similar) en el repositorio.
- Las 5 migraciones más grandes tienen entre 836 y 1,563 líneas (`20261015000700_phase8_gate_fixes.sql`: 1,563).

**Impacto**

- Cada cambio exige localizar la última definición. Es fácil partir de una versión vieja y revertir sin querer un arreglo previo.
- La revisión de PR se encarece.

**Recomendación**

- Generar en CI `supabase/schema.snapshot.sql` con `pg_dump --schema-only` tras migrar `pruva_test`.
- Hacer que falle la verificación si el snapshot no coincide con lo commiteado. Así el diff de cada PR muestra el cambio real de cada función.

### ARQ-02 · Media · `migrate.mjs` aplica migraciones en cada `pnpm build` de Vercel, sin candado ni separación por entorno [VERIFICADO el código; NO VERIFICADO la configuración de Vercel]

**Evidencia**

- `package.json:12` define `"build": "node scripts/deploy/migrate.mjs && next build"`.
- `scripts/deploy/migrate.mjs`:
  - aplica cada migración pendiente en su propia transacción y detecta archivos alterados por sha256 (bien);
  - no toma `pg_advisory_lock`;
  - no distingue entre Preview y Production;
  - corre antes de `next build`.

**Impacto**

- Si `MIGRATION_DATABASE_URL` está definida para Preview y Production en el mismo proyecto Supabase, una rama sin fusionar puede aplicar sus migraciones a la base compartida.
- Dos builds simultáneos pueden competir: el segundo falla, sin corrupción, porque cada migración es transaccional.
- Un build que falla después de migrar deja la base por delante del código. Lo mitiga la disciplina expand→contract.
- No hay plan de reversa documentado por migración: es forward-only por diseño, sin runbook de «qué hacer si una migración rompe producción».

**Recomendación**

- Añadir `select pg_advisory_lock(<constante>)` al inicio de `migrate.mjs`.
- Ejecutar migraciones solo si `VERCEL_ENV === 'production'`, o desde un paso de CI explícito.
- Escribir `docs/runbooks/migraciones.md` con el procedimiento de migración correctiva y de restauración PITR.

### ARQ-03 · Media · La capa de datos está dispersa en `src/app` [VERIFICADO]

**Evidencia**

- Tamaño por área:
  - `src/app`: 272 archivos, 41,543 líneas;
  - `src/server`: 138 archivos, 13,943 líneas;
  - `src/lib`: 90 archivos, 8,466 líneas.
- Hay 215 llamadas `supabase.from`, `.rpc` o similares dentro de `src/app`.
- 9 archivos de `src/app` usan `workerDb` o `postgres` directamente, por ejemplo `admin/[storeHandle]/ajustes/pagos/actions.ts:8` y `(acceso)/actions.ts`.
- 35 archivos `"use server"`.
- Archivos más largos:
  - `apariencia/home-editor.tsx`: 1,925 líneas;
  - `productos/actions.ts`: 1,327;
  - `apariencia/forms.tsx`: 1,129;
  - `src/server/storefront/catalog.ts`: 913.
- La dirección de las dependencias está bien: `server` no importa de `app`, `lib` no importa de `server` (salvo un test) y `ui` solo importa `safe-html`.

**Impacto**

- Las reglas de negocio y los contratos de RPC quedan repartidos entre páginas y acciones, lo que dificulta pruebas unitarias y cambios de proveedor (ARQ-08).
- Es la mayor fuente de costo al cambiar.

**Recomendación**

- Mover gradualmente las llamadas a datos de `src/app/**/actions.ts` a módulos `src/server/<dominio>/`, empezando por `productos/actions.ts` y pagos.
- Partir `home-editor.tsx` por sección.

### ARQ-04 · Media · Cobertura de pruebas sin medición y huecos por área crítica [VERIFICADO]

**Evidencia**

- No hay herramienta de cobertura (`@vitest/coverage-*` no está instalado y no hay `coverage` en la configuración). Las cifras de pruebas (945 unit, 2,348 pgTAP, 355 integración, 98 E2E) no dicen qué líneas cubren.
- Mapa de archivos por área (unit / integración / pgTAP / E2E):

| Área                   | Unit | Integración     | pgTAP                                     | E2E |
| ---------------------- | ---- | --------------- | ----------------------------------------- | --- |
| checkout               | 1    | 1               | 2 (`27_calculate_cart`, `28_place_order`) | 1   |
| pagos y Mercado Pago   | 3    | 1               | 2 (`35`, `68`)                            | 0   |
| webhooks               | 1    | 2               | —                                         | 0   |
| reembolsos             | 0    | 1               | 1                                         | 0   |
| inventario             | 0    | 1               | 2                                         | 1   |
| notificaciones         | 3    | 2               | 1                                         | 0   |
| permisos y aislamiento | 0    | 1               | `04`, `05`, `00`                          | 0   |
| importaciones          | 3    | 1 (`import-5k`) | 2                                         | 1   |

- No hay E2E de pago ni de reembolso. Es razonable sin sandbox de Mercado Pago, pero confirma que todo el flujo real de pago está [NO VERIFICADO].
- Pruebas inestables: `playwright.config.ts` tiene `retries: 0`, hay 0 `.skip`, `.only` o `.fixme`, y 1 `@ts-expect-error` justificado (`tests/integration/golden-cart.test.ts:6`). No se encontraron pruebas en cuarentena.

**Recomendación**

- Instalar `@vitest/coverage-v8` (dependencia nueva: justificarla en el PR) y publicar el reporte en CI sin umbral al principio.
- Agregar un E2E de pago contra el simulador `fake` y otro de reembolso.

### ARQ-05 · Media · No se puede retomar el proyecto sin el historial: falta README raíz y faltan runbooks clave [VERIFICADO]

**Evidencia**

- No existe `README.md` en la raíz.
- `docs/README.md` es un índice desactualizado: no menciona `mercadopago.md` ni los planes nuevos.
- Solo hay 3 runbooks: `database-roles`, `local-stack`, `mercadopago`. Faltan respaldo y restauración (PITR solo aparece como casilla en `database-roles.md:38`), incidentes, migraciones y rotación de secretos de terceros.
- `docs/plan/PROGRESS.md` pesa 80 KB en 290 líneas muy largas. Es una bitácora cronológica, no un estado.
- `docs/plan/` suma 347 KB.
- Lo bueno: `CLAUDE.md` (56 líneas) es claro, `GATE0` (2,812 líneas) es completo y `DECISIONS.md` tiene 47 secciones.

**Impacto**

- Una persona nueva necesita horas para saber qué está hecho, qué falta y cómo operar en producción.
- No hay procedimiento probado para restaurar datos.

**Recomendación**

- Escribir un `README.md` raíz de una página: qué es, cómo correrlo, dónde está cada cosa y el estado actual.
- Partir `PROGRESS.md` en `ESTADO.md` (una pantalla) y `BITACORA.md` (histórico).
- Crear `runbooks/respaldo-restauracion.md`, con el simulacro trimestral que exige GATE0 §36.3, y `runbooks/incidentes.md`.

### ARQ-06 · Baja · Código muerto y dependencias (knip) [VERIFICADO]

**Evidencia** (`npx knip@5`)

- Archivos sin uso:
  - `scripts/dev/gateway.mjs` y `scripts/dev/keys.d.mts`: candidatos reales;
  - `supabase/functions/demo-seed/index.ts`: falso positivo, es una Edge Function.
- 38 exportaciones sin uso, por ejemplo `startPayment` y `orderPath` en `src/server/storefront/checkout.ts`, `createRoleClient` en `src/server/db/role-clients.ts` y `manualSupplierProvider`.
- 96 tipos exportados sin uso.
- Las fuentes `@fontsource*` aparecen como no usadas, pero es falso positivo: se importan en `src/app/layout.tsx` y `_components/fonts.ts`.
- `@eslint/js` y `typescript-eslint` también aparecen como no usadas; habría que verificarlo en `eslint.config.mjs`.
- `postcss` falta en las dependencias declaradas.

**Recomendación**

- Agregar `knip` a CI con una configuración que ignore las Edge Functions y las fuentes.
- Borrar las exportaciones muertas en un PR de higiene.

### ARQ-07 · Baja · Deuda técnica explícita casi nula [VERIFICADO]

**Evidencia**

- 0 `TODO`, `FIXME` o `HACK` reales. Los 7 resultados de `grep` son la palabra española «TODO» (de «todo o nada»).
- 34 `eslint-disable`, todos `@next/next/no-img-element` con justificación. Esto confirma que las imágenes usan `<img>` sin `next/image`, lo que se relaciona con el LCP y la falta de `srcset` medidos en la línea base.
- 4 `as unknown as` o `as any` fuera de tests.
- La URL pública de Storage `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/store-media/${path}` está duplicada en 4 lugares: `src/server/catalog/queries.ts:285`, `src/server/storefront/catalog.ts:835`, `src/server/jobs/registry.ts:57` y `src/app/api/auth/email-hook/route.ts:37`.

**Recomendación**

- Centralizar la URL en una función `mediaPublicUrl(path)`. Es requisito para salir de Supabase Storage o para meter un CDN o transformador de imágenes.

### ARQ-08 · Media · Dependencia de proveedores: inventario y costo de salida [VERIFICADO el acoplamiento; esfuerzos INFERIDOS]

Supuestos:

- Esfuerzo en días-persona de un desarrollador que conoce el código.
- No incluye migración de datos de producción ni precios: no se inventan cifras.

| Pieza                         | Acoplamiento medido                                                                                                                                                                     | Qué habría que reemplazar                                                                                                      | Esfuerzo estimado                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Postgres (Supabase)**       | Postgres estándar con extensiones `unaccent`, `pg_trgm` y `citext`                                                                                                                      | Cualquier Postgres ≥ 15 administrado                                                                                           | Bajo, 1–2 días: `pg_dump`/`restore` y roles. Las pruebas ya corren en Postgres local                         |
| **Supabase Auth (GoTrue)**    | 69 referencias a `auth.uid()`, `auth.jwt()` o `auth.role()` en SQL; 20 FK hacia `auth.users`; 21 llamadas `.auth.*` en TS (OTP, MFA TOTP, admin); hook de correo `/api/auth/email-hook` | Otro IdP que emita JWT con `sub` y un esquema `auth` compatible. GoTrue es open source y ya corre sin Docker en el stack local | Medio, 5–10 días si se autohospeda GoTrue; Alto, 15–25 días si se cambia de IdP (usuarios, MFA, contraseñas) |
| **PostgREST / Data API**      | supabase-js en 15 archivos; unas 215 llamadas en `src/app`                                                                                                                              | PostgREST autohospedado (ya está en el stack local) o migrar a `postgres.js` con un helper de RLS                              | Bajo con PostgREST propio, 1–3 días; Medio-Alto, 10–20 días, si se elimina (ver ARQ-03)                      |
| **Supabase Storage**          | 6 referencias a `storage.objects` y `storage.buckets` en SQL; 17 en TS; `src/server/privileged/storage-admin.ts`; URL pública duplicada (ARQ-07)                                        | S3 o R2 con un adaptador; reescribir las políticas de `storage.objects` en la capa de servidor                                 | Medio, 4–8 días                                                                                              |
| **pg_cron / pg_net**          | No se usan en migraciones: el camino alterno no está activado                                                                                                                           | —                                                                                                                              | Ninguno                                                                                                      |
| **Edge Function `demo-seed`** | Solo para la demo                                                                                                                                                                       | Script Node                                                                                                                    | Bajo, menos de 1 día                                                                                         |
| **Vercel Cron**               | 1 cron diario (`vercel.json`); el runner es un GET o POST autenticado y portátil                                                                                                        | Cualquier cron que llame a `/api/jobs/run` con Bearer o HMAC                                                                   | Bajo, menos de 1 día                                                                                         |
| **Vercel Data Cache**         | `unstable_cache` y `revalidateTag` en `src/server/storefront/cache.ts`                                                                                                                  | En un host propio de Next, cache handler (por ejemplo Redis) para compartir entre instancias                                   | Bajo-Medio, 2–4 días                                                                                         |
| **Vercel Image**              | No se usa: `next/image` aparece en 1 archivo y las imágenes son `<img>`                                                                                                                 | —                                                                                                                              | Ninguno, aunque esto penaliza el LCP                                                                         |
| **Vercel Domains API**        | `src/server/domains/provider.ts` (`VERCEL_DOMAINS_TOKEN`); dominios propios de tiendas                                                                                                  | Otra API de certificados (Caddy, Cloudflare for SaaS)                                                                          | Medio, 3–6 días                                                                                              |

**Conclusión**: el acoplamiento más caro es **Supabase Auth**, por el `auth.uid()` en RLS y las FK a `auth.users`. El resto es portátil. Sin datos de precios ni volumen, el costo económico es [NO VERIFICADO].

### ARQ-09 · Baja · Bucles secuenciales con red dentro de un runner de 60 s [VERIFICADO el código]

**Evidencia**

- `reconcileMercadoPagoPayments` (`src/server/payments/mercadopago-webhook.ts:~128`) procesa hasta 100 filas en serie, con un `fetchByReference` HTTP más una RPC por fila.
- `reconcileRefunds` (`src/server/orders/refunds.ts:~117`) sigue el mismo patrón.
- `export const maxDuration = 60` en `src/app/api/jobs/run/route.ts`.
- No se encontró N+1 en la tienda: `card_variants` y `rating_summaries` reciben arreglos de ids.

**Impacto**

- Con proveedores lentos, una tanda de reconciliación puede rebasar 60 s y repetirse. Es idempotente, pero desperdicia trabajo.

**Recomendación**

- Paralelismo acotado (por ejemplo 5 en paralelo) y un presupuesto de tiempo por job.

### ARQ-10 · Baja · `app_schema_version` se valida contra la última migración que la define, no contra la última migración [VERIFICADO]

**Evidencia**

- `src/server/db/schema-version.test.ts:44-56` compara contra el último archivo que contiene `function public.app_schema_version()`.
- Una migración nueva que olvide redefinir la función pasa la prueba, y el aviso de «base atrasada» del panel deja de detectar esa migración.
- Hoy `EXPECTED_SCHEMA_VERSION = "20261025000100"` coincide con la última migración.

**Recomendación**

- Que la prueba exija que el último archivo de `supabase/migrations` redefina la función, o bien leer la versión de `supabase_migrations.schema_migrations`.

---

## 4. Controles verificados (no son hallazgos)

- **Regla 2** (consulta a `pg_catalog` en `pruva_test`):
  - 57 de las 58 tablas de `public` con `store_id` lo tienen `NOT NULL`; la excepción es `organization_invitations`, que está justificada.
  - Las 109 tablas tienen `relrowsecurity` y `relforcerowsecurity`.
  - Las 28 tablas de tienda que son destino de FK compuestas tienen un `UNIQUE` que coincide con la llave referenciada.
- Las 19 FK que no incluyen `store_id` en tablas de tienda apuntan a tablas globales (`auth.users`, `roles`, `organizations`, `regulated_categories`). Ninguna FK hacia una tabla de tienda omite `store_id`.
- Metatests 11 y 12 de `00_schema_security.test.sql` (líneas 115–150) vigilan `prevent_tenant_change` (o append-only) y las FK compuestas en toda tabla nueva.
- **Dinero**: 27 columnas monetarias, todas `bigint`. 0 columnas `real`, `double precision`, `numeric` o `money` en `public`, `system` y `audit`. Tasas en `tax_rate_bps integer`.
- **Inmutabilidad**: las FK desde `stores` hacia `orders`, `order_items`, `payments`, `payment_events`, `refunds`, `order_events`, `shipments`, `customers` y `product_reviews` son `RESTRICT`. Hay triggers `forbid_mutation` en `order_events`, `shipment_items`, `supplier_order_items`, `notification_deliveries` y `audit_logs`; en `payment_events` hay `prevent_column_change` y bloqueo de DELETE; en `inventory_movements`, guardas de UPDATE y DELETE.
- **Auditoría sin PII del comprador**: `customer.updated` solo guarda `accepts_marketing`; `customer.anonymized` guarda el email enmascarado (`app.mask_email`). En dev, de las filas con `@` fuera de `config.*`, las 57 son `store.updated` con el contacto del comercio, no del comprador.
- **Particionado** de `audit.audit_logs` por mes, con 24 particiones adelantadas y una default.
- **Migraciones**: 120 archivos forward-only. `migrate.mjs` detecta archivos alterados por sha256 y aplica cada uno en una transacción. `db:test` prueba desde cero. Staging tiene 120/120, según la línea base. `app_schema_version()` = `20261025000100`, igual que el código.
- **`rate_limits.purge`** sí está programado (diario).
- **Caché de datos públicos por tienda**: la clave y el tag incluyen `storeId` (`src/server/storefront/cache.ts`), así que no cruza tiendas.
- **Capas**: `src/server` no importa de `src/app`, y `src/lib` no importa de `src/server` (salvo un test).
- **Pruebas**: 0 pruebas saltadas o en cuarentena; Playwright con `retries: 0`.
- **Búsqueda**: hay índices GIN para `search_vector` y trigram de `title` por tienda (`products_search_idx`, `products_title_trgm_idx`).

---

## 5. Tareas propuestas (no implementadas)

| #   | Tarea                                                                                                                                                                                          | Hallazgos              | Prioridad       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------- |
| T1  | Disparo del runner de al menos 1 por minuto (Vercel Pro, pg_cron verificado o cron externo con HMAC) y alerta de «`orders.expire` atrasado»                                                    | DAT-01                 | Antes de cobrar |
| T2  | Job diario de mantenimiento de datos: `purge_finished_jobs`, purga de carritos de más de 30 días, `security_events` de más de 12 meses, `maintain_audit_partitions`, más prueba de integración | DAT-02, DAT-03, DAT-08 | Antes de cobrar |
| T3  | ADR de periodo de bloqueo y anonimización de PII en pedidos y carritos (con asesor legal)                                                                                                      | DAT-04                 | Antes de cobrar |
| T4  | Migración `expand` con unos 12 índices de FK calientes; documentar los unos 60 aceptados                                                                                                       | DAT-05                 | Media           |
| T5  | Prueba de carga de catálogo (5,000 productos por tienda) y p95 de `get_home`, `list_products` y `list_facets`                                                                                  | DAT-06                 | Media           |
| T6  | `migrate.mjs`: advisory lock y solo en producción; runbook de migraciones y restauración PITR                                                                                                  | ARQ-02, ARQ-05         | Media           |
| T7  | Snapshot `schema.sql` generado y verificado en CI                                                                                                                                              | ARQ-01                 | Media           |
| T8  | README raíz, `ESTADO.md` corto y runbooks de respaldo e incidentes                                                                                                                             | ARQ-05                 | Media           |
| T9  | Cobertura (`@vitest/coverage-v8`) y E2E de pago y reembolso con el simulador                                                                                                                   | ARQ-04                 | Media           |
| T10 | Mover el acceso a datos de `src/app` a `src/server/<dominio>`; centralizar `mediaPublicUrl`                                                                                                    | ARQ-03, ARQ-07, ARQ-08 | Continua        |
| T11 | `knip` en CI; PK en `auth_login_intents`; política única en `customers`; corregir la prueba de `app_schema_version`                                                                            | ARQ-06, DAT-09, ARQ-10 | Baja            |

---

## 6. Lo que no se pudo verificar

- **Vercel** (403): si `MIGRATION_DATABASE_URL` está en Preview y Production, el plan real (Hobby o Pro) y la frecuencia efectiva del cron en producción.
- **Rendimiento a volumen**: las bases locales tienen como máximo 16 productos por tienda. No se crearon datos sintéticos grandes, así que los tiempos de §DAT-06 solo valen para catálogos chicos.
- **Índices sin uso**: las estadísticas de staging no son representativas, porque tiene 0 pedidos.
- **`payment_events` reales** con Mercado Pago (no hay credenciales) y los límites de almacenamiento y precio de Supabase y Vercel.
- **Plazos legales de conservación** (LFPDPPP, fiscal): requieren asesoría. Todo lo legal aquí es orientación informativa; validar con abogado o asesor regulatorio.
