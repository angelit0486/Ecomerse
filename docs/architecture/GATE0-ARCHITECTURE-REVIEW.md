# GATE 0 — ARCHITECTURE REVIEW

> **Documento:** Especificación arquitectónica definitiva v1.0 (candidata a contrato técnico).
> **Base:** Blueprint v0.1 (38 secciones + 3 anexos) producido en esta sesión.
> **Estado del repositorio:** sin cambios. Este documento vive fuera del repositorio.
> **Respuestas del propietario recibidas tras el blueprint:** ninguna. Las 12 preguntas abiertas siguen sin respuesta; se usan los defaults declarados y se marcan.
>
> **Etiquetas epistémicas usadas en todo el documento**
> - **[FACT]**: verificado por inspección o por definición de la plataforma.
> - **[DECISION]**: decisión arquitectónica de este documento.
> - **[ASSUMPTION]**: supuesto no verificado. Se verifica en el *spike* indicado.
> - **[RECOMMENDATION]**: recomendación que no bloquea.
> - **[OPEN QUESTION]**: requiere decisión humana.
> - **[UNKNOWN]**: información que no existe todavía.
> - **[CHANGED vs v0.1]**: cambio declarado respecto al blueprint.
>
> **Todo SQL de este documento es: SQL CONCEPTUAL — NO EJECUTAR.**

---

## 1. Executive Summary

**Qué es.** Una plataforma SaaS de comercio electrónico **multi-tenant y white-label**: un único despliegue y una única base de datos PostgreSQL (Supabase) alojan muchas **Organizations** (clientes del SaaS). Cada una tiene una o más **Stores** independientes. El Platform Owner las administra desde una consola de plataforma con planes, entitlements, feature flags y soporte auditado.

**Veredicto de la revisión.** El blueprint v0.1 es **sólido en su núcleo**: Organization → Store, aislamiento por `store_id`, RLS forzado, FK compuestas, inventario por ledger, pedidos con snapshot y tres ejes de estado, pagos abstraídos y cuentas de pago propiedad de la tienda. La revisión adversarial encontró **14 hallazgos críticos o altos** que deben corregirse **antes** de escribir código. Los más importantes:

1. **El service role era el camino por defecto del storefront** (carritos, checkout, resolución de host). Eso lo convertía en un bypass silencioso y masivo. → Se reemplaza por **roles de base de datos de mínimo privilegio** (`storefront_gateway`, `system_worker`) que solo pueden ejecutar funciones auditadas en esquemas **no expuestos** por la API. El service role queda en una lista blanca de 2 usos.
2. **Una sesión de comprador podía otorgar poderes de staff.** Supabase Auth tiene un solo pool de usuarios. Si un miembro del staff inicia sesión como comprador con OTP en un storefront, su JWT llevaba su identidad de staff y RLS le concedía permisos de panel. → **MFA (AAL2) obligatorio para todo permiso de staff**, verificado en la función de autorización de la base de datos.
3. **Contradicción en el acceso público:** v0.1 decía a la vez "anon lee por RLS" y "se revoca todo a anon". → **`anon` no tiene ningún grant**. El storefront lee mediante funciones `storefront.*` con columnas mínimas.
4. **Contradicción en pagos tardíos:** un pedido expirado pasaba a `cancelled` (estado terminal), pero el pago tardío debía "reabrirlo". → Transición explícita `cancelled(payment_expired) → open`, solo para el sistema. Además, la expiración del lado del proveedor se alinea con el TTL de la reserva.
5. **`order_items.variant_id` sin FK compuesta** permitía asociar una línea de pedido a una variante de otra tienda. → FK compuesta con `ON DELETE SET NULL (variant_id)`.
6. **Contradicción en el borrado de productos:** la cascada al borrar chocaba con el ledger `RESTRICT`. → Los productos **nunca** se borran físicamente desde la UI. Una purga controlada elimina solo borradores sin referencias.
7. **Los cupones se consumían en pedidos que nunca se pagaban.** → Las redenciones tienen estado (`reserved → confirmed | released`).
8. **El soporte de plataforma no tenía un modelo formal de concesión.** → Tabla `support_access_grants`: motivo, alcance, expiración, solo lectura, sin autoconcesión y con notificación al tenant.
9. **La vista previa de tiendas en borrador era imposible.** La sesión del staff vive en otro dominio. → Token de vista previa firmado (HMAC, 15 minutos).
10. **Las importaciones asíncronas se ejecutaban sin identidad de usuario.** → El worker vuelve a validar el permiso de quien solicitó la importación en cada lote y fuerza `store_id` desde el job.

Las simplificaciones de la §46 reducen el MVP: una sola cola (`jobs`) en lugar de outbox más cola, direcciones como snapshot JSONB, tasa de impuesto en la tienda, sin `ltree`, sin `usage_counters`, y sin abstracciones de búsqueda, storage ni dominios hasta que exista una segunda implementación.

**Estado.** La arquitectura queda **definida y coherente**. Su aprobación formal está **bloqueada** por 5 preguntas cuya respuesta sí cambia la arquitectura (§48 → BLOCKING QUESTIONS). Cada una tiene un default seguro: si el propietario acepta los defaults, la arquitectura pasa a **APPROVED WITH CHANGES** sin más trabajo.

---

## 2. Repository Findings

Inspección ejecutada en esta fase: `git fetch`, árbol completo con archivos ocultos, estado, hash del único archivo, búsqueda de configuración y versiones de herramientas.

| Elemento | Hallazgo | Clasificación |
|---|---|---|
| Repositorio | `angelii33/pruva`, remoto `origin` | EXISTENTE [FACT] |
| Ramas | `main`, `claude/ecommerce-regulated-platform-41vu1e` (local y remota), todas en `a41e3fb` | EXISTENTE [FACT] |
| Historial | 1 commit: `a41e3fb "Add files via upload"` | EXISTENTE [FACT] |
| Estructura de carpetas | Solo la raíz | EXISTENTE [FACT] |
| Archivos | `CAMBIOS-FASE-1-2.md` (blob `289f06b8…`, idéntico al commit; no modificado) | **HEREDADO DE OTRO PROYECTO** (`angelii33/app-cursos`) [FACT] |
| Package manager | Ninguno declarado (sin `package.json` ni lockfile). Entorno: pnpm 10.28.0, npm 10.9.4 | NUEVO (por decidir: pnpm [DECISION]) |
| Framework | Ninguno | NUEVO |
| TypeScript | No hay `tsconfig.json` | NUEVO |
| Linting | No hay configuración | NUEVO |
| Testing | No hay configuración | NUEVO |
| Supabase | No hay carpeta `supabase/`; la CLI no está instalada en el entorno; Docker 29.6.2 disponible | NUEVO; Supabase local es viable [FACT] |
| Variables de entorno | No hay `.env*` | NUEVO |
| Documentación | No hay `docs/`. Solo el archivo heredado | NUEVO |
| `.gitignore` | No existe | NUEVO (bloqueante para Fase 1: debe existir antes del primer `git add` de código) |
| Node | No declarado en el repo; entorno con Node 22.22.0 | NUEVO (`.nvmrc` = 22 LTS [DECISION]) |
| Infraestructura externa (proyecto Supabase, Vercel, dominios, proveedores de pago) | No inspeccionable desde el repo; sin evidencia de que exista | **DESCONOCIDO** [UNKNOWN] |

**Conclusiones [FACT]:**
- El proyecto e-commerce **empieza desde cero**. No hay arquitectura que preservar.
- `CAMBIOS-FASE-1-2.md` pertenece a `app-cursos`: **no se modifica, no se reutiliza su arquitectura** y no se mueve sin autorización.
- Del archivo heredado **solo se toma una lección de seguridad genérica**, no arquitectura: la validación de redirecciones abiertas (`//host` pasa un filtro ingenuo `startsWith("/")`). Se incorpora como regla en la §30 (T-18) por mérito propio.

---

## 3. Current Architecture Assessment

No hay arquitectura implementada. Lo que se evalúa es el **blueprint v0.1** como arquitectura propuesta.

| Área | Evaluación | Veredicto |
|---|---|---|
| Modelo de tenancy (Org → Store, `store_id`) | Correcto y proporcionado | KEEP |
| RLS forzado + función de permisos única | Correcto; faltaba el requisito de AAL2 y el modo de solo lectura por suscripción | KEEP + CHANGE |
| FK compuestas `(store_id, id)` | Correcto; tenía una excepción injustificada (`order_items`) y omitía la sintaxis de `SET NULL` por columna | KEEP + CHANGE |
| Uso del service role | **Defectuoso**: era la vía por defecto del storefront, carritos, checkout y jobs | **CHANGE (crítico)** |
| Acceso anónimo | **Contradictorio** (§9.2 frente a §9.3/ADR-005) | **CHANGE** |
| Identidad de compradores | Correcta en datos; **defectuosa en privilegios** (JWT compartido con el staff) | **CHANGE (crítico)** |
| Inventario (ledger + niveles + reservas) | Correcto; faltaban el encabezado e items de reserva y la regla de backorder en el fulfillment | KEEP + CHANGE |
| Pedidos (3 ejes + snapshot) | Correcto; contradicción con pagos tardíos y direcciones en tabla aparte innecesaria | KEEP + CHANGE |
| Checkout | Correcto en principio; faltaba especificar que ninguna transacción abarca llamadas de red y el orden exacto de bloqueos | KEEP + SPECIFY |
| Pagos | Correcto; faltaban la protección contra *replay* y la separación explícita del billing de plataforma | KEEP + SPECIFY |
| SaaS billing | Correcto; `usage_counters` innecesario; faltaba el *access mode* derivado | KEEP + SIMPLIFY |
| White-label | Correcto; faltaba la cadena de fallback y la vista previa entre dominios era imposible | KEEP + CHANGE |
| Dominios | Correcto en diseño; abstracción prematura en el MVP | KEEP + DEFER abstracción |
| Búsqueda | Correcta; faltaba el índice compuesto por tienda (escala) | KEEP + CHANGE |
| Jobs / eventos | Dos colas (outbox + jobs) donde basta una | SIMPLIFY |
| Auditoría | Correcta; faltaban `before`/`after` explícitos y `reason` | KEEP + SPECIFY |
| Soporte de plataforma | Faltaba un modelo de concesión formal | **CHANGE** |
| Fases | Orden correcto; tablas ubicadas en la fase equivocada (`store_domains`, jobs) generaban dependencias implícitas hacia adelante | CHANGE |

---

## 4. Critical Findings

Formato por hallazgo: **DECISIÓN ACTUAL → PROBLEMA → IMPACTO → ALTERNATIVAS → RECOMENDACIÓN → DECISIÓN PROPUESTA.**

### CF-01 — Service role como camino por defecto del storefront · **CRITICAL**
- **Decisión actual (v0.1):** carritos con "SR only", resolución de host con SR, checkout de invitado con SR, jobs y webhooks con SR.
- **Problema:** la operación más frecuente del sistema (navegar y comprar) corre con un rol que **omite RLS por completo**. Un bug en una consulta (un `store_id` olvidado) expone datos de todas las tiendas. La lista blanca de "carpeta privilegiada" no limita **qué** puede hacer el código, solo **dónde** vive.
- **Impacto:** fuga cross-tenant masiva por un solo error; contradice el principio de no confiar en `WHERE store_id = …`.
- **Alternativas:** (a) seguir con SR + disciplina de código; (b) conceder RPC a `anon` (cualquiera con la anon key, que es pública, podría llamarlas saltándose nuestro rate limiting y CAPTCHA); (c) **roles de base de datos de mínimo privilegio, sin acceso a tablas**, que solo ejecutan funciones `SECURITY DEFINER` auditadas, en esquemas **no expuestos** por la Data API, usados desde el servidor con una conexión directa vía Supavisor.
- **Recomendación:** (c).
- **Decisión propuesta [CHANGED vs v0.1]:** roles `storefront_gateway` y `system_worker` (§11.4). El service role queda limitado a 2 usos en lista blanca (§11.5).

### CF-02 — El JWT de comprador concede privilegios de staff · **CRITICAL**
- **Decisión actual:** un solo pool de Supabase Auth; el staff entra en `app.`; los compradores entran por OTP en cada storefront; MFA solo para roles altos.
- **Problema:** el JWT identifica al **usuario**, no al contexto. Un miembro del staff (p. ej., `order_manager` sin MFA) que inicia sesión con OTP en un storefront obtiene un JWT con el que, llamando a la Data API, tiene sus permisos de staff. El storefront es la superficie menos protegida: contenido del comerciante y XSS potencial.
- **Impacto:** escalada de contexto y bypass de MFA.
- **Alternativas:** (a) proyectos de Auth separados para staff y compradores (duplica infraestructura); (b) claim de contexto vía Custom Access Token Hook (el hook no sabe qué dominio inició el login, así que no es fiable); (c) **exigir `aal = 'aal2'` en `app.has_store_permission` para cualquier permiso de staff** y MFA obligatorio para todo el staff.
- **Recomendación:** (c). Es simple y verificable en la base de datos.
- **Decisión propuesta [CHANGED vs v0.1]:** MFA TOTP obligatorio para **todo** miembro de staff y de plataforma. Sin AAL2, la función de autorización devuelve `false`. Las políticas de comprador no dependen de AAL.

### CF-03 — Contradicción en el acceso anónimo · **HIGH**
- **Actual:** la matriz §9.2 de v0.1 daba `SELECT` a `anon` vía la condición `pub`; la §9.3 y el ADR-005 revocaban todo a `anon`.
- **Problema:** dos fuentes de verdad incompatibles. Un implementador elegiría una al azar.
- **Decisión propuesta:** `anon` **no tiene ningún grant** en ningún esquema. El catálogo público se sirve con funciones `storefront.*` (rol `storefront_gateway`) que exigen `store_id`, devuelven columnas públicas explícitas y aplican las condiciones de publicación. Costos, secretos y PII nunca salen por esas funciones.

### CF-04 — Pago tardío sobre pedido cancelado (estado terminal) · **HIGH**
- **Actual:** al expirar la reserva, el pedido pasa a `cancelled`; si el pago llega después, el pedido "queda `open`".
- **Problema:** contradice la máquina de estados (`cancelled` es terminal) y deja el comportamiento sin definir.
- **Decisión propuesta:** (1) **prevención**: la checkout session del proveedor se crea con una expiración igual al TTL de la reserva menos un margen, y los métodos diferidos (vouchers) solo se habilitan si la tienda configura una reserva igual a la vigencia del voucher; (2) **corrección**: transición permitida **solo al actor `system`**: `cancelled` con `cancel_reason = 'payment_expired'` → `open` cuando llega un pago `succeeded` válido. Se intenta volver a reservar; si no hay stock, el pedido queda `open` + `payment_status = paid` + `needs_attention = true` (reembolso o surtido manual). **Nunca se pierde un pago.**

### CF-05 — `order_items` podía referenciar variantes de otra tienda · **HIGH**
- **Actual:** FK simple `variant_id → product_variants(id) ON DELETE SET NULL` como excepción a la regla de FK compuestas.
- **Problema:** permite asociar cross-tenant (corrompe la analítica de productos y viola el principio del §5).
- **Decisión propuesta:** FK compuesta `(store_id, variant_id) → product_variants(store_id, id) ON DELETE SET NULL (variant_id)` [FACT: la sintaxis de `SET NULL` con lista de columnas existe desde PostgreSQL 15]. **Se elimina la excepción**: no hay FK no compuesta entre tablas de tienda.

### CF-06 — Borrado de productos contradictorio · **MEDIUM**
- **Actual:** "si nunca se vendió, borrado real con cascada". Pero `inventory_levels` cascada desde la variante y `inventory_movements` es `RESTRICT` y siempre contiene un movimiento `initial`.
- **Decisión propuesta:** la UI **nunca** borra físicamente: "Eliminar" = `deleted_at` (papelera de 30 días). Un job de purga borra físicamente solo productos en papelera de más de 30 días, sin pedidos ni movimientos distintos de `initial`, eliminando primero esos movimientos dentro de la misma función. Así el ledger conserva siempre la integridad referencial.

### CF-07 — Cupones consumidos por pedidos impagos · **MEDIUM**
- **Decisión propuesta:** `discount_redemptions.status ∈ {reserved, confirmed, released}`. Se reserva en `place_order`, se confirma con el pago y se libera al expirar o cancelar. El límite cuenta `reserved + confirmed`.

### CF-08 — Soporte de plataforma sin modelo formal · **HIGH**
- **Decisión propuesta:** `support_access_grants` (§7.7): concesión explícita, motivo obligatorio, una tienda, solo lectura, 60 minutos máximo, sin autoconcesión, notificación al `org_owner` y auditoría de inicio, fin y páginas vistas. `has_store_permission` concede **solo permisos de lectura no sensibles** mientras la concesión esté vigente.

### CF-09 — Vista previa de tiendas en borrador imposible · **MEDIUM**
- **Problema:** v0.1 decía "draft = visible para staff con sesión", pero la sesión del staff vive en `app.{plataforma}` y el storefront en otro dominio raíz.
- **Decisión propuesta:** el panel genera un **token de vista previa** firmado (HMAC con `store_id`, `exp` de 15 minutos y `nonce`). El storefront lo canjea por una cookie `__preview` host-only con la misma vigencia. Con vista previa: `noindex`, sin caché y con una barra visible "Vista previa".

### CF-10 — Importaciones asíncronas sin identidad · **HIGH**
- **Problema:** el job de importación no tiene JWT de usuario y v0.1 lo corría con SR.
- **Decisión propuesta:** `system.import_commit_batch(job_id, batch_no)` (rol `system_worker`) (1) vuelve a validar que `import_jobs.requested_by` **todavía** tiene `products.import` en `import_jobs.store_id` mediante `app.user_has_store_permission(user_id, store_id, perm)` (variante de la función que recibe el usuario explícito y solo puede ejecutarla `system_worker`); (2) **ignora** cualquier `store_id` del archivo y usa siempre el del job; (3) las FK compuestas impiden referencias a otra tienda; (4) aplica los mismos validadores de dominio que el panel.

### CF-11 — Tablas en la fase equivocada (dependencias hacia adelante) · **MEDIUM**
- **Problema:** v0.1 creaba la tienda en la Fase 2, pero su subdominio (`store_domains`) llegaba en la Fase 5 y la ubicación de inventario por defecto en la Fase 4. Varias fases suponían la cola de jobs antes de crearla.
- **Decisión propuesta:** `store_domains` y la cola `jobs` pasan a las Fases 2 y 1. Las tablas que dependen de la tienda y llegan después (ubicaciones, tema) **incluyen su propio backfill y un trigger para tiendas nuevas** en su fase. Toda lectura opcional tiene fallback (p. ej., tema por defecto si no hay fila).

### CF-12 — Búsqueda que no escala con muchas tiendas · **MEDIUM**
- **Problema:** índice GIN solo sobre `search_vector`. Con miles de tiendas, una palabra común produce millones de coincidencias antes de filtrar por tienda.
- **Decisión propuesta:** extensión `btree_gin` e índices compuestos `GIN (store_id, search_vector)` y `GIN (store_id, title gin_trgm_ops)`.

### CF-13 — Revocación de acceso con caché de servidor · **MEDIUM**
- **Problema:** v0.1 no prohibía cachear datos autorizados entre requests (Next Data Cache). Un usuario revocado podría ver páginas cacheadas.
- **Decisión propuesta:** regla de no regresión: **ningún dato del panel ni de la cuenta del comprador se guarda en una caché compartida entre requests**. Solo `React.cache` por request. Los permisos **nunca** se ponen en claims del JWT (quedarían obsoletos hasta una hora).

### CF-14 — Webhooks sin protección contra replay · **MEDIUM**
- **Decisión propuesta:** verificar la marca de tiempo firmada del proveedor con una tolerancia de 5 minutos, además de la idempotencia por `provider_event_id` y la re-consulta del estado a la API del proveedor.

### Contradicciones internas de v0.1 encontradas (regla §52)

| # | Contradicción | Resolución |
|---|---|---|
| C-1 | Acceso anónimo: §9.2 frente a §9.3 | CF-03 |
| C-2 | Pago tardío frente a `cancelled` terminal | CF-04 |
| C-3 | FK compuestas "siempre" frente a la excepción de `order_items` | CF-05 |
| C-4 | Borrado en cascada frente a ledger `RESTRICT` | CF-06 |
| C-5 | "Service role solo en carpeta privilegiada" frente a SR en todo el storefront | CF-01 |
| C-6 | Preview de draft frente a cookies separadas por dominio | CF-09 |
| C-7 | "Login unificado del comprador" frente a "MFA para staff" (un mismo JWT) | CF-02 |
| C-8 | `stock_reservations` (filas por variante) frente a la liberación atómica por pedido | §15: encabezado + items |
| C-9 | Fases: tienda creada en F2 sin subdominio hasta F5 | CF-11 |
| C-10 | Roles de v0.1 (`support`) con nombre ambiguo frente a `platform_support` | Se renombra a `support_agent` |

---

## 5. Required Changes

Cambios obligatorios respecto a v0.1. Todos están reflejados ya en las secciones siguientes.

| ID | Cambio | Sección | Origen |
|---|---|---|---|
| RC-01 | Roles de base de datos `storefront_gateway` y `system_worker`; esquemas `storefront` y `system` no expuestos; `anon` sin grants | §11, §12 | CF-01, CF-03 |
| RC-02 | Lista blanca de 2 usos del service role | §11.5 | CF-01 |
| RC-03 | AAL2 obligatorio para todo permiso de staff y plataforma | §7, §12 | CF-02 |
| RC-04 | Transición `cancelled(payment_expired) → open` solo para el sistema; expiración del lado del proveedor | §16, §18 | CF-04 |
| RC-05 | FK compuesta en `order_items` con `SET NULL (variant_id)`; cero excepciones | §13 | CF-05 |
| RC-06 | Sin borrado físico desde la UI; purga controlada | §9, §14 | CF-06 |
| RC-07 | Estado en las redenciones de descuento | §17 | CF-07 |
| RC-08 | `support_access_grants` | §7, §8 | CF-08 |
| RC-09 | Token de vista previa entre dominios | §20, §21 | CF-09 |
| RC-10 | Re-validación de permisos en los jobs de importación | §26 | CF-10 |
| RC-11 | Reubicar `store_domains` en F2 y `jobs` en F1; backfills | §38 | CF-11 |
| RC-12 | `btree_gin` + índices compuestos de búsqueda | §23 | CF-12 |
| RC-13 | Prohibido cachear datos autorizados entre requests; permisos nunca en el JWT | §12, §44 | CF-13 |
| RC-14 | Tolerancia de marca de tiempo en webhooks | §18 | CF-14 |
| RC-15 | Reservas como encabezado + items | §15 | C-8 |
| RC-16 | `membership.status` (`active`/`suspended`) para revocar sin borrar | §7 | Identidad |
| RC-17 | *Access mode* de la organización (`full`/`read_only`/`suspended`) evaluado en la autorización | §19 | Billing |
| RC-18 | Simplificaciones de la §46 (una cola, direcciones JSONB, impuesto en la tienda, sin `ltree`, sin `usage_counters`, sin abstracciones prematuras) | §46 | Revisión de sobreingeniería |
| RC-19 | Rol `support` renombrado a `support_agent`; rol `org_member` sin permisos de tienda implícitos | §8 | C-10 |
| RC-20 | El billing de plataforma (cobro al tenant) y el cobro de la tienda (al comprador) quedan en módulos, tablas, endpoints y secretos separados | §18, §19 | Requisito §15 del prompt |

---

## 6. Organization → Store Model

**DECISION:** tres planos de identidad (Plataforma, Tenant y Comprador) y dos niveles de tenant: **Organization** (propiedad, equipo, plan, suscripción, límites, facturación del SaaS) y **Store** (todos los datos de comercio y la frontera de aislamiento de datos).

**WHY:** permite una o varias tiendas por cliente con el mismo esquema. La facturación y el equipo son de la organización; los datos de comercio quedan aislados por tienda, incluso entre tiendas de la misma organización.

**ALTERNATIVES:** solo Store (multi-marca imposible sin duplicar cuentas); solo Organization (las marcas compartirían catálogo y clientes; separarlas después sería peligroso).

**TRADE-OFFS:** un join extra (`stores.organization_id`) en la función de autorización; los reportes consolidados por organización requieren agregación.

**SECURITY IMPACT:** frontera de datos más estrecha (`store_id`), lo que reduce el radio de una política defectuosa.

**PERFORMANCE IMPACT:** despreciable (PK lookup cacheado por sentencia mediante initPlan).

**IMPLEMENTATION IMPACT:** toda tabla de comercio lleva `store_id`; las tablas de organización llevan `organization_id`; ninguna tabla de comercio lleva `organization_id` (una sola fuente de verdad).

**TEST REQUIREMENTS:** suite de aislamiento entre organizaciones **y entre tiendas de la misma organización** (§34).

**STATUS:** APPROVED

```
PLATFORM (implícita: un despliegue; config en platform_settings)
├── platform_staff ............ platform_owner · platform_admin · platform_support
├── plans · plan_entitlements · feature_flags
└── ORGANIZATION (tenant comercial)
    ├── organization_members .. org_owner · org_admin · org_member
    ├── subscription (1 vigente) · entitlement_overrides
    └── STORE (frontera de datos de comercio)  ×N (limitado por max_stores)
        ├── store_members ..... store_admin · catalog_manager · inventory_manager ·
        │                       order_manager · marketing_manager · support_agent · viewer
        ├── catálogo · inventario · pedidos · clientes · descuentos · envíos
        ├── pagos (payment_accounts de la tienda) · contenido · tema · SEO · dominios
        └── customers (compradores, plano Comprador)
```

### 6.1 Matriz de pertenencia por entidad

Leyenda: **Org** = `organization_id`; **Store** = `store_id`; **Aud** = auditoría (T = trigger genérico, S = acción semántica, — = no); **SD** = soft delete; **Imm** = inmutabilidad (Total, Parcial = columnas protegidas, — = mutable).

| Entidad | Owner scope | Org | Store | RLS | Aud | SD | Imm |
|---|---|---|---|---|---|---|---|
| profiles | Usuario | — | — | ✓ | — | — | Parcial (`id`) |
| platform_staff | Plataforma | — | — | ✓ | S | — | — |
| platform_settings | Plataforma | — | — | ✓ | T | — | — |
| plans, plan_entitlements | Plataforma | — | — | ✓ | T | — (status) | — |
| feature_flags, feature_flag_overrides | Plataforma | — | — | ✓ | T | — | — |
| organizations | Organización | (es raíz) | — | ✓ | T+S | ✓ (`closed`) | Parcial (`id`) |
| organization_members | Organización | ✓ | — | ✓ | S | — (status) | Parcial (`organization_id`, `user_id`) |
| organization_invitations | Organización | ✓ | opcional | ✓ | S | — | Parcial |
| subscriptions | Organización | ✓ | — | ✓ | T | — | Parcial |
| organization_entitlement_overrides | Organización | ✓ | — | ✓ | T | — | — |
| support_access_grants | Plataforma→Tienda | ✓ (denorm.) | ✓ | ✓ | S | — (revoked_at) | Parcial |
| stores | Organización | ✓ | (es raíz) | ✓ | T+S | ✓ (`closed`) | Parcial (`id`, `organization_id`) |
| store_members | Tienda | — | ✓ | ✓ | S | — (status) | Parcial (`store_id`, `user_id`) |
| roles, permissions, role_permissions | Plataforma (MVP) | — | — | ✓ | T | — | — |
| store_domains | Tienda | — | ✓ | ✓ | T | — (status) | Parcial (`hostname`) |
| store_settings (en `stores`) | Tienda | — | ✓ | ✓ | T | — | — |
| store_themes | Tienda | — | ✓ | ✓ | S (publish) | — | — |
| menus, menu_items, store_pages | Tienda | — | ✓ | ✓ | T | pages ✓ | — |
| brands, categories | Tienda | — | ✓ | ✓ | T | ✓ | Parcial |
| products | Tienda | — | ✓ | ✓ | T | ✓ | Parcial |
| product_options, product_option_values | Tienda | — | ✓ | ✓ | T (vía producto) | — | Parcial |
| product_variants | Tienda | — | ✓ | ✓ | T | ✓ | Parcial |
| variant_option_values | Tienda | — | ✓ | ✓ | — | — | Total |
| variant_costs | Tienda | — | ✓ | ✓ | T | — | — |
| product_categories | Tienda | — | ✓ | ✓ | — | — | — |
| collections, collection_products (P2) | Tienda | — | ✓ | ✓ | T | ✓ | — |
| media (product_media) | Tienda | — | ✓ | ✓ | T | ✓ | Parcial (`storage_path`) |
| inventory_locations | Tienda | — | ✓ | ✓ | T | — (`is_active`) | Parcial |
| inventory_levels | Tienda | — | ✓ | ✓ | vía ledger | — | Parcial |
| inventory_movements | Tienda | — | ✓ | ✓ | (es ledger) | — | **Total** |
| inventory_reservations, inventory_reservation_items | Tienda | — | ✓ | ✓ | — | — | Parcial |
| customers, customer_addresses | Tienda | — | ✓ | ✓ | T | ✓ / — | Parcial |
| carts, cart_items | Tienda | — | ✓ | ✓ (sin políticas: solo funciones) | — | — | — |
| orders | Tienda | — | ✓ | ✓ | S | **nunca** | Parcial (snapshot) |
| order_items | Tienda | — | ✓ | ✓ | — | nunca | **Total** salvo contadores |
| order_events | Tienda | — | ✓ | ✓ | (es historial) | nunca | **Total** |
| payment_accounts | Tienda | — | ✓ | ✓ | T (sin secretos) | — (status) | Parcial |
| payments (intentos) | Tienda | — | ✓ | ✓ | S | nunca | Parcial |
| payment_events | Tienda | — | ✓ | ✓ | — | nunca | **Total** |
| refunds | Tienda | — | ✓ | ✓ | S | nunca | Parcial |
| shipping_zones, shipping_rates | Tienda | — | ✓ | ✓ | T | — (`is_active`) | — |
| shipments, shipment_items | Tienda | — | ✓ | ✓ | S | nunca | Parcial |
| discounts | Tienda | — | ✓ | ✓ | T | — (status) | Parcial (`code` tras su uso) |
| discount_redemptions | Tienda | — | ✓ | ✓ | — | nunca | Parcial (status) |
| import_jobs, import_job_rows | Tienda | — | ✓ | ✓ | S | — | Parcial |
| export_jobs | Tienda | — | ✓ | ✓ | S | — | Parcial |
| jobs | Tienda o plataforma | — | opcional | ✓ (sin políticas) | — | — | — |
| notification_deliveries | Tienda o plataforma | opcional | opcional | ✓ | — | — | Parcial |
| audit.audit_logs | Cualquiera | opcional | opcional | ✓ (solo función de lectura) | — | nunca | **Total** |
| security_events | Plataforma | opcional | opcional | ✓ | — | nunca | **Total** |

**Regla de pertenencia de la configuración [DECISION]:**
- **Organización:** propietario, miembros, plan, suscripción, límites, overrides, datos de facturación del SaaS, email de facturación, país fiscal del cliente del SaaS.
- **Tienda:** nombre visible, handle, moneda, zona horaria, locale, impuesto, contacto, datos legales de la tienda, branding, dominios, pagos, envíos, notificaciones, SEO, catálogo y todo lo transaccional.
- **Plataforma:** defaults de branding (fallback), lista de handles reservados, políticas de gracia de suscripción, catálogo de permisos y roles del sistema, temas disponibles.

---

## 7. Identity Architecture

### 7.1 Capas

```
auth.users (Supabase Auth: identidad global, email único)
   │ 1:1
profiles (nombre, avatar, locale)
   │
   ├─ 0..1 platform_staff ............. plano Plataforma
   ├─ 0..N organization_members ....... plano Tenant (nivel organización)
   ├─ 0..N store_members .............. plano Tenant (nivel tienda)
   └─ 0..N customers .................. plano Comprador (uno por tienda)
```

**[FACT]** No se asume `1 user = 1 organization` ni `1 user = 1 store`: un usuario puede pertenecer a N organizaciones, a N tiendas (de una o varias organizaciones) y ser comprador en N tiendas.

### 7.2 Ciclo de vida

| Evento | Especificación |
|---|---|
| **Registro de staff** | Solo por invitación (MVP). No hay autoservicio. La plataforma crea la organización y la tienda e invita al `org_owner`. |
| **Invitación** | `organization_invitations` con `token_hash` (SHA-256 de 32 bytes aleatorios), `expires_at = now() + 7 días`, rol de organización **o** tienda + rol de tienda. Email con enlace a `app.{plataforma}/invitacion/{token}`. Máximo 20 invitaciones pendientes por organización (anti-abuso). |
| **Aceptación / activación** | El invitado se autentica (crea cuenta o inicia sesión) → **debe enrolar TOTP (AAL2)** → RPC `access_accept_invitation(token)` verifica hash, expiración, que el email coincida con `auth.email()` y que esté dentro del límite `max_staff`; crea la membresía `active`; marca `accepted_at`. Atómico. |
| **Revocación** | `status = 'suspended'` (reversible) o eliminación de la fila (definitiva) vía RPC. Efecto **inmediato** en la base de datos porque RLS consulta membresías en vivo. La sesión sigue existiendo, pero sin permisos. |
| **Varias organizaciones/tiendas** | El panel lista las tiendas accesibles (`access_list_my_stores()`); el selector cambia la URL `/admin/[storeHandle]`. **El contexto de tienda viene de la URL y se valida en cada request**; no existe "tienda activa" guardada en la sesión. |
| **Cambio de organización/tienda** | Navegación a otra URL; no requiere un nuevo token. |
| **Sesión de staff** | Cookies de Supabase SSR en `app.{plataforma}`, host-only, `HttpOnly; Secure; SameSite=Lax`. Access token de 1 hora con refresh rotativo. Cierre de sesión por inactividad del panel: 12 h [DECISION]. |
| **Sesión de comprador** | Cookies en el dominio de la tienda (host-only). OTP de 6 dígitos por email. Sin contraseña. |
| **Recuperación de cuenta (staff)** | Login por email (contraseña o magic link) + TOTP. Si pierde el TOTP: el `org_owner`/`org_admin` solicita un reset de MFA del miembro → función de plataforma (service role, uso #1 de la lista blanca) elimina sus factores tras confirmación, con auditoría. Si el afectado es el propio `org_owner`: proceso de soporte de plataforma con verificación de identidad fuera de banda, auditado. |
| **MFA** | **Obligatorio desde el MVP para todo el staff y la plataforma [CHANGED vs v0.1]**. Códigos de recuperación de un solo uso (10) generados al enrolar [ASSUMPTION: soporte nativo de Supabase o implementación propia; se verifica en el spike S-2]. |
| **Suspensión de usuario (plataforma)** | `platform_admin` puede *banear* un `auth.user` (Auth Admin, uso #1 de la lista blanca) → invalida sesiones; todas las membresías quedan inutilizables. |
| **Suspensión de organización/tienda** | `organizations.status = 'suspended'` o `stores.status = 'suspended'` → `has_store_permission` devuelve `false` para todo; storefront en mantenimiento. |
| **Eliminación de cuenta de usuario** | Si es `org_owner` de una organización activa: bloqueada hasta transferir la propiedad. Si no: elimina membresías y anonimiza `profiles`; los registros de auditoría conservan `actor_label` como snapshot. |

### 7.3 Contexto de autenticación en la base de datos

- `auth.uid()`: el usuario.
- `auth.jwt() ->> 'aal'`: nivel de autenticación (`aal1`/`aal2`) [FACT: claim emitido por Supabase Auth].
- **Los permisos nunca van en el JWT** [DECISION]: se evalúan en vivo.

### 7.4 Compradores
- `customers (store_id, email)` único; `user_id` nulo para invitados.
- Al iniciar sesión con OTP en la tienda X: `storefront_link_customer(store_id, …)` vincula o crea `customers` con `user_id = auth.uid()` **solo si** `customers.email = auth.email()` verificado. Los pedidos de invitado con ese email quedan visibles en la cuenta [DECISION; riesgo LOW documentado en T-21].
- Políticas de comprador: `customers.user_id = auth.uid()` (sin AAL2).

### 7.5 Separación de privilegios por contexto

| Contexto de login | AAL típico | Permisos efectivos |
|---|---|---|
| Panel (`app.`) con TOTP | aal2 | Staff según membresías |
| Storefront (OTP) | aal1 | Solo sus datos de comprador |
| Storefront con un usuario que también es staff | aal1 | Solo sus datos de comprador (**el staff exige aal2**) |

### 7.6 Platform staff
- `platform_staff (user_id, role, status)`; AAL2 obligatorio; acceso solo a `/platform`.
- Los platform admins **no** obtienen acceso a datos de tenant por RLS. Usan funciones de plataforma y, para ver la tienda "como el tenant", una concesión de soporte.

### 7.7 Concesiones de soporte (`support_access_grants`)

| Campo | Regla |
|---|---|
| `grantee_user_id` | Debe tener `platform_staff.role in (platform_support, platform_admin)` y estar activo |
| `store_id` | Exactamente una tienda |
| `reason` | Obligatorio, mínimo 20 caracteres; ticket de referencia opcional |
| `scope` | `read` (MVP: único valor) |
| `granted_by` | `platform_admin`/`platform_owner`, **≠ grantee** (sin autoconcesión) |
| `starts_at`/`expires_at` | Máximo 60 minutos; extensión = nueva concesión |
| `revoked_at` | Revocable por plataforma o por el `org_owner` |
| Notificación | Email al `org_owner` al crear (MVP); P2: aprobación previa por el tenant |
| Efecto | `has_store_permission` devuelve `true` solo para permisos con `support_readable = true` (excluye costos, exportaciones, PII completa de clientes, auditoría y pagos) |
| Auditoría | `support_session.started/ended`, más registro de las rutas visitadas (a nivel de aplicación) |

---

## 8. RBAC Matrix

### 8.1 Auditoría de los cuatro roles solicitados

| Rol | ¿Suficiente? | Veredicto |
|---|---|---|
| `org_owner` | Sí para la propiedad | KEEP. Único por organización, transferible. |
| `org_admin` | Sí para la administración general | KEEP. Todo menos facturación, borrado y transferencia. |
| `catalog_manager` | Sí para el catálogo | KEEP. |
| `platform_support` | Sí, con concesión | KEEP, solo lectura y con concesión. |
| **¿Solo estos cuatro?** | **No.** Faltan roles operativos de tienda (pedidos, inventario, marketing, atención) y un rol de solo lectura. Sin ellos, cualquier empleado de pedidos necesitaría `org_admin`, lo que viola el mínimo privilegio. | Conjunto final abajo |

**Conjunto final [DECISION]:**
- Plataforma: `platform_owner`, `platform_admin`, `platform_support`.
- Organización: `org_owner`, `org_admin`, `org_member` (sin permisos de tienda por sí mismo; necesita `store_members`).
- Tienda: `store_admin`, `catalog_manager`, `inventory_manager`, `order_manager`, `marketing_manager`, `support_agent`, `viewer`.

### 8.2 Catálogo de permisos (fuente: código, sincronizado con la tabla `permissions`)

Cada permiso tiene `kind ∈ {read, write, operational}` (el modo de solo lectura de la suscripción deniega solo `write`; `operational` = `orders.fulfill`, `orders.cancel` y `orders.refund`, que siguen permitidos para no dañar a los compradores, §19.4), `sensitive bool` (excluido de soporte) y `support_readable bool` (solo con `kind = read`).

```
store.read · store.update
staff.read · staff.manage
products.read · products.create · products.update · products.publish · products.delete
products.cost.read                                   (sensitive)
categories.manage · brands.manage                    (incluyen create/update/delete)
inventory.read · inventory.adjust · inventory.locations.manage
orders.read · orders.update · orders.fulfill · orders.cancel · orders.refund
customers.read · customers.pii.read (sensitive) · customers.update · customers.delete
discounts.read · discounts.manage
payments.read · payments.manage                      (cuentas de pago de la tienda)
shipping.manage · taxes.manage
appearance.manage · content.manage · seo.manage
domains.manage
analytics.read
imports.run · exports.run (sensitive)
notifications.manage
audit.read (sensitive)
--- Organización (no asignables por tienda) ---
org.read · org.update · org.members.manage · org.stores.create · org.billing.read
org.billing.manage · org.delete · org.transfer_ownership
--- Plataforma (solo platform_staff) ---
platform.tenants.read · platform.tenants.manage · platform.plans.manage
platform.flags.manage · platform.support.grant · platform.staff.manage · platform.health.read
```

### 8.3 Matriz completa

Leyenda: ✓ = concedido · — = denegado · R = solo lectura · G = solo con `support_access_grant` vigente.

**Organización y plataforma**

| Permiso | org_owner | org_admin | org_member | catalog_manager | platform_support | platform_admin | platform_owner |
|---|---|---|---|---|---|---|---|
| org.read | ✓ | ✓ | ✓ | — | — | ✓ (función) | ✓ |
| org.update | ✓ | ✓ | — | — | — | ✓ (función) | ✓ |
| org.members.manage | ✓ | ✓ (no al owner, no a otro admin si no es owner) | — | — | — | — | — |
| org.stores.create | ✓ | ✓ | — | — | — | ✓ | ✓ |
| org.billing.read | ✓ | ✓ | — | — | — | ✓ | ✓ |
| org.billing.manage | ✓ | — | — | — | — | ✓ | ✓ |
| org.delete / org.transfer_ownership | ✓ | — | — | — | — | — (cierre vía plataforma) | ✓ |
| platform.tenants.read | — | — | — | — | ✓ (metadatos, sin datos de comercio) | ✓ | ✓ |
| platform.tenants.manage (suspender, cerrar) | — | — | — | — | — | ✓ | ✓ |
| platform.plans.manage / flags.manage | — | — | — | — | — | ✓ | ✓ |
| platform.support.grant | — | — | — | — | — | ✓ (no a sí mismo) | ✓ |
| platform.staff.manage | — | — | — | — | — | — | ✓ |

**Tienda** (los roles de organización `org_owner`/`org_admin` tienen todos los permisos de tienda en todas sus tiendas)

| Permiso | org_owner / org_admin | store_admin | catalog_mgr | inventory_mgr | order_mgr | marketing_mgr | support_agent | viewer | platform_support |
|---|---|---|---|---|---|---|---|---|---|
| store.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | G |
| store.update | ✓ | ✓ | — | — | — | — | — | — | — |
| staff.read | ✓ | ✓ | — | — | — | — | — | — | G |
| staff.manage | ✓ | ✓ (solo roles < store_admin) | — | — | — | — | — | — | — |
| products.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | G |
| products.create/update/publish | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| products.delete | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| products.cost.read | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — |
| categories.manage / brands.manage | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| inventory.read | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | G |
| inventory.adjust | ✓ | ✓ | — | ✓ | — | — | — | — | — |
| inventory.locations.manage | ✓ | ✓ | — | ✓ | — | — | — | — | — |
| orders.read | ✓ | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | G |
| orders.update / orders.fulfill | ✓ | ✓ | — | — | ✓ | — | — | — | — |
| orders.cancel / orders.refund | ✓ | ✓ | — | — | ✓ | — | — | — | — |
| customers.read (sin PII completa) | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | ✓ (enmascarado) | G (enmascarado) |
| customers.pii.read | ✓ | ✓ | — | — | ✓ | — | ✓ | — | — |
| customers.update | ✓ | ✓ | — | — | ✓ | — | ✓ | — | — |
| customers.delete (anonimizar) | ✓ | ✓ | — | — | — | — | — | — | — |
| discounts.read | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | G |
| discounts.manage | ✓ | ✓ | — | — | — | ✓ | — | — | — |
| payments.read | ✓ | ✓ | — | — | ✓ | — | — | — | — |
| payments.manage | ✓ | ✓* | — | — | — | — | — | — | — |
| shipping.manage / taxes.manage | ✓ | ✓ | — | — | — | — | — | — | — |
| appearance / content / seo .manage | ✓ | ✓ | — | — | — | ✓ | — | — | — |
| domains.manage | ✓ | ✓* | — | — | — | — | — | — | — |
| analytics.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | G |
| imports.run | ✓ | ✓ | ✓ | ✓ (solo inventario) | — | — | — | — | — |
| exports.run | ✓ | ✓ | ✓ (catálogo) | ✓ (inventario) | ✓ (pedidos) | — | — | — | — |
| notifications.manage | ✓ | ✓ | — | — | — | — | — | — | — |
| audit.read | ✓ | ✓ | — | — | — | — | — | — | — |

\* El `org_owner` puede retirarlos al `store_admin` (P2: toggle por organización; MVP: concedidos).

**Restricciones estructurales (aplicadas en las RPC de membresía):**
1. Nadie asigna un rol con permisos que no posee.
2. Nadie modifica ni elimina al `org_owner`, excepto la transferencia hecha por el propio owner.
3. `store_admin` no crea `store_admin`.
4. Debe existir siempre exactamente un `org_owner` (índice único parcial + RPC atómica de transferencia).
5. `catalog_manager` **no tiene ningún permiso `org.*`**: no puede ver ni modificar el billing (Ataque 3, §45).

### 8.4 Evolución
- **P2:** roles personalizados por organización (`roles.organization_id`), que duplican uno de sistema y editan permisos, sin superar los del creador y sin `org.*`. Limitados por el entitlement `custom_roles`.
- **P2+:** varios roles por miembro (`store_member_roles`); permisos acotados por ubicación de inventario solo con demanda real.

---

## 9. Database Architecture

### 9.1 Convenciones obligatorias

| Tema | Regla [DECISION] |
|---|---|
| Motor | PostgreSQL de Supabase, versión ≥ 15 [ASSUMPTION: la versión exacta del proyecto es UNKNOWN hasta crearlo; ≥ 15 es requisito por `SET NULL (col)` y `NULLS NOT DISTINCT`] |
| Esquemas | `public` (tablas + RPC de staff y comprador; expuesto por la Data API), `storefront` (funciones del gateway; **no expuesto**), `system` (funciones del worker; **no expuesto**), `app` (helpers de autorización; no expuesto), `audit` (no expuesto), `private` (no expuesto) |
| PK | `id uuid` generado por `app.uuid_v7()` (v7 por localidad de índice; implementación SQL si `uuidv7()` nativo no está disponible) — ver §10 |
| Tenant | `store_id uuid not null`. Inmutable vía trigger `app.prevent_tenant_change()` |
| Padres de tienda | `unique (store_id, id)` |
| Hijas de tienda | FK compuesta `(store_id, parent_id) → parent(store_id, id)`. **Sin excepciones** |
| Dinero | `bigint` en unidades menores + `currency char(3)` en el contexto (tienda o pedido) |
| Cantidades | `integer` |
| Porcentajes | Puntos base `integer` (1600 = 16.00%) |
| Tiempo | `timestamptz` en UTC; `created_at`/`updated_at` (trigger) |
| Estados | `text` + `CHECK`; tabla de transiciones en función |
| Texto con unicidad sin mayúsculas | `citext` (emails, handles, códigos de descuento, hostnames) |
| Soft delete | `deleted_at timestamptz` + índices únicos parciales `WHERE deleted_at IS NULL` |
| JSONB | Solo snapshots, configuraciones versionadas o metadatos. Nunca para relaciones ni campos filtrados con frecuencia. Siempre `CHECK (jsonb_typeof(col) = 'object')` |
| Extensiones | `pgcrypto`, `citext`, `pg_trgm`, `unaccent`, `btree_gin`, `pg_cron`, `pg_net`, `supabase_vault`. **Sin `ltree`** [CHANGED: SIMPLIFY] |
| Migraciones | Supabase CLI; forward-only; *expand → migrate → contract* |
| Grants | `REVOKE ALL` por defecto en todos los esquemas para `anon`, `authenticated` y `public`; grants explícitos por tabla y función |

### 9.2 Especificación lógica por tabla (MVP)

Formato: **Propósito · PK · Org · Store · FK · UQ · CK · IX · SD · Audit · RLS · Inmutables.** "FKc" = FK compuesta con `store_id`.

#### Plano Plataforma

**platform_settings**: configuración global (gracias de suscripción, handles reservados, defaults de branding). PK `key text`. Columna `value jsonb`. Audit T. RLS: lectura `authenticated` para claves públicas vía función; escritura `platform.flags.manage` vía función.

**platform_staff**: PK `user_id` → `auth.users` ON DELETE CASCADE. `role` CK in (`platform_owner`,`platform_admin`,`platform_support`); `status` CK in (`active`,`suspended`). IX `(role)`. Audit S. RLS: SELECT propio; escritura solo por función de plataforma con `platform.staff.manage`.

**plans**: PK `id`; UQ `key`. `name`, `status` CK in (`active`,`legacy`,`hidden`), `sort`, precios informativos. Audit T. RLS: SELECT `authenticated`; escritura por función.

**plan_entitlements**: PK `(plan_id, key)`; FK `plan_id → plans` CASCADE; `key` CK ∈ registro de claves; `value_int` o `value_bool` (CK: exactamente uno no nulo). Audit T.

**feature_flags**: PK `key`; `default_enabled`, `kill_switch`, `entitlement_key?`, `description`, `owner`.

**feature_flag_overrides**: PK `id`; UQ `(flag_key, scope, scope_id)`; `scope` CK in (`plan`,`organization`,`store`) [CHANGED: el scope de usuario se difiere, ver §46]; `enabled`, `expires_at?`.

#### Plano Tenant: organización

**organizations**: PK `id`. `name`, `slug citext` UQ, `status` CK in (`active`,`suspended`,`closed`), `owner_user_id` FK → `auth.users` RESTRICT, `billing_email citext`, `country char(2)`, `closed_at?`. IX `(status)`. SD vía `closed`. Audit T+S. RLS §12. Inmutables: `id`.

**organization_members**: PK `id`; FK `organization_id` → organizations CASCADE; `user_id` → `auth.users` CASCADE. `role` CK in (`org_owner`,`org_admin`,`org_member`); `status` CK in (`active`,`suspended`). UQ `(organization_id, user_id)`; UQ parcial `(organization_id) WHERE role = 'org_owner'`. IX `(user_id, status)`. Audit S. Inmutables: `organization_id`, `user_id`.

**organization_invitations**: PK `id`; `organization_id` FK CASCADE; `store_id?` → FKc lógica (CK: si `store_id` no es nulo, la tienda pertenece a la organización, verificado por trigger); `email citext`; `org_role?`; `store_role_key?`; CK exactamente uno de (`org_role`, `store_role_key`). `token_hash bytea` UQ; `expires_at`; `accepted_at?`; `revoked_at?`; `invited_by`. UQ parcial `(organization_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL`. Audit S.

**subscriptions**: PK `id`; `organization_id` FK RESTRICT; UQ parcial `(organization_id) WHERE status <> 'cancelled'` (una vigente); `plan_id` FK RESTRICT; `status` CK in (`trialing`,`active`,`past_due`,`paused`,`cancelled`); `current_period_start/end`; `trial_ends_at?`; `grace_ends_at?`; `provider?` y `provider_*_id?` (P2). Audit T.

**organization_entitlement_overrides**: PK `(organization_id, key)`; valores; `reason` NOT NULL; `expires_at?`; `created_by`. Audit T.

**support_access_grants**: PK `id`; `organization_id` (denormalizado y verificado por trigger contra la tienda); `store_id` FK → stores CASCADE; `grantee_user_id`, `granted_by` FK → `auth.users`; CK `grantee_user_id <> granted_by`; `reason text` CK `length >= 20`; `scope` CK in (`read`); `starts_at`, `expires_at` CK `expires_at <= starts_at + interval '60 minutes'`; `revoked_at?`. IX `(grantee_user_id, store_id, expires_at)`. Audit S.

#### Plano Tenant: tienda

**stores**: PK `id`; UQ `(id)`; `organization_id` FK RESTRICT. `name`, `handle citext` UQ global, CK formato `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$` y CK `NOT app.is_reserved_handle(handle)`. `status` CK in (`draft`,`active`,`paused`,`suspended`,`closed`). `currency char(3)`, `country char(2)`, `timezone`, `locale`, `prices_include_tax bool`, `tax_rate_bps int` CK `0..10000` [CHANGED: SIMPLIFY], `tax_applies_to_shipping bool`, `order_number_prefix text` CK longitud ≤ 8, `contact_email`, `contact_phone?`, `legal_name?`, `tax_id?`, `launched_at?`, `closed_at?`. IX `(organization_id)`. Audit T+S. Inmutables: `id`, `organization_id`, `currency` (después de `launched_at`).

**store_members**: PK `id`; FK `store_id` CASCADE; `user_id` → `auth.users` CASCADE; `role_id` FK → roles RESTRICT; `status` CK in (`active`,`suspended`). UQ `(store_id, user_id)`. IX `(user_id, status, store_id)`. Audit S. Inmutables: `store_id`, `user_id`.

**roles / permissions / role_permissions**: sembradas desde el código. `roles(id, key, scope='store', organization_id NULL [P2: no nulo = personalizado], is_system)`, UQ `(coalesce(organization_id, '00000000-0000-0000-0000-000000000000'), key)`. `permissions(key PK, kind, sensitive, support_readable, module)`. `role_permissions(role_id, permission_key) PK`. Escritura solo por migración.

**store_domains**: PK `id`; FK `store_id` CASCADE; `hostname citext` **UQ global** (CK minúsculas, sin puerto, FQDN válido); `type` CK in (`platform_subdomain`,`custom`); `status` CK in (`pending`,`verifying`,`active`,`failed`,`removed`); `is_primary`; UQ parcial `(store_id) WHERE is_primary AND status = 'active'`; `verification_token_hash?`; `verified_at?`; `last_checked_at?`; `provider_ref?`. IX `(store_id)`. Audit T. Inmutable: `hostname`.

**store_themes**: PK `store_id` (FK CASCADE). `theme_key`, `theme_version int`, `settings jsonb`, `home_sections jsonb` (array), `draft_settings?`, `draft_home_sections?`, `published_at?`, `published_by?`. CK de forma JSON. Validación profunda en el servidor (esquema Zod del tema) **y** en la función de publicación (`storefront_validate_theme`, verificaciones estructurales mínimas). Audit S (publish).

**menus**: PK `id`; UQ `(store_id, id)`; UQ `(store_id, handle)`; `handle` CK in (`main`,`footer`). **menu_items**: PK `id`; FKc → menus CASCADE; `parent_id?` FKc → menu_items CASCADE; `label`; `link_type` CK in (`home`,`category`,`brand`,`product`,`page`,`collection`,`search`,`url`); `target_id?`; `url?` CK (`url` empieza por `https://` o por `/` y no por `//`); CK coherencia `link_type` ↔ `target_id`/`url`; `position`. Profundidad ≤ 2 (trigger). La validez de `target_id` se comprueba en la resolución de lectura: si el destino no existe o no está publicado, el ítem se omite.

**store_pages**: PK `id`; UQ `(store_id, id)`; UQ parcial `(store_id, slug) WHERE deleted_at IS NULL`; `type` CK in (`content`,`policy_privacy`,`policy_terms`,`policy_returns`,`policy_shipping`); UQ parcial `(store_id, type) WHERE type <> 'content' AND deleted_at IS NULL`; `title`, `body_html` (sanitizado en el servidor), `is_published`, `seo_*`. SD ✓. Audit T.

#### Catálogo
Especificado en la §14 (incluye columnas, UQ, CK e IX).

#### Inventario
Especificado en la §15.

#### Pedidos, checkout y pagos
Especificados en las §16, §17 y §18.

#### Clientes

**customers**: PK `id`; UQ `(store_id, id)`; UQ `(store_id, email)`; UQ parcial `(store_id, user_id) WHERE user_id IS NOT NULL`; `user_id?` → `auth.users` SET NULL; `email citext`, `first_name?`, `last_name?`, `phone?`, `accepts_marketing bool default false`, `marketing_consent_at?`, `marketing_consent_source?`, `orders_count int`, `total_spent bigint` (mantenidos por `system.apply_payment_status`), `note?`, `anonymized_at?`, `deleted_at?`. IX `(store_id, created_at desc)`, GIN trigram `(store_id, email)` para búsqueda en el panel. Audit T. Inmutables: `store_id`, `email` después de la anonimización.

**customer_addresses**: PK `id`; FKc → customers CASCADE; campos de dirección (`line1`, `line2?`, `city`, `region`, `postal_code`, `country char(2)`, `phone?`, `recipient_name`); `is_default`; UQ parcial `(customer_id) WHERE is_default`.

#### Envíos

**shipping_zones**: PK `id`; UQ `(store_id, id)`; `name`; `countries char(2)[]` CK no vacío; `regions text[]?`. **shipping_rates**: PK `id`; FKc → shipping_zones CASCADE; `name`; `type` CK in (`flat`,`free_over`,`pickup`); `price bigint` CK ≥ 0; `free_over_subtotal?` CK (requerido si `type = 'free_over'`); `min_weight_g?`, `max_weight_g?`; `est_days_min?`, `est_days_max?`; `is_active`. IX `(store_id, is_active)`.

**shipments**: PK `id`; UQ `(store_id, id)`; FKc → orders RESTRICT; `status` CK in (`pending`,`shipped`,`delivered`,`returned`,`cancelled`); `carrier?`, `tracking_number?`, `tracking_url?` (CK `https://`); `shipped_at?`, `delivered_at?`; `idempotency_key` UQ `(store_id, idempotency_key)`. **shipment_items**: PK `(shipment_id, order_item_id)`; FKc ambas; `quantity` CK > 0.

#### Sistema

**jobs** (cola única [CHANGED: SIMPLIFY]): PK `id`; `store_id?` (FK → stores CASCADE si no es nulo); `type text`; `payload jsonb`; `dedupe_key text?` UQ parcial; `status` CK in (`queued`,`running`,`succeeded`,`failed`,`dead`); `attempts int`, `max_attempts int default 8`; `run_after timestamptz`; `locked_at?`, `locked_by?`; `last_error?`; `created_at`. IX `(status, run_after) WHERE status = 'queued'`. RLS habilitado **sin políticas** (solo `system_worker` y las funciones de encolado).

**notification_deliveries**: PK `id`; `store_id?`; `organization_id?`; `channel` CK in (`email`); `template`; `recipient` (hash + versión enmascarada para la UI); `dedupe_key` UQ; `status` CK in (`queued`,`sent`,`failed`,`suppressed`); `provider_message_id?`; `error?`; `sent_at?`.

**import_jobs / import_job_rows / export_jobs**: §26.

**audit.audit_logs / security_events**: §29.

### 9.3 Problemas de integridad detectados y su resolución

| Tipo | Hallazgo en v0.1 | Resolución |
|---|---|---|
| Relación ambigua | `organization_invitations` podía apuntar a una tienda de otra organización | Trigger de coherencia organización ↔ tienda |
| Relación ambigua | `menu_items.target_id` polimórfico sin FK | Aceptado (polimórfico); validación en lectura y en escritura (función verifica existencia en la misma tienda); el ítem se omite si el destino falta |
| Duplicación | `organization_id` en tablas de comercio (tentación) | Prohibido; solo en `support_access_grants` como denormalización verificada por trigger |
| Duplicación | `order_addresses` tabla frente a snapshot | Columnas JSONB en `orders` [SIMPLIFY] |
| Duplicación | `notification_outbox` + `jobs` | Solo `jobs` [SIMPLIFY] |
| Dependencia circular | `products ↔ product_media` (imagen de variante y medios de producto) | La variante referencia media; media referencia producto; no hay ciclo de NOT NULL (las columnas `image_id` son nulas) |
| Dependencia circular | `organizations.owner_user_id` ↔ `organization_members` | La RPC `access_transfer_ownership` actualiza ambas en una transacción; trigger diferido verifica la coherencia al final de la transacción |
| Clave débil | SKU opcional | UQ parcial por tienda; la importación exige SKU **o** handle + firma de opciones |
| Clave débil | `discounts.code` sin normalizar | `citext` + trim por trigger |
| Índice faltante | Búsqueda sin `store_id` | GIN compuesto con `btree_gin` (CF-12) |
| Índice faltante | `store_members(user_id)` para el selector y la autorización | IX `(user_id, status, store_id)` |
| Índice faltante | `inventory_reservations` por expiración | IX parcial `(expires_at) WHERE status = 'active'` |
| Constraint faltante | Coherencia de totales | CK en `orders` (§16) |
| Constraint faltante | Suma reembolsada ≤ cobrada | Verificación en la función bajo `FOR UPDATE` + CK `refunded_total <= paid_total` |
| Constraint faltante | `compare_at_price > price` | CK en variantes |
| Riesgo | Mover `store_id` | Trigger genérico de inmutabilidad (todas las tablas) |
| Riesgo | Borrado de pedidos | `REVOKE DELETE` + sin políticas de DELETE + trigger que lanza excepción |

---

## 10. Entity Relationship Model

### 10.1 Diagrama

```
auth.users ─1:1─ profiles
auth.users ─1:0..1─ platform_staff
auth.users ─1:N─ organization_members ─N:1─ organizations ─1:N─ stores
auth.users ─1:N─ store_members ─N:1─ stores ;  store_members ─N:1─ roles ─N:M─ permissions
organizations ─1:1─ subscriptions(vigente) ─N:1─ plans ─1:N─ plan_entitlements
organizations ─1:N─ organization_entitlement_overrides
stores ─1:N─ support_access_grants ─N:1─ auth.users(grantee)

stores ─1:N─ store_domains | ─1:1─ store_themes | ─1:N─ menus ─1:N─ menu_items | ─1:N─ store_pages
stores ─1:N─ brands | categories(árbol: parent_id) | products
products ─1:N─ product_options ─1:N─ product_option_values
products ─1:N─ product_variants ─N:M─ product_option_values  (variant_option_values)
product_variants ─1:0..1─ variant_costs
products ─N:M─ categories (product_categories) ; products ─N:0..1─ brands
products ─1:N─ media ; product_variants ─N:0..1─ media
stores ─1:N─ inventory_locations ─1:N─ inventory_levels ─N:1─ product_variants
inventory_levels ─1:N─ inventory_movements
orders ─1:0..1─ inventory_reservations ─1:N─ inventory_reservation_items ─N:1─ inventory_levels
stores ─1:N─ customers ─1:N─ customer_addresses ; customers ─N:0..1─ auth.users
stores ─1:N─ carts ─1:N─ cart_items ─N:1─ product_variants
stores ─1:N─ orders ─1:N─ order_items ─N:0..1─ product_variants (SET NULL)
orders ─1:N─ order_events | payments ─1:N─ refunds | shipments ─1:N─ shipment_items ─N:1─ order_items
orders ─N:0..1─ customers ; orders ─1:0..1─ discount_redemptions ─N:1─ discounts
stores ─1:N─ payment_accounts ─1:N─ payments ; payment_accounts ─1:N─ payment_events
stores ─1:N─ shipping_zones ─1:N─ shipping_rates
```

### 10.2 Cardinalidades clave
- **1:1:** `auth.users`↔`profiles`; `stores`↔`store_themes`; `product_variants`↔`variant_costs`; `organizations`↔`subscription` vigente; `orders`↔`inventory_reservations` (como máximo una vigente).
- **1:N:** organización→tiendas; tienda→todo; producto→variantes; pedido→items, eventos, pagos y envíos; pago→reembolsos.
- **N:M:** usuarios↔organizaciones; usuarios↔tiendas; roles↔permisos; productos↔categorías; variantes↔valores de opción.

### 10.3 Comportamiento en cascada (resumen normativo)

| Relación | ON DELETE | Razón |
|---|---|---|
| Hijos de composición (opciones, valores, `variant_option_values`, `cart_items`, `menu_items`, `customer_addresses`, `product_categories`) | CASCADE | Sin vida propia |
| Referencias opcionales (`products.brand_id`, `variants.image_id`, `orders.customer_id`, `order_items.variant_id/product_id`) | `SET NULL (col)` | El dato histórico sobrevive |
| Todo lo transaccional (`orders`, `payments`, `refunds`, `shipments`, `movements`, `payment_events`) | RESTRICT | Nunca se borra |
| `stores → organizations`, `inventory_levels → locations` | RESTRICT | El cierre es lógico |
| `auth.users` → membresías | CASCADE | El usuario eliminado pierde el acceso |
| `auth.users` → `customers.user_id` | SET NULL | El cliente y sus pedidos permanecen |

---

## 11. Multi-Tenant Security

### 11.1 Garantía
> **Un tenant nunca puede leer, modificar, eliminar ni asociar datos de otro tenant**, aunque haya un bug en la aplicación.

### 11.2 Capas de defensa (defensa en profundidad)

| # | Capa | Protege contra | Dónde |
|---|---|---|---|
| L1 | Resolución del contexto en el servidor (host → tienda; URL → tienda + membresía) | Tienda elegida por el cliente | Next.js proxy/middleware + guards |
| L2 | Guard de permisos en TS (`requirePermission`) | Acciones no autorizadas (UX y error claro) | Server Actions y Route Handlers |
| L3 | **RLS forzado** con `app.has_store_permission` | Lectura y escritura fuera de los permisos | PostgreSQL |
| L4 | **FK compuestas `(store_id, …)`** | Asociación cross-tenant **incluso con roles que omiten RLS** | PostgreSQL |
| L5 | **`store_id` inmutable** | "Mover" filas entre tiendas | Trigger genérico |
| L6 | **Roles de mínimo privilegio sin acceso a tablas** (`storefront_gateway`, `system_worker`) | Bypass silencioso por service role | PostgreSQL grants |
| L7 | Funciones `SECURITY DEFINER` endurecidas (`search_path = ''`, `REVOKE EXECUTE FROM public`) | Secuestro de funciones privilegiadas | PostgreSQL |
| L8 | Esquemas privilegiados **no expuestos** por la Data API | Invocación directa de funciones internas | Configuración de Supabase |
| L9 | Lint de importaciones y CODEOWNERS en código privilegiado | Uso accidental de clientes privilegiados | CI |
| L10 | Suite de aislamiento obligatoria | Regresiones | CI (bloquea el merge) |

### 11.3 Actores y su camino a los datos

| Actor | Rol de base de datos | Cómo llega | Qué puede |
|---|---|---|---|
| Visitante anónimo | — | Next.js (servidor) → `storefront_gateway` | Solo funciones `storefront.*` (catálogo publicado, carrito con token, checkout) |
| Comprador autenticado | `authenticated` (JWT, aal1) | supabase-js con su JWT | Sus filas de `customers`, `orders` y `customer_addresses` vía RLS |
| Staff | `authenticated` (JWT, **aal2**) | supabase-js con su JWT | Lo que concedan las membresías vía RLS y RPC de `public` |
| Platform staff | `authenticated` (aal2) | supabase-js + funciones `platform_*` | Metadatos de tenants; datos de tienda solo con concesión |
| Jobs y webhooks | `system_worker` | Conexión directa (Supavisor) | Solo funciones `system.*` |
| Auth Admin, Storage Admin | `service_role` | SDK en `server/privileged` | Lista blanca (§11.5) |
| Migraciones | `postgres` | CLI en CI | DDL |

### 11.4 Roles de base de datos de mínimo privilegio [DECISION, RC-01]

**SQL CONCEPTUAL — NO EJECUTAR**
```sql
create role storefront_gateway login noinherit;   -- contraseña en el gestor de secretos
create role system_worker      login noinherit;
revoke all on all tables in schema public from storefront_gateway, system_worker;
grant usage on schema storefront to storefront_gateway;
grant execute on all functions in schema storefront to storefront_gateway;
grant usage on schema system to system_worker;
grant execute on all functions in schema system to system_worker;
-- Las funciones storefront.* y system.* son SECURITY DEFINER, con search_path='',
-- y reciben store_id explícito; cada una valida pertenencia y estado.
```

- **Conexión:** desde el servidor Next.js mediante el pooler de Supabase (Supavisor, modo transacción, sin *prepared statements*) con un cliente Postgres ligero (p. ej., `postgres`).
  [ASSUMPTION: Supavisor acepta roles de login personalizados → **Spike S-1** en la Fase 1. Alternativa si falla: JWT firmado por el servidor con `role` personalizado para la Data API, con las mismas funciones en un esquema expuesto solo a ese rol.]
- **Efecto:** el código del storefront y de los jobs **no puede** hacer `SELECT * FROM orders`; solo puede llamar a funciones que ya aplican las reglas. Un bug de "olvidé el `store_id`" no puede existir en esa capa.

### 11.5 Service role: lista blanca cerrada [DECISION, RC-02]

| # | Uso | Por qué no hay alternativa | Controles |
|---|---|---|---|
| SR-1 | **Auth Admin API**: banear usuario, resetear factores MFA, invalidar sesiones | Solo la API de administración de Auth lo permite | Función `privileged/authAdmin.ts`; requiere actor de plataforma con aal2 o un `org_owner` (reset de su miembro) ya autorizado; auditoría obligatoria con `reason` |
| SR-2 | **Storage Admin**: procesamiento de medios (leer el original, escribir derivados), limpieza de huérfanos, escritura de archivos de exportación | El worker no tiene JWT de usuario y Storage autoriza por JWT | `privileged/storageAdmin.ts`; **la ruta se deriva siempre de una fila de la base de datos** (`media.storage_path`, `export_jobs.file_path`) leída vía `system.*`, nunca de la entrada; verifica el prefijo `{store_id}/` |

> Nota: el Send Email Hook de Supabase Auth **no** requiere service role (se verifica con la firma del hook); no forma parte de la lista.

**Prohibido:** usar el service role para leer o escribir tablas de `public` en runtime. Lo verifican lint (`no-restricted-imports` del cliente SR fuera de `server/privileged/*`), revisión obligatoria (CODEOWNERS) y un test de CI que busca la clave en el bundle del cliente.

### 11.6 Escenarios de bypass accidental y su bloqueo

| Escenario | Bloqueado por |
|---|---|
| Server Action olvida `requirePermission` | L3 (RLS/RPC rechaza) |
| Query del panel sin filtro de `store_id` | L3 (RLS devuelve solo lo permitido; para un usuario de varias tiendas, la UI siempre filtra, pero la fuga entre sus propias tiendas no es cross-tenant) |
| Función del worker recibe el `store_id` de A y el `product_id` de B | L4 (FK compuesta) + la función valida pertenencia |
| Desarrollador usa el service role "por comodidad" | L9 (lint/CI) + L6 (no hay razón funcional: las funciones existen) |
| `UPDATE ... SET store_id = B` | L5 |
| Nueva tabla sin RLS | L10 (meta-test falla) |
| Nueva función `SECURITY DEFINER` sin `search_path` | L10 (meta-test falla) + Supabase advisors |
| Caché de Next.js sirve datos de A a B | Las páginas del storefront viven en la ruta `/_store/[storeId]` (la clave de caché incluye el `storeId`); las funciones cacheadas exigen `storeId` como argumento; los datos autorizados nunca se cachean entre requests (RC-13) |

---

## 12. RLS Strategy

### 12.1 Reglas globales [DECISION]
1. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` **y** `FORCE ROW LEVEL SECURITY` en el 100% de las tablas de `public`, `audit` y `private`.
2. Sin políticas = sin acceso. Ninguna política `USING (true)` para `authenticated`.
3. `anon`: **cero grants** (CF-03).
4. Las políticas usan `(select auth.uid())` y `(select app.has_store_permission(store_id, '…'))` para que la evaluación se haga una vez por sentencia (initPlan).
5. Escrituras de negocio complejas: **solo RPC** (`SECURITY DEFINER`, que verifica el permiso internamente). Esas tablas no tienen políticas de INSERT, UPDATE ni DELETE.
6. Vistas: `security_invoker = true`.

### 12.2 Función de autorización (contrato)

**SQL CONCEPTUAL — NO EJECUTAR**
```sql
create function app.has_store_permission(p_store_id uuid, p_perm text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_kind text; v_support_ok boolean;
        v_org uuid; v_store_status text; v_org_status text; v_mode text;
begin
  if v_uid is null then return false; end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then return false; end if;    -- RC-03
  select kind, support_readable into v_kind, v_support_ok from public.permissions where key = p_perm;
  if v_kind is null then return false; end if;                                       -- permiso desconocido
  select s.organization_id, s.status, o.status into v_org, v_store_status, v_org_status
    from public.stores s join public.organizations o on o.id = s.organization_id
   where s.id = p_store_id;
  if v_org is null or v_store_status in ('suspended','closed') or v_org_status <> 'active' then
    return false;
  end if;
  v_mode := app.org_access_mode(v_org);                                              -- RC-17
  if v_mode = 'suspended' then return false; end if;
  if v_mode = 'read_only' and v_kind = 'write' then return false; end if;
  if exists (select 1 from public.organization_members m
              where m.organization_id = v_org and m.user_id = v_uid and m.status = 'active'
                and m.role in ('org_owner','org_admin')) then return true; end if;
  if exists (select 1 from public.store_members sm
               join public.role_permissions rp on rp.role_id = sm.role_id
              where sm.store_id = p_store_id and sm.user_id = v_uid and sm.status = 'active'
                and rp.permission_key = p_perm) then return true; end if;
  if v_kind = 'read' and v_support_ok and exists (
       select 1 from public.support_access_grants g
         join public.platform_staff ps on ps.user_id = g.grantee_user_id and ps.status = 'active'
        where g.grantee_user_id = v_uid and g.store_id = p_store_id
          and g.revoked_at is null and now() between g.starts_at and g.expires_at) then
    return true;
  end if;
  return false;
end $$;
revoke all on function app.has_store_permission(uuid, text) from public;
grant execute on function app.has_store_permission(uuid, text) to authenticated;
```

- Variante `app.user_has_store_permission(p_user, p_store, p_perm)`: misma lógica **sin** la verificación de AAL. **Solo ejecutable por `system_worker`** (para jobs que actúan en nombre de un solicitante, CF-10).
- `app.is_store_member(p_store)`: `has_store_permission(p_store, 'store.read')`.
- `app.org_access_mode(org)`: deriva `full | read_only | suspended` de `organizations.status` + `subscriptions` + `platform_settings` (§19.4).

### 12.3 Matriz de políticas (normativa)

`P(x)` = `has_store_permission(store_id,'x')`; `RPC` = solo vía función; `—` = denegado; `C` = comprador (`customer.user_id = auth.uid()`).

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| profiles | propio; co-miembros vía vista `member_profiles` (nombre, avatar) | trigger de Auth | propio (columnas permitidas) | — |
| platform_staff | propio | — | — | — |
| organizations | miembro activo de la organización | RPC plataforma | RPC `org_update` (`org.update`) | — |
| organization_members | miembros de la organización | RPC | RPC | RPC |
| organization_invitations | `org.members.manage` / `staff.manage` (tienda) | RPC | RPC (revocar) | — |
| subscriptions, overrides | `org.billing.read` | — | — | — |
| support_access_grants | grantee (propias); `org_owner` de la organización; plataforma vía función | RPC plataforma | RPC (revocar) | — |
| stores | `P(store.read)` | RPC `org.stores.create` + límite | `P(store.update)` (columnas no estructurales) | — |
| store_members | `P(staff.read)` o propio | RPC | RPC | RPC |
| roles / permissions / role_permissions | `authenticated` | — | — | — |
| store_domains | `P(store.read)` | RPC `domains.manage` | RPC | RPC |
| store_themes, menus, menu_items | `P(store.read)` | `P(appearance.manage)` | `P(appearance.manage)` | `P(appearance.manage)` |
| store_pages | `P(store.read)` | `P(content.manage)` | `P(content.manage)` | soft (UPDATE) |
| brands, categories | `P(products.read)` | `P(categories.manage)`/`P(brands.manage)` | ídem | soft |
| products y sus hijos | `P(products.read)` | RPC `catalog_upsert_product` (`products.create`) | RPC (`products.update`) | RPC soft (`products.delete`) |
| variant_costs | `P(products.cost.read)` | RPC (`products.update` + `cost.read`) | ídem | — |
| media | `P(products.read)` | RPC `media_create_upload` | `P(products.update)` (alt, orden) | RPC soft |
| inventory_locations | `P(inventory.read)` | `P(inventory.locations.manage)` | ídem | — |
| inventory_levels, movements, reservations(+items) | `P(inventory.read)` | RPC | RPC | — |
| customers | `P(customers.read)` (PII enmascarada vía vista si no hay `customers.pii.read`); **C** | RPC | `P(customers.update)`; C (sus columnas de contacto) | RPC anonimizar |
| customer_addresses | `P(customers.read)`; C | C | C | C |
| carts, cart_items | — (solo `storefront.*`) | — | — | — |
| orders, order_items | `P(orders.read)`; **C** (vía `customers.user_id`) | — (solo `storefront.place_order`) | RPC | — |
| order_events | `P(orders.read)`; C (`customer_visible = true`) | RPC | — | — |
| payments, refunds | `P(payments.read)` o `P(orders.read)` (columnas no sensibles vía vista) | RPC/`system` | RPC/`system` | — |
| payment_accounts | `P(payments.manage)` vía vista sin `secret_ref` | RPC | RPC | RPC (desactivar) |
| payment_events | `P(payments.manage)` | `system` | `system` | — |
| shipping_zones, shipping_rates | `P(store.read)` | `P(shipping.manage)` | ídem | ídem |
| shipments, shipment_items | `P(orders.read)`; C | RPC `orders_fulfill` | RPC | — |
| discounts | `P(discounts.read)` | `P(discounts.manage)` | ídem (no puede cambiar `code` si `times_used > 0`) | — (status) |
| discount_redemptions | `P(orders.read)` | `storefront`/`system` | `system` | — |
| import_jobs, rows | `P(imports.run)` | RPC | `system` | — |
| export_jobs | solicitante con `P(exports.run)` | RPC | `system` | — |
| jobs | — | RPC/funciones internas | `system` | — |
| notification_deliveries | `P(notifications.manage)` (enmascarado) | `system` | `system` | — |
| audit.audit_logs | RPC `audit_list(store_id, …)` (`audit.read`) | triggers/funciones | — | — |
| security_events | plataforma vía función | funciones | — | — |
| storage.objects | §25 | §25 | §25 | §25 |

### 12.4 Ejemplo de políticas

**SQL CONCEPTUAL — NO EJECUTAR**
```sql
alter table public.brands enable row level security;
alter table public.brands force row level security;
create policy brands_sel on public.brands for select to authenticated
  using ((select app.has_store_permission(store_id, 'products.read')));
create policy brands_ins on public.brands for insert to authenticated
  with check ((select app.has_store_permission(store_id, 'brands.manage')));
create policy brands_upd on public.brands for update to authenticated
  using ((select app.has_store_permission(store_id, 'brands.manage')))
  with check ((select app.has_store_permission(store_id, 'brands.manage')));
-- Sin política DELETE: el borrado es lógico (UPDATE deleted_at).

create policy orders_customer_sel on public.orders for select to authenticated
  using (exists (select 1 from public.customers c
                  where c.id = orders.customer_id and c.store_id = orders.store_id
                    and c.user_id = (select auth.uid())));
```

### 12.5 Índices que exige RLS
`store_members (user_id, status, store_id)`; `organization_members (user_id, status, organization_id)`; `support_access_grants (grantee_user_id, store_id, expires_at)`; `customers (user_id) WHERE user_id IS NOT NULL`; y toda tabla de tienda con índice cuyo prefijo sea `store_id`.

---

## 13. Composite Key Strategy

**DECISION:** toda tabla de tienda referenciable expone `UNIQUE (store_id, id)`. Toda FK entre tablas de tienda es compuesta e incluye `store_id`. Las referencias opcionales usan `ON DELETE SET NULL (columna)`. **Sin excepciones** (RC-05).

**WHY:** RLS protege a los usuarios; las FK compuestas protegen al **sistema** (funciones, workers, migraciones, bugs). Hacen imposible, a nivel de motor, que una fila de la tienda A referencie una de la tienda B.

**ALTERNATIVES:** (a) solo RLS (no protege a roles que lo omiten); (b) triggers de verificación (más lentos, más código y fáciles de olvidar); (c) FK compuestas (declarativas, verificadas por el motor, imposibles de olvidar en una fila).

**TRADE-OFFS:** un índice único extra por tabla padre (bajo costo); FK más verbosas; las columnas `store_id` se repiten en tablas hijas (ya existían por RLS).

**SECURITY IMPACT:** elimina la clase completa de "asociación cross-tenant" (Ataques 12 y 13).

**PERFORMANCE IMPACT:** las verificaciones de FK usan el índice `(store_id, id)`; costo marginal en escritura; ninguno en lectura.

**IMPLEMENTATION IMPACT:** plantilla de migración obligatoria; meta-test que recorre `pg_constraint` y falla si una FK hacia una tabla con `store_id` no incluye `store_id`.

**TEST REQUIREMENTS:** para cada par padre-hijo, insertar un hijo de la tienda A con un padre de la tienda B **como `postgres` (omitiendo RLS)** → debe fallar con `foreign_key_violation`.

**STATUS:** APPROVED

**SQL CONCEPTUAL — NO EJECUTAR**
```sql
create table public.product_variants (
  id uuid primary key default app.uuid_v7(),
  store_id uuid not null references public.stores(id),
  product_id uuid not null,
  image_id uuid,
  unique (store_id, id),
  foreign key (store_id, product_id) references public.products(store_id, id) on delete cascade,
  foreign key (store_id, image_id) references public.media(store_id, id) on delete set null (image_id)
);
```

Lista de FK compuestas (MVP): `categories.parent_id`, `products.brand_id`, `product_options.product_id`, `product_option_values.option_id`, `product_variants.product_id/image_id`, `variant_option_values.(variant_id, option_value_id)`, `variant_costs.variant_id`, `product_categories.(product_id, category_id)`, `media.product_id`, `inventory_levels.(variant_id, location_id)`, `inventory_movements.level_id`, `inventory_reservations.order_id`, `inventory_reservation_items.(reservation_id, level_id)`, `cart_items.(cart_id, variant_id)`, `carts.customer_id`, `orders.customer_id`, `order_items.(order_id, variant_id, product_id)`, `order_events.order_id`, `payments.(order_id, payment_account_id)`, `refunds.(order_id, payment_id)`, `payment_events.payment_account_id`, `shipments.order_id`, `shipment_items.(shipment_id, order_item_id)`, `discount_redemptions.(discount_id, order_id, customer_id)`, `customer_addresses.customer_id`, `shipping_rates.zone_id`, `menu_items.(menu_id, parent_id)`, `import_job_rows.import_job_id`.

---

## 14. Catalog Architecture

### 14.1 Jerarquía

```
Product (contenido comercial: título, descripción, SEO, medios, categorías, marca, tags)
 ├── Option (≤3)  ── OptionValue
 ├── Variant (unidad vendible; ≥1 siempre)
 │    ├── sku · barcode · price · compare_at_price · (cost → variant_costs)
 │    ├── weight_g · length/width/height_mm · requires_shipping
 │    ├── inventory → inventory_levels (por ubicación)
 │    └── image → media
 ├── Category (N:M; una principal) · Brand (N:1) · Collection (P2, N:M) · tags text[]
 └── Media (imágenes; video P2)
```

**DECISION:** un **producto simple es un producto con exactamente una variante** (`option_signature = ''`). Carrito, inventario y pedidos operan **siempre** sobre variantes.

**WHY:** una sola ruta de código; desaparecen las ramas "si tiene variantes" en checkout, inventario y pedidos.

**ALTERNATIVES:** precio y stock en el producto para los simples (dos modelos que mantener).

**TRADE-OFFS:** la UI debe ocultar la variante en los productos simples.

**SECURITY IMPACT:** ninguno.

**PERFORMANCE IMPACT:** un join adicional en los listados; se compensa con `products.min_price/max_price` denormalizados.

**IMPLEMENTATION IMPACT:** la RPC `catalog_upsert_product` gestiona producto, opciones y variantes de forma transaccional.

**TEST REQUIREMENTS:** el simple y el variable producen la misma estructura de carrito y pedido.

**STATUS:** APPROVED

### 14.2 Tablas

**brands**: PK `id`; UQ `(store_id, id)`; UQ parcial `(store_id, slug) WHERE deleted_at IS NULL`; `name`, `slug`, `logo_media_id?`, `seo_*`, `deleted_at?`.

**categories**: PK `id`; UQ `(store_id, id)`; `parent_id?` FKc RESTRICT; `name`, `slug`, `path text` (slugs unidos por `/`, mantenido por trigger), `depth smallint` CK `≤ 3` (4 niveles: 0..3), `position`, `is_visible`, `description?`, `seo_*`, `image_media_id?`, `deleted_at?`. UQ parcial `(store_id, parent_id, slug) NULLS NOT DISTINCT WHERE deleted_at IS NULL`; UQ parcial `(store_id, path) WHERE deleted_at IS NULL`. Trigger anti-ciclos y recálculo de `path` de los descendientes en `catalog_move_category` [CHANGED: sin `ltree`].

**products**: PK `id`; UQ `(store_id, id)`; `brand_id?` FKc `SET NULL (brand_id)`; `title` CK `1..200`, `slug` CK formato, `description_html?` (sanitizado, ≤ 100 KB), `product_type` CK in (`physical`,`digital`,`service`) — **MVP solo `physical`** (CK adicional en la RPC); `status` CK in (`draft`,`active`,`archived`); `published_at?`; `tags text[]` CK `cardinality ≤ 50`; `specs jsonb` (solo de presentación); `seo_title?`, `seo_description?`; `min_price`, `max_price` (trigger); `sales_count int`; `search_vector tsvector`; `deleted_at?`. UQ parcial `(store_id, slug) WHERE deleted_at IS NULL`. IX `(store_id, status, published_at desc)`, `(store_id, min_price)`, `(store_id, sales_count desc)`, `GIN (store_id, search_vector)`, `GIN (store_id, title gin_trgm_ops)`, `GIN (tags)`.

**product_options**: PK `id`; UQ `(store_id, id)`; FKc producto CASCADE; `name`, `position`; UQ `(product_id, lower(name))`; máximo 3 por producto (trigger).

**product_option_values**: PK `id`; UQ `(store_id, id)`; FKc opción CASCADE; `value`, `position`; UQ `(option_id, lower(value))`.

**product_variants**: PK `id`; UQ `(store_id, id)`; FKc producto; `sku citext?` (trim + upper por trigger), `barcode?`, `price bigint` CK `≥ 0`, `compare_at_price bigint?` CK `compare_at_price > price`, `weight_g int?` CK `≥ 0`, `length_mm?/width_mm?/height_mm?` CK `≥ 0`, `image_id?` FKc `SET NULL`, `status` CK in (`active`,`inactive`), `track_inventory bool default true`, `inventory_policy` CK in (`deny`,`continue`), `requires_shipping bool default true`, `position`, `option_signature text` (trigger: `Color=Negro|Talla=M`, ordenado por posición de opción), `deleted_at?`. UQ parcial `(store_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL`; UQ parcial `(store_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL`; UQ parcial `(product_id, option_signature) WHERE deleted_at IS NULL`. Máximo 100 variantes por producto (entitlement `max_variants_per_product`, default 100). IX `(store_id, product_id)`.

**variant_option_values**: PK `(variant_id, option_value_id)`; FKc ambas CASCADE; `store_id`. Trigger: exactamente un valor por opción del producto.

**variant_costs**: PK `variant_id`; FKc CASCADE; `cost bigint` CK `≥ 0`.

**product_categories**: PK `(product_id, category_id)`; FKc ambas CASCADE; `store_id`; `is_primary`; `position`; UQ parcial `(product_id) WHERE is_primary`.

**media**: PK `id`; UQ `(store_id, id)`; `owner_type` CK in (`product`,`brand`,`category`,`store_branding`,`banner`); `product_id?` FKc CASCADE (CK requerido si `owner_type = 'product'`); `kind` CK in (`image`,`video`) (MVP: `image`); `status` CK in (`pending`,`ready`,`rejected`); `storage_path` UQ; `mime_type`, `bytes`, `width?`, `height?`, `alt_text?`, `position`, `deleted_at?`. UQ `(product_id, position) DEFERRABLE INITIALLY DEFERRED`.

### 14.3 Publicación con validación
`catalog_publish_product(product_id)` → `app.validate_product_for_publish` devuelve una lista de errores y bloquea si hay alguno:
- ≥ 1 variante `active`.
- Precio > 0 (o permiso explícito de precio 0 por producto, P2).
- Slug único.
- Título presente.
- `compare_at_price > price` si existe.
- Imágenes con `alt_text` (**advertencia** en el MVP; no bloquea).
- `product_type = 'physical'` en el MVP.

El stock 0 está permitido (se muestra "Agotado" o "Bajo pedido").

**Punto de extensión [DECISION]:** registro de validadores por tienda (`validators` en código + `app.validate_*` en SQL). El módulo de cumplimiento futuro (§48, Q-B3) agrega validadores sin modificar el núcleo.

### 14.4 Extensiones futuras (sin bloqueo)

| Extensión | Cómo encaja sin rediseño |
|---|---|
| Atributos filtrables | `attributes` + `attribute_values` + `product_attribute_values` (P2); `specs` sigue siendo de presentación |
| Video | `media.kind = 'video'` (ya en el CK) + proveedor de video o subida limitada |
| Digitales | `product_type = 'digital'`, `requires_shipping = false`, `track_inventory` opcional; `digital_assets` en bucket privado; entrega por URL firmada tras el pago (P2) |
| Servicios | `product_type = 'service'`; sin envío ni inventario; agenda FUT |
| Bundles | `bundle_components (bundle_variant_id, component_variant_id, quantity)` con FKc; la reserva expande los componentes (FUT). El inventario por niveles lo soporta sin cambios estructurales |
| Colecciones | `collections` (manual o por reglas) + `collection_products` (P2) |
| SEO por producto | Ya en el MVP (`seo_*` + slug) |

---

## 15. Inventory Architecture

### 15.1 Entidades

**inventory_locations**: PK `id`; UQ `(store_id, id)`; `name`; `is_default`; `is_active`; `address jsonb?`; UQ parcial `(store_id) WHERE is_default`. La Fase 4 crea la ubicación por defecto para las tiendas existentes (backfill) y un trigger `AFTER INSERT ON stores` para las nuevas.

**inventory_levels**: PK `id`; UQ `(store_id, id)`; UQ `(variant_id, location_id)`; FKc → variante CASCADE*, → ubicación RESTRICT; `on_hand int` CK `≥ 0`; `reserved int` CK `≥ 0`; `incoming int` CK `≥ 0`; `available int GENERATED ALWAYS AS (on_hand - reserved) STORED`; `low_stock_threshold int?`. IX `(store_id, location_id)`; IX parcial `(store_id) WHERE low_stock_threshold IS NOT NULL AND available <= low_stock_threshold`.
\* La cascada solo ocurre en la purga controlada (CF-06).

**inventory_movements** (ledger, append-only): PK `id`; `store_id`; FKc `level_id` RESTRICT; `type` CK in (`initial`,`purchase`,`sale`,`return`,`adjustment`,`damage`,`loss`,`transfer_in`,`transfer_out`,`reservation`,`release`); `on_hand_delta int`; `reserved_delta int`; `on_hand_after`; `reserved_after`; `reason?` (obligatorio para `adjustment`, `damage` y `loss`: CK); `reference_type?` CK in (`order`,`refund`,`import`,`manual`,`purchase_order`,`transfer`); `reference_id?`; `actor_type`, `actor_user_id?`; `idempotency_key?`; `created_at`. UQ parcial `(store_id, idempotency_key)`. `REVOKE UPDATE, DELETE` + trigger que lanza excepción. IX `(store_id, level_id, created_at desc)`.

**inventory_reservations** (encabezado) [CHANGED: RC-15]: PK `id`; UQ `(store_id, id)`; FKc `order_id` RESTRICT; UQ parcial `(order_id) WHERE status IN ('active','committed')`; `status` CK in (`active`,`committed`,`released`,`expired`,`fulfilled`); `expires_at`; `committed_at?`, `released_at?`. IX parcial `(expires_at) WHERE status = 'active'`.

**inventory_reservation_items**: PK `id`; FKc `reservation_id` CASCADE; FKc `level_id` RESTRICT; `quantity` CK > 0; `fulfilled_quantity` CK `0..quantity`; `released_quantity` CK; CK `fulfilled + released ≤ quantity`.

### 15.2 Semántica de cantidades

| Campo | Significado |
|---|---|
| `on_hand` | Unidades físicas en la ubicación |
| `reserved` | Unidades comprometidas: reservas `active` (impagas, con TTL) + `committed` (pagadas, no enviadas) |
| `available` | `on_hand − reserved`; puede ser negativo **solo** con `inventory_policy = 'continue'` |
| `incoming` | Unidades en órdenes de compra (P2); informativo, no vendible |

### 15.3 Operación única de mutación

**SQL CONCEPTUAL — NO EJECUTAR**
```sql
-- app.apply_inventory_movement: ÚNICO punto de cambio de inventory_levels
update public.inventory_levels l
   set on_hand  = l.on_hand  + p_on_hand_delta,
       reserved = l.reserved + p_reserved_delta
 where l.id = p_level_id and l.store_id = p_store_id
   and l.on_hand  + p_on_hand_delta  >= 0
   and l.reserved + p_reserved_delta >= 0
   and ( p_policy = 'continue'
         or p_reserved_delta <= 0                      -- liberar siempre es posible
         or (l.on_hand + p_on_hand_delta) - (l.reserved + p_reserved_delta) >= 0 )
returning on_hand, reserved into v_on_hand, v_reserved;
if not found then raise exception using errcode = 'P0001', message = 'insufficient_stock'; end if;
insert into public.inventory_movements(...) values (..., v_on_hand, v_reserved, p_idem_key);
-- Una violación de unicidad en idempotency_key => movimiento ya aplicado => no-op controlado.
```

### 15.4 Flujos

| Evento | Reserva | Movimientos (Δon_hand, Δreserved) | Notas |
|---|---|---|---|
| Ajuste manual, daño o pérdida | — | `adjustment/damage/loss` (±n, 0) | Motivo obligatorio; `inventory.adjust` |
| Recepción (P2 OC) | — | `purchase` (+n, 0); `incoming −n` | |
| **Checkout (`place_order`)** | `active`, `expires_at = now() + TTL` | `reservation` (0, +n) por item | Falla atómica si un item no alcanza |
| **Pago aprobado** | `active → committed` | — | `reserved` se mantiene hasta el envío |
| **Pago fallido** (definitivo) | `active → released` | `release` (0, −n) | Si el proveedor permite reintentar, la reserva sigue activa hasta el TTL |
| **Expiración** (job cada minuto) | `active → expired` | `release` (0, −n) | El pedido pasa a `cancelled(payment_expired)` en la misma transacción |
| **Cancelación antes del envío** | `→ released` | `release` (0, −n) por lo no enviado | Reembolso si estaba pagado |
| **Fulfillment** | items `fulfilled_quantity += q`; todo enviado → `fulfilled` | `sale` (−q, −q) | Requiere `on_hand ≥ q` **aunque** la política sea `continue` (no se envía lo que no existe) |
| **Devolución o reembolso con restock** | — | `return` (+q, 0) | Solo cantidades ya enviadas |
| **Pago tardío sobre pedido expirado** | Nueva reserva `committed` si hay stock | `reservation` (0, +n) | Sin stock → `needs_attention` (CF-04) |

### 15.5 Concurrencia: el último SKU [FACT sobre PostgreSQL]
Dos transacciones ejecutan el `UPDATE` condicional sobre la misma fila de `inventory_levels` con `available = 1`:
1. T1 toma el bloqueo de fila, actualiza (`reserved = 1`) y hace commit.
2. T2 esperaba el bloqueo. En READ COMMITTED, PostgreSQL **re-evalúa el `WHERE` sobre la versión ya confirmada** (EvalPlanQual): `on_hand − (reserved + 1) = −1 < 0` → 0 filas → `insufficient_stock` → su transacción completa (pedido, cupón, contador) **se revierte**.

Resultado: exactamente una compra; stock nunca negativo; sin `SELECT … FOR UPDATE` previo.
**Pedidos multi-línea:** los items se reservan en orden ascendente de `level_id` para evitar deadlocks entre pedidos con los mismos productos en distinto orden.
**No hace falta SERIALIZABLE.**

### 15.6 Multi-almacén (preparado)
MVP: una ubicación `is_default`, invisible en la UI. P2: N ubicaciones; la disponibilidad pública es la suma de `available` de las ubicaciones activas (función `storefront.variant_availability`); asignación de ubicación por reserva (regla: la de mayor prioridad con stock suficiente; división de pedidos P2+); transferencias = `transfer_out` + `transfer_in` en una transacción.

---

## 16. Order Architecture

### 16.1 Tabla `orders` (snapshot)
PK `id`; UQ `(store_id, id)`; UQ `(store_id, number)`; UQ `(store_id, checkout_idempotency_key)`.

| Grupo | Columnas |
|---|---|
| Identidad | `number bigint`, `display_number text` (prefijo + número), `guest_access_token_hash bytea`, `source` CK in (`storefront`,`admin`,`api`) |
| Cliente (snapshot) | `customer_id?` FKc `SET NULL (customer_id)`, `email citext`, `phone?`, `customer_name` |
| Direcciones (snapshot) [CHANGED: SIMPLIFY] | `shipping_address jsonb?` (CK requerido si algún item `requires_shipping`), `billing_address jsonb?` |
| Moneda e impuestos (snapshot) | `currency`, `prices_include_tax`, `tax_rate_bps`, `tax_applies_to_shipping` |
| Envío (snapshot) | `shipping_rate_id?` (referencia informativa, FKc `SET NULL`), `shipping_snapshot jsonb` (nombre, tipo, precio, días) |
| Descuento (snapshot) | `discount_snapshot jsonb?` (código, tipo, valor, monto aplicado) |
| Totales (bigint) | `subtotal`, `discount_total`, `shipping_total`, `tax_total`, `total`, `paid_total`, `refunded_total` |
| Estados | `status`, `payment_status`, `fulfillment_status`, `needs_attention bool`, `cancel_reason?` CK in (`customer`,`staff`,`payment_expired`,`payment_failed`,`fraud`,`out_of_stock`,`other`) |
| Tiempos | `placed_at`, `paid_at?`, `cancelled_at?`, `completed_at?` |
| Notas | `customer_note?` (≤ 1000), `staff_note?` |
| Versión | `snapshot_version smallint` (contrato §43) |

**CHECK de totales:**
- Si `prices_include_tax`: `total = subtotal − discount_total + shipping_total` (`tax_total` es informativo, incluido en los precios).
- Si no: `total = subtotal − discount_total + shipping_total + tax_total`.
- Además: `0 ≤ refunded_total ≤ paid_total ≤ total` y todos los importes `≥ 0`.

**Inmutables tras la creación (trigger):** todas las columnas de snapshot y totales excepto `paid_total`, `refunded_total`, estados, `needs_attention`, `staff_note` y tiempos de estado.

### 16.2 `order_items` (inmutable)
PK `id`; FKc `order_id` RESTRICT; `variant_id?`/`product_id?` FKc `SET NULL (col)` (RC-05); snapshot: `product_title`, `variant_title`, `sku?`, `option_values jsonb`, `image_path?`, `product_type`, `requires_shipping`, `weight_g?`, `unit_price`, `compare_at_price?`, `quantity` CK > 0, `discount_allocation` CK ≥ 0, `tax_amount`, `line_total`; contadores mutables: `fulfilled_quantity`, `refunded_quantity`, `returned_quantity` con CK `≤ quantity`. Trigger: el resto es inmutable.

### 16.3 `order_events` (historial append-only)
PK `id`; FKc `order_id`; `type`; `axis?` CK in (`status`,`payment`,`fulfillment`); `from_value?`, `to_value?`; `message?`; `customer_visible bool`; `actor_type` CK in (`customer`,`staff`,`system`,`provider`,`platform_support`); `actor_user_id?`; `metadata jsonb`; `created_at`. Sin UPDATE ni DELETE.

### 16.4 Estados y transiciones (normativo)

**order_status**

| Desde → Hacia | Actor | Condición |
|---|---|---|
| (nuevo) → `pending_payment` | sistema (`place_order`) | — |
| `pending_payment` → `open` | sistema | Pago `succeeded` (o confirmación manual) |
| `pending_payment` → `cancelled` | sistema / staff / comprador | Expiración, fallo definitivo, cancelación |
| `open` → `completed` | sistema | `fulfillment_status = fulfilled` y todos los envíos `delivered`, o 30 días tras `fulfilled` [DECISION] |
| `open` → `cancelled` | staff (`orders.cancel`) | Sin unidades enviadas; exige reembolso si `paid_total > 0` |
| `cancelled(payment_expired)` → `open` | **solo sistema** | Pago tardío `succeeded` válido (CF-04) |
| `completed` → (ninguna) | — | Terminal (las devoluciones y reembolsos solo afectan a los otros ejes) |

**payment_status**: `unpaid → pending → (authorized) → paid → partially_refunded → refunded`; `pending → failed | expired`; `authorized → voided`; `failed → pending` (reintento dentro del TTL). Monótono: nunca vuelve de `paid` a `pending`.

**fulfillment_status**: `unfulfilled → partially_fulfilled → fulfilled → partially_returned → returned`; requiere `payment_status ∈ {paid, partially_refunded}` para salir de `unfulfilled` (MVP: no se envía sin pago).

Aplicación: función `app.assert_order_transition(axis, from, to, actor)` con la tabla anterior en código SQL. Trigger `orders_state_guard` como red de seguridad. Cada transición inserta en `order_events`.

**Estado visible** (función pura, probada): `Pendiente de pago`, `Pagado — por preparar`, `Enviado parcialmente`, `Enviado`, `Entregado`, `Completado`, `Cancelado`, `Reembolsado`, `Reembolsado parcialmente`, `Requiere atención`.

### 16.5 Identificadores del pedido
- `id` (UUIDv7): interno y para la URL del panel.
- `number`: secuencial por tienda desde `stores.order_number_start` (default 1001) mediante el contador. **[FACT]** revela el volumen de ventas de esa tienda: práctica aceptada en la industria; mitigación opcional: número inicial configurable.
- Acceso del invitado: `/pedido/{id}?t={token}` (token de 32 bytes; en la base solo su hash) o número + email + OTP.

### 16.6 Idempotencia
- Creación: `checkout_idempotency_key` (generada al renderizar el checkout).
- Transiciones: cada RPC de staff recibe `idempotency_key`; los eventos de pago se deduplican por `provider_event_id`; los cambios de estado son monótonos.

---

## 17. Checkout Architecture

### 17.1 Entidades
- **cart**: `carts(id, store_id, token_hash UQ, customer_id?, email?, shipping_address jsonb?, shipping_rate_id?, discount_code?, status ∈ {active, converted, abandoned}, last_activity_at, expires_at = +30 días)`.
- **cart_item**: `cart_items(id, store_id, cart_id, variant_id, quantity 1..999)`, UQ `(cart_id, variant_id)`. **Sin precio almacenado.**
- **checkout**: **no es una tabla** [DECISION, confirmada]. Es el estado del carrito (email, dirección y tarifa elegidos) más la operación atómica `place_order`. **Por qué:** una tabla `checkouts` duplicaría el estado del carrito y crearía dos fuentes de verdad; la idempotencia se resuelve con `checkout_idempotency_key` en `orders`.
- **order**: §16. **inventory reservation**: §15. **payment** (intento): §18.

### 17.2 Autoridad
**El frontend nunca es autoridad** sobre precio, stock, impuestos, descuentos ni total. El navegador envía únicamente: `cart_token` (cookie httpOnly), `variant_id` + `quantity`, email, dirección, `shipping_rate_id`, código de descuento, `expected_total` (solo para detectar cambios) e `idempotency_key`.

### 17.3 Cálculo único
`app.calculate_cart(store_id, cart_id, shipping_rate_id?, discount_code?) → jsonb` (función pura sobre los datos de la base), usada por la vista previa del carrito, el checkout y `place_order`:
1. Líneas: precio vigente de cada variante activa de un producto `active`; las líneas no vendibles se marcan `unavailable`.
2. Subtotal = Σ precio × cantidad.
3. Descuento: validez (estado, vigencia, mínimo, usos, por cliente) → monto; prorrateo por línea con el método del **residuo mayor** (suma exacta).
4. Envío: tarifa de la tienda, activa, cuya zona incluye el país y la región de la dirección y cuyo rango de peso cubre el total; `free_over` se evalúa sobre el subtotal ya descontado.
5. Impuesto: incluido → `round_half_even(base × r / (10000 + r))`; no incluido → `round_half_even(base × r / 10000)`; por línea y luego sumado.
6. Total.

### 17.4 `storefront.place_order` (transacción única)

**SQL CONCEPTUAL — NO EJECUTAR** (pseudocódigo de orden de operaciones)
```
storefront.place_order(p_store_id, p_cart_token, p_input jsonb, p_expected_total, p_idem_key)
  0. if exists order(store_id, checkout_idempotency_key = p_idem_key) → return it   -- idempotencia
  1. cart := select ... from carts where store_id = p_store_id and token_hash = sha256(p_cart_token)
             and status = 'active' FOR UPDATE                                        -- serializa por carrito
  2. assert store.status = 'active' and org access_mode <> 'suspended'
  3. validar p_input (email, dirección, tarifa) con validadores SQL
  4. totals := app.calculate_cart(...)
     if any line unavailable → raise 'cart_invalid'(detalle)
     if totals.total <> p_expected_total → raise 'price_changed'(totals)            -- sin efectos
  5. if discount: select ... from discounts where store_id = ... and code = ... FOR UPDATE;
     re-validar; insert discount_redemptions(status='reserved'); times_reserved++
  6. number := update store_counters set value = value + 1 ... returning value
  7. customer := upsert customers(store_id, email)
  8. insert orders(status='pending_payment', payment_status='unpaid', snapshot..., totals...)
  9. insert order_items(snapshot)
 10. insert inventory_reservations(active, expires_at = now() + store.reservation_ttl)
     for item in items order by level_id: app.apply_inventory_movement(reservation, 0, +q)
        → 'insufficient_stock' aborta TODO (rollback total)
 11. account := payment_account activa de la tienda para el método elegido (FKc)
     insert payments(status='created', amount=total, idempotency_key=gen)
 12. update carts set status='converted'
 13. insert order_events('order.created'); enqueue jobs('order.created')
 14. return {order_id, payment_id, guest_token}
COMMIT
```

### 17.5 Después del commit (fuera de la transacción)
15. Server Action → `PaymentProvider.createCheckout({ idempotencyKey: payment.id, expiresAt: reservation.expires_at − 2 min })` → URL de redirección.
16. Si el proveedor falla: `system.mark_payment_failed(payment_id, error)`; el pedido **sigue** `pending_payment` con su reserva; la UI ofrece "Reintentar pago" (nuevo intento de pago sobre el mismo pedido mientras la reserva esté vigente).
17. **Ninguna transacción de base de datos abarca una llamada de red** [DECISION].

### 17.6 Errores y rollback

| Error | Momento | Efecto |
|---|---|---|
| `price_changed` | Paso 4 | Sin efectos; la UI muestra el nuevo total y pide confirmar |
| `cart_invalid` | Paso 4 | Sin efectos; la UI marca las líneas |
| `discount_invalid` / `discount_exhausted` | Paso 5 | Sin efectos |
| `insufficient_stock` | Paso 10 | Rollback total (incluido el contador y el cupón); la UI indica qué falta |
| `no_payment_method` | Paso 11 | Rollback total (la validación de lanzamiento lo previene) |
| Fallo del proveedor | Paso 15 | Pedido pendiente; reintento disponible |
| Doble clic / reenvío | Paso 0 | Devuelve el mismo pedido |
| Abandono en el proveedor | — | Expira por TTL → liberación |

### 17.7 Rate limits (checkout)
Por IP y tienda: 10 `place_order` cada 10 minutos. Por carrito: 5 intentos de pago por pedido. Por email: 20 pedidos al día por tienda. Turnstile activado cuando la tasa de fallos de la tienda supera un umbral (P2: siempre configurable).

---

## 18. Payment Architecture

### 18.1 Separación de flujos de dinero [DECISION, RC-20]

| | **Store payment processing** | **Platform billing** |
|---|---|---|
| Quién paga a quién | Comprador → Tienda | Organización (tenant) → Plataforma |
| Módulo | `payments` | `billing` |
| Tablas | `payment_accounts`, `payments`, `payment_events`, `refunds` | `subscriptions`, (P2) `billing_customers`, `billing_invoices`, `billing_events` |
| Credenciales | Cuenta del proveedor **de la tienda** (Vault, por tienda) | Cuenta **de la plataforma** (variable de entorno del servidor) |
| Webhooks | `/api/webhooks/payments/{provider}/{payment_account_id}` | `/api/webhooks/billing/{provider}` |
| Interfaz | `PaymentProvider` | `BillingProvider` (P2) |
| Nunca | Usa credenciales de la plataforma | Toca dinero de compradores |

### 18.2 Interfaz `PaymentProvider` (contrato §43)

```ts
// CONTRATO CONCEPTUAL — NO IMPLEMENTAR
interface PaymentProvider {
  readonly key: 'mercadopago' | 'stripe' | 'manual' | 'fake'
  readonly capabilities: {
    redirectCheckout: boolean; embeddedCheckout: boolean; delayedMethods: boolean
    refunds: boolean; partialRefunds: boolean; providerSideExpiration: boolean
  }
  validateCredentials(account: PaymentAccountCredentials): Promise<CredentialCheck>
  createCheckout(input: {
    account: PaymentAccountCredentials; payment: { id: string; amount: Money; currency: string }
    order: { id: string; displayNumber: string; items: CheckoutLine[] }
    buyer: { email: string; name?: string }
    returnUrls: { success: string; pending: string; failure: string }
    expiresAt: Date; idempotencyKey: string
  }): Promise<{ providerCheckoutId: string; redirectUrl?: string; clientToken?: string }>
  verifyWebhook(input: { account: PaymentAccountCredentials; headers: Headers; rawBody: string; now: Date })
    : Promise<{ ok: true; eventId: string; type: string; providerPaymentId?: string; signedAt: Date }
             | { ok: false; reason: 'bad_signature' | 'stale' | 'malformed' }>
  fetchPayment(input: { account: PaymentAccountCredentials; providerPaymentId: string }): Promise<NormalizedPayment>
  refund(input: { account: PaymentAccountCredentials; providerPaymentId: string; amount: Money; idempotencyKey: string })
    : Promise<NormalizedRefund>
}
type NormalizedPayment = {
  providerPaymentId: string; status: 'pending'|'authorized'|'succeeded'|'failed'|'cancelled'|'expired'|'refunded'|'partially_refunded'
  amount: Money; currency: string; externalReference: string /* = payments.id */; method?: string; failureCode?: string
}
```

### 18.3 Vocabulario (mapeado a entidades)

| Concepto | Entidad |
|---|---|
| **Payment intent** (lo que se debe) | Implícito: `orders.total − orders.paid_total` |
| **Payment attempt** | `payments` (una fila por intento; varios por pedido; como máximo uno `succeeded`) |
| **Transaction** (hecho reportado por el proveedor) | `payment_events` (crudo, verificado) + estado normalizado en `payments` |
| **Refund** | `refunds` |
| **Webhook** | `payment_events` |

**payments**: PK `id`; UQ `(store_id, id)`; FKc `order_id`, `payment_account_id`; `provider`; `provider_checkout_id?`; `provider_payment_id?` UQ parcial `(provider, provider_payment_id)`; `amount`, `currency`; `status` CK in (`created`,`pending`,`authorized`,`succeeded`,`failed`,`cancelled`,`expired`); `method?`; `failure_code?`; `idempotency_key` UQ; `last_synced_at?`. UQ parcial `(order_id) WHERE status = 'succeeded'` (un solo pago exitoso por pedido en el MVP).

**payment_events**: PK `id`; `store_id`; FKc `payment_account_id`; `provider_event_id`; `type`; `signed_at`; `received_at`; `payload jsonb` (sanitizado: sin datos de tarjeta); `processed_at?`; `processing_error?`; `attempts`. UQ `(payment_account_id, provider_event_id)`.

**payment_accounts**: PK `id`; UQ `(store_id, id)`; `provider`; `mode` CK in (`test`,`live`); `status` CK in (`pending`,`active`,`disabled`,`error`); `public_config jsonb`; `secret_ref uuid` (Vault); `webhook_secret_ref uuid?`; `enabled_methods text[]`; UQ parcial `(store_id, provider) WHERE status = 'active'`.

**refunds**: PK `id`; UQ `(store_id, id)`; FKc `order_id`, `payment_id`; `amount` CK > 0; `items jsonb` (variante, cantidad y restock); `reason?`; `status` CK in (`pending`,`succeeded`,`failed`); `provider_refund_id?`; `idempotency_key` UQ `(store_id, idempotency_key)`; `requested_by`.

### 18.4 Webhook (orden normativo)
1. Resolver `payment_account_id` de la URL → `system.get_payment_account_for_webhook(id)` (sin secreto en la respuesta salvo para la verificación interna). Cuenta inexistente o deshabilitada → **404 genérico** + `security_event`.
2. `verifyWebhook` con el secreto de **esa** cuenta; marca de tiempo firmada dentro de **±5 minutos** (CF-14); firma inválida → **401** + `security_event` + métrica.
3. `system.record_payment_event(...)` → `INSERT … ON CONFLICT DO NOTHING`; si ya existía y fue procesado → **200** (idempotente).
4. `fetchPayment` (re-consulta a la API del proveedor: **fuente de verdad**).
5. Validar `externalReference = payments.id`; `payments.payment_account_id = account`; `amount = payments.amount`; `currency = payments.currency`. Discrepancia → `needs_attention` + `security_event`; **no** se marca pagado.
6. `system.apply_payment_status(payment_id, normalized)`: transacción con `SELECT … FOR UPDATE` del pedido; transición monótona; si `succeeded`: reserva → `committed` (o re-reserva si había expirado, CF-04), redención de cupón → `confirmed`, `paid_total`, contadores del cliente, `order_events` y jobs (`payment.confirmed`).
7. Responder 200 en < 5 s. El resto (emails) va por jobs.

### 18.5 Reconciliación
Job cada 10 minutos: `payments` en `pending`/`created` con más de 15 minutos y pedido `pending_payment` → `fetchPayment` → `apply_payment_status`. Job diario: compara los pagos `succeeded` del día con el proveedor (P2: reporte de conciliación).

### 18.6 Reembolsos y cancelaciones
- `orders_request_refund(order_id, amount, items[], restock, reason, idempotency_key)`: `orders.refund`; bloquea el pedido; valida `amount ≤ paid_total − refunded_total` y cantidades ≤ enviadas o pagadas; crea `refunds(pending)` → job `refund.execute` → `PaymentProvider.refund(idempotencyKey = refund.id)` → `system.apply_refund_result` → `refunded_total`, `payment_status`, movimientos `return` si hay restock, eventos y email.
- Cancelación con pago: `orders_cancel` = cancelación + reembolso total en una solicitud; el pedido queda `cancelled` y `refunded` cuando el reembolso se confirma (hasta entonces, `payment_status = paid` con un reembolso `pending` visible).

### 18.7 Fraude (MVP)
Antifraude del proveedor; rate limits (§17.7); límite de intentos por pedido; monto atípico (> p99 de la tienda) → `needs_attention` (P2); contracargos registrados como eventos con alerta.

### 18.8 Proveedores
[OPEN QUESTION Q-B1: modelo de merchant of record]. Default: **cuentas propiedad de la tienda**. Primer adaptador: `mercadopago` (Checkout Pro, redirección; menor alcance PCI) + `manual` + `fake` (pruebas). Stripe en P2.
[UNKNOWN: los detalles exactos de firma y expiración de cada proveedor se verifican contra su documentación vigente en la Fase 7 — Spike S-4.]

---

## 19. SaaS Billing Architecture

### 19.1 Entidades
- **Plan**: `plans`.
- **Plan Feature / Entitlement**: `plan_entitlements(plan_id, key, value)`. Las claves se registran en código (`billing/entitlements.ts`) y se validan por CK contra el registro sincronizado.
- **Subscription**: `subscriptions` (una vigente por organización).
- **Override**: `organization_entitlement_overrides`.
- **Usage**: **calculado en vivo** [CHANGED: REMOVE `usage_counters`]: productos (`count` con índice), staff, tiendas, ubicaciones, dominios; almacenamiento = `sum(media.bytes)` de las tiendas de la organización.
- **Limit**: valor efectivo = override vigente ▷ entitlement del plan ▷ default de la plataforma.

### 19.2 Registro de claves (MVP)

| Clave | Tipo | Aplicación |
|---|---|---|
| `max_stores` | int | Trigger en `stores` |
| `max_products` | int (por organización) | Trigger en `products` (INSERT y restauración desde la papelera) |
| `max_variants_per_product` | int | Trigger en `product_variants` |
| `max_staff` | int (miembros activos distintos por organización) | Aceptación de invitación |
| `max_locations` | int | Trigger en `inventory_locations` |
| `max_custom_domains` | int | RPC de dominios (P2) |
| `storage_mb` | int | `media_create_upload` (pre-verificación) |
| `advanced_analytics`, `abandoned_cart`, `custom_roles`, `api_access`, `remove_platform_branding`, `custom_domains` | bool | Guards de servicio + flags |
| `max_orders_per_month` | — | **No se define** [RECOMMENDATION: limitar pedidos castiga el éxito del cliente; si se decide, solo como aviso] |

### 19.3 Verificación de límites

**SQL CONCEPTUAL — NO EJECUTAR**
```sql
create function app.assert_within_limit(p_org uuid, p_key text, p_increment int default 1)
returns void language plpgsql security definer set search_path = '' as $$
declare v_limit int; v_used int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || p_key, 0));  -- serializa por org+clave
  v_limit := app.effective_limit(p_org, p_key);
  if v_limit is null then return; end if;                                    -- ilimitado
  v_used := app.current_usage(p_org, p_key);
  if v_used + p_increment > v_limit then
    raise exception using errcode = 'P0001', message = 'limit_reached',
      detail = json_build_object('key', p_key, 'limit', v_limit, 'used', v_used)::text;
  end if;
end $$;
```
Llamada desde triggers `BEFORE INSERT` (y desde la restauración del soft delete). **El frontend solo muestra el uso; la base de datos decide.**

### 19.4 Access mode de la organización [RC-17]

| Estado | Panel | Storefront | Aplicación |
|---|---|---|---|
| `trialing`, `active` | completo | activo | `full` |
| `past_due` (dentro de la gracia, default 7 días) | completo + banner | activo | `full` |
| `past_due` (gracia vencida) → `paused` | **solo lectura** (permisos `write` denegados en la base de datos) | activo (los compradores siguen comprando; el fulfillment se permite como excepción [DECISION: `orders.fulfill`, `orders.refund` y `orders.cancel` se marcan `kind = 'operational'` y siguen permitidos para no dañar a los compradores]) | `read_only` |
| `paused` > N días (default 30) o `organizations.status = 'suspended'` | sin acceso (solo el owner ve la página de facturación) | mantenimiento (503) | `suspended` |
| `cancelled` | export disponible 90 días | cerrado | `suspended` |

Por eso `permissions.kind ∈ {read, write, operational}`. En `read_only` se deniega solo `write`.

### 19.5 Cobro
MVP: manual (el Platform Owner gestiona estado y fechas en `/platform`). P2: `BillingProvider` (Stripe Billing o Mercado Pago Suscripciones) sincroniza `subscriptions` vía webhooks propios (§18.1). El resto del sistema solo lee el access mode y los entitlements.

---

## 20. White-Label Architecture

### 20.1 Capas y propiedad

| Capa | Dueño | Editable por la tienda | Ejemplos |
|---|---|---|---|
| **Platform defaults** | Plataforma (`platform_settings.branding_defaults` + código) | No | Tipografía base, paleta neutra, favicon genérico, textos legales de la plataforma |
| **Theme** | Plataforma (código versionado `themes/{key}`) | No (estructura) | Layout, plantillas de producto, catálogo, carrito y checkout; accesibilidad; SEO; secciones disponibles y sus esquemas |
| **Store configuration** | Tienda (`store_themes`, `menus`, `store_pages`, `stores`) | Sí | Tokens, secciones de la home, menús, páginas, contacto, redes, SEO global |

### 20.2 Configurable por la tienda (MVP)

| Elemento | Detalle | Fallback si no se configura |
|---|---|---|
| Logo (claro y oscuro) | `media(owner_type = store_branding)`; PNG/WebP/AVIF; máximo 2 MB | Nombre de la tienda como wordmark tipográfico |
| Favicon | Generado desde una imagen cuadrada (32/180/192/512) | Monograma generado dinámicamente (inicial + color primario) |
| Colores | `primary`, `accent`, `background`, `foreground`, `muted`; los derivados se calculan | Paleta del tema |
| Validación de color | Contraste ≥ 4.5:1 texto/fondo y ≥ 3:1 en botones → **bloquea publicar** | — |
| Tipografía | 1 para títulos + 1 para cuerpo, de una lista curada (≤ 10, autoalojadas) | Tipografía del tema |
| Botones | `radius ∈ {none, sm, md, full}`, `style ∈ {solid, outline}` | Del tema |
| Header | Posición del logo, barra de anuncio (texto ≤ 120, enlace, colores validados), menú `main` | Sin barra; menú autogenerado con las categorías raíz visibles |
| Footer | Menú `footer`, texto legal, redes, medios de pago | Enlaces a las políticas publicadas |
| Home / secciones | Lista ordenada (≤ 12) de: `hero`, `featured_products`, `category_grid`, `promo_banner`, `image_with_text`, `brand_logos`, `testimonials`, `rich_text` | Plantilla del tema: hero con el nombre de la tienda + productos recientes + categorías |
| Banners | Son props de secciones (`hero`, `promo_banner`), no una entidad | — |
| Menús | `main`, `footer` (2 niveles) | Autogenerados |
| Redes | Lista de `{network, url}` (`https`, dominios conocidos) | Ocultas |
| SEO global | Título, descripción, imagen social | Nombre de la tienda + descripción genérica + logo |
| Contacto | Email (obligatorio para lanzar), teléfono, WhatsApp, dirección, horario | Solo email |

**Estructural (no configurable):** orden y estructura de checkout y carrito, marcado semántico, JSON-LD, comportamiento responsive, foco y teclado, *loading/empty/error states*, CSP. **Sin CSS ni JS personalizados** en el MVP.

### 20.3 Mecánica
- Resolución de valores: `store_config ?? theme_default ?? platform_default` en una función pura `resolveTheme(store, theme, platform)` → tokens → variables CSS en `<html>`.
- Validación: esquema Zod por versión de tema en el servidor (forma, rangos, URLs, contraste) + verificación estructural en la función de publicación.
- **Borrador → Publicar:** edición en `draft_*`; vista previa con token (CF-09); `storefront_publish_theme` copia a los campos vigentes, audita e invalida la caché de la tienda.
- Versionado: `theme_version`; migradores de settings entre versiones (funciones puras con tests).

---

## 21. Storefront Architecture

### 21.1 Resolución `hostname → store`

```
request → proxy/middleware:
  1. host := normalize(request.headers.host)          // minúsculas, sin puerto, sin punto final
     (x-forwarded-host NO se usa; en Vercel, Host es el dominio enrutado)
  2. si host ∈ {app., platform marketing} → rutas de panel/marketing
  3. resolved := cache.get(host) ?? storefront.resolve_host(host)   // gateway; TTL 60 s
     → { store_id, status, primary_hostname, is_primary }
  4. no existe → 404 genérico "Tienda no disponible" (idéntico para inexistente y cerrada)
  5. status ∈ {paused, suspended} o access_mode = suspended → 503 + Retry-After
  6. status = draft → requiere cookie __preview válida (HMAC, store_id coincide, no expirada); si no, 404
  7. si host no es primario y existe un primario activo → 301 al primario (misma ruta)
  8. rewrite interno → /_store/{store_id}/{ruta}
  9. bloquear cualquier request externo cuya ruta empiece por /_store (404)
```

**Garantías:**
- El `store_id` **solo** sale de la tabla `store_domains` (hostname único global).
- Ningún parámetro, cookie ni header del cliente puede elegir otra tienda.
- Las cookies del comprador son host-only: el navegador nunca envía las cookies de la tienda A a la tienda B.
- Toda lectura de comprador filtra por el `store_id` resuelto **y** el JWT.
- La clave de caché incluye el `store_id` por estar en la ruta.

### 21.2 Rutas
Iguales a v0.1 §15.2 (español, fijas en el MVP): `/`, `/productos`, `/productos/[slug]`, `/categoria/[...path]`, `/marca/[slug]`, `/buscar`, `/carrito`, `/checkout`, `/checkout/resultado`, `/pedido/[id]`, `/cuenta/ingresar`, `/cuenta`, `/cuenta/pedidos`, `/cuenta/pedidos/[number]`, `/cuenta/direcciones`, `/paginas/[slug]`, `/sitemap.xml`, `/robots.txt`, `/_preview` (canje del token). `/coleccion/[slug]` y `/cuenta/favoritos`: P2.

### 21.3 Lectura de datos
Todas las lecturas públicas usan funciones `storefront.*` (`get_store_public`, `get_home`, `list_products`, `get_product`, `get_category`, `search_products`, `get_menus`, `get_page`, `variant_availability`). La disponibilidad se expone como un estado (`in_stock`, `low_stock`, `backorder`, `out_of_stock`), **nunca como cantidades exactas** [DECISION: no revelar inventario a competidores].

### 21.4 Renderizado y caché
- RSC. Páginas de catálogo cacheadas por tags: `store:{id}`, `product:{id}`, `category:{id}`, `theme:{id}`.
- Las mutaciones del panel invalidan los tags correspondientes.
- Carrito, checkout, cuenta y pedido: dinámicos y sin caché.
- Islas cliente solo para: selector de variantes, drawer del carrito, formularios, galería y sugerencias de búsqueda.

### 21.5 Cuenta del comprador
OTP por email. Tras verificar, `storefront_link_customer`. Las lecturas de pedidos y direcciones van con el JWT del comprador (RLS) más el filtro de `store_id` resuelto.

---

## 22. Domain Architecture

Fuera del MVP como funcionalidad (los dominios propios son P2), pero **el contrato es definitivo** desde ahora.

| Concepto | Contrato |
|---|---|
| **Subdominio** | `{handle}.{STOREFRONT_ROOT_DOMAIN}`. Se crea en la misma transacción que la tienda (`store_domains`, `type = platform_subdomain`, `status = active`, `is_primary = true`). Handle con formato validado + lista reservada. Wildcard DNS y certificado wildcard gestionados por el hosting. |
| **Dominio raíz de storefronts** | **Distinto del dominio del panel** [DECISION, Q-B4]: aísla cookies y orígenes y contiene un posible XSS de una tienda. Alternativa aceptable: mismo dominio raíz + entrada en la Public Suffix List (proceso externo, lento). |
| **Dominio propio (P2)** | `store_domains(type = custom, status = pending)` → `DomainProvider.add(hostname)` → instrucciones DNS (CNAME para `www`, A/ALIAS para el apex) + TXT de verificación de propiedad `_platform-verify.{hostname}` = token → job de verificación (cada 5 min durante 72 h, luego diario 14 días) → `active` cuando DNS y certificado están listos → `failed` si vence. |
| **Verificación** | Siempre TXT de propiedad **antes** de activar, aunque el hosting no lo exija (previene secuestro de dominio, T-22). |
| **SSL** | Emitido y renovado por el hosting (Vercel) [ASSUMPTION Q-B5: hosting en Vercel]. |
| **Canonical** | `canonicalUrl(store, path) = https://{primary_hostname}{path}`. Un solo primario activo por tienda (UQ parcial). Sitemap, OG, JSON-LD y emails usan el primario. |
| **Redirect** | Todo host activo no primario de la tienda → **301** al primario conservando ruta y query. `www` ↔ apex: el comerciante elige cuál es el primario y el otro redirige. |
| **Eliminación** | `removed` + `DomainProvider.remove`; el subdominio vuelve a ser el primario. |
| **Límites** | `max_custom_domains` por plan. |
| **Auth** | Los compradores usan OTP sin redirección: no hace falta registrar cada dominio en las *redirect URLs* de Supabase. |
| **Abstracción** | `DomainProvider` se define como interfaz en P2, cuando exista la funcionalidad [CHANGED: DEFER, §46]. |

---

## 23. Search Architecture

**DECISION:** búsqueda del MVP en PostgreSQL: FTS `spanish` + `unaccent` + trigram, con índices compuestos por tienda (`btree_gin`).

**WHY:** cero infraestructura nueva; suficiente para catálogos de hasta decenas de miles de SKUs por tienda; el aislamiento es nativo (misma consulta, mismo `store_id`).

**ALTERNATIVES:** Meilisearch, Typesense o Algolia (mejor ranking y tolerancia a errores, pero otro servicio, sincronización y aislamiento por índice o filtro).

**TRADE-OFFS:** ranking básico; tolerancia a errores limitada; facetas con conteo costosas a gran escala.

**SECURITY IMPACT:** la función exige `store_id`; no hay índice compartido externo que filtrar.

**PERFORMANCE IMPACT:** los índices GIN compuestos `(store_id, …)` acotan la búsqueda a la tienda.

**IMPLEMENTATION IMPACT:** trigger que mantiene `search_vector` (también cuando cambian marca, SKUs, tags o categorías). Escrituras del catálogo algo más lentas.

**TEST REQUIREMENTS:** relevancia (casos dorados), acentos ("cafe" encuentra "café"), SKU exacto primero, aislamiento (la búsqueda en A nunca devuelve productos de B).

**STATUS:** APPROVED

| Aspecto | MVP | Futuro |
|---|---|---|
| Búsqueda | `websearch_to_tsquery('spanish', unaccent(q))` sobre `search_vector` ponderado (A título; B marca, tags y SKU; C categoría; D descripción); si hay < 3 resultados, trigram `similarity(title, q) > 0.3`; coincidencia exacta de SKU o barcode con prioridad | Motor dedicado |
| Filtros | Categoría (incluye descendientes por `path LIKE`), marca, rango de precio (`min_price`), disponibilidad | Atributos |
| Orden | Relevancia, precio ↑↓, novedades, más vendidos | Personalizado |
| Facetas | Sin conteos (listas de categorías y marcas de la tienda) | Conteos (consultas agregadas o motor) |
| Tolerancia a errores | Trigram | Motor (distancia de edición) |
| Paginación | Cursor sobre `(sort_key, id)`; máximo 48 por página | — |
| Indexación | Síncrona por trigger | Asíncrona vía jobs `search.reindex` hacia el motor |
| Aislamiento | `store_id` obligatorio en la firma | Índice por tienda o filtro obligatorio inyectado en el servidor |
| Abstracción | Ninguna en el MVP: `catalog.search()` es la única entrada [CHANGED: DEFER `SearchProvider`] | Se introduce con el segundo motor |
| Logs | Sin almacenar consultas en el MVP | P2: `search` event (sin PII) |

---

## 24. SEO Architecture

| Elemento | Especificación |
|---|---|
| **URLs** | Español, estables, legibles: `/productos/{slug}`, `/categoria/{ruta}`, `/marca/{slug}`, `/paginas/{slug}` |
| **Slugs** | Generados del título (minúsculas, sin acentos, `-`), editables, únicos por tienda; al cambiar el slug de una entidad publicada → `store_redirects(from_path, to_path)` 301 (**P2**; MVP: advertencia y el cambio se permite solo si la entidad no está publicada) |
| **Metadata** | `generateMetadata` por página: `title = "{entidad} · {tienda}"` (≤ 60 caracteres recomendados), `description` (SEO personalizada ▷ extracto ▷ default), `robots` |
| **Canonical** | Absoluto al dominio primario; los filtros y el orden (`?orden=`, `?precio=`) canonicalizan a la URL limpia; la paginación canonicaliza a sí misma |
| **Open Graph** | `og:title`, `og:description`, `og:image` (imagen principal 1200×630 vía `opengraph-image` o derivado), `og:type = product/website`, `og:url` canónica, `og:site_name` |
| **Twitter/X** | `summary_large_image` con los mismos datos |
| **Structured data** | Home: `Organization` (o `OnlineStore`) + `WebSite` con `SearchAction`. Producto: `Product` (name, image[], description, sku, gtin si hay barcode válido, brand, `offers`: price, priceCurrency, availability, url, itemCondition). Categoría: `CollectionPage` + `ItemList` + `BreadcrumbList`. Producto y categoría: `BreadcrumbList` por la categoría principal. **Nunca** `AggregateRating` sin reseñas reales. |
| **Sitemap** | `/sitemap.xml` por host (índice) → `products`, `categories`, `brands`, `pages`; solo publicados; `lastmod = updated_at`; paginado a partir de 50k URLs; caché de 1 hora + invalidación por tag |
| **robots.txt** | Por host. `Allow: /`; `Disallow: /carrito /checkout /cuenta /buscar /pedido /_preview`; `Sitemap:` absoluto. Tienda en `draft` o vista previa: `Disallow: /` + `X-Robots-Tag: noindex` |
| **SEO independiente por tienda** | Todo se genera por host y `store_id`; ningún sitemap ni canonical cruza tiendas; el subdominio redirige 301 al dominio propio primario cuando existe |
| **Categoría y tienda** | Título, descripción e introducción editables por categoría; SEO global en Apariencia |

---

## 25. Storage Architecture

### 25.1 Buckets

| Bucket | Acceso | Contenido | Ruta | Máximo | MIME permitidos |
|---|---|---|---|---|---|
| `store-media` | Lectura pública por URL; **no listable** | Imágenes de producto, marca, categoría, branding y banners | `{store_id}/{owner_type}/{owner_id}/{media_id}/original.{ext}` | 10 MB (branding 2 MB) | `image/jpeg`, `image/png`, `image/webp`, `image/avif` (**sin SVG ni GIF**) |
| `store-private` | Privado (URL firmada de 15 min) | Importaciones, exportaciones; digitales (P2) | `{store_id}/{imports|exports}/{job_id}/{uuid}.{ext}` | 10 MB (import), 200 MB (export) | `text/csv`, `application/json` |
| `user-avatars` | Lectura pública | Avatares de staff | `{user_id}/{uuid}.webp` | 2 MB | imágenes |

### 25.2 Políticas (`storage.objects`)

**SQL CONCEPTUAL — NO EJECUTAR**
```sql
create policy media_insert on storage.objects for insert to authenticated
  with check ( bucket_id = 'store-media'
    and app.has_store_permission(((storage.foldername(name))[1])::uuid, 'products.update')
    and app.media_upload_reserved(name) );          -- debe existir media(status='pending', storage_path=name)
create policy private_read on storage.objects for select to authenticated
  using ( bucket_id = 'store-private'
    and app.storage_private_readable(name) );       -- solicitante del job y permiso vigente
-- Sin políticas de UPDATE/DELETE para authenticated: la eliminación la hace el worker (SR-2).
```

### 25.3 Ciclo de vida de un medio
1. **Reservar:** `media_create_upload(store_id, owner, mime, bytes)` → valida permiso, MIME declarado, tamaño y cuota (`storage_mb`) → crea `media(status = 'pending', storage_path = …)` → devuelve una URL firmada de subida **para esa ruta exacta** (válida 10 minutos).
2. **Subir:** el navegador sube directamente a Storage.
3. **Finalizar:** `media_finalize(media_id)` → encola `media.process`.
4. **Procesar (worker, SR-2):** lee el original por la ruta de la fila; verifica *magic bytes* (debe coincidir con el MIME permitido); decodifica y **re-codifica** con sharp (elimina EXIF y metadatos, máximo 4096 px por lado, rechaza bombas de descompresión por límite de píxeles); guarda ancho y alto; `status = 'ready'` o `rejected` (y borra el objeto).
5. **Servir:** transformaciones a anchos permitidos `{160, 320, 640, 960, 1280, 1920}` (lista blanca, contra el abuso de costos) mediante las transformaciones de imagen de Supabase o el optimizador de Next con loader [ASSUMPTION: disponibilidad y costo de las transformaciones de Supabase según el plan → Spike S-3].
6. **Eliminar:** soft (`deleted_at`) → el job purga el objeto a los 7 días si ningún `order_items.image_path` lo referencia (si está referenciado por un pedido, se conserva el original).
7. **Huérfanos:** job diario elimina `media(status = 'pending')` de más de 24 h con su objeto, y los objetos sin fila (comparación por prefijo) de más de 48 h.

### 25.4 Aislamiento
La primera carpeta de la ruta es siempre `store_id` y la verifican las políticas. Las rutas las genera el servidor (nunca el nombre de archivo del usuario). El worker deriva la ruta de la fila (`store_id` de la fila = prefijo, verificado). Las URLs públicas no son listables.

---

## 26. Import / Export Architecture

### 26.1 Importación CSV (MVP: productos + variantes; inventario)
Tablas:
- `import_jobs(id, store_id, type ∈ {products, inventory}, mode ∈ {create_only, update_existing, upsert}, status ∈ {uploaded, validating, validated, committing, completed, failed, cancelled, blocked}, file_path, requested_by, totals jsonb, error?, created_at)`.
- `import_job_rows(id, store_id, import_job_id FKc, row_number, raw jsonb, normalized jsonb?, errors jsonb, action ∈ {create, update, skip, error}, entity_id?)`, UQ `(import_job_id, row_number)`.

| Paso | Detalle |
|---|---|
| 1. Subida | `imports_create(store_id, type, mode)` (`imports.run`) → URL firmada a `store-private/{store_id}/imports/{job_id}/…`. Máximo 10 MB y 20k filas |
| 2. Validación (worker) | Parseo en streaming (UTF-8, detección de BOM y de separador `,`/`;`); encabezados contra la plantilla; validación por fila con **los mismos validadores de dominio** que el panel (esquemas compartidos); duplicados dentro del archivo (SKU, handle + firma) y contra la base de datos según el modo; se guardan errores por fila |
| 3. Preview / dry run | El panel muestra totales (crear, actualizar, omitir, errores) + CSV de errores descargable. **Nada se escribe en el catálogo** hasta confirmar |
| 4. Commit | `imports_commit(job_id)` (`imports.run`) → job `import.commit` → `system.import_commit_batch(job_id, batch)` (CF-10): **vuelve a validar el permiso del solicitante**, fuerza `store_id` del job, usa las RPC internas del catálogo (mismas invariantes) y respeta los límites del plan |
| 5. Atomicidad | ≤ 5,000 filas: **una sola transacción** (todo o nada). > 5,000: lotes de 1,000 idempotentes (`import_job_id + row_number`), con estado parcial visible y "reintentar los lotes fallidos" |
| 6. Rollback | ≤ 5k: automático. > 5k: las entidades creadas llevan `import_job_id` en la auditoría; "deshacer importación" en P2 |
| 7. Inventario | Movimientos `initial`/`adjustment` con `reference_type = 'import'` y `idempotency_key = job:row` |
| 8. Auditoría | `import.requested`, `import.committed` (totales), `import.failed` |

### 26.2 Exportación (CSV; JSON P2)
- Entidades: productos (con variantes), inventario, pedidos, clientes.
- Permiso `exports.run` + el permiso de lectura de la entidad (+ `customers.pii.read` para PII completa).
- ≤ 5k filas: generación en la Server Action con el **JWT del usuario** (RLS aplica). > 5k: job con `system_worker` que vuelve a validar el permiso del solicitante → archivo en `store-private` → URL firmada de 15 minutos por email y en el panel. Archivos borrados a los 7 días.
- **Protección contra formula injection:** celdas que empiezan con `= + - @ \t \r` se prefijan con `'`.
- Auditoría `export.requested` (entidad, filtros, número de filas) — es una acción sensible.
- **JSON export completo de la tienda** (portabilidad, P2): por entidad, sin secretos; solo `org_owner`.

---

## 27. Notification Architecture

### 27.1 Abstracción
```ts
// CONTRATO CONCEPTUAL — NO IMPLEMENTAR
interface NotificationChannel { readonly channel: 'email' | 'sms' | 'whatsapp' | 'push'
  send(msg: RenderedMessage, opts: { idempotencyKey: string }): Promise<{ providerMessageId: string }> }
// MVP: EmailChannel (adaptadores: resend | fake). SMS/WhatsApp/Push: FUT con el mismo contrato.
```
`notifications.dispatch(event)` → reglas (qué plantilla, para quién, por qué canal) → render (plantillas en código con el branding de la tienda) → `notification_deliveries(dedupe_key)` → canal.

### 27.2 Eventos y destinatarios (MVP)

| Evento | Destinatario | Plantilla |
|---|---|---|
| `order.created` | Comprador (solo si el método es diferido: "pendiente de pago"); staff (`notifications.manage` configura quién) | `order_received`, `staff_new_order` |
| `payment.confirmed` | Comprador; staff | `order_confirmation`, `staff_order_paid` |
| `payment.failed` | Comprador (con enlace para reintentar si la reserva sigue vigente) | `payment_failed` |
| `order.shipped` | Comprador | `order_shipped` (rastreo) |
| `order.cancelled` | Comprador | `order_cancelled` |
| `refund.succeeded` | Comprador | `refund_issued` |
| `inventory.low` | Staff (resumen diario configurable o inmediato) | `low_stock` |
| `customer.created` | — en el MVP (sin email de bienvenida; P2) | — |
| `subscription.expiring` / `past_due` / `paused` | `org_owner` + `billing_email` | `billing_notice` (remitente de la plataforma) |
| `support_session.started` | `org_owner` | `support_access_notice` |
| `member.invited` | Invitado | `staff_invitation` |
| Auth: OTP / magic link / reset | Usuario | Vía Send Email Hook de Supabase Auth, con la marca de la tienda (compradores) o de la plataforma (staff) [ASSUMPTION: el hook recibe contexto suficiente para resolver la tienda, p. ej. `redirect_to`/metadatos → Spike S-2] |

### 27.3 Reintentos e idempotencia
- `dedupe_key = {event_id}:{template}:{recipient_hash}` (UQ): un evento reprocesado no reenvía.
- Reintentos del job con backoff exponencial (1, 2, 4… hasta 64 min; máximo 8 intentos) → `dead` + alerta.
- Errores permanentes (email inválido, rebote duro) → `suppressed` sin reintento.
- La clave de idempotencia también se pasa al proveedor si lo soporta.
- **El envío nunca bloquea la transacción de negocio:** se encola en ella y se envía después.

---

## 28. Event Architecture

### 28.1 Modular monolith

**DECISION:** una aplicación Next.js + una base de datos, organizadas en módulos de dominio con APIs internas explícitas. Asincronía mediante **una sola cola transaccional en PostgreSQL** (`jobs`). Sin microservicios, sin broker externo.

**WHY:** un equipo pequeño; transacciones ACID entre módulos (pedido + inventario + cupón en un commit); despliegue y depuración simples.

**ALTERNATIVES:** microservicios (complejidad operativa y consistencia eventual innecesaria); broker externo como Kafka o SQS (otro servicio que operar, sin necesidad hasta un volumen alto).

**TRADE-OFFS:** el throughput de la cola en Postgres está acotado (suficiente para miles de jobs por minuto); los workers corren en funciones serverless con límite de duración.

**SECURITY IMPACT:** menos superficie; un solo perímetro.

**PERFORMANCE IMPACT:** adecuado hasta la etapa 3 de la §47.

**IMPLEMENTATION IMPACT:** `enqueue()` como única API; el reemplazo futuro por pgmq o un broker no cambia los módulos.

**TEST REQUIREMENTS:** encolado transaccional (si la transacción revierte, no hay job); idempotencia de los handlers; reintentos; dead-letter.

**STATUS:** APPROVED

### 28.2 Síncrono frente a asíncrono

| Síncrono (dentro de la transacción o del request) | Asíncrono (job) |
|---|---|
| Autorización, validación, cálculo de totales | Emails y notificaciones |
| `place_order` (pedido + reserva + cupón + contador) | Expiración de reservas y pedidos (cron cada minuto) |
| `apply_payment_status` (tras la verificación del webhook) | Reconciliación de pagos (cada 10 min) |
| Movimientos de inventario | Ejecución de reembolsos en el proveedor |
| Transiciones de estado, auditoría | Procesamiento de medios |
| Publicación (producto, tema) + invalidación de caché | Importaciones y exportaciones grandes |
| Encolado de jobs | Purgas (papelera, huérfanos, archivos) |
| | Rollups de analítica (P2), verificación de dominios (P2), reindexado (FUT) |

### 28.3 Eventos de dominio
Los eventos son **nombres tipados en código** (`domain/events.ts`): `order.created`, `order.cancelled`, `payment.confirmed`, `payment.failed`, `refund.succeeded`, `order.shipped`, `inventory.low`, `product.published`, `theme.published`, `member.invited`, `subscription.status_changed`, `support_session.started`.

`emit(tx, event)` inserta **en la misma transacción** un job por cada suscriptor registrado (`notifications`, `analytics` P2, `search` FUT, `webhooks` FUT), con `dedupe_key = {event_id}:{subscriber}`.

[CHANGED vs v0.1: se elimina `notification_outbox`; una sola tabla `jobs` cumple el patrón outbox.]

### 28.4 Worker
- **Disparo:** `pg_cron` (cada minuto) → `pg_net` POST a `/api/jobs/run` con HMAC (`JOBS_HMAC_SECRET`, marca de tiempo ±60 s) → el handler toma lotes con `FOR UPDATE SKIP LOCKED` (máximo 50 jobs o 50 s por invocación) → ejecuta → marca el resultado. Respaldo: Vercel Cron.
- **Rol:** `system_worker` (conexión directa). Cada handler valida que el `store_id` del job coincide con el de las entidades que toca.

---

## 29. Audit Architecture

### 29.1 Modelo

**SQL CONCEPTUAL — NO EJECUTAR**
```sql
create table audit.audit_logs (
  id uuid default app.uuid_v7(),
  occurred_at timestamptz not null default now(),
  organization_id uuid, store_id uuid,                 -- según el alcance; null = plataforma
  actor_type text not null check (actor_type in ('user','platform_staff','system','provider','api_key')),
  actor_user_id uuid, actor_label text not null,       -- snapshot (email/nombre) para que sobreviva a la eliminación
  support_grant_id uuid,                               -- si actuó bajo una concesión de soporte
  action text not null,                                -- 'product.updated' (registro tipado en código)
  entity_type text not null, entity_id uuid,
  before jsonb, after jsonb,                           -- SOLO campos cambiados; redactados
  reason text,                                         -- obligatorio en acciones sensibles
  request_id text, ip inet, user_agent text,           -- cuando corresponda (acciones de usuario)
  primary key (id, occurred_at)
) partition by range (occurred_at);   -- particiones mensuales creadas por pg_cron
```

### 29.2 Qué se audita

| Categoría | Acciones | Cómo |
|---|---|---|
| Login de staff | `auth.login_succeeded`, `auth.login_failed`, `auth.mfa_enrolled`, `auth.mfa_reset` | Server Action de login → `security_events` (+ auditoría para el reset) |
| Permisos | `member.invited`, `member.joined`, `member.role_changed`, `member.suspended`, `member.removed`, `org.ownership_transferred` | RPC (semántica) |
| Productos y precios | `product.created/updated/published/archived/deleted/restored`; `variant.price_changed` (before/after) | Trigger genérico + semántica |
| Inventario | Ya es un ledger (`inventory_movements`); además `inventory.adjusted` (manual) | RPC |
| Pedidos | `order.cancelled`, `order.fulfilled`, `order.note_added`, `order.contact_updated` | RPC |
| Reembolsos | `refund.requested`, `refund.succeeded/failed` (reason obligatorio) | RPC/system |
| Configuración | `store.settings_changed`, `payment_account.connected/disabled`, `shipping.changed`, `taxes.changed`, `domain.*`, `theme.published` | Trigger + RPC |
| Soporte | `support_grant.created/revoked`, `support_session.page_viewed` | RPC + aplicación |
| Importación y exportación | `import.requested/committed/failed`, `export.requested` | RPC |
| Plataforma | `tenant.suspended/reactivated/closed`, `plan.changed`, `subscription.changed`, `flag.changed`, `override.created` | Funciones de plataforma |

### 29.3 Reglas
- **Append-only:** `REVOKE UPDATE, DELETE` para todos los roles de la aplicación + trigger que lanza excepción. Solo el job de retención elimina particiones completas, previo archivo.
- **Redacción:** lista de columnas que nunca entran en `before`/`after` (`secret_ref`, tokens, `token_hash`, PII completa de clientes → enmascarada, `cost` solo si el lector tiene permiso, en la UI).
- **No se almacenan secretos.** Prueba automática: búsqueda de patrones de claves en los logs de auditoría de los tests.
- **Actor en triggers:** `auth.uid()` + `actor_label` desde `profiles`. Para `system_worker`: `set_config('app.actor', '{"type":"system","label":"jobs:import"}', true)` al inicio de cada función `system.*`.
- **Lectura:** `audit_list(store_id, filtros, cursor)` con `audit.read`. Plataforma: `platform_audit_list`.
- **Retención:** 24 meses en línea; luego archivo frío (P2) y borrado. `security_events`: 12 meses; la IP completa se guarda solo aquí y en la auditoría de acciones de usuario.

---

## 30. Security Threat Model

Escala: **Likelihood** Baja/Media/Alta · **Impact** Bajo/Medio/Alto/Crítico.

| ID | Threat | Likelihood | Impact | Mitigation | Detection | Test |
|---|---|---|---|---|---|---|
| T-01 | **Tenant escape** (leer o escribir otra tienda) | Media | Crítico | RLS forzado, `has_store_permission`, FK compuestas, `store_id` inmutable, roles sin acceso a tablas, esquemas no expuestos | `security_events` por denegaciones repetidas; alertas de 403/404 anómalos por usuario | Suite de aislamiento (matriz completa + meta-tests) |
| T-02 | **IDOR** (IDs ajenos en URL o API) | Media | Alto | RLS por registro (no por URL); 404 uniforme; UUIDs; token de pedido de invitado | Tasa de 404 por usuario o IP | E2E: cambiar IDs en las rutas del panel y de la cuenta |
| T-03 | **Privilege escalation** (autoasignarse rol, invitar a un rol superior, owner) | Media | Crítico | Membresías solo por RPC con reglas; sin políticas de escritura directa; UQ de owner | Auditoría `member.role_changed` + alerta al owner | pgTAP: cada regla de §8.3 |
| T-04 | **Escalada de contexto** (JWT de comprador usado como staff) | Media | Alto | AAL2 obligatorio en `has_store_permission` | — | Test: usuario staff con JWT aal1 → 0 permisos |
| T-05 | **CSRF** | Baja | Medio | Server Actions verifican Origin/Host; cookies `SameSite=Lax`; Route Handlers mutantes con HMAC o token | Logs de Origin rechazado | Test: POST con Origin ajeno → 403 |
| T-06 | **XSS** (contenido del comerciante, nombres, tema) | Media | Alto | Sanitización con lista blanca al guardar **y** al renderizar (`SafeHtml`); sin CSS/JS personalizados; CSP con nonce; sin SVG; dominio raíz separado | Reportes de CSP (`report-to`) | Unit con payloads XSS conocidos; E2E que verifica que no se ejecutan scripts |
| T-07 | **SQL injection** | Baja | Crítico | Data API/RPC parametrizadas; prohibido SQL dinámico concatenado en funciones (solo `format()` con `%I/%L`, revisado) | Errores de sintaxis SQL en los logs | Lint de funciones (búsqueda de `EXECUTE` + revisión); fuzz de parámetros RPC |
| T-08 | **SSRF** (URLs remotas en importaciones, futuros webhooks salientes, verificación de dominios) | Baja (MVP) | Alto | MVP: **no** se descargan URLs de imágenes en la importación (P2 con resolución DNS validada, bloqueo de rangos privados y metadata, solo `https`, timeout, tamaño máximo); la verificación de dominio solo hace consultas DNS | Logs del worker | Test de denegación de IPs privadas (cuando exista) |
| T-09 | **Webhook spoofing** | Media | Crítico | Firma por cuenta + re-consulta al proveedor + validación de monto, moneda y referencia | `security_event` por firma inválida; alerta si > 5 en 10 min | Firma inválida, cuenta equivocada, monto alterado → nunca `paid` |
| T-10 | **Replay attacks** (webhooks, tokens de invitación, OTP, preview) | Media | Medio | Marca de tiempo ±5 min + idempotencia; tokens de un solo uso con expiración; OTP con límite de intentos | Duplicados registrados | Reenviar el mismo webhook → un solo efecto; token usado → rechazo |
| T-11 | **Brute force** (OTP, login, códigos de descuento) | Alta | Medio | Rate limit de Supabase Auth + propio por IP, email y tienda; OTP: 5 intentos y expiración de 10 min; descuentos: 10 intentos por carrito por hora | `security_events` + umbrales | Test de bloqueo tras N intentos |
| T-12 | **Credential stuffing** (staff) | Media | Alto | **MFA obligatorio** (los credenciales robados no bastan); rate limit; Turnstile tras fallos | Pico de `login_failed` | Test: login correcto sin TOTP → sin acceso al panel |
| T-13 | **Malicious uploads** (polyglots, bombas de descompresión, EXIF con PII, MIME falso) | Media | Alto | Magic bytes + re-codificación con sharp + límite de píxeles + sin SVG + rutas generadas + `nosniff` | Medios `rejected` | Fixtures maliciosos → `rejected` y objeto eliminado |
| T-14 | **Price manipulation** | Alta (intentos) | Crítico | El cliente solo envía IDs y cantidades; `calculate_cart` en la base de datos; `expected_total` solo compara | Discrepancias `price_changed` anómalas | Test: payload con precio alterado → se ignora; total del servidor |
| T-15 | **Inventory race conditions** | Media | Alto | UPDATE condicional atómico; orden por `level_id`; idempotencia | Métrica de `insufficient_stock` | Concurrencia: N > stock → exactamente stock éxitos |
| T-16 | **Coupon abuse** (reutilización, carreras, enumeración) | Alta | Medio | `FOR UPDATE` del descuento; redenciones con estado; límite por cliente (email normalizado + `customer_id`); rate limit de intentos | Tasa de códigos inválidos | Concurrencia en el último uso; email con variaciones (`+tag`) — normalización documentada como límite conocido |
| T-17 | **Admin abuse** (staff o plataforma que excede su rol) | Media | Alto | Mínimo privilegio; concesiones de soporte acotadas; auditoría inmutable; notificaciones al owner; MFA | Revisión de auditoría; alertas de exportaciones masivas | Soporte sin concesión → denegado; con concesión → solo lectura |
| T-18 | **Open redirect** (returnUrl tras login) | Media | Medio | `safeRedirect`: solo rutas relativas que empiezan con `/` y no con `//` ni `/\`, sin esquema | — | Unit: `//evil.com`, `/\evil.com`, `https://evil.com` → rechazados |
| T-19 | **Service-role misuse** | Media | Crítico | Lista blanca de 2 usos; lint; CODEOWNERS; roles de mínimo privilegio para el resto; detección de la clave en el bundle | Revisión obligatoria; logs de `privileged/*` | CI: la clave no está en `.next/static`; lint falla con importación fuera de la lista |
| T-20 | **Fuga de secretos** (credenciales de pago, claves) | Baja | Crítico | Vault; redacción en logger, Sentry y auditoría; variables solo de servidor; gitleaks | gitleaks en CI; escaneo de secretos de GitHub | Test de redacción del logger |
| T-21 | **Vinculación de pedidos de invitado por email** | Media | Bajo | Solo se vinculan al verificar el email por OTP; se muestran como "pedidos con este email" | — | Test de vinculación solo tras OTP |
| T-22 | **Domain takeover** (P2) | Baja | Medio | TXT de propiedad; eliminación del dominio en el proveedor al quitarlo; job que detecta DNS colgante | Job de verificación | Test del flujo de eliminación |
| T-23 | **Enumeración de tenants** | Media | Bajo | Respuestas uniformes; rate limit en la resolución; los handles son públicos por naturaleza (aceptado) | — | Respuesta idéntica para inexistente y cerrada |
| T-24 | **DoS / abuso de API** (checkout, búsqueda, OTP) | Media | Medio | Rate limits (Vercel WAF + contadores en la base de datos para operaciones críticas); paginación con máximo; tamaños de payload | Métricas de 429 | Test de límites |
| T-25 | **Supply chain** | Media | Alto | Lockfile; pocas dependencias; Dependabot/`pnpm audit`; revisión de dependencias nuevas | Alertas de CVE | CI de auditoría |

---

## 31. API Architecture

### 31.1 Capas

| Capa | Uso | Autenticación | Autorización |
|---|---|---|---|
| Server Actions | Mutaciones de panel, cuenta y storefront | Cookie de sesión (staff aal2 / comprador) o token de carrito | `requirePermission` + RLS/RPC |
| RSC + queries | Lecturas | Ídem | RLS / funciones `storefront.*` |
| RPC `public.<module>_<verb>_<noun>` | Operaciones transaccionales de staff y comprador | JWT | Verificación interna con `has_store_permission` |
| Funciones `storefront.*` / `system.*` | Gateway y worker | Rol de base de datos | Validación interna |
| Route Handlers | Webhooks, jobs, health, sitemap/robots, canje de preview, descargas | Firma o HMAC / público | Específica |
| REST pública `/api/v1` (FUT) | Integraciones, POS, ERP, móvil | API key (`Authorization: Bearer pk_…`) con scopes = permisos | Mismos servicios de dominio |

### 31.2 Convenciones normativas

| Tema | Regla |
|---|---|
| **Naming** | Server Actions: `verbNoun` (`createProduct`, `adjustInventory`). RPC: `catalog_upsert_product`, `orders_request_refund`. REST: recursos en plural en inglés (`/v1/products/{id}`); campos en `snake_case`. Eventos: `entity.past_tense`. Permisos: `module.action`. |
| **Validation** | Zod en el borde (esquemas compartidos cliente/servidor) + validación definitiva en SQL (CK, funciones). |
| **Error format** | `{ ok: false, error: { code, message, fields?: Record<string, string>, request_id } }`. Códigos: `unauthenticated`, `mfa_required`, `forbidden`, `not_found`, `validation_failed`, `conflict`, `insufficient_stock`, `price_changed`, `cart_invalid`, `discount_invalid`, `limit_reached`, `read_only_mode`, `rate_limited`, `provider_error`, `internal`. HTTP: 401/403/404/422/409/429/502/500. `forbidden` frente a `not_found`: se devuelve `not_found` cuando revelar la existencia sería una fuga (recursos de otra tienda). |
| **Success** | `{ ok: true, data }`; listas: `{ ok: true, data: [...], page: { next_cursor, has_more } }`. |
| **Pagination** | Cursor opaco (base64 de `[sort_value, id]`); `limit` por defecto 25, máximo 100. Sin `offset` en listas grandes. |
| **Filtering** | Lista blanca por recurso (`status`, `category_id`, `created_from`…). Parámetros desconocidos → `validation_failed`. |
| **Sorting** | `sort=field` / `sort=-field` con lista blanca; desempate por `id` siempre. |
| **Idempotency** | Toda mutación con efectos externos o financieros recibe `idempotency_key` (campo oculto en formularios; header `Idempotency-Key` en REST); almacenada con UQ por tienda. |
| **Rate limiting** | Por IP + tienda (storefront), por usuario (panel), por API key (REST). Headers `RateLimit-*` en REST. |
| **Versioning** | REST con prefijo `/v1`; cambios incompatibles = nueva versión; deprecación con 6 meses de aviso. Server Actions y RPC internas no se versionan (se despliegan juntas), pero sus contratos críticos (§43) requieren ADR para cambiar. |
| **Auth errors** | Staff sin aal2 → `mfa_required` (redirección a TOTP). |

---

## 32. UX / UI Architecture

### 32.1 Principios
- **Admin:** claridad, velocidad, baja fricción y densidad útil. Producto SaaS profesional, no una plantilla.
- **Storefront:** confianza, conversión, velocidad, claridad y móvil. Tienda premium, no una plantilla.
- **Anti-"hecho por IA" [DECISION]:**
  - nada de gradientes decorativos, *glassmorphism*, emojis como iconos, tarjetas para todo ni sombras pesadas;
  - nada de textos genéricos ("¡Bienvenido a tu dashboard!");
  - nada de iconos sin función;
  - tablas reales en lugar de grillas de tarjetas en el panel;
  - jerarquía tipográfica en lugar de cajas de colores;
  - microcopy específico en español, sin lenguaje de marketing en la UI operativa.

### 32.2 Design tokens

| Grupo | Admin | Storefront |
|---|---|---|
| Color | Neutros (12 pasos) + 1 acento de la plataforma + semánticos (éxito, advertencia, peligro, info) con contraste AA verificado | Tokens de la tienda (§20) + neutros derivados + semánticos fijos |
| Tipografía | Sans de interfaz (Inter/Geist); base de 14 px; escala 12/13/14/16/18/20/24/30; números tabulares en tablas | Base de 16 px; escala 14/16/18/20/24/32/40/48; títulos con la fuente de la tienda |
| Espaciado | Rejilla de 4 px (4, 8, 12, 16, 20, 24, 32, 40, 48, 64) | Misma escala con más aire (secciones de 64–96 px en desktop) |
| Radio | 6 px componentes, 8 px contenedores | De la tienda (`none`/`sm`/`md`/`full`) |
| Elevación | 2 niveles (borde + sombra sutil para popovers y modales) | Mínima |
| Movimiento | 120–200 ms ease-out; nada decorativo | Ídem; sin carruseles automáticos; respeta `prefers-reduced-motion` |
| Iconos | Lucide 16/20 px, siempre con etiqueta o `aria-label` | Ídem |

### 32.3 Jerarquía y patrones

| Patrón | Regla |
|---|---|
| Encabezado de página | Título + contexto (contador, estado) + **una** acción primaria a la derecha; secundarias en un menú |
| Tablas | Encabezado fijo; números alineados a la derecha; selección múltiple → barra de acciones masivas; filas clicables con un objetivo claro; columnas prioritarias en tablet; tarjetas compactas en móvil |
| Formularios | Etiqueta visible siempre; ayuda bajo el campo; validación al salir del campo y al enviar; foco en el primer error; secciones con anclas en formularios largos; guardado explícito con barra fija "Cambios sin guardar" |
| Modales | Solo para confirmar o para tareas de menos de 3 campos; foco atrapado; `Esc` cierra; sin modales anidados |
| Drawers | Edición rápida, filtros en móvil, carrito |
| Notificaciones | Toast para el éxito (con "Deshacer" cuando aplique); los errores, inline junto a la causa; banner para estados globales (solo lectura, suscripción) |
| Empty states | Qué es la sección, por qué está vacía y la acción principal (y la secundaria, p. ej. importar) |
| Loading | Skeleton con la forma del contenido; el botón muestra el estado pendiente; nunca un spinner de página completa |
| Errores | Mensaje humano + qué hacer + `request_id`; `error.tsx` por segmento |
| Confirmaciones | Resumen del impacto ("Se archivarán 12 productos"); las irreversibles requieren escribir la confirmación |
| Acciones destructivas | Color de peligro, separadas espacialmente, nunca como acción por defecto; preferir reversibles (papelera) |

### 32.4 Responsive

| Ancho | Storefront (mobile-first) | Admin |
|---|---|---|
| < 640 | 2 columnas de producto; menú en drawer; CTA "Agregar" fijo; checkout en 1 columna con el resumen en acordeón | Barra inferior (Inicio, Pedidos, Productos, Más); tablas → tarjetas; ver y enviar pedidos y ajustar stock completamente usables |
| 640–1023 | 3 columnas; filtros en drawer | Sidebar colapsable; columnas prioritarias |
| 1024–1439 | 4 columnas; filtros laterales; checkout en 2 columnas | Sidebar fija; tablas completas |
| ≥ 1440 | Contenido de ancho máximo 1280–1440 px centrado | Lista + detalle lado a lado |

Optimizadas para escritorio (usables en móvil, no prioritarias): editor masivo de variantes, importación y editor de tema.

### 32.5 Accesibilidad (WCAG 2.2 AA)

| Criterio | Regla |
|---|---|
| Teclado | Todo es operable con teclado; orden lógico; *skip link*; sin trampas de foco salvo en modales |
| Foco | Anillo visible de 2 px con contraste ≥ 3:1; nunca `outline: none` sin reemplazo; foco no oculto por elementos fijos (2.4.11) |
| Contraste | Texto ≥ 4.5:1 (grande ≥ 3:1); componentes y estados ≥ 3:1; **validado en los tokens de cada tienda** |
| HTML semántico | `header/nav/main/footer`, encabezados en orden, `button` para acciones y `a` para navegación, tablas con `th` y `scope` |
| ARIA | Solo cuando el HTML nativo no alcanza; primitivas Radix (patrones WAI-ARIA); `aria-live` para carrito, toasts y errores |
| Lectores de pantalla | `alt` significativo (obligatorio para publicar: advertencia en el MVP); iconos decorativos `aria-hidden`; precios y estados legibles ("Precio anterior $X, precio actual $Y") |
| Movimiento reducido | `prefers-reduced-motion`: sin transiciones no esenciales ni autoplay |
| Formularios | `label` asociado; `autocomplete` correcto (checkout); `inputmode`; errores con `aria-invalid` + `aria-describedby`; resumen de errores enlazado al enviar |
| Objetivos táctiles | ≥ 24×24 px (2.5.8); recomendado 44×44 en el storefront |
| Autenticación accesible | OTP con posibilidad de pegar el código (3.3.8) |
| Verificación | axe en E2E (cero serias o críticas) + revisión manual con teclado y lector (VoiceOver/NVDA) en la Fase 11 |

---

## 33. Performance Architecture

Presupuestos y su justificación. Los números de CWV son los umbrales "good" públicos de Google [FACT]. El resto son [RECOMMENDATION] a calibrar con mediciones reales en la Fase 5.

| Métrica | Presupuesto | Justificación |
|---|---|---|
| LCP (p75, móvil) | ≤ 2.5 s (meta 2.0 s) | Umbral "good" de Core Web Vitals; afecta el SEO y la conversión |
| INP (p75) | ≤ 200 ms | Umbral "good" |
| CLS (p75) | ≤ 0.1 | Umbral "good"; se garantiza con dimensiones de imagen guardadas |
| TTFB storefront (página cacheada en el CDN) | ≤ 200 ms | Servida desde el edge; deja margen para el LCP en 4G |
| TTFB storefront (sin caché) | ≤ 800 ms | Umbral "good" de TTFB según web.dev |
| JS inicial, página de producto | ≤ 130 KB gzip | En un Android de gama media, el parseo y la ejecución de JS dominan el INP; mantenerlo bajo deja ~1 s de margen sobre el LCP en 4G. Se mide y ajusta en la Fase 5 |
| Imagen LCP (hero o producto, móvil) | ≤ 150 KB (AVIF/WebP al ancho correcto) | A ~1.6 Mbps efectivos (4G lento), 150 KB ≈ 0.75 s |
| Miniaturas de listado | ≤ 30 KB cada una | Listados de 24–48 productos sin saturar la red |
| Consultas indexadas de una tienda (lecturas del panel y del storefront) | p95 ≤ 50 ms en la base de datos | Lecturas por índice con prefijo `store_id` en la misma región |
| `place_order` | p95 ≤ 300 ms (sin proveedor) | ~10–20 sentencias con bloqueos de fila |
| Server Actions del panel | p95 ≤ 500 ms extremo a extremo | Percepción de inmediatez con estado optimista |
| Listados del panel (10k productos / 100k pedidos por tienda) | p95 ≤ 400 ms | Cursor + índices + columnas explícitas |
| Webhook | Responder en < 5 s (p95 < 1 s) | Los proveedores reintentan con respuestas lentas |
| Lighthouse (storefront) | ≥ 90 en las 4 categorías | Indicador sintético de regresión en CI |

**Tácticas:** RSC + caché por tags; islas cliente mínimas; `next/font` autoalojadas (≤ 2 familias); imágenes con `sizes` y anchos en lista blanca; `priority` solo en el LCP; carga diferida de editores, gráficos e importador; pooler de Supabase en modo transacción; índices con prefijo `store_id` para cada patrón; `EXPLAIN ANALYZE` de las 20 consultas principales en la Fase 11; sin Redis en el MVP (re-evaluar con métricas, §47).

**Verificación:** Lighthouse CI con presupuestos (falla el PR si se exceden); tamaño de bundle en CI; k6 para `place_order` y el catálogo en la Fase 11; Vercel Speed Insights (datos de campo) en producción.

---

## 34. Testing Strategy

### 34.1 Niveles y herramientas

| Nivel | Herramienta | Alcance obligatorio |
|---|---|---|
| Unit | Vitest | Formateo de dinero (el cálculo vive solo en SQL y se prueba con pgTAP: **no** existe copia en TS), estado visible del pedido, validadores Zod, `safeRedirect`, sanitización, generador de variantes y `option_signature`, `resolveTheme`, contraste, parser CSV, escape CSV, cursor de paginación |
| Integration | Vitest + Supabase local | Servicios de módulos contra una base real; adaptadores con MSW; flujos de jobs |
| Database | pgTAP (`supabase test db`) | CK, UQ, FK compuestas, triggers (inmutabilidad, anti-ciclos, `option_signature`), funciones RPC, transiciones de estado |
| **RLS** | pgTAP + clientes con JWT reales (aal1 y aal2) | Matriz de la §12.3 completa |
| **Tenant isolation** | pgTAP + Vitest | §34.3 |
| API | Vitest sobre Route Handlers y Server Actions | Errores normalizados, Origin, HMAC de jobs, rate limits |
| **Payment** | Vitest + proveedor `fake` + sandbox del proveedor en staging | §34.4 |
| **Inventory** | pgTAP + Vitest concurrente | §34.5 |
| **Concurrency** | Vitest con N conexiones paralelas | Último SKU, último cupón, contador de pedidos, límite de plan en el borde, webhook frente a expiración |
| E2E | Playwright (Chromium; WebKit móvil para el storefront) | §34.6 |
| Security | gitleaks, `pnpm audit`, Supabase advisors, ZAP baseline (F11), lint de service role, detección de la clave en el bundle, payloads XSS, uploads maliciosos | — |
| Accessibility | axe en E2E + Lighthouse | — |
| Performance | Lighthouse CI + presupuesto de bundle + k6 (F11) | — |
| Visual regression | Diferido (P2) | — |

### 34.2 Datos de prueba
Seed determinista:
- Organizaciones **A** (tiendas A1, A2) y **B** (tienda B1).
- Usuarios: `owner_A`, `admin_A`, `store_admin_A1`, `catalog_A1`, `inventory_A1`, `orders_A1`, `marketing_A1`, `agent_A1`, `viewer_A1`, `staff_A2_only`, `owner_B`, `buyer_1` (cliente de A1 y B1), `platform_owner`, `platform_admin`, `platform_support`, `suspended_member_A1`.
- Cada usuario de staff disponible con sesión aal1 **y** aal2.

### 34.3 Suite de aislamiento multi-tenant (bloquea el merge)
1. **Meta-tests de esquema:**
   - RLS habilitado y forzado en todas las tablas;
   - toda tabla con `store_id` tiene políticas o está en la lista de "solo funciones";
   - toda tabla con `store_id` tiene el trigger de inmutabilidad;
   - **toda FK hacia una tabla con `store_id` es compuesta** (cero excepciones);
   - toda función `SECURITY DEFINER` tiene `search_path` fijo y `EXECUTE` revocado a `public`;
   - `anon` no tiene grants;
   - `storefront_gateway` y `system_worker` no tienen grants de tabla;
   - los esquemas `storefront`, `system`, `app`, `audit` y `private` no están expuestos.
2. **Matriz generada:** cada tabla de tienda × {SELECT, INSERT, UPDATE, DELETE} × actor ∈ {`owner_B`, `staff_A2_only`, `buyer_1` (contexto B), `viewer_A1` (escritura), `platform_support` sin concesión, `catalog_A1` con aal1} → sobre filas de A1 → 0 filas o error.
3. **Casos dirigidos (mínimo):**
   - Store A → **leer** Store B: productos, pedidos, clientes, inventario, auditoría, pagos → 0 filas.
   - Store A → **modificar** Store B: `UPDATE` de productos y precios, ajuste de inventario por RPC con `level_id` de B → rechazado.
   - Store A → **eliminar** Store B: soft delete por RPC con ID de B → rechazado.
   - Store A → **asociar** recurso de Store B: variante de A con `product_id` de B; item de carrito de A con variante de B; pedido de A con descuento de B; envío de A con `order_item` de B → **`foreign_key_violation` incluso como `postgres`**.
   - `UPDATE … SET store_id` → rechazado en todas las tablas.
   - `storefront.place_order(A1, carrito de B1)` → rechazado.
   - Webhook con la cuenta de A1 y referencia de un pago de B1 → no se aplica.
   - Storage: subir a `store-media/{B1}/…` como staff de A1 → rechazado; leer `store-private/{B1}` → rechazado.
   - Búsqueda y listados del gateway con el host de A1 → ningún ID de B1.
   - Importación con columna `store_id = B1` → ignorada; todas las filas creadas en A1.
   - Caché: la página de producto de A1 nunca se sirve en el host de B1 (E2E con dos hosts).

### 34.4 Pagos (bloquea el merge en `payments`)
Firma inválida, cuenta inexistente, marca de tiempo vencida, evento duplicado, eventos fuera de orden (`succeeded` antes de `pending`), monto o moneda alterados, referencia de otro pedido, pago tardío sobre pedido expirado (con y sin stock), reembolso mayor que lo cobrado, doble solicitud de reembolso (idempotencia), fallo del proveedor en `createCheckout` → reintento.

### 34.5 Inventario (bloquea el merge en `inventory`, `checkout` y `orders`)
- Último SKU con N = 20 compradores concurrentes → exactamente 1.
- Multi-línea con deadlock potencial → ningún deadlock (orden por `level_id`).
- Expiración frente a pago simultáneos → estado consistente.
- Ledger: la suma de deltas = estado actual (invariante verificada en cada test).
- `continue` frente a `deny`; fulfillment sin `on_hand` → rechazado; idempotencia de movimientos.

### 34.6 E2E críticos (gate de release)
1. Onboarding de tenant (plataforma → invitación → MFA → configuración → validación de lanzamiento).
2. Producto con variantes → publicar → visible en el storefront.
3. Compra de invitado (proveedor `fake` en CI; sandbox en staging) → webhook → pagado → email encolado.
4. Fulfillment → stock descontado.
5. Reembolso parcial con restock.
6. Pago expirado → reserva liberada.
7. Comprador OTP → pedidos visibles solo de esa tienda.
8. Staff con rol limitado → secciones ocultas y acciones forzadas rechazadas.
9. Importación con errores → corrección → éxito.
10. Concesión de soporte → acceso de solo lectura → expiración → sin acceso.
11. Suscripción `paused` → panel en solo lectura, storefront vendiendo, fulfillment permitido.

### 34.7 Gates
- **Por PR:** lint, typecheck, unit, integración, pgTAP, RLS, aislamiento, pagos/inventario (si se tocan los módulos), build, gitleaks, presupuesto de bundle, lint de service role.
- **Por release:** lo anterior + E2E críticos en staging + axe + Lighthouse CI + Supabase advisors sin hallazgos de seguridad + migraciones aplicadas sobre una copia del esquema de producción.

---

## 35. Observability

| Señal | Diseño | Datos sensibles |
|---|---|---|
| **Application logs** | JSON estructurado: `ts, level, msg, request_id, store_id?, org_id?, user_id?, route, duration_ms, error_code?`. Drenados a un proveedor de logs [RECOMMENDATION: Axiom o Better Stack; decisión de costo en la F11]. Retención de 30 días | Redacción obligatoria: email, teléfono, dirección, tokens, cookies, `authorization`, cuerpos de webhook (solo el ID del evento) |
| **Error tracking** | Sentry (tras `observability/errors.ts`), tags `store_id`, `release`, `module`; `sendDefaultPii = false`; scrubbing | Ídem |
| **Security logs** | `security_events` (base de datos): login fallido o exitoso de staff, MFA, firmas inválidas, rate limits, denegaciones repetidas, concesiones de soporte. 12 meses | IP completa permitida aquí (finalidad de seguridad) |
| **Business audit** | `audit.audit_logs` (§29) | Redactado; sin secretos |
| **Metrics** | Derivadas: pedidos por minuto, tasa de pagos fallidos, latencia de `place_order`, profundidad y antigüedad de la cola, jobs `dead`, webhooks fallidos, reservas activas, 5xx, 429. MVP: consultas agregadas mostradas en `/platform/salud` + Vercel Analytics y Speed Insights | Sin PII |
| **Tracing** | FUT: OpenTelemetry (Next.js lo soporta) cuando haya más de un servicio o latencias opacas | — |
| **Health checks** | `/api/health` (liveness: proceso arriba), `/api/health/ready` (base de datos `select 1` por rol, Storage alcanzable, cola: job `queued` más antiguo < 5 min). Monitor externo cada minuto | Sin detalles internos en la respuesta pública (solo `ok`/`degraded`) |
| **Alerting** | Tasa de 5xx > 2% en 5 min; cola atascada > 5 min; jobs `dead` > 0; > 5 firmas de webhook inválidas en 10 min; latencia p95 de `place_order` > 1 s; health `degraded` 3 min; almacenamiento > 80%; certificado de dominio por vencer (P2). Canales: email + mensajería | — |

`request_id`: generado en el proxy, propagado a logs, Sentry, auditoría y respuestas de error.

---

## 36. Backup / Recovery

### 36.1 Definiciones
- **Backup:** copia de los datos para recuperarlos después.
- **Rollback:** revertir un **despliegue o una migración** al estado anterior del código o del esquema.
- **Restore:** reconstruir **datos** desde un backup o desde PITR.

### 36.2 Estrategia

| Escenario | Mecanismo | RPO | RTO |
|---|---|---|---|
| Fallo o corrupción de la base de datos | Backups diarios de Supabase + **PITR** (activado antes del primer cliente de pago) [ASSUMPTION: plan Pro + add-on; costo en Q-B5] | ≤ 5 min con PITR (24 h sin él) | ≤ 4 h |
| Desastre regional | Restore de PITR en un proyecto nuevo + redeploy + cambio de DNS (runbook) | ≤ 5 min | ≤ 8 h [RECOMMENDATION; FUT: réplica en otra región] |
| Borrado por el comerciante | Papelera de 30 días (productos, categorías, marcas, páginas, clientes) + auditoría con `before` | 0 | Inmediato (autoservicio) |
| Borrado o corrupción que afecta a **una** tienda por error de plataforma | PITR a un proyecto o rama temporal → extracción de las filas `store_id = X` → reinserción con un script probado (las FK compuestas validan la coherencia) | ≤ 5 min | ≤ 24 h |
| Migración fallida | **Rollback** del despliegue de la aplicación; esquema forward-only con *expand/contract* (la versión N−1 de la aplicación funciona con el esquema N); migración de corrección hacia adelante; backup manual previo a cada release con migraciones destructivas (las cuales solo ocurren en la fase *contract*) | — | ≤ 1 h |
| Despliegue defectuoso | Rollback instantáneo al despliegue anterior en Vercel | — | Minutos |
| Fallo de Storage | Durabilidad del proveedor; P2: replicación nocturna de `store-media` y `store-private` a un bucket externo | 24 h (P2) | ≤ 24 h |
| Proveedor de pagos o email caído | Reintentos en la cola; reconciliación posterior | — | — |
| Compromiso de credenciales | Runbook de rotación (claves de Supabase, contraseñas de los roles `storefront_gateway` y `system_worker`, secretos de webhook, Vault, `JOBS_HMAC_SECRET`, `PREVIEW_HMAC_SECRET`) | — | ≤ 2 h |

### 36.3 Retención

| Dato | Retención |
|---|---|
| Pedidos, pagos, reembolsos y movimientos | Indefinida mientras la tienda exista; tras el cierre, el mínimo legal [UNKNOWN: depende del país, Q1 no bloqueante] en forma anonimizada |
| Auditoría | 24 meses |
| `security_events` | 12 meses |
| Logs de aplicación | 30 días |
| Carritos abandonados | 30 días |
| Archivos de importación y exportación | 7 días |
| Tiendas cerradas | Export disponible 90 días → purga (salvo el mínimo legal) |
| Backups | Según el plan de Supabase (PITR 7 días mínimo recomendado) |

**Simulacro de restore:** trimestral, en staging, con verificación de conteos e invariantes y ejecución de la suite de aislamiento sobre los datos restaurados.

---

## 37. Project Structure

**DECISION:** una sola aplicación Next.js (pnpm), con módulos de dominio con API pública explícita (`index.ts`) y límites verificados por lint. Sin monorepo hasta que exista un segundo desplegable.

**WHY:** ownership claro por módulo, testabilidad y evolución a paquetes sin reescribir.

**ALTERNATIVES:** carpetas por tipo técnico (`components/`, `utils/`, `lib/`) — sin límites de dominio, crece en acoplamiento; monorepo desde el día 1 — costo de tooling sin beneficio.

**TRADE-OFFS:** disciplina de imports (automatizada).

**SECURITY IMPACT:** el código privilegiado queda aislado y revisable (CODEOWNERS).

**PERFORMANCE IMPACT:** ninguno.

**IMPLEMENTATION IMPACT:** plantilla de módulo obligatoria.

**TEST REQUIREMENTS:** lint de límites en CI.

**STATUS:** APPROVED

```
.
├── docs/                         # contrato técnico (tras la aprobación) + ADRs + runbooks
├── supabase/
│   ├── config.toml
│   ├── migrations/               # SQL forward-only
│   ├── seed.sql                  # seed determinista (§34.2)
│   └── tests/                    # pgTAP: schema/, rls/, isolation/, rpc/, inventory/, payments/
├── src/
│   ├── app/
│   │   ├── (marketing)/          # sitio del SaaS (mínimo)
│   │   ├── (auth)/               # login staff, MFA, invitación
│   │   ├── (admin)/admin/[storeHandle]/…
│   │   ├── (platform)/platform/…
│   │   ├── _store/[storeId]/…    # storefront (solo vía rewrite)
│   │   └── api/{webhooks/payments/[provider]/[accountId], webhooks/billing (P2), jobs/run, health, preview}/
│   ├── proxy.ts | middleware.ts  # según la versión de Next fijada en la F1
│   ├── modules/                  # DOMINIO — cada uno: index.ts · schemas.ts · types.ts · queries.ts · service.ts · actions.ts · components/ · __tests__/
│   │   ├── auth/                 # sesión, MFA, login, recuperación (sobre Supabase Auth)
│   │   ├── organizations/        # orgs, membresías de organización, invitaciones, transferencia
│   │   ├── stores/               # tiendas, configuración, dominios, lanzamiento, contexto de tienda
│   │   ├── access/               # catálogo de permisos, roles, guards (requirePermission/can), concesiones de soporte
│   │   ├── catalog/              # productos, variantes, opciones, categorías, marcas, búsqueda
│   │   ├── media/                # reserva, finalización, procesamiento, purga
│   │   ├── inventory/
│   │   ├── customers/
│   │   ├── checkout/             # carrito, cálculo, place_order, envíos, impuestos
│   │   ├── orders/               # ciclo de vida, fulfillment, cancelaciones, reembolsos (orquestación)
│   │   ├── payments/             # PaymentProvider (contrato), cuentas, webhooks, reconciliación
│   │   ├── marketing/            # descuentos (P2: promociones, abandono)
│   │   ├── storefront/           # read model público, resolución de host, preview
│   │   ├── theming/              # esquemas de tema, resolveTheme, tokens → CSS, publicación
│   │   ├── content/              # menús, páginas, políticas
│   │   ├── imports/              # import/export
│   │   ├── notifications/        # reglas, plantillas, canales
│   │   ├── billing/              # planes, entitlements, límites, access mode (P2: BillingProvider)
│   │   ├── flags/
│   │   ├── audit/
│   │   ├── analytics/            # KPIs (P2: eventos)
│   │   └── platform/             # consola de plataforma
│   ├── adapters/                 # implementaciones de terceros (solo donde hay contrato): payments/{mercadopago,manual,fake}, email/{resend,fake}
│   ├── server/
│   │   ├── db/                   # supabase-js (usuario), gatewayDb (storefront_gateway), workerDb (system_worker), tipos generados
│   │   ├── privileged/           # ÚNICO lugar del service role: authAdmin.ts, storageAdmin.ts (CODEOWNERS)
│   │   ├── jobs/                 # enqueue, runner, registro de handlers
│   │   ├── security/             # rate limit, safeRedirect, HMAC, CSP, sanitize
│   │   └── observability/        # logger con redacción, errores, request_id
│   ├── ui/                       # design system: primitives/, admin/, storefront/
│   ├── themes/base/              # tema 1: schema.ts, sections/, layout
│   ├── lib/                      # utilidades puras sin dominio: money, dates, slug, cursor
│   └── config/                   # env.ts (Zod; falla el build), constants, reserved-handles
├── tests/{e2e, integration, fixtures}/
├── .github/workflows/  .github/CODEOWNERS
├── .env.example  .gitignore  .nvmrc  package.json  pnpm-lock.yaml  tsconfig.json  eslint.config.*
└── CLAUDE.md                     # reglas de no regresión (§44) para agentes
```

**Justificación de los módulos:**
- `auth`, `organizations`, `stores` y `access` van separados porque tienen ciclos de vida y dueños distintos (sesión frente a tenancy frente a autorización).
- `checkout` y `orders` van separados: checkout termina en `place_order`; orders gestiona todo lo posterior.
- `payments` y `billing` van separados por la regla de la §18.1.
- `media` es transversal (catálogo, branding, banners).
- `content` y `theming` van separados: datos editoriales frente a presentación.

**Reglas de dependencia (lint):**
- `app → modules(index) | ui | lib`.
- `modules/X → modules/Y(index)`; sin ciclos.
- `modules → adapters` solo a través de un registro.
- `server/privileged` solo importable desde `modules/{auth,media,imports}/service.ts`.
- `ui` no importa `modules`.
- `lib` no importa nada del dominio.

---

## 38. Implementation Roadmap

**Regla de fase:** cada fase cierra con su informe (cambios, archivos, migraciones, tests y resultados, riesgos, pendientes, criterios de aceptación) y **aprobación humana**. Ninguna fase usa una tabla, función o contrato que se cree en una fase posterior. Las lecturas opcionales de datos futuros tienen fallback explícito.

### Spikes (riesgos técnicos que se verifican primero)

| ID | Pregunta | Fase | Si falla |
|---|---|---|---|
| S-1 | ¿Supavisor acepta los roles de login `storefront_gateway`/`system_worker` desde serverless (modo transacción)? | F1 | Alternativa: JWT del servidor con `role` personalizado para la Data API (ADR-016) |
| S-2 | Supabase Auth: claim `aal`, enrolamiento TOTP, códigos de recuperación, contexto disponible en el Send Email Hook para dar marca por tienda | F2 | Códigos de recuperación propios; marca por tienda vía metadatos de OTP |
| S-3 | Transformaciones de imagen: costo y disponibilidad (Supabase frente al optimizador de Next) | F3 | Optimizador de Next con lista blanca de anchos |
| S-4 | Proveedor de pagos: firma, marca de tiempo, expiración del checkout, idempotencia | F7 | Ajustes del adaptador (el contrato no cambia) |
| S-5 | Versión de Next.js: nombre del archivo de middleware/proxy, APIs de caché por tags | F1 | Se fija la versión y se ajusta el contrato de caché |

---

### PHASE 0 — Architecture Sign-off
- **Objetivo:** aprobar esta especificación y responder las BLOCKING QUESTIONS.
- **Dependencias:** ninguna.
- **Entregables (tras la autorización):** `/docs` (documentos del Anexo A del blueprint, actualizados con este Gate 0) + `CLAUDE.md` con la §44.
- **Criterios de aceptación:** la checklist de la §48 está completa.
- **DoD:** aprobación humana explícita.
- **NO hacer:** código, dependencias, configuración de servicios.

### PHASE 1 — Foundation
- **Objetivo:** proyecto ejecutable, seguro por defecto, con CI y la infraestructura transversal que las fases siguientes necesitan.
- **Dependencias:** F0.
- **Tablas:** `jobs`, `platform_settings`. Esquemas `app`, `audit`, `private`, `storefront`, `system`. Extensiones. Helpers: `app.uuid_v7`, `set_updated_at`, `prevent_tenant_change`, `audit.log_change` (sin uso todavía).
- **Backend:** `config/env.ts` (Zod, falla el build); logger con redacción; errores tipados; `request_id`; clientes de base de datos (usuario, `gatewayDb`, `workerDb`); roles `storefront_gateway`/`system_worker` (S-1); runner de jobs + `/api/jobs/run` con HMAC + pg_cron; `/api/health`, `/api/health/ready`; `safeRedirect`; HMAC utilitario.
- **Frontend:** design tokens (admin), primitivas (Button, Input, Field, Select, Checkbox, Dialog, Drawer, Toast, Table base, Skeleton, EmptyState), layout base.
- **Seguridad:** `.gitignore` (primer commit), CSP con nonce, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors`; gitleaks; lint de `no-restricted-imports` del service role; CODEOWNERS.
- **Tests:** unit (env, `safeRedirect`, HMAC, logger que redacta); pgTAP: meta-tests de esquema (pasan con el esquema base: RLS forzado en `jobs`/`platform_settings`, `anon` sin grants, esquemas no expuestos); job encolado en una transacción revertida → no existe; worker: idempotencia y reintentos.
- **Criterios de aceptación:** `pnpm verify` (lint + typecheck + unit + pgTAP + build) verde en local y en CI; headers verificados; S-1 y S-5 resueltos y documentados.
- **Riesgos:** S-1 negativo (alternativa preparada).
- **DoD:** CI verde; cero secretos; `docs/` actualizado con los resultados de los spikes.
- **NO hacer:** tablas de dominio, auth, UI de negocio.

### PHASE 2 — Identity, Tenancy & Access
- **Objetivo:** multi-tenancy real y **demostrada** antes de cualquier dato de comercio.
- **Dependencias:** F1.
- **Tablas:** `profiles`, `platform_staff`, `organizations`, `organization_members`, `organization_invitations`, `stores`, `store_members`, `store_domains`, `store_counters`, `roles`, `permissions`, `role_permissions`, `support_access_grants`, `plans`, `plan_entitlements`, `subscriptions`, `organization_entitlement_overrides`, `feature_flags`, `feature_flag_overrides`, `audit.audit_logs` (particionada), `security_events`, `notification_deliveries` (estructura; el envío real llega en la F7: en la F2 las invitaciones usan el canal `fake`/log en desarrollo y un `EmailChannel` mínimo de plataforma).
- **Backend:** `has_store_permission` (+ AAL2, access mode, concesiones), `user_has_store_permission` (worker), `org_access_mode`, `assert_within_limit` (`max_stores`, `max_staff`), `effective_limit`, `flag_enabled`; RPC: `platform_create_organization_with_store` (crea organización, tienda, subdominio en `store_domains`, contador, suscripción e invitación del owner), `access_invite_member`, `access_accept_invitation`, `access_change_member_role`, `access_suspend_member`, `access_remove_member`, `access_transfer_ownership`, `platform_grant_support_access`, `platform_revoke_support_access`, `platform_set_tenant_status`; `storefront.resolve_host` (solo resolución, sin contenido).
- **Frontend:** login de staff + enrolamiento y verificación TOTP; aceptación de invitación; shell del panel con selector de tienda; Ajustes → Equipo; `/platform`: organizaciones (crear, suspender), concesiones de soporte.
- **Seguridad:** RLS de todas las tablas de la fase; reglas anti-escalada; auditoría de membresías y concesiones; rate limit de login.
- **Tests:** **suite de aislamiento v1** (meta + matriz + dirigidos de identidad); pgTAP de cada regla de la §8.3; aal1 frente a aal2; miembro suspendido sin acceso inmediato; soporte sin concesión, con concesión y expirado; access mode `read_only` deniega `write`; E2E: plataforma crea tenant → owner acepta → MFA → invita a un `catalog_manager` → este no ve Ajustes ni Equipo.
- **Criterios de aceptación:** un usuario de B no puede leer ni modificar nada de A (probado); escalada imposible (probado); auditoría presente.
- **Riesgos:** S-2; complejidad de las RPC de membresía.
- **DoD:** suite verde; Supabase advisors sin hallazgos.
- **NO hacer:** catálogo, storefront con contenido, billing automatizado, roles personalizados.

### PHASE 3 — Catalog & Media
- **Objetivo:** catálogo completo por tienda con medios seguros.
- **Dependencias:** F2.
- **Tablas:** `brands`, `categories`, `products`, `product_options`, `product_option_values`, `product_variants`, `variant_option_values`, `variant_costs`, `product_categories`, `media`; buckets `store-media`, `store-private` + políticas.
- **Backend:** `catalog_upsert_product` (transaccional: producto + opciones + variantes + costos + categorías), `catalog_publish_product` / `validate_product_for_publish`, `catalog_archive_product`, `catalog_soft_delete_product` / `restore`, `catalog_duplicate_product`, `catalog_move_category`, triggers (`option_signature`, `search_vector`, `min/max_price`, anti-ciclos, límites `max_products`/`max_variants_per_product`); `media_create_upload`, `media_finalize`, job `media.process` (SR-2), purga de huérfanos; `catalog.search` para el panel.
- **Frontend:** listado de productos (filtros, acciones masivas, cursor), editor de producto (simple y variable, generador de combinaciones, tabla de variantes), categorías (árbol), marcas, subida de imágenes con progreso.
- **Seguridad:** sanitización de `description_html`; validación de uploads (§25); `variant_costs` restringido.
- **Tests:** pgTAP (SKU único, combinación única, FK compuestas, ciclos, inmutabilidad, límites); unit (generador, firma, sanitización); uploads maliciosos; aislamiento ampliado (catálogo + storage); E2E: crear la "Playera" de 6 variantes → publicar → archivar → restaurar.
- **Criterios de aceptación:** todas las invariantes de la §14 probadas; ningún medio sin procesar se sirve.
- **Riesgos:** UX del editor de variantes; S-3.
- **DoD:** suite verde; Lighthouse del panel no aplica; axe sin violaciones serias en el editor.
- **NO hacer:** colecciones, atributos, video, digitales, importación (F8).

### PHASE 4 — Inventory
- **Objetivo:** inventario consistente bajo concurrencia.
- **Dependencias:** F3.
- **Tablas:** `inventory_locations` (+ backfill de la ubicación por defecto + trigger para tiendas nuevas), `inventory_levels` (+ backfill para las variantes existentes con `track_inventory`), `inventory_movements`, `inventory_reservations`, `inventory_reservation_items`.
- **Backend:** `app.apply_inventory_movement`, `inventory_adjust` (RPC de staff), funciones internas `reserve`/`release`/`commit`/`fulfill` (usadas en las F6–F7), alerta de stock bajo (job diario; el envío llega en la F7: hasta entonces solo se marca en el dashboard).
- **Frontend:** tabla de inventario, ajuste con motivo, historial por variante, umbral.
- **Seguridad:** ledger inmutable; `inventory.adjust`.
- **Tests:** concurrencia del último SKU (N = 20); deadlock multi-línea; idempotencia; invariante del ledger; `continue` frente a `deny`.
- **Criterios de aceptación:** nunca hay stock negativo bajo carga; cada cambio tiene su movimiento.
- **Riesgos:** errores de signo (cubiertos por la invariante).
- **DoD:** suite verde.
- **NO hacer:** multi-almacén en la UI, órdenes de compra, transferencias.

### PHASE 5 — Storefront (read path), Content & SEO
- **Objetivo:** tiendas públicas rápidas en subdominio.
- **Dependencias:** F3, F4 (disponibilidad), F2 (`store_domains`).
- **Tablas:** `store_themes` (fallback: si no existe la fila, se usan los defaults del tema), `menus`, `menu_items`, `store_pages` (+ seed de plantillas de políticas en borrador).
- **Backend:** funciones `storefront.*` de lectura (`get_store_public`, `get_home`, `list_products`, `get_product`, `get_category`, `get_brand`, `search_products`, `get_menus`, `get_page`, `variant_availability`, `sitemap_entries`); proxy de resolución con caché; token de vista previa; invalidación por tags desde las mutaciones del catálogo y del contenido; `resolveTheme`.
- **Frontend:** tema base (home con secciones por defecto, catálogo, categoría, marca, producto con selector de variantes y disponibilidad por estado, búsqueda, páginas, header y footer, 404, 503, barra de vista previa); editor mínimo de menús y páginas en el panel.
- **Seguridad:** `/_store` inaccesible directamente; `noindex` en draft y vista previa; `SafeHtml`; CSP del storefront.
- **Tests:** E2E con dos tiendas en dos hosts (sin mezcla de datos ni de caché); host desconocido → 404 uniforme; tienda suspendida → 503; vista previa (válida, expirada, de otra tienda); SEO (canonical, JSON-LD validado, sitemap por host, robots); axe; Lighthouse CI con presupuestos.
- **Criterios de aceptación:** LCP y presupuestos de la §33 cumplidos en staging (datos sintéticos); aislamiento por host probado.
- **Riesgos:** fugas de caché (test dedicado); rendimiento.
- **DoD:** suite verde; Lighthouse ≥ 90.
- **NO hacer:** carrito y checkout, editor de tema completo, dominios propios.

### PHASE 6 — Customers, Cart, Shipping, Taxes, Discounts & Checkout
- **Objetivo:** del carrito al pedido `pending_payment` con totales correctos y stock reservado.
- **Dependencias:** F4, F5.
- **Tablas:** `customers`, `customer_addresses`, `carts`, `cart_items`, `shipping_zones`, `shipping_rates`, `discounts`, `discount_redemptions`, `orders`, `order_items`, `order_events`, **`payment_accounts` y `payments`** (aquí, para que `place_order` no dependa de la F7; en esta fase solo existen los proveedores `manual` y `fake`).
- **Backend:** `storefront.cart_*` (crear, agregar, actualizar, quitar; token), `app.calculate_cart`, `storefront.place_order` (§17.4), `storefront.get_order_for_guest`; RPC de staff para envíos, impuestos (columnas de `stores`) y descuentos; `orders_assert_transition`; job de expiración de reservas y pedidos (libera, cancela con `payment_expired`, libera el cupón); `PaymentProvider` (contrato) + adaptadores `manual` y `fake`; confirmación manual de pago por staff (`orders_mark_paid_manual`, auditada).
- **Frontend:** drawer y página del carrito; checkout de una página; resultado y estado del pedido de invitado; panel: envíos, impuestos, descuentos; listado básico de pedidos (solo lectura).
- **Seguridad:** el frontend no es autoridad (§17.2); rate limits de checkout; token de carrito httpOnly.
- **Tests:** unit y pgTAP de totales (tabla de casos: impuesto incluido o no, %, fijo, envío gratis, redondeos, multi-línea, prorrateo exacto); `place_order` (idempotencia, `price_changed`, `insufficient_stock` con rollback total incluido el contador, cupón agotado concurrente, variante de otra tienda, carrito de otra tienda); expiración; E2E: checkout con `fake` hasta "pagado" simulado.
- **Criterios de aceptación:** el pedido creado tiene un snapshot completo y el total es idéntico al mostrado; doble envío → un solo pedido.
- **Riesgos:** redondeo (casos dorados validados por ti antes de cerrar la fase).
- **DoD:** suite verde.
- **NO hacer:** proveedor real, reembolsos, fulfillment, cuenta del comprador.

### PHASE 7 — Payments, Order Lifecycle & Notifications
- **Objetivo:** cobro real (sandbox), ciclo de vida completo y comunicación.
- **Dependencias:** F6.
- **Tablas:** `payment_events`, `refunds`, `shipments`, `shipment_items`.
- **Backend:** adaptador `mercadopago` (S-4); conexión y validación de credenciales (Vault); webhook (§18.4); `system.apply_payment_status` (incluye pago tardío CF-04); reconciliación; `orders_fulfill`, `orders_mark_delivered`, `orders_cancel`, `orders_request_refund` + job `refund.execute`; `NotificationChannel` (email: `resend` + `fake`) + plantillas con marca + reglas de la §27.2; Send Email Hook (marca por tienda en OTP); `stores_launch` / `validate_store_for_launch` (método de pago `live` activo, zona de envío si hay productos físicos, políticas publicadas, contacto, ≥ 1 producto activo).
- **Frontend:** detalle del pedido con timeline, fulfillment (parcial), cancelar, reembolsar; Ajustes → Pagos y Notificaciones; checklist de lanzamiento.
- **Seguridad:** firma, *replay* y re-consulta; separación del billing de plataforma; secretos en Vault.
- **Tests:** §34.4 completa; reembolso > cobrado; E2E con sandbox en staging; 100 checkouts simulados con fallos aleatorios → cero estados inconsistentes (invariantes verificadas).
- **Criterios de aceptación:** compra real de punta a punta en sandbox; ningún pedido pagado sin un pago `succeeded` verificado.
- **Riesgos:** comportamiento real del proveedor; entregabilidad del email (SPF, DKIM, DMARC).
- **DoD:** suite verde + prueba en staging.
- **NO hacer:** Stripe, devoluciones formales (RMA), pedidos manuales, disputas.

### PHASE 8 — Customer Accounts & Admin Operations
- **Objetivo:** completar la operación diaria.
- **Dependencias:** F7.
- **Tablas:** `import_jobs`, `import_job_rows`, `export_jobs`.
- **Backend:** OTP de comprador + `storefront_link_customer`; RPC de clientes (editar, anonimizar); KPIs del dashboard (consultas agregadas sobre `orders` y `order_items`); importación y exportación (§26).
- **Frontend:** `/cuenta/*`; clientes (listado, perfil); dashboard; importador con vista previa; exportaciones; Ajustes → Actividad (auditoría).
- **Seguridad:** PII enmascarada sin `customers.pii.read`; formula injection; re-validación de permisos en los jobs.
- **Tests:** aislamiento de la cuenta del comprador entre tiendas; vinculación solo tras OTP; importación (duplicados, errores, 5k filas atómicas, `store_id` del archivo ignorado); exportación (escape, permisos); KPIs contra un seed conocido.
- **Criterios de aceptación:** un comerciante opera una semana sin ayuda técnica (prueba guiada).
- **Riesgos:** UX de la importación.
- **DoD:** suite verde.
- **NO hacer:** segmentos, grupos, Excel, JSON export completo.

### PHASE 9 — White-Label Customization
- **Objetivo:** identidad propia por tienda sin perder calidad.
- **Dependencias:** F5, F3 (media).
- **Tablas:** sin tablas nuevas (`store_themes` completo con `draft_*`).
- **Backend:** esquema Zod del tema v1, validación de contraste, `storefront_publish_theme` (con auditoría e invalidación), favicon generado.
- **Frontend:** editor de branding, secciones de la home (agregar, quitar, ordenar, editar), menús, contacto, redes, SEO global, vista previa.
- **Seguridad:** sin CSS ni JS personalizados; URLs validadas.
- **Tests:** valores inválidos rechazados; contraste bloquea la publicación; la vista previa no se filtra al público; la publicación invalida la caché; las dos tiendas de prueba cumplen Lighthouse y axe.
- **Criterios de aceptación:** dos tiendas visualmente distintas, ambas ≥ 90 en Lighthouse.
- **DoD:** suite verde.
- **NO hacer:** temas adicionales, page builder, CSS personalizado.

### PHASE 10 — Platform Console & SaaS Plans
- **Objetivo:** operar el negocio SaaS sin SQL manual.
- **Dependencias:** F2 (modelo), F7 (emails).
- **Tablas:** ninguna nueva.
- **Backend:** CRUD de planes y entitlements; suscripciones manuales con transiciones (`trialing` → `active` → `past_due` → `paused` → `cancelled`) y job diario que aplica las gracias; overrides; flags (UI); salud (cola, webhooks, errores); notificaciones de billing.
- **Frontend:** `/platform` completo; "Plan y uso" en el panel del tenant.
- **Seguridad:** solo `platform_admin`/`owner` con aal2; auditoría.
- **Tests:** límites en el borde con concurrencia; transiciones de suscripción y su efecto (§19.4); `platform_support` no puede escribir.
- **Criterios de aceptación:** alta, límite, suspensión y reactivación de un tenant de punta a punta.
- **DoD:** suite verde.
- **NO hacer:** cobro automático (P2).

### PHASE 11 — Hardening & Launch Readiness
- **Objetivo:** listo para el primer cliente de pago.
- **Dependencias:** F1–F10.
- **Trabajo:** revisión de seguridad con la §30 como checklist; ZAP baseline; pentest externo [RECOMMENDATION]; k6 (checkout y catálogo); `EXPLAIN ANALYZE` de las 20 consultas principales; advisors limpios; PITR activo; runbooks (incidentes, restore, rotación); alertas; revisión manual de accesibilidad; textos legales de la plataforma (términos del SaaS, política de uso aceptable con categorías prohibidas, aviso de privacidad) [requiere asesoría legal]; simulacro de restore.
- **DoD:** §48 y gates de release cumplidos; checklist firmada por ti.

### PHASE 12 — Pilot Launch
- **Objetivo:** 1–3 tiendas piloto en producción, acompañadas.
- **DoD:** dos semanas sin incidentes críticos; backlog P2 priorizado con datos reales.

### Lo que NO debe hacerse todavía (global, hasta después de la F12 salvo aprobación)
Dominios propios · billing automatizado · analítica de eventos · Stripe · productos digitales y servicios · bundles · colecciones y atributos · devoluciones (RMA) · multi-almacén operativo · roles personalizados · API pública v1 · webhooks salientes · temas adicionales · page builder · multi-moneda o multi-idioma · motor de búsqueda externo · Redis · réplicas de lectura · particionado de tablas de comercio · microservicios · módulo de cumplimiento regulatorio (salvo que Q-B3 lo pida).

---

## 39. ADRs

### ADR-001 — Multi-tenancy Organization → Store
- **Context:** el SaaS aloja clientes con una o varias tiendas; la facturación y el equipo son del cliente; los datos de comercio deben aislarse por tienda.
- **Decision:** base de datos compartida y esquema compartido; jerarquía Organization (tenant comercial) → Store (frontera de datos); `store_id` en las tablas de comercio, `organization_id` en las de organización.
- **Alternatives:** base de datos por tenant; esquema por tenant; solo Store; solo Organization.
- **Why:** un solo despliegue y una sola migración; costo mínimo; multi-tienda como límite de plan; aislamiento fino.
- **Consequences:** el aislamiento depende de RLS + FK compuestas + la suite; un join en la autorización; reportes por organización agregados.
- **Rejected alternatives:** base de datos o esquema por tenant (operación y migraciones N veces; costo); solo Store (multi-marca imposible); solo Organization (marcas mezcladas).

### ADR-002 — PostgreSQL RLS como frontera de autorización
- **Context:** la aplicación tendrá bugs; la autorización no puede depender solo de TS.
- **Decision:** RLS habilitado y forzado en todas las tablas; función única `has_store_permission` (AAL2, access mode, concesiones); escrituras complejas solo por RPC; `anon` sin grants.
- **Alternatives:** autorización solo en la aplicación; RLS parcial.
- **Why:** la base de datos rechaza aunque la aplicación se equivoque.
- **Consequences:** las políticas deben probarse (pgTAP); costo por sentencia mitigado con initPlan e índices.
- **Rejected alternatives:** solo aplicación (un `WHERE` olvidado = fuga); RLS sin `FORCE` (el dueño de la tabla lo omitiría).

### ADR-003 — Composite foreign keys
- **Context:** las funciones privilegiadas, los workers y las migraciones no pasan por RLS.
- **Decision:** `UNIQUE (store_id, id)` en los padres; FK compuestas en todos los hijos; `SET NULL (col)` para referencias opcionales; cero excepciones.
- **Alternatives:** solo RLS; triggers de verificación.
- **Why:** imposibilidad estructural de asociar entre tenants.
- **Consequences:** índices únicos extra; FK verbosas; meta-test.
- **Rejected alternatives:** triggers (lentos, olvidables); excepción en `order_items` (eliminada).

### ADR-004 — Modular monolith
- **Context:** equipo pequeño; transacciones entre módulos (pedido, inventario, cupón).
- **Decision:** una aplicación Next.js con módulos de dominio y límites verificados por lint; una base de datos; una cola en Postgres.
- **Alternatives:** microservicios; monorepo multi-paquete.
- **Why:** ACID entre módulos, simplicidad operativa, evolución a paquetes si hace falta.
- **Consequences:** escalado vertical primero; disciplina de límites.
- **Rejected alternatives:** microservicios (consistencia eventual y operación innecesarias).

### ADR-005 — RBAC
- **Context:** distintos empleados con distintas tareas; soporte de plataforma; evolución a roles personalizados.
- **Decision:** 3 roles de plataforma, 3 de organización y 7 de tienda; permisos atómicos con `kind`, `sensitive` y `support_readable`; roles del sistema sembrados desde el código; `org_owner`/`org_admin` con todos los permisos de tienda; reglas anti-escalada en las RPC; P2 roles personalizados.
- **Alternatives:** roles fijos sin permisos; ACL por recurso.
- **Why:** mínimo privilegio con complejidad acotada.
- **Consequences:** matriz que mantener sincronizada (test).
- **Rejected alternatives:** solo los 4 roles solicitados (forzaría a dar `org_admin` a operadores); `MANAGER` genérico.

### ADR-006 — Inventory ledger
- **Context:** trazabilidad y consistencia del stock.
- **Decision:** `inventory_movements` append-only + `inventory_levels` agregados; única función de mutación con UPDATE condicional atómico; idempotencia.
- **Alternatives:** solo un contador; event sourcing puro.
- **Why:** auditoría completa y lectura O(1) del stock.
- **Consequences:** doble escritura (nivel + movimiento) en la misma transacción.
- **Rejected alternatives:** solo contador (sin trazabilidad); event sourcing puro (lecturas costosas, complejidad).

### ADR-007 — Inventory reservations
- **Context:** evitar la sobreventa durante el pago sin bloquear stock por carritos.
- **Decision:** reserva (encabezado + items) al crear el pedido `pending_payment` con TTL; `committed` al pagar; `fulfilled` al enviar; expiración por job; el carrito no reserva; pago tardío con re-reserva o `needs_attention`.
- **Alternatives:** reservar en el carrito; no reservar (verificar al pagar).
- **Why:** equilibrio entre conversión y riesgo; los bots no bloquean stock.
- **Consequences:** job de expiración crítico (monitorizado); pagos tardíos posibles (cubiertos).
- **Rejected alternatives:** reservar en el carrito (abuso); sin reserva (sobreventa en métodos diferidos).

### ADR-008 — Payment abstraction
- **Context:** varios proveedores por mercado; pruebas sin el proveedor real.
- **Decision:** contrato `PaymentProvider` + `NormalizedPayment`; adaptadores `mercadopago`, `manual`, `fake`; el dominio nunca importa SDKs.
- **Alternatives:** acoplar a un proveedor.
- **Why:** cambiar o agregar un proveedor = un adaptador.
- **Consequences:** el mínimo común denominador se complementa con `capabilities`.
- **Rejected alternatives:** acoplamiento directo.

### ADR-009 — Store-owned payment accounts
- **Context:** quién es el merchant of record.
- **Decision:** cada tienda conecta su propia cuenta; la plataforma no toca el dinero de los compradores; el billing de plataforma va separado (§18.1). [Q-B1]
- **Alternatives:** la plataforma cobra y liquida (agregador o marketplace).
- **Why:** evita obligaciones de facilitador de pagos, KYC de submerchants y contracargos de la plataforma.
- **Consequences:** onboarding de pagos por tienda; comisión por transacción solo en FUT (Connect o marketplace).
- **Rejected alternatives:** agregador en el MVP (riesgo regulatorio).

### ADR-010 — Order snapshots
- **Context:** los pedidos históricos deben sobrevivir a cambios y borrados del catálogo.
- **Decision:** snapshot inmutable (items, precios, impuestos, descuento, envío, direcciones y cliente) con `snapshot_version`; las referencias al catálogo son opcionales (`SET NULL`).
- **Alternatives:** referencias vivas al catálogo; versionado del catálogo.
- **Why:** reconstrucción exacta sin consultar el catálogo.
- **Consequences:** datos duplicados (deliberado); el contrato del snapshot se versiona.
- **Rejected alternatives:** referencias vivas (corrompen el histórico); versionado del catálogo (complejo).

### ADR-011 — Domain resolution
- **Context:** subdominios ahora, dominios propios después; aislamiento por host.
- **Decision:** `store_domains.hostname` único global como única fuente de `host → store`; resolución en el proxy con caché de 60 s; rewrite a `/_store/{store_id}`; primario + 301; dominio raíz separado para los storefronts; verificación TXT para dominios propios (P2). [Q-B4, Q-B5]
- **Alternatives:** tienda por ruta (`/s/{handle}`); tienda por parámetro.
- **Why:** aislamiento de cookies, SEO por tienda y white-label real.
- **Consequences:** wildcard DNS y certificados; caché de resolución.
- **Rejected alternatives:** por ruta (cookies y orígenes compartidos, SEO inferior).

### ADR-012 — White-label architecture
- **Context:** identidad por tienda sin degradar calidad ni seguridad.
- **Decision:** tema en código (estructura) + tokens validados + secciones predefinidas + contenido; fallback `store ▷ theme ▷ platform`; borrador → publicar; sin CSS ni JS personalizados.
- **Alternatives:** page builder libre; temas de terceros.
- **Why:** calidad, accesibilidad y rendimiento garantizados; soporte barato; sin vector XSS.
- **Consequences:** menos libertad creativa.
- **Rejected alternatives:** page builder en el MVP (costo y riesgo).

### ADR-013 — SaaS entitlements
- **Context:** límites por plan aplicados de forma fiable.
- **Decision:** `plans` + `plan_entitlements` + overrides; uso calculado en vivo; `assert_within_limit` con advisory lock en triggers; access mode derivado de la suscripción y evaluado en la autorización; cobro manual en el MVP.
- **Alternatives:** límites en el frontend; contadores denormalizados.
- **Why:** la base de datos decide; sin desincronización de contadores.
- **Consequences:** `count` indexado al insertar (barato a la escala prevista).
- **Rejected alternatives:** `usage_counters` (deriva); integrar el billing ahora (prematuro).

### ADR-014 — Idempotency
- **Context:** reintentos de red, doble clic, webhooks duplicados.
- **Decision:** claves de idempotencia con UQ por tienda en `place_order`, pagos, reembolsos, envíos, movimientos, jobs (`dedupe_key`), notificaciones y eventos de proveedor; transiciones monótonas.
- **Alternatives:** deduplicación en memoria; *exactly-once* de infraestructura.
- **Why:** correcta bajo cualquier reintento y verificable en la base de datos.
- **Consequences:** columnas y UQ extra; los clientes generan las claves.
- **Rejected alternatives:** confiar en que no hay duplicados.

### ADR-015 — Audit logging
- **Context:** responsabilidad, soporte, seguridad y disputas.
- **Decision:** `audit.audit_logs` particionada, append-only, con actor, alcance, acción, entidad, `before`/`after` (solo campos cambiados, redactados), `reason`, `request_id`, `ip`/`UA` cuando corresponde; triggers genéricos + acciones semánticas; `security_events` aparte; sin secretos.
- **Alternatives:** solo logs de aplicación; tabla de auditoría por entidad.
- **Why:** consultable por tenant, inmutable y completa.
- **Consequences:** volumen (particiones y retención).
- **Rejected alternatives:** logs de aplicación (no consultables por tenant, mutables, con PII).

### ADR-016 — Least-privilege database roles [NUEVO]
- **Context:** el storefront y los workers necesitaban acceso sin JWT de usuario; v0.1 usaba el service role.
- **Decision:** roles de login `storefront_gateway` y `system_worker` sin grants de tabla, con `EXECUTE` solo en funciones de esquemas no expuestos; conexión directa vía Supavisor; service role limitado a 2 usos.
- **Alternatives:** service role + disciplina; RPC concedidas a `anon`.
- **Why:** elimina el bypass silencioso; la función es la frontera.
- **Consequences:** un segundo cliente de base de datos; credenciales que rotar; S-1.
- **Rejected alternatives:** service role por defecto; `anon` con RPC (se saltan los rate limits del servidor).

### ADR-017 — MFA obligatorio para staff [NUEVO]
- **Context:** pool único de Auth; el JWT del comprador comparte identidad con el staff.
- **Decision:** AAL2 exigido por `has_store_permission` y por las funciones de plataforma; TOTP obligatorio para todo el staff.
- **Alternatives:** proyectos de Auth separados; claim de contexto.
- **Why:** cierra la escalada de contexto y el credential stuffing de staff con una regla verificable.
- **Consequences:** fricción en el onboarding del staff; proceso de recuperación de MFA.
- **Rejected alternatives:** MFA solo para roles altos (deja abierta la escalada de contexto).

### ADR-018 — Storefront read model por funciones [NUEVO]
- **Context:** el catálogo es público pero contiene columnas privadas (costos) y no debe ser enumerable por la Data API.
- **Decision:** lecturas públicas solo vía `storefront.*` con columnas explícitas y condiciones de publicación; disponibilidad como estado, no como cantidad.
- **Alternatives:** RLS pública para `anon`; vistas.
- **Why:** superficie mínima y contrato de lectura estable.
- **Consequences:** funciones que mantener junto al esquema.
- **Rejected alternatives:** RLS para `anon` (columnas sensibles, enumeración global).

### ADR-019 — Una sola cola transaccional (`jobs`) [NUEVO]
- **Decision:** `jobs` cumple outbox y cola; `emit()` inserta un job por suscriptor en la misma transacción.
- **Why / Rejected:** elimina `notification_outbox` duplicado; brokers externos rechazados por ahora (§47).

### ADR-020 — Búsqueda en PostgreSQL [NUEVO]
- **Decision:** FTS + trigram con índices GIN compuestos (`btree_gin`); sin abstracción hasta que exista un segundo motor.
- **Why / Rejected:** motor externo rechazado en el MVP (infraestructura y sincronización innecesarias).

---

## 40. Risk Matrix

| ID | Riesgo | Probabilidad | Impacto | Severidad | Mitigación | Test |
|---|---|---|---|---|---|---|
| R-01 | **Tenant escape** por una política, función o consulta defectuosa | Media | Crítico | **CRITICAL** | Capas L1–L10 (§11.2) | Suite de aislamiento (§34.3) |
| R-02 | **Service-role abuse** / bypass silencioso | Media | Crítico | **CRITICAL** | ADR-016; lista blanca de 2 usos; lint; CODEOWNERS | Lint + clave ausente del bundle + revisión |
| R-03 | **Autorización:** escalada de rol o de contexto | Media | Crítico | **CRITICAL** | RPC anti-escalada; AAL2; sin permisos en el JWT | pgTAP §8.3; aal1 frente a aal2 |
| R-04 | **Pagos:** pedido marcado pagado sin pago real | Baja | Crítico | **HIGH** | Firma + re-consulta + validación + idempotencia + replay | §34.4 |
| R-05 | **Pagos:** pago perdido (tardío, webhook perdido) | Media | Alto | **HIGH** | Reconciliación; pago tardío → re-reserva o `needs_attention` | Pago tardío con y sin stock; webhook omitido + reconciliación |
| R-06 | **Inventario:** sobreventa por carrera | Media | Alto | **HIGH** | UPDATE condicional; orden por `level_id` | Concurrencia N = 20 |
| R-07 | **Race conditions** en cupones, contadores y límites | Media | Medio | **MEDIUM** | `FOR UPDATE` / advisory lock / contador por UPDATE | Tests concurrentes específicos |
| R-08 | **Corrupción de pedidos** (snapshot modificado, totales incoherentes) | Baja | Alto | **HIGH** | CK de totales; triggers de inmutabilidad; transiciones validadas | pgTAP de inmutabilidad y de transiciones inválidas |
| R-09 | **Pérdida de datos** (base de datos, borrado, migración) | Baja | Crítico | **HIGH** | PITR; soft delete; expand/contract; restore por tienda | Simulacro trimestral; test de migración sobre una copia |
| R-10 | Contradicción webhook frente a expiración | Media | Alto | **HIGH** | `FOR UPDATE` del pedido en ambas funciones; transición explícita de pago tardío | Test concurrente webhook + expiración |
| R-11 | XSS almacenado afecta a compradores | Media | Alto | **HIGH** | Sanitización doble; CSP con nonce; dominio separado; sin CSS ni JS personalizados | Payloads XSS |
| R-12 | Fuga de caché entre tiendas | Baja | Alto | **MEDIUM** | `storeId` en la ruta y en los argumentos de caché; sin caché de datos autorizados | E2E con dos hosts |
| R-13 | Alcance del MVP desbordado | Alta | Alto | **HIGH** | Fases con "NO hacer"; P2 por defecto | Revisión de fase |
| R-14 | Dependencia de Supabase o Vercel (precio, límites, caídas) | Media | Alto | **HIGH** | Postgres estándar; adaptadores; plan de salida | — |
| R-15 | S-1 negativo (roles personalizados vía pooler) | Baja | Medio | **MEDIUM** | Alternativa JWT con rol personalizado (ADR-016) | Spike S-1 |
| R-16 | Errores de impuestos o redondeo | Media | Alto | **HIGH** | Función única en SQL; enteros; casos dorados aprobados | pgTAP con tabla de casos |
| R-17 | Abuso de la plataforma por tenants (ilegal, fraude, phishing) | Media | Alto | **HIGH** | Onboarding asistido; política de uso aceptable; suspensión; revisión previa al lanzamiento | — |
| R-18 | Cumplimiento legal (privacidad, consumidor, productos regulados) | Media | Alto | **HIGH** | Asesoría legal en la F11; anonimización; consentimientos; Q-B3 | — |
| R-19 | Entregabilidad de email baja | Media | Medio | **MEDIUM** | SPF, DKIM y DMARC; reintentos; supresiones | Test de envío en staging |
| R-20 | Supabase Auth sin contexto de tienda en los emails | Media | Medio | **MEDIUM** | Spike S-2; plantillas por metadatos | Spike S-2 |
| R-21 | *Noisy neighbor* | Baja | Medio | **LOW** | Índices por `store_id`; rate limits por tienda; monitoreo | k6 multi-tienda (F11) |
| R-22 | Deriva entre la especificación y la implementación | Media | Medio | **MEDIUM** | Contratos críticos (§43); reglas (§44); ADR obligatorio para desviaciones | Revisión de fase |
| R-23 | Fricción del MFA reduce la adopción del staff | Media | Bajo | **LOW** | Onboarding guiado; recordar dispositivo en sesión de 12 h | — |

---

## 41. Traceability Matrix

| # | Requirement | Decision | Database entity | Backend module | UI | Test | Acceptance criterion |
|---|---|---|---|---|---|---|---|
| RQ-01 | Múltiples organizaciones y tiendas | ADR-001 | organizations, stores | organizations, stores | /platform, selector de tienda | Aislamiento | Organización con 2 tiendas aisladas |
| RQ-02 | Aislamiento total entre tenants | ADR-002/003/016 | Todas (`store_id`, FKc) | access | — | §34.3 | Matriz 100% verde |
| RQ-03 | Super Admin | ADR-005 | platform_staff, plans, subscriptions | platform, billing | /platform | E2E 1, 10 | Crear, limitar y suspender tenant sin SQL |
| RQ-04 | Catálogo por tienda (productos, variantes, SKU, marcas, categorías) | §14 | products… | catalog | Productos, Categorías, Marcas | pgTAP catálogo | "Playera" de 6 variantes |
| RQ-05 | Colecciones | §14.4 | collections (P2) | catalog | — | — | **P2 — diferido, marcado** |
| RQ-06 | Inventario sin sobreventa | ADR-006/007 | inventory_* | inventory | Inventario | §34.5 | N concurrentes → stock exacto |
| RQ-07 | Pedido con snapshot histórico | ADR-010 | orders, order_items | orders | Detalle de pedido | Inmutabilidad | Pedido intacto tras editar o borrar el producto |
| RQ-08 | Checkout con autoridad del servidor | §17 | carts, orders | checkout | Checkout | T-14 | Precio manipulado ignorado |
| RQ-09 | Abstracción de pagos | ADR-008 | payments… | payments | Ajustes → Pagos | §34.4 | Adaptador `fake` y `mercadopago` intercambiables |
| RQ-10 | Billing de plataforma separado del cobro de la tienda | §18.1 | subscriptions frente a payment_accounts | billing frente a payments | Plan y uso frente a Pagos | Revisión de dependencias (lint) | Módulos sin imports cruzados |
| RQ-11 | Planes, entitlements y límites aplicados en el servidor | ADR-013 | plan_entitlements | billing | Plan y uso | Límite en el borde | Producto N+1 rechazado en la base de datos |
| RQ-12 | White-label | ADR-012 | store_themes, menus, pages | theming, content | Apariencia | F9 | Dos tiendas distintas ≥ 90 |
| RQ-13 | Subdominios; dominios propios después | ADR-011 | store_domains | stores, storefront | Ajustes → Dominios | E2E de host | Host → tienda correcta; 404 uniforme |
| RQ-14 | Búsqueda | ADR-020 | search_vector | catalog | /buscar | Relevancia + aislamiento | "cafe" encuentra "café"; sin resultados de otra tienda |
| RQ-15 | SEO por tienda | §24 | seo_* | storefront | — | SEO E2E | Canonical, sitemap y JSON-LD por host |
| RQ-16 | Storage aislado | §25 | media + storage | media | Subidas | Storage cross-tenant | Subida a otra tienda rechazada |
| RQ-17 | Importación y exportación | §26 | import_jobs… | imports | Importar/Exportar | F8 | 5k filas atómicas; errores por fila |
| RQ-18 | Notificaciones | §27 | notification_deliveries | notifications | Ajustes → Notificaciones | Idempotencia | Evento reprocesado → un solo email |
| RQ-19 | Auditoría | ADR-015 | audit_logs | audit | Actividad | Append-only | UPDATE en auditoría rechazado |
| RQ-20 | RBAC + soporte restringido | ADR-005, CF-08 | roles…, support_access_grants | access | Equipo; /platform | §8.3, E2E 10 | Soporte solo lectura con concesión |
| RQ-21 | WCAG 2.2 AA | §32.5 | — | ui | Todo | axe + manual | Cero violaciones serias |
| RQ-22 | Rendimiento | §33 | Índices | — | — | Lighthouse CI, k6 | Presupuestos cumplidos |
| RQ-23 | Backups y recuperación | §36 | — | — | — | Simulacro | Restore verificado |
| RQ-24 | Feature flags | §9 (flags) | feature_flags | flags | /platform | Resolución | Kill switch apaga la funcionalidad |
| RQ-25 | Analítica | §20 v0.1 | orders (KPIs) | analytics | Dashboard | KPIs vs. seed | **Parcial: KPIs de ventas en el MVP; conversión y eventos P2** |
| RQ-26 | Desactivar productos, variantes, métodos de pago y destinos (requisito original) | §14, §18 | products.status, variants.status, payment_accounts.status/enabled_methods, shipping_rates.is_active, shipping_zones | catalog, payments, checkout | Cada sección | Desactivado → no vendible | Checkout rechaza lo desactivado |
| RQ-27 | Configuración inválida no llega a producción (requisito original) | §14.3, F7 | validate_* | catalog, stores | Checklist de lanzamiento | Validaciones | Tienda incompleta no se lanza; producto inválido no se publica |
| RQ-28 | Reglas regulatorias por jurisdicción (requisito original) | Punto de extensión §14.3 | — | — | — | — | **GAP: sin implementación en el MVP; depende de Q-B3** |
| RQ-29 | Múltiples marcas por organización | ADR-001 | stores | stores | Selector | Aislamiento | Dos marcas = dos tiendas aisladas |
| RQ-30 | Productos digitales, servicios y bundles | §14.4 | Preparado | — | — | — | **FUT — marcado; el esquema no bloquea** |

---

## 42. Dependency Graph

Corrección al ejemplo del prompt: **Orders no va después de Payments**. El pedido nace en el checkout (`pending_payment`) **antes** del pago. Los pagos dependen de que exista el pedido; el **ciclo de vida** del pedido (pagado, enviado, reembolsado) depende de los pagos. Además, RBAC y RLS no van después de Stores: se construyen **junto** con la tenancy, porque sin ellos no se pueden probar las tiendas.

```
F1 Foundation (jobs, roles DB, CI, seguridad base)
 └─▶ F2 Auth+MFA ─▶ Organizations ─▶ Stores(+store_domains) ═ RBAC/RLS + Isolation suite + Plans(model) + Audit
      ├─▶ F3 Catalog + Media
      │    └─▶ F4 Inventory
      │         └─▶ F5 Storefront read + Content + SEO  (usa F2 store_domains, F3 catálogo, F4 disponibilidad)
      │              ├─▶ F6 Customers + Cart + Shipping + Taxes + Discounts + Checkout
      │              │     (crea orders pending_payment + reservas + payments[manual/fake])
      │              │    └─▶ F7 Payments(real) + Order lifecycle + Refunds + Notifications + Launch validation
      │              │         └─▶ F8 Customer accounts + Admin ops + Import/Export
      │              └─▶ F9 White-label editor (requiere F5 + F3 media)
      └─▶ F10 Platform console + Plans/Subscriptions UI (modelo desde F2; emails desde F7)
F8 + F9 + F10 ─▶ F11 Hardening ─▶ F12 Pilot
```

**Paralelizable** (si hay más de un implementador, sin romper dependencias): F9 en paralelo con F7–F8; F10 en paralelo con F8–F9; el diseño visual del tema base desde la F3.

---

## 43. Critical Contracts

**Política de cambio:** cambiar un contrato crítico requiere ADR + versión + migración + actualización de tests. Ninguna fase lo cambia "de paso".

| Contrato | Forma (resumen) | Invariantes |
|---|---|---|
| **TenantContext** | `{ storeId, organizationId, storeHandle, storeStatus, accessMode, currency, locale, timezone }`, resuelto en el servidor desde el host (storefront) o desde la URL + membresía (panel) | Nunca proviene del cliente; inmutable durante el request |
| **AuthorizationContext** | `{ userId, aal, platformRole?, orgRole?, storeRole?, permissions: Set<PermissionKey>, supportGrantId? }` cargado una vez por request | `permissions` refleja `has_store_permission`; sin aal2 está vacío; nunca se cachea entre requests |
| **PermissionKey** | Unión cerrada en `access/permissions.ts`, espejo de la tabla `permissions` | Test de sincronización |
| **Product / Variant** | Producto con ≥ 1 variante; simple = una variante con `option_signature = ''`; ≤ 3 opciones; SKU único por tienda; precios bigint ≥ 0; `compare_at > price` | Las operaciones de comercio siempre usan `variant_id` |
| **Inventory movement** | `apply_inventory_movement(store_id, level_id, type, on_hand_delta, reserved_delta, policy, reference, idempotency_key)` | Única vía de cambio; atómica; idempotente; ledger inmutable |
| **Cart** | Token opaco de 32 bytes (cookie httpOnly) → `carts.token_hash`; items `{variant_id, quantity}`; **sin precios** | El precio se calcula siempre en vivo |
| **Checkout** | `place_order(store_id, cart_token, input, expected_total, idempotency_key) → {order_id, payment_id, guest_token} \| error(price_changed \| cart_invalid \| insufficient_stock \| discount_invalid \| no_payment_method)` | Transacción única; sin red dentro de ella; idempotente |
| **Order snapshot v1** | Columnas de la §16.1–16.2, `snapshot_version = 1` | Inmutable salvo los contadores y estados listados |
| **Order state machine** | Tablas de la §16.4 | Transiciones solo por funciones; cada una registra `order_events` |
| **PaymentProvider / NormalizedPayment** | §18.2 | El dominio no importa SDKs; el estado sale de `fetchPayment` |
| **apply_payment_status** | `(payment_id, NormalizedPayment) → resultado` | Monótono; valida monto, moneda y referencia; bloquea el pedido |
| **Subscription / AccessMode** | `full \| read_only \| suspended` derivado (§19.4) | Evaluado en la base de datos en cada autorización |
| **Entitlement registry** | Claves de la §19.2 con su tipo | Límites aplicados en la base de datos |
| **StoreConfiguration / Theme schema v1** | Tokens + secciones (§20.2) validados con Zod por versión | Fallback `store ▷ theme ▷ platform`; publicación auditada |
| **Job / Domain event** | `enqueue(tx, {type, store_id?, payload, dedupe_key, run_after?})`; eventos tipados | Encolado transaccional; handlers idempotentes |
| **Error envelope** | §31.2 | Códigos estables |
| **Storage path** | `{store_id}/{owner_type}/{owner_id}/{media_id}/original.{ext}` | El prefijo `store_id` se verifica en las políticas y en el worker |

---

## 44. Non-Regression Rules

Reglas permanentes para cualquier implementador, incluido Claude Code. Van en `CLAUDE.md` tras la aprobación.

1. Nunca eliminar ni debilitar el aislamiento multi-tenant.
2. Nunca desactivar RLS, quitar `FORCE` ni agregar políticas `USING (true)` "para desarrollar".
3. Toda tabla nueva de tienda lleva `store_id NOT NULL`, RLS forzado, políticas, el trigger de inmutabilidad, `UNIQUE (store_id, id)` si es referenciable y FK compuestas. Sin excepciones.
4. Nunca usar el service role fuera de `server/privileged/*` ni para leer o escribir tablas de `public`.
5. Nunca conceder grants a `anon`.
6. Nunca poner permisos ni roles de tenant en claims del JWT.
7. Nunca cachear entre requests datos que dependen de la autorización.
8. Nunca confiar en datos del cliente para precio, total, impuestos, descuento, stock, tienda o permisos.
9. Nunca modificar snapshots históricos de pedidos.
10. Nunca actualizar inventario fuera de `apply_inventory_movement`.
11. Nunca abrir una transacción que incluya una llamada de red.
12. Nunca confirmar un pago desde el frontend ni desde la página de retorno: solo desde un webhook verificado o una reconciliación.
13. Nunca procesar dos veces un webhook, un reembolso o un movimiento (idempotencia obligatoria).
14. Nunca borrar físicamente pedidos, pagos, reembolsos, movimientos ni auditoría.
15. Nunca registrar secretos, tokens ni PII completa en logs, errores o auditoría.
16. Nunca aceptar HTML, CSS ni JS sin sanitizar del comerciante; nunca usar `dangerouslySetInnerHTML` fuera de `SafeHtml`.
17. Nunca aceptar SVG en las subidas.
18. Nunca crear funciones `SECURITY DEFINER` sin `search_path = ''` y sin `REVOKE EXECUTE FROM public`.
19. Nunca exponer los esquemas `storefront`, `system`, `app`, `audit` ni `private` en la Data API.
20. Nunca introducir una dependencia sin justificarla en el PR (propósito, alternativas, tamaño, mantenimiento).
21. Nunca romper un contrato crítico (§43) sin ADR aprobado.
22. Nunca avanzar de fase con tests críticos fallando ni saltarse, desactivar o poner en cuarentena un test.
23. Nunca usar una tabla, función o contrato de una fase futura.
24. Nunca usar `float` para dinero.
25. Nunca devolver errores internos al cliente: siempre el formato de error con `request_id`.
26. Toda acción mutante: validación Zod + `requirePermission` + verificación en la base de datos + auditoría si es crítica.
27. Toda migración: forward-only, *expand/contract*, probada desde cero y sobre el estado anterior.

---

## 45. Adversarial Review

| # | Escenario | Expected behavior | Actual architectural protection | Failure point (residual) | Required test |
|---|---|---|---|---|---|
| 1 | Usuario de Store A intenta acceder a Store B | 404 / 0 filas en lectura, escritura, borrado y asociación | URL → membresía (L1); `requirePermission` (L2); RLS con `has_store_permission` (L3); FK compuestas (L4) | Un usuario legítimo de A y B puede ver ambas (correcto); el riesgo residual es la UI mezclando contextos → filtro de tienda en todas las consultas del panel | §34.3 matriz + E2E de URLs |
| 2 | Usuario normal ejecuta una acción de admin | 403 | Guard en TS + RLS/RPC con un permiso específico | Server Action sin guard → la base de datos igual rechaza (la defensa existe aunque falte la capa de UX) | pgTAP por permiso + test de Server Action forzada |
| 3 | `catalog_manager` intenta modificar billing | Denegado | `catalog_manager` no tiene permisos `org.*`; `subscriptions` solo `org.billing.read` y escrituras solo de plataforma | Ninguno identificado | pgTAP: `catalog_manager` → SELECT/UPDATE de `subscriptions` → 0/rechazo; RPC de plan → rechazo |
| 4 | `platform_support` lee sin concesión | Denegado | Los platform staff no tienen ruta RLS sin una concesión vigente; las funciones de plataforma solo devuelven metadatos | **Riesgo:** `platform_admin` concediendo a un cómplice → auditoría + notificación al owner; P2: aprobación del tenant | Sin concesión → 0; concesión expirada → 0; con concesión → solo `kind = read` y no sensibles; autoconcesión → CK |
| 5 | Dos clientes compran el último producto a la vez | Uno gana; el otro recibe "agotado"; stock = 0, nunca −1 | UPDATE condicional + EvalPlanQual (§15.5) | Políticas `continue` (bajo pedido) permiten vender: comportamiento deseado y documentado | Concurrencia N = 20 |
| 6 | El webhook de pago llega dos veces | Un solo efecto | UQ `(payment_account_id, provider_event_id)`; transición monótona; `FOR UPDATE` | Dos eventos **distintos** del mismo pago (p. ej. `updated` + `created`) → la re-consulta y la monotonicidad evitan el doble efecto | Duplicado exacto y eventos distintos del mismo pago |
| 7 | Webhook falso intenta marcar pagado | Rechazado (401) sin cambios | Firma por cuenta + marca de tiempo + re-consulta (el estado viene del proveedor, no del payload) + validación de monto y referencia | Secreto de webhook filtrado → la re-consulta sigue protegiendo (el atacante no controla la API del proveedor) | Firma inválida; firma válida con monto alterado (simulada con `fake`); cuenta equivocada |
| 8 | Un producto cambia de precio después de la compra | El pedido conserva el precio original | Snapshot inmutable | Pedido **en checkout** cuando cambia el precio → `price_changed` antes de cobrar | Cambiar el precio tras `place_order` → pedido intacto; cambiar antes → `price_changed` |
| 9 | Un producto se elimina después de la compra | El pedido se muestra completo | Soft delete; FK `SET NULL (variant_id)`; snapshot | La imagen podría purgarse → la purga omite rutas referenciadas por `order_items.image_path` (§25.3) | Borrar y purgar el producto → el pedido renderiza con imagen |
| 10 | Usuario manipula el precio enviado desde el navegador | Se ignora | El cliente solo envía IDs y cantidades; `calculate_cart` en la base de datos | Ninguno | Payload con `price` y `total` arbitrarios → total del servidor |
| 11 | Subida de archivo malicioso | Rechazado y eliminado | MIME en lista blanca + magic bytes + re-codificación + límite de píxeles + sin SVG + ruta generada | La ventana entre subida y procesamiento: el objeto `pending` no se sirve (las URLs públicas solo se generan para `ready`) | Polyglot, SVG, MIME falso, bomba de descompresión, EXIF con GPS |
| 12 | Import intenta insertar registros de otra tienda | Todos los registros se crean en la tienda del job o fallan | `store_id` del job forzado; columna del archivo ignorada; FK compuestas; re-validación del permiso | Referencias por **nombre** (categoría "Ropa") se resuelven solo dentro de la tienda | CSV con `store_id`, `category_id` y `product_id` de B → nada en B; errores por fila |
| 13 | Llamada con service role intenta cruzar tenants | Imposible asociar; lectura limitada a 2 usos | ADR-016; el service role no se usa para tablas; FK compuestas | **Residual real:** el service role *técnicamente* puede leer todo. Mitigado por la lista blanca, el lint, CODEOWNERS y la rotación; no es eliminable mientras exista la clave | Lint; test de que `storageAdmin` solo opera con rutas derivadas de filas con prefijo coincidente |
| 14 | Usuario pierde acceso a una organización con sesión activa | Pierde acceso en la siguiente consulta | Membresía consultada en vivo por RLS; permisos fuera del JWT; sin caché autorizada entre requests | Una página ya renderizada en su navegador sigue visible hasta recargar (no puede actuar: las acciones fallan) | Suspender a un miembro → su siguiente lectura y acción → 0/403 |
| 15 | La suscripción expira durante una operación | La operación termina o falla de forma atómica; las siguientes respetan el nuevo modo | Access mode evaluado en cada sentencia autorizada; las transacciones son atómicas; la importación verifica por lote | Una importación grande por lotes puede quedar parcial (estado visible + reanudación al reactivarse) | Cambiar a `paused` entre lotes → estado `blocked`; operación en curso → completa o revierte |

**Escenarios adicionales encontrados por la revisión:**

| # | Escenario | Protección | Test |
|---|---|---|---|
| A16 | Miembro del staff inicia sesión con OTP en un storefront y usa ese JWT contra la Data API | AAL2 exigido | aal1 → 0 permisos |
| A17 | Atacante con la anon key llama directamente a funciones internas | `anon` sin grants; esquemas `storefront`/`system` no expuestos | Llamada directa → error de permisos / no encontrado |
| A18 | Header `Host` falsificado para obtener datos de otra tienda | La tienda resultante es la del host (contenido público); las cookies del comprador son host-only | Request con cookie de A y Host de B → sin sesión |
| A19 | Expiración y webhook `succeeded` simultáneos | `FOR UPDATE` del pedido en ambas funciones; transición explícita de pago tardío | Test concurrente |
| A20 | Brute force de códigos de descuento | Rate limit por carrito, IP y tienda | Test de bloqueo |
| A21 | Request directo a `/_store/{otro_store_id}/…` | El proxy bloquea las rutas `/_store` externas | Request directo → 404 |

---

## 46. Overengineering Review

| Elemento | Veredicto | Razón |
|---|---|---|
| Organization → Store | **KEEP** | Barato ahora, carísimo después |
| RLS forzado + función única | **KEEP** | Frontera de seguridad |
| FK compuestas | **KEEP** | Garantía estructural barata |
| Roles DB de mínimo privilegio | **KEEP** (nuevo) | Elimina la clase de bug más grave; costo: un cliente de base de datos |
| MFA obligatorio | **KEEP** (nuevo) | Una regla simple que cierra dos amenazas |
| Ledger de inventario | **KEEP** | Trazabilidad necesaria |
| Reservas encabezado + items | **KEEP** | Necesario para liberar por pedido de forma atómica |
| Tres ejes de estado del pedido | **KEEP** | Un enum único no representa los casos parciales |
| Snapshot de pedido | **KEEP** | Requisito |
| `PaymentProvider` | **KEEP** | Dos implementaciones desde el día 1 (`fake`, `manual`) + Mercado Pago |
| `NotificationChannel` (email) | **KEEP** | Adaptador `fake` para tests + proveedor real |
| `notification_outbox` + `jobs` | **SIMPLIFY** → solo `jobs` | Duplicación |
| `order_addresses` (tabla) | **SIMPLIFY** → JSONB en `orders` | Snapshot puro, sin consultas relacionales |
| `tax_rates` (tabla) | **SIMPLIFY** → columnas en `stores` (MVP) | Una tasa por tienda; tabla en P2 con migración trivial |
| `ltree` para categorías | **SIMPLIFY** → `path text` + `parent_id` | Una extensión menos; 4 niveles máximo |
| `usage_counters` | **REMOVE** | Uso calculado en vivo, sin deriva |
| `SearchProvider` | **DEFER** | Sin segunda implementación |
| `DomainProvider` | **DEFER** (P2) | Sin dominios propios en el MVP |
| `StorageProvider` | **REMOVE** | Supabase Storage directo en `media` |
| Feature flags por usuario | **DEFER** | Sin caso de uso en el MVP (plataforma, plan, organización y tienda bastan) |
| Particionado de auditoría | **KEEP** (barato si se crea particionada desde el inicio; migrar después es costoso) | — |
| Particionado de tablas de comercio | **DEFER** | Innecesario hasta la etapa 3–4 |
| Analítica de eventos | **DEFER** (P2) | KPIs desde pedidos bastan |
| Visual regression | **DEFER** | Valor bajo frente a costo de mantenimiento al inicio |
| Paleta de comandos ⌘K | **DEFER** | Agradable, no necesaria |
| Borrador → publicar del tema | **KEEP** | Evita storefronts rotos |
| Token de vista previa | **KEEP** | Necesario por la separación de dominios |
| Dominio raíz separado | **KEEP** | Costo: un dominio; beneficio: aislamiento de cookies |
| Importación asíncrona | **KEEP** (simple) | Los límites de duración serverless lo exigen para archivos grandes |
| Roles y permisos en tablas (frente a solo código) | **KEEP** | Evita reescribir la autorización al llegar los roles personalizados; costo: seed + test de sincronización |
| Redis, colas externas, motor de búsqueda, microservicios, GraphQL | **REMOVE** del plan del MVP | Sin necesidad demostrada |

---

## 47. Scalability Review

| Etapa | Volumen aproximado | Escala naturalmente | Necesitará (no implementar antes) |
|---|---|---|---|
| **1** — 1 organización, 1 tienda, 100 productos | Trivial | Todo | Nada |
| **2** — 100 organizaciones, 300 tiendas | ~300k productos, ~1M pedidos/año | Postgres único con índices por `store_id`; caché por tags; cola en Postgres; búsqueda FTS con GIN compuesto | Monitoreo de consultas lentas; quizá subir el tamaño de la instancia |
| **3** — 10,000 organizaciones, 30,000 tiendas | ~30M productos, ~100M pedidos/año, cientos de GB | Modelo de datos (sin cambios); RLS (initPlan + índices); las FK compuestas no degradan | **Read replicas** (analítica, listados del storefront); **particionado** de `audit_logs` (ya listo), `inventory_movements`, `order_events` y `jobs` por tiempo; **cola** dedicada (pgmq o broker) si los jobs superan ~1–5k/min; **motor de búsqueda** para tiendas grandes; **CDN y optimización de imágenes** (derivados pre-generados); revisar los límites de dominios por proyecto del hosting [UNKNOWN: límites vigentes de Vercel]; rate limiting distribuido (Upstash o WAF) |
| **4** — 100,000+ tiendas | TB de datos, picos por campañas | El código y el esquema (todo indexado por `store_id`) | **Sharding por tenant**: varias bases de datos con un directorio `store_id → shard` (el diseño lo permite: no hay joins entre tiendas); *tenant pinning* de tiendas grandes en proyectos dedicados; **procesamiento de eventos** (stream) para analítica; warehouse para analítica de plataforma; posible migración de dominios a Cloudflare for SaaS (ADR-011 lo prevé) |

**Elementos que se diseñaron hoy para no bloquear mañana:** `store_id` en todas las tablas (sharding); ningún join entre tiendas en el dominio; auditoría particionada; `enqueue()` abstrae la cola; `catalog.search()` como único punto de entrada; IDs UUIDv7 (únicos globalmente, sin colisiones al consolidar shards).

---

## 48. Final Architecture Decision

### 48.1 Decisión
La arquitectura definida en las §1–47 es **coherente, implementable y auditable**. Con los cambios obligatorios RC-01…RC-20 incorporados, se recomienda como **contrato técnico oficial**.

**DECISION:** adoptar esta especificación como base de implementación.

**WHY:** resuelve los 14 hallazgos críticos o altos de v0.1, elimina las 10 contradicciones detectadas y reduce el alcance del MVP sin cerrar la evolución.

**ALTERNATIVES:** seguir con v0.1 (con defectos de seguridad conocidos); rediseñar desde cero (sin justificación).

**TRADE-OFFS:** MFA obligatorio (fricción) y roles de base de datos adicionales (operación) a cambio de un aislamiento verificable.

**SECURITY IMPACT:** alto y positivo (cierra el bypass del service role y la escalada de contexto).

**PERFORMANCE IMPACT:** neutro o positivo (índices compuestos de búsqueda, lecturas por funciones con columnas explícitas).

**IMPLEMENTATION IMPACT:** +1 cliente de base de datos, +2 roles, +1 tabla (`support_access_grants`), −4 tablas o abstracciones (simplificaciones).

**TEST REQUIREMENTS:** §34, con las suites de aislamiento, pagos e inventario bloqueando el merge.

**STATUS:** **NEEDS DECISION**. Las 5 BLOCKING QUESTIONS de abajo afectan a la arquitectura. Con los defaults aceptados → **APPROVED WITH CHANGES**.

### 48.2 Revisión final de consistencia (regla §52)

| # | Posible contradicción revisada | Resultado |
|---|---|---|
| K-1 | RLS frente a service role | Consistente: el service role no toca tablas (§11.5); los roles DB no tienen grants de tabla (§11.4) |
| K-2 | RBAC frente a API | Consistente: la API usa los mismos permisos (`requirePermission` + base de datos); los scopes de la API v1 = permisos |
| K-3 | Inventario frente al flujo de pedidos | Consistente: reserva en `place_order` (F6), `committed` al pagar, `sale` al enviar, `release` al expirar o cancelar; pago tardío definido |
| K-4 | Aislamiento por tienda frente a la resolución de dominio | Consistente: `store_id` solo sale de `store_domains`; cookies host-only; `/_store` bloqueado |
| K-5 | Access mode `read_only` frente a fulfillment | Resuelto: `kind = operational` permitido (§19.4, §8.2) |
| K-6 | Soporte frente a permisos sensibles | Consistente: solo `kind = read` + `support_readable` |
| K-7 | Fases frente a tablas | Resuelto: `store_domains` en F2, `payments`/`payment_accounts` en F6, backfills en F4 y F5 |
| K-8 | Cálculo de totales en TS frente a SQL | Resuelto: solo SQL (`calculate_cart`); la UI muestra lo que devuelve |
| K-9 | Lista blanca del service role (contaba 3) | Resuelto: 2 usos |
| K-10 | Compradores con OTP frente a las redirect URLs de Auth | Consistente: OTP sin redirección (§22) |
| K-11 | Purga de imágenes frente a snapshots | Resuelto: la purga omite rutas referenciadas por pedidos |
| K-12 | Draft frente a cookies de dominio separado | Resuelto: token de vista previa |

**No quedan contradicciones abiertas conocidas.**

### 48.3 Criterios de "Arquitectura aprobada"

| Criterio | Estado |
|---|---|
| [x] Multi-tenancy definido | §6, §11 |
| [x] RLS definido | §12 |
| [x] RBAC definido | §8 |
| [x] Database definida | §9, §10, §13 |
| [x] Inventory definido | §15 |
| [x] Checkout definido | §17 |
| [x] Payments definido | §18 |
| [x] SaaS billing definido | §19 |
| [x] White-label definido | §20 |
| [x] Storage definido | §25 |
| [x] Search definido | §23 |
| [x] SEO definido | §24 |
| [x] Notifications definido | §27 |
| [x] Audit definido | §29 |
| [x] Security definido | §30 |
| [x] Testing definido | §34 |
| [x] Performance definido | §33 |
| [x] Observability definido | §35 |
| [x] Backup definido | §36 |
| [x] Roadmap definido | §38 |
| [x] ADRs definidos | §39 |
| [x] Risks definidos | §40 |
| [ ] **Open questions resueltas** | **Pendiente: 5 BLOCKING QUESTIONS sin respuesta del propietario** |
| [ ] Spikes S-1…S-5 | Programados en sus fases; no bloquean la aprobación, pero su resultado se documenta antes de cerrar cada fase |

### 48.4 BLOCKING QUESTIONS

**Q-B1 — Merchant of record**
- **Q:** ¿Cada tienda cobra con su **propia** cuenta del proveedor de pagos, o la plataforma cobra a los compradores y liquida a las tiendas?
- **Why it matters:** define el modelo de pagos, la responsabilidad regulatoria (facilitador o agregador de pagos, KYC, contracargos), las tablas y los flujos de dinero.
- **Default:** cada tienda con su propia cuenta.
- **Recommended:** el default (ADR-009).
- **Impact if changed:** rediseño de la §18 (split payments, liquidaciones, ledger financiero de plataforma, KYC de submerchants), revisión legal, más fases.

**Q-B2 — Identidad de compradores**
- **Q:** ¿Aceptas un pool único de Supabase Auth con compradores **sin contraseña** (OTP por email) y **MFA obligatorio para todo el staff**?
- **Why it matters:** es la base de la separación de privilegios (ADR-017) y de la simplicidad multi-dominio.
- **Default:** sí.
- **Recommended:** sí.
- **Impact if changed:** contraseñas de compradores (riesgo de credenciales compartidas entre marcas, redirect URLs por dominio) o staff sin MFA (requiere otra defensa contra la escalada de contexto: proyectos de Auth separados).

**Q-B3 — Productos regulados**
- **Q:** ¿La tienda de productos regulados de la primera conversación es un tenant del MVP?
- **Why it matters:** si lo es, el módulo de cumplimiento por jurisdicción (reglas configurables, denegación por defecto, verificación de edad, restricciones de pago y envío) pasa a ser requisito del MVP **para ese tenant**, y su catálogo PDF sigue sin estar disponible.
- **Default:** no. La plataforma se lanza sin módulo regulatorio; ese tenant no se activa hasta que exista el módulo y su catálogo esté verificado; la política de uso aceptable prohíbe categorías ilegales.
- **Recommended:** el default.
- **Impact if changed:** nueva fase (después de la F7) con `jurisdictions`, `compliance_rules`, validadores de publicación, checkout y lanzamiento, proveedor de verificación de edad y auditoría de decisiones; RQ-28 deja de ser GAP.

**Q-B4 — Dominios de la plataforma**
- **Q:** ¿Cuál es el nombre o dominio de la plataforma? ¿Aceptas **un dominio raíz separado** para los storefronts?
- **Why it matters:** aislamiento de cookies y orígenes entre el panel y las tiendas (ADR-011); configuración de DNS, email remitente y Auth.
- **Default:** dos dominios: `{marca}.com` (marketing + `app.`) y `{marca}-tiendas.com` (o similar) para `{handle}.{dominio}`.
- **Recommended:** el default.
- **Impact if changed:** con un solo dominio raíz, solicitar la entrada en la Public Suffix List (proceso externo de semanas) y endurecer más las cookies; sin ella, el XSS de una tienda tiene más alcance.

**Q-B5 — Hosting y presupuesto**
- **Q:** ¿Confirmas Vercel (aplicación, dominios, SSL) + Supabase plan Pro con PITR?
- **Why it matters:** la resolución de dominios, el SSL automático, los crons y los backups de esta especificación asumen ambos servicios; tienen costo mensual fijo desde la Fase 11.
- **Default:** sí.
- **Recommended:** sí.
- **Impact if changed:** otro hosting exige otra estrategia de dominios (p. ej., Cloudflare for SaaS) y de cron; sin PITR, el RPO pasa de ≤ 5 min a 24 h.

### 48.5 Preguntas no bloqueantes (se usan los defaults si no hay respuesta)

| # | Pregunta | Default |
|---|---|---|
| Q-N1 | País, moneda e impuesto de lanzamiento | México, MXN, IVA 16% incluido en precios |
| Q-N2 | Primer proveedor de pago | Mercado Pago Checkout Pro + manual |
| Q-N3 | Alta de tiendas | Asistida por la plataforma (sin autoservicio) |
| Q-N4 | Planes: nombres, precios y valores de límites | Estructura de la §19.2 con valores placeholder |
| Q-N5 | Facturación electrónica (CFDI) al lanzar | No (FUT) |
| Q-N6 | Retención tras el cierre de una tienda | Export 90 días → purga, salvo el mínimo legal |
| Q-N7 | Proveedor de email y de logs | Resend; Axiom o Better Stack (decisión de costo en la F11) |
| Q-N8 | TTL de reserva por defecto | 30 minutos (configurable por tienda; vouchers según su vigencia) |

---

**Archivos y estado:** este documento se generó **fuera del repositorio**. El repositorio `angelii33/pruva` permanece **sin cambios**: sin archivos nuevos o modificados, sin dependencias, sin migraciones, sin commits y sin despliegues. `CAMBIOS-FASE-1-2.md` sigue intacto (blob `289f06b8…`).

========================================

GATE 0 COMPLETED

Architecture:
BLOCKED — WAITING FOR DECISIONS

Implementation:
NOT AUTHORIZED

Repository:
UNCHANGED

Next step:
WAITING FOR HUMAN APPROVAL

========================================
