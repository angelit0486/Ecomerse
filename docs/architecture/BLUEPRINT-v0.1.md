# Plataforma E-commerce SaaS Multi-Tenant — Blueprint Técnico v0.1

> Estado: **BORRADOR PARA REVISIÓN**. No se ha escrito código, no se crearon archivos en el repositorio, no se instalaron dependencias, no se ejecutaron migraciones ni commits.
>
> Convención de este documento:
> - **[REQ]** = requisito explícito tuyo.
> - **[DEC]** = decisión técnica propuesta por arquitectura (revisable).
> - **[DEF]** = valor por defecto propuesto para una pregunta abierta (ver §35).
> - **MVP / P2 / FUT** = MVP, Fase 2 (post-lanzamiento), Futuro.

---

## Índice

1. Executive Summary
2. Current Repository Audit
3. Product Definition
4. User Roles
5. Multi-Tenant Architecture
6. System Architecture
7. Database Architecture
8. Entity Relationship Model
9. RLS Strategy
10. RBAC
11. Catalog Architecture
12. Inventory Architecture
13. Order Architecture
14. Payment Architecture
15. Storefront Architecture
16. Admin Architecture
17. White-Label Architecture
18. Domain Architecture
19. API Architecture
20. Analytics
21. Security Threat Model
22. Performance Strategy
23. Testing Strategy
24. Observability
25. Backup & Recovery
26. SaaS Billing Architecture
27. Feature Flags
28. Audit Logs
29. Project Structure
30. Development Roadmap
31. MVP Definition
32. Future Roadmap
33. Architecture Decision Records
34. Risk Register
35. Open Questions
36. Definition of Done
37. Recommended Implementation Order
38. Final Architectural Recommendation
- Anexo A — Contenido propuesto de `/docs`
- Anexo B — Notas de UX/UI, responsive y accesibilidad (pasos 25–27)
- Anexo C — Storage, notificaciones, importación/exportación, búsqueda, SEO (pasos 16–18, 21–22)

---

## 1. Executive Summary

Construiremos una **plataforma e-commerce SaaS multi-tenant, white-label**, en la que el propietario (tú, *Platform Owner*) opera muchas tiendas independientes desde un único despliegue y una única base de datos, con aislamiento garantizado a nivel de base de datos.

Decisiones centrales:

| Tema | Decisión |
|---|---|
| Modelo de tenancy | **Base de datos compartida, esquema compartido, aislamiento por fila** (PostgreSQL RLS). Jerarquía `Platform → Organization → Store`. |
| Unidad de aislamiento de datos | **`store_id`** en cada tabla de comercio. La `organization` es la unidad de facturación y propiedad. |
| Integridad cross-tenant | Doble barrera: **RLS** + **llaves foráneas compuestas `(store_id, id)`**, que hacen imposible referenciar en la base de datos una fila de otra tienda, incluso con `service_role`. |
| Stack | Next.js (App Router) + TypeScript + Tailwind en Vercel; Supabase (Postgres, Auth, Storage, RLS, pg_cron). Una sola aplicación Next.js, sin monorepo en el MVP. |
| Lógica transaccional | Funciones PostgreSQL (RPC) para checkout, reservas de inventario, numeración de pedidos y reembolsos. Server Actions para mutaciones del panel. Route Handlers para webhooks y la API pública futura. |
| Proveedores externos | Detrás de interfaces: `PaymentProvider`, `EmailProvider`, `DomainProvider`, `SearchProvider`, `StorageProvider` (imágenes). Ningún módulo de dominio importa un SDK de proveedor. |
| Pedidos | Tres ejes de estado independientes: `status`, `payment_status` y `fulfillment_status`. Snapshot completo e inmutable de productos, precios, impuestos, dirección y cliente. |
| Inventario | Libro mayor (*ledger*) de movimientos, append-only, más niveles agregados por variante × ubicación, con `CHECK` que impide stock negativo y reservas con TTL. |
| White-label | Tema fijo y estructural + **tokens de diseño configurables** + **secciones predefinidas** ordenables en la home. Sin page builder libre en el MVP. |
| Dominios | `{tienda}.{plataforma}` en el MVP. Dominios propios en la Fase P2 vía API de Vercel, con verificación DNS. |
| SaaS | Planes, entitlements y límites modelados desde el MVP, con aplicación de límites en la base de datos. El cobro automático a tenants queda para P2 (MVP con facturación manual). |

**Qué NO hace el MVP** (para que sea terminable): page builder libre, multi-almacén operativo (solo el esquema), marketplaces, POS, ERP, apps, roles personalizados, búsqueda externa, multi-moneda por tienda, multi-idioma por tienda, billing automatizado de tenants, analítica avanzada de eventos.

**Ruta de escalado sin reconstruir:** 1 → 10 → 100 tiendas con el mismo esquema y despliegue. Hacia 1,000+ tiendas o tenants enterprise: particionado de tablas de eventos y auditoría, réplicas de lectura y, si se requiere, *tenant pinning* a un proyecto de base de datos dedicado. La lógica no cambia, porque todo ya está indexado por `store_id`.

---

## 2. Current Repository Audit

Inspección realizada sobre `angelii33/pruva`, ramas `main` y `claude/ecommerce-regulated-platform-41vu1e`, más `git fetch` del remoto.

| # | Punto | Resultado |
|---|---|---|
| 1 | Repositorio completo | 1 commit (`a41e3fb "Add files via upload"`), 1 archivo: `CAMBIOS-FASE-1-2.md`. Ambas ramas son idénticas. |
| 2 | ¿Existe código? | **No.** |
| 3 | Framework | Ninguno. |
| 4 | Versión de Node | No declarada en el repo (no hay `.nvmrc`, `engines` ni `package.json`). El entorno tiene Node 22.22.0, npm 10.9.4 y pnpm. |
| 5 | TypeScript | No hay. |
| 6 | Sistema de estilos | No hay. |
| 7 | Librerías | No hay. |
| 8 | Build | No hay. |
| 9 | Linting | No hay. |
| 10 | Testing | No hay. |
| 11 | Autenticación | No hay. |
| 12 | Base de datos | No hay. |
| 13 | Supabase | No hay carpeta `supabase/` ni configuración. |
| 14 | Variables de entorno | No hay `.env.example`. |
| 15 | Rutas | No hay. |
| 16 | Componentes | No hay. |
| 17 | Patrones existentes | Ninguno en este repo. |
| 18 | Problemas técnicos | (a) El único archivo documenta cambios de **otro proyecto** (`angelii33/app-cursos`, plataforma de cursos); no tiene relación con el e-commerce. (b) No hay `.gitignore`. Ese mismo archivo advierte el riesgo de subir `node_modules/` o `.env.local` con llaves; debe crearse en la Fase 1 antes de cualquier `git add`. |
| 19 | Deuda técnica | Ninguna de código. Deuda de contexto: la conversación previa planteaba una tienda de **productos regulados** con un catálogo PDF que no está disponible. Ver §35, pregunta Q7. |
| 20 | Decisiones que NO deben romperse | No hay decisiones técnicas previas en este repo. Sí hay requisitos tuyos de la conversación anterior que mantengo: reglas regulatorias configurables y nunca hardcodeadas, deshabilitar productos, variantes, métodos de pago y destinos, y validación que impida que una configuración inválida llegue a producción. Esto se refleja en el sistema de "publicación con validación" (§11.7) y en el módulo de cumplimiento futuro (§32). |

**Conclusión:** proyecto *greenfield*. No hay arquitectura que preservar ni código que migrar. `CAMBIOS-FASE-1-2.md` no se toca: propongo moverlo a `app-cursos` o a `docs/archive/` solo con tu autorización.

---

## 3. Product Definition

### 3.1 Product Vision [DEC]
Una infraestructura de comercio electrónico que permite al Platform Owner lanzar y operar tiendas online profesionales para negocios de cualquier nicho permitido, cada una con su propia identidad, catálogo, clientes y operación, sin desarrollo a medida por tienda.

### 3.2 Problem Statement
Los negocios pequeños y medianos (inicialmente hispanohablantes, ver Q1) enfrentan esta disyuntiva:
- Las plataformas globales (Shopify, Tiendanube, WooCommerce) implican costo en dólares, comisiones, apps de pago por funcionalidad, configuración técnica o integraciones locales deficientes (pagos, envíos, facturación).
- Las tiendas a medida son caras, lentas de construir y frágiles de mantener.

El Platform Owner necesita **una sola base de código** que pueda vender y operar para N negocios, con aislamiento real y sin duplicar trabajo por cliente.

### 3.3 Target Customers
- **Primario (MVP):** negocios pequeños y medianos con catálogo físico de 10 a 5,000 SKUs, que venden en un país y una moneda, con 1 a 10 usuarios administrativos.
- **Secundario (P2):** negocios con varias marcas o tiendas, o que requieren dominio propio y más usuarios.
- **Futuro:** cadenas con múltiples almacenes, POS, integraciones ERP y API.
- **Fuera de alcance:** marketplaces multivendedor (un tenant con vendedores terceros). La arquitectura no lo impide, pero no se diseña para ello.

### 3.4 User Personas

| Persona | Objetivo | Dolor principal | Necesidad clave del sistema |
|---|---|---|---|
| **Platform Owner** (tú) | Vender, crear y operar tiendas; cobrar suscripciones; dar soporte. | Gestionar muchos clientes sin intervenir manualmente en cada uno. | Super Admin: tenants, planes, límites, flags, salud del sistema, soporte auditado. |
| **Store Owner** | Vender más con poco esfuerzo técnico. | Configuración compleja, costos impredecibles. | Onboarding guiado, KPIs claros, control total de su tienda y su equipo. |
| **Store Administrator** | Operar el día a día: catálogo, pedidos, apariencia. | Herramientas lentas, demasiados clics. | Panel rápido, acciones masivas, importación CSV. |
| **Staff** (inventario, pedidos, soporte, marketing) | Ejecutar su tarea específica. | Ver o romper cosas fuera de su ámbito. | Permisos granulares; interfaz que oculta lo que no le corresponde. |
| **Customer** | Comprar con confianza, rápido, desde el móvil. | Desconfianza, checkout largo, poca información del pedido. | Storefront rápido, checkout corto, compra como invitado, seguimiento del pedido. |

---

## 4. User Roles

Hay tres planos de identidad **separados**. Esta separación es una decisión de seguridad, no solo de organización:

```
PLANO PLATAFORMA     platform_staff        (tú y tu equipo)
PLANO TENANT         organization_members  +  store_members   (clientes del SaaS y su staff)
PLANO COMPRADOR      customers             (compradores finales de cada tienda)
```

Un mismo `auth.users` puede existir en varios planos (por ejemplo, un dueño de tienda que también compra en otra tienda), pero **los privilegios nunca se heredan entre planos**. El detalle de roles y permisos está en §10.

---

## 5. Multi-Tenant Architecture

### 5.1 Conceptos

| Concepto | Definición en esta plataforma |
|---|---|
| **Platform** | El despliegue completo. Implícito (no es tabla): hay una sola plataforma. La configuración global vive en `platform_settings`. |
| **Tenant** | Término de negocio = **Organization**. Es quien contrata el plan y paga. |
| **Organization** | Cuenta del cliente del SaaS. Posee tiendas, suscripción, miembros y facturación. |
| **Store** | Una tienda online: catálogo, pedidos, clientes, tema, dominios. **Unidad de aislamiento de datos de comercio.** |
| **User** | Identidad autenticada (`auth.users`), global a la plataforma. |
| **Membership** | Vínculo usuario ↔ organización (`organization_members`) y usuario ↔ tienda (`store_members`) con un rol. |
| **Role** | Conjunto nombrado de permisos. En el MVP los roles son del sistema; P2 agrega roles personalizados por organización. |
| **Permission** | Capacidad atómica (`products.update`). Definida por la plataforma en código y sincronizada a la tabla. |
| **Ownership** | Cada organización tiene exactamente un `owner` (transferible). Cada tienda pertenece a exactamente una organización. |

### 5.2 Jerarquía elegida [DEC]

```
Platform (implícita)
   │
   ├── platform_staff ──────────────── (PLATFORM_OWNER / PLATFORM_ADMIN / PLATFORM_SUPPORT)
   │
   └── Organization  (tenant, facturación, plan)
          │   organization_members: ORG_OWNER | ORG_ADMIN | ORG_MEMBER
          │
          └── Store  (aislamiento de datos de comercio)
                 │   store_members: STORE_ADMIN | CATALOG_MANAGER | INVENTORY_MANAGER |
                 │                  ORDER_MANAGER | MARKETING_MANAGER | SUPPORT | VIEWER
                 │
                 ├── catálogo, inventario, pedidos, clientes, tema, dominios...
                 └── customers (compradores)
```

**Justificación de por qué Organization y Store son entidades separadas desde el día 1:**
- Si `store` fuera el tenant, un negocio con dos marcas tendría que pagar dos suscripciones, duplicar usuarios y no podría compartir equipo. Migrarlo después implicaría reescribir membresías, facturación y RLS.
- Si `organization` fuera la unidad de aislamiento de datos de comercio, las dos marcas compartirían catálogo y clientes, y separarlas después sería una migración de datos peligrosa.
- Con ambas entidades, el costo extra en el MVP es mínimo: una tabla y un join en la función de permisos. Además habilita "multi-tienda" como un simple límite de plan.

**Por qué el aislamiento se hace por `store_id` y no por `organization_id`:**
- Toda consulta de comercio ocurre en el contexto de una tienda (storefront por host, panel por URL).
- Evita que una política RLS mal escrita filtre datos entre tiendas de la misma organización (por ejemplo, clientes de la marca A visibles para staff exclusivo de la marca B).
- No se desnormaliza `organization_id` en tablas de comercio: se obtiene vía `stores.organization_id` dentro de la función de permisos. Una sola fuente de verdad.

### 5.3 Soporte de casos

| Caso | MVP | Preparado |
|---|---|---|
| Una sola tienda por organización | ✅ (límite de plan = 1) | — |
| Múltiples tiendas por organización | Esquema listo; UI de "cambiar de tienda" incluida y oculta por límite de plan | Se activa subiendo `max_stores` |
| Múltiples marcas | Una marca = una tienda (identidad propia). `brands` del catálogo es otra cosa: marcas de producto. | — |
| Múltiples dominios por tienda | Esquema `store_domains` (N por tienda, uno primario). MVP: solo subdominio. | P2: dominios propios |
| Catálogo compartido entre tiendas de una organización | ❌ | FUT (sincronización explícita, nunca filas compartidas) |
| Clientes compartidos entre tiendas | ❌ (decisión deliberada de aislamiento) | FUT opcional |

### 5.4 Resolución del contexto de tenant

| Superficie | Cómo se resuelve |
|---|---|
| Storefront | Header `Host` → `store_domains.hostname` → `store_id`. Resuelto en `middleware`/`proxy` con caché; la tienda nunca viene de un parámetro del cliente. |
| Panel administrativo | `app.{plataforma}/admin/[storeHandle]/...` → `stores.handle` → `store_id`, y luego verificación de membresía en el servidor y en RLS. |
| Super Admin | `app.{plataforma}/platform/...` → requiere fila en `platform_staff` + MFA. |
| Webhooks | Endpoint por cuenta de proveedor: `/api/webhooks/payments/{provider}/{payment_account_id}`. La tienda se deriva de la cuenta, nunca del payload. |
| Jobs | Cada job lleva `store_id` explícito en su payload; el worker lo valida contra la entidad referenciada. |

---

## 6. System Architecture

### 6.1 Vista de componentes

```
                    ┌──────────────────────────── Vercel ─────────────────────────────┐
  Comprador ──────▶ │ Next.js App                                                      │
 (*.plataforma,     │  ├─ middleware/proxy: resolución host→store, sesión, rate-limit  │
  dominio propio)   │  ├─ (storefront)  RSC + ISR por tienda (tags de caché)           │
                    │  ├─ (admin)       RSC + Server Actions                            │
  Staff ──────────▶ │  ├─ (platform)    Super Admin                                     │
 (app.plataforma)   │  ├─ api/webhooks/* · api/jobs/* · api/v1/* (futuro)               │
                    │  └─ modules/* (dominio) → providers/* (adaptadores)               │
                    └───────────┬────────────────────────────┬────────────────────────┘
                                │ supabase-js (anon/user JWT)│ service role (solo server)
                    ┌───────────▼────────────────────────────▼────────────────────────┐
                    │ Supabase                                                         │
                    │  Postgres 15+: esquemas public / app (funciones) / audit         │
                    │   RLS · RPC transaccionales · pg_cron · pg_trgm · unaccent       │
                    │  Auth (staff y compradores) + Send Email Hook                    │
                    │  Storage (buckets por tipo, rutas por store_id)                  │
                    └───────────┬──────────────────────────────────────────────────────┘
                                │
       Proveedores (vía adaptadores): Mercado Pago · Stripe · Email (Resend/Postmark/SES)
                                     · Vercel Domains API · Sentry
```

### 6.2 Principios
1. **La base de datos es la última línea de defensa.** Toda regla de aislamiento e integridad crítica (tenant, stock no negativo, unicidad de SKU, transiciones de estado de pedido) se aplica en Postgres, no solo en TypeScript.
2. **Servidor primero.** El navegador nunca decide precios, totales, stock, tienda ni permisos.
3. **Módulos por dominio** (`catalog`, `inventory`, `orders`...) con API interna explícita. Un módulo no consulta las tablas de otro directamente; usa su servicio.
4. **Adaptadores para proveedores.** Cambiar de proveedor de email o pagos = nuevo adaptador, sin tocar el dominio.
5. **Asíncrono por outbox.** Emails, webhooks salientes y reindexaciones se encolan en la misma transacción que el cambio de negocio y se procesan después (patrón *transactional outbox*).
6. **Sin infraestructura especulativa.** Sin Redis, colas externas, Elasticsearch ni microservicios en el MVP.

### 6.3 Clientes de base de datos [DEC]

| Cliente | Dónde | Para qué | Regla |
|---|---|---|---|
| `createServerClient` (JWT del usuario) | RSC, Server Actions | Lecturas y escrituras del panel y la cuenta del comprador | **Por defecto.** RLS aplica siempre. |
| Cliente anónimo | Storefront (servidor) | Lecturas públicas del catálogo publicado | RLS de lectura pública restringida. |
| `service_role` | Solo en `src/server/privileged/*` (marcado `server-only`) | Webhooks, jobs, checkout de invitados, operaciones de plataforma | Cada uso pasa por una función que exige `store_id` explícito y escribe auditoría. Prohibido importarlo fuera de esa carpeta (regla ESLint `no-restricted-imports`). |

### 6.4 Trabajos en segundo plano [DEC]
- Tabla `jobs` (cola en Postgres, consumo con `FOR UPDATE SKIP LOCKED`), con `attempts`, `run_after`, `last_error` y backoff exponencial.
- Disparo: `pg_cron` cada minuto invoca vía `pg_net` un endpoint protegido `/api/jobs/run` (firma HMAC con un secreto compartido). Vercel Cron queda como respaldo.
- Jobs del MVP: liberar reservas expiradas, enviar notificaciones (outbox), procesar importaciones CSV, reconciliar pagos pendientes, verificar dominios (P2) y rollups de analítica.
- Alternativa evaluada: Supabase Queues (pgmq). Es aceptable y puede sustituir la tabla `jobs` sin cambiar la interfaz `enqueue()`. Ver ADR-014.

---

## 7. Database Architecture

### 7.1 Convenciones [DEC]

| Convención | Regla |
|---|---|
| PK | `id uuid primary key default gen_random_uuid()` (o `uuidv7()` si la versión de Postgres lo ofrece, por mejor localidad de índice). Nunca IDs secuenciales expuestos. |
| Tenant | `store_id uuid not null references stores(id)` en toda tabla de comercio. |
| FK intra-tienda | Las tablas padre tienen `unique (store_id, id)`. Las hijas referencian con **FK compuesta** `foreign key (store_id, product_id) references products(store_id, id)`. Esto **impide en la base de datos** que una variante de la tienda A apunte a un producto de la tienda B. |
| Dinero | `bigint` en unidades menores (centavos) + `currency char(3)`. Nunca `float` ni `numeric` sin escala. Una moneda por tienda en el MVP (`stores.currency`). |
| Tiempos | `created_at timestamptz not null default now()` y `updated_at` mantenido por trigger. Todo en UTC; la zona horaria vive en `stores.timezone` para presentación. |
| Estados / enums | `text` + `CHECK (status in (...))` en lugar de `CREATE TYPE ... AS ENUM` (ADR-008), por facilidad de evolución. |
| Soft delete | `deleted_at timestamptz` solo donde hay valor de recuperación o referencias históricas (productos, categorías, colecciones, clientes). Pedidos y pagos **nunca** se borran. |
| Slugs / handles | `citext` o `lower()` + `unique (store_id, slug)`. |
| Esquemas | `public` (tablas expuestas por PostgREST con RLS), `app` (funciones helper, no expuesto), `audit` (auditoría, no expuesto), `private` (secretos referenciados, no expuesto). |
| JSONB | Solo para datos genuinamente variables (configuración de tema, snapshots, metadatos de eventos). Nunca para datos que se filtran o se relacionan. |
| Nombres | Tablas en plural `snake_case`. Columnas en inglés (el código y la base en inglés, la UI en español). |
| Migraciones | Supabase CLI, forward-only, patrón *expand → migrate → contract* para cambios rompedores. |

### 7.2 Inventario de entidades y clasificación

Leyenda: **MVP**, **P2** (post-lanzamiento), **FUT** (futuro), **NO** (descartada y por qué).

**Identity**

| Entidad | Fase | Notas |
|---|---|---|
| `auth.users` | MVP | Gestionada por Supabase Auth. |
| `profiles` | MVP | 1:1 con `auth.users`: nombre, avatar, idioma. Sin datos de tenant. |
| `platform_staff` | MVP | Roles de plataforma. Separada de los tenants. |
| `organizations` | MVP | Tenant. |
| `organization_members` | MVP | |
| `organization_invitations` | MVP | Token hash, expiración. |
| `stores` | MVP | |
| `store_members` | MVP | |
| `roles` | MVP | Roles del sistema (seed). P2: roles personalizados con `organization_id`. |
| `permissions` | MVP | Catálogo de permisos (seed desde código). |
| `role_permissions` | MVP | N:M. |

**Catalog**

| Entidad | Fase | Notas |
|---|---|---|
| `products` | MVP | |
| `product_options` | MVP | Ej. "Color", "Talla" por producto. |
| `product_option_values` | MVP | Ej. "Negro", "M". |
| `product_variants` | MVP | La unidad vendible. **El SKU es una columna aquí, no una tabla.** |
| `variant_option_values` | MVP | N:M variante ↔ valor de opción. |
| `variant_costs` | MVP | Costo separado para que no sea legible por el público (ver §9.6). |
| `brands` | MVP | |
| `categories` | MVP | Árbol (adjacency list + `path` materializado). |
| `product_categories` | MVP | N:M con categoría principal. |
| `collections` | P2 | Colecciones manuales o automáticas por reglas. En el MVP la home usa categorías y "destacados". |
| `collection_products` | P2 | |
| `tags`, `product_tags` | P2 | En el MVP, `products.tags text[]` con índice GIN basta. Normalizar después si hace falta gestión de tags. |
| `attributes`, `attribute_values` (especificaciones filtrables, p. ej. "Material") | P2 | Distintos de las opciones de variante. MVP: `products.specs jsonb` solo para mostrar. |
| `product_media` | MVP | Imágenes (videos P2: `type in ('image','video')` desde el inicio). |
| `product_relations` | P2 | Relacionados, upsell y cross-sell. |
| `price_lists`, `customer_group_prices` | FUT | Precios B2B. |
| "SKUs" como tabla | NO | Duplicaría la variante. |

**Inventory**

| Entidad | Fase | Notas |
|---|---|---|
| `inventory_locations` (warehouses) | MVP (1 por tienda, creada automáticamente) | Multi-almacén operativo en P2. |
| `inventory_levels` (inventory_items) | MVP | Variante × ubicación: `on_hand`, `reserved`, `incoming`. |
| `inventory_movements` | MVP | Ledger append-only. Los ajustes son movimientos con `reason`, no una tabla aparte. |
| `stock_reservations` | MVP | Reservas de checkout con TTL. |
| `stock_adjustments` como tabla | NO | Es un tipo de movimiento. |
| `suppliers` | P2 | |
| `purchase_orders`, `purchase_order_items` | P2 | Alimentan `incoming`. |
| `inventory_transfers` | P2 | Con multi-almacén. |

**Commerce**

| Entidad | Fase | Notas |
|---|---|---|
| `carts`, `cart_items` | MVP | |
| `checkouts` | NO como tabla aparte | El checkout es un estado del carrito más la creación del pedido `pending_payment`. Menos estados duplicados. |
| `orders`, `order_items` | MVP | |
| `order_addresses` | MVP | Snapshot (envío y facturación). |
| `order_events` (status history + timeline) | MVP | Historial unificado: cambios de estado, notas, emails enviados. |
| `payments` | MVP | Intentos de pago por pedido. |
| `payment_events` | MVP | Webhooks recibidos (idempotencia). |
| `refunds` | MVP | |
| `returns`, `return_items` | P2 | MVP: reembolso + reingreso manual de stock. |
| `discounts` | MVP (básico) | Porcentaje o monto fijo por código, con mínimo de compra, vigencia y límite de usos. |
| `discount_redemptions` | MVP | Control de usos. |
| `promotions` automáticas (BOGO, por categoría, escalonadas) | P2 | Mismo motor de `discounts` con `type`/`rules`. |
| `gift_cards` | FUT | |
| `tax_rates` | MVP (simple) | Ver §13.5. |
| `store_counters` | MVP | Numeración de pedidos por tienda. |

**Customers**

| Entidad | Fase | Notas |
|---|---|---|
| `customers` | MVP | Por tienda; `user_id` nulo si es invitado. |
| `customer_addresses` | MVP | |
| `customer_groups` | P2 | |
| `wishlists`, `wishlist_items` | P2 | MVP opcional: SHOULD. |
| `reviews` | P2 | Requiere moderación y antispam. |

**Shipping**

| Entidad | Fase | Notas |
|---|---|---|
| `shipping_zones` | MVP | País y estados/regiones. |
| `shipping_rates` (métodos dentro de la zona) | MVP | Tarifa fija, gratis desde X, recoger en tienda. `shipping_methods` se fusiona aquí: método + tarifa por zona. |
| `shipments` | MVP | Fulfillment: paquetería, guía y URL de rastreo **capturadas manualmente**. |
| `shipment_items` | MVP | Permite envíos parciales. |
| tracking automático, cotización en vivo con paqueterías | FUT | Vía `ShippingProvider`. |

**Storefront**

| Entidad | Fase | Notas |
|---|---|---|
| `store_themes` (configuración de tema por tienda) | MVP | `theme_key` + `settings jsonb` validado con un esquema por versión de tema. |
| `themes` (catálogo de temas de plataforma) | MVP como constante en código | Los temas son código versionado, no filas. Tabla en P2 si se venden temas. |
| `store_pages` | MVP | Páginas de contenido: políticas, "Sobre nosotros". |
| `page_sections` / homepage sections | MVP como `jsonb` dentro de `store_themes.home_sections` | Lista ordenada de secciones predefinidas. |
| `menus`, `menu_items` | MVP | Header y footer. |
| `banners` | NO como tabla | Es un tipo de sección ("hero", "promo_strip"). |

**Marketing**

| Entidad | Fase | Notas |
|---|---|---|
| `email_subscribers` | P2 | Con doble opt-in y consentimiento registrado. |
| `abandoned_carts` | P2 | Derivado de `carts` (no es tabla nueva): job + `carts.recovery_email_sent_at`. |
| `campaigns` | FUT | |
| `recommendations` | FUT | MVP: "más vendidos" y "de la misma categoría" calculados con consultas. |

**Analytics**

| Entidad | Fase | Notas |
|---|---|---|
| KPIs del panel calculados desde `orders` | MVP | Sin pipeline de eventos. |
| `analytics_events` | P2 | Particionada por mes. |
| `analytics_daily_store_metrics` (rollups) | P2 | |
| `sessions`, `product_views` como tablas | NO | Son eventos con `type`; las vistas se derivan en rollups. |

**SaaS**

| Entidad | Fase | Notas |
|---|---|---|
| `plans` | MVP | |
| `plan_entitlements` | MVP | Clave → valor (límite numérico o booleano). |
| `subscriptions` | MVP (estado manual) | P2: sincronizada con el proveedor de billing. |
| `organization_entitlement_overrides` | MVP | Excepciones comerciales. |
| `usage_counters` | MVP solo para métricas no derivables (almacenamiento, pedidos/mes) | Productos y usuarios se cuentan en vivo. |
| `feature_flags`, `feature_flag_overrides` | MVP | |

**System**

| Entidad | Fase | Notas |
|---|---|---|
| `audit.audit_logs` | MVP | |
| `security_events` | MVP | Inicios de sesión fallidos, cambios de rol, accesos de soporte. |
| `notification_outbox` | MVP | |
| `notification_templates` | P2 | MVP: plantillas en código (React Email) con branding por tienda. |
| `jobs` | MVP | |
| `payment_accounts` (integraciones de pago por tienda) | MVP | Credenciales en Supabase Vault. |
| `integrations` genéricas | FUT | |
| `api_keys` | FUT (P2 tardía) | |
| `webhook_endpoints`, `webhook_deliveries` (salientes) | FUT | |
| `import_jobs`, `import_job_rows` | MVP (CSV de productos) | |
| `export_jobs` | MVP (síncrono hasta N filas) / P2 asíncrono | |
| `store_domains` | MVP | |
| `platform_settings` | MVP | |

---

## 8. Entity Relationship Model

### 8.1 Diagrama de alto nivel

```
auth.users 1─1 profiles
auth.users 1─0..1 platform_staff
auth.users 1─N organization_members N─1 organizations
auth.users 1─N store_members N─1 stores
organizations 1─N stores
organizations 1─1 subscriptions N─1 plans 1─N plan_entitlements
roles N─M permissions (role_permissions)
store_members N─1 roles

stores 1─N store_domains | store_themes(1:1) | menus 1─N menu_items | store_pages
stores 1─N brands | categories(árbol) | products
products 1─N product_options 1─N product_option_values
products 1─N product_variants N─M product_option_values (variant_option_values)
product_variants 1─1 variant_costs
products N─M categories (product_categories) ; products N─1 brands
products 1─N product_media ; product_variants N─0..1 product_media (imagen de variante)

stores 1─N inventory_locations
product_variants 1─N inventory_levels N─1 inventory_locations
inventory_levels 1─N inventory_movements
product_variants 1─N stock_reservations N─1 carts|orders

stores 1─N customers 1─N customer_addresses ; customers N─0..1 auth.users
stores 1─N carts 1─N cart_items N─1 product_variants
stores 1─N orders 1─N order_items (N─0..1 product_variants, SET NULL)
orders 1─N order_events | payments 1─N refunds | shipments 1─N shipment_items | order_addresses(≤2)
orders N─0..1 customers ; orders 1─N discount_redemptions N─1 discounts
stores 1─N payment_accounts 1─N payments ; payment_events N─1 payment_accounts
stores 1─N shipping_zones 1─N shipping_rates
```

### 8.2 Especificación por entidad (MVP)

Notación: **PK**; **FK** (→ destino, acción `ON DELETE`); **UQ** (único); **IX** (índice); **CK** (check); `?` = nullable. Todas las tablas de tienda tienen `store_id NOT NULL`, `created_at` y `updated_at` salvo que se indique lo contrario.

#### Identity

**profiles** (1:1)
- PK `id` = FK → `auth.users(id)` ON DELETE CASCADE.
- `full_name?`, `avatar_path?`, `locale default 'es'`.

**platform_staff**
- PK `user_id` → `auth.users` ON DELETE CASCADE.
- `role` CK in (`platform_owner`,`platform_admin`,`platform_support`); `mfa_required bool default true`; `created_by?` → auth.users.
- Solo legible por el propio usuario y por `platform_owner`. Escritura solo vía función de plataforma.

**organizations**
- PK `id`. `name`, `slug` UQ (global), `status` CK in (`active`,`suspended`,`closed`), `owner_user_id` → auth.users ON DELETE RESTRICT, `billing_email`, `country char(2)`, `deleted_at?`.
- IX `(status)`.

**organization_members**
- PK `id`. FK `organization_id` → organizations ON DELETE CASCADE; `user_id` → auth.users ON DELETE CASCADE.
- `role` CK in (`org_owner`,`org_admin`,`org_member`).
- UQ `(organization_id, user_id)`. IX `(user_id)`.
- Invariante: exactamente un `org_owner` por organización. Índice único parcial `unique (organization_id) where role='org_owner'` + `organizations.owner_user_id` sincronizado por función de transferencia.

**organization_invitations**
- PK `id`. `organization_id` → CASCADE; `store_id?` → stores CASCADE (invitar directo a una tienda); `email citext`; `org_role?`; `store_role_id?` → roles; `token_hash` UQ; `expires_at`; `accepted_at?`; `invited_by` → auth.users.
- UQ parcial `(organization_id, email) where accepted_at is null`.

**stores**
- PK `id`. UQ `(id)`; FK `organization_id` → organizations ON DELETE RESTRICT.
- `name`, `handle` UQ global (subdominio y URL del panel; CK formato `^[a-z0-9](-?[a-z0-9])*$`, 3–40 caracteres, no en lista reservada).
- `status` CK in (`draft`,`active`,`paused`,`suspended`,`closed`). `draft` = solo staff ve el storefront.
- `currency char(3)`, `country char(2)`, `timezone`, `locale default 'es-MX'`, `prices_include_tax bool`, `contact_email`, `contact_phone?`, `legal_name?`, `tax_id?`, `deleted_at?`.
- IX `(organization_id)`.

**store_members**
- PK `id`. `store_id` → stores CASCADE; `user_id` → auth.users CASCADE; `role_id` → roles RESTRICT.
- UQ `(store_id, user_id)` (un rol por tienda en el MVP; P2 permite varios con tabla puente). IX `(user_id)`.

**roles**
- PK `id`. `key` (p. ej. `store_admin`), `scope` CK in (`store`) (los de org y plataforma son enums fijos), `organization_id?` → organizations CASCADE (null = rol de sistema), `name`, `is_system bool`.
- UQ `(coalesce(organization_id, '00000000-...'), key)`.

**permissions** — PK `key text` (p. ej. `products.update`), `description`, `module`.

**role_permissions** — PK `(role_id, permission_key)`; FK → roles CASCADE, → permissions CASCADE.

#### Catalog

**brands** — PK `id`; UQ `(store_id, id)`; UQ `(store_id, slug)`; `name`, `slug`, `logo_path?`, `deleted_at?`.

**categories**
- PK `id`; UQ `(store_id, id)`; `parent_id?` → FK compuesta `(store_id, parent_id)` → categories(store_id, id) ON DELETE RESTRICT.
- `name`, `slug`, `path ltree` o `text` materializado (`ropa/hombre/playeras`), `depth smallint CK <= 4`, `position int`, `description?`, `seo_title?`, `seo_description?`, `image_path?`, `is_visible bool`, `deleted_at?`.
- UQ `(store_id, parent_id, slug)` (NULLS NOT DISTINCT) y UQ `(store_id, path)`.
- Trigger: impide ciclos (un padre no puede ser descendiente) y recalcula `path` de los descendientes al mover.

**products**
- PK `id`; UQ `(store_id, id)`; `brand_id?` → FK compuesta (store_id, brand_id) ON DELETE SET NULL (columna `brand_id` únicamente).
- `title`, `slug`, `description_html?` (sanitizado al guardar), `product_type` CK in (`physical`,`digital`,`service`), `status` CK in (`draft`,`active`,`archived`), `published_at?`, `has_variants bool` (derivado), `tags text[]`, `specs jsonb default '{}'`, `seo_title?`, `seo_description?`, `search_vector tsvector` (generada), `deleted_at?`.
- UQ parcial `(store_id, slug) where deleted_at is null`.
- IX `(store_id, status, published_at desc)`, GIN `(search_vector)`, GIN trigram `(title)`, GIN `(tags)`.

**product_options** — PK `id`; FK compuesta (store_id, product_id) → products CASCADE; `name`, `position`. UQ `(product_id, lower(name))`. CK máx. 3 opciones por producto (trigger).

**product_option_values** — PK `id`; FK compuesta (store_id, option_id) → product_options CASCADE; `value`, `position`. UQ `(option_id, lower(value))`.

**product_variants**
- PK `id`; UQ `(store_id, id)`; FK compuesta (store_id, product_id) → products ON DELETE CASCADE (borrado real solo si no hay pedidos; en la práctica se archiva).
- `sku?` (texto normalizado: trim + upper), `barcode?`, `price bigint CK >= 0`, `compare_at_price? bigint CK > price`, `weight_grams? int CK >= 0`, `length_mm?`, `width_mm?`, `height_mm?`, `image_id?` → FK compuesta product_media SET NULL, `status` CK in (`active`,`inactive`), `track_inventory bool default true`, `inventory_policy` CK in (`deny`,`continue`) (continue = bajo pedido), `requires_shipping bool`, `position`, `option_signature text` (valores de opción ordenados y concatenados), `deleted_at?`.
- UQ parcial `(store_id, sku) where sku is not null and deleted_at is null` → **SKU único por tienda**.
- UQ parcial `(store_id, barcode) where barcode is not null and deleted_at is null`.
- UQ `(product_id, option_signature) where deleted_at is null` → **impide combinaciones duplicadas** (dos "Negro / M").
- Producto simple = exactamente 1 variante con `option_signature = ''`. Así el carrito, el inventario y los pedidos siempre operan sobre variantes, sin ramas especiales.

**variant_option_values** — PK `(variant_id, option_value_id)`; FK compuestas CASCADE. Trigger: una variante tiene exactamente un valor por cada opción de su producto.

**variant_costs** — PK `variant_id` → FK compuesta (store_id, variant_id) CASCADE; `cost bigint CK >= 0`. Lectura solo con permiso `products.cost.read`.

**product_categories** — PK `(product_id, category_id)`; FK compuestas CASCADE; `is_primary bool`, `position`. UQ parcial `(product_id) where is_primary`.

**product_media**
- PK `id`; UQ `(store_id, id)`; FK compuesta (store_id, product_id) CASCADE.
- `type` CK in (`image`,`video`), `storage_path`, `alt_text?`, `width?`, `height?`, `position`, `bytes`, `mime_type`.
- UQ `(product_id, position)` DEFERRABLE (para reordenar).

#### Inventory

**inventory_locations** — PK `id`; UQ `(store_id, id)`; `name`, `is_default bool`, `address jsonb?`, `is_active`. UQ parcial `(store_id) where is_default`.

**inventory_levels**
- PK `id`; UQ `(variant_id, location_id)`; FK compuestas → product_variants CASCADE, → inventory_locations RESTRICT.
- `on_hand int not null default 0`, `reserved int not null default 0`, `incoming int not null default 0`, `low_stock_threshold? int`.
- CK `reserved >= 0`, `incoming >= 0`, `on_hand >= 0` (siempre); la regla `on_hand >= reserved` se aplica en la función de reserva según `inventory_policy`.
- `available` = `on_hand - reserved` (columna generada).
- IX `(store_id, location_id)`, IX parcial para stock bajo.

**inventory_movements** (append-only)
- PK `id`; `store_id`; FK `level_id` → inventory_levels RESTRICT.
- `type` CK in (`purchase`,`sale`,`return`,`adjustment`,`damage`,`loss`,`transfer_in`,`transfer_out`,`reservation`,`release`,`initial`).
- `quantity_delta int` (afecta `on_hand`), `reserved_delta int` (afecta `reserved`), `reason?`, `reference_type?` (`order`,`refund`,`import`,`purchase_order`,`manual`), `reference_id?`, `actor_user_id?`, `on_hand_after`, `reserved_after`, `idempotency_key?`.
- UQ parcial `(store_id, idempotency_key) where idempotency_key is not null`.
- Sin UPDATE ni DELETE (privilegios revocados + trigger que lanza excepción).

**stock_reservations**
- PK `id`; `store_id`; `variant_id`, `location_id`, `quantity CK > 0`, `cart_id?`, `order_id?`, `status` CK in (`active`,`consumed`,`released`,`expired`), `expires_at`.
- IX `(status, expires_at) where status='active'`.

#### Commerce

**carts**
- PK `id`; `store_id`; `token_hash` UQ (el token en cookie httpOnly; en la base solo su hash), `customer_id?`, `currency`, `email?`, `status` CK in (`active`,`converted`,`abandoned`), `discount_code?`, `last_activity_at`, `expires_at`, `recovery_email_sent_at?`.
- IX `(store_id, status, last_activity_at)`.

**cart_items** — PK `id`; FK compuestas → carts CASCADE, → product_variants CASCADE; `quantity CK between 1 and 999`; UQ `(cart_id, variant_id)`. **Sin precio**: el precio se calcula siempre en vivo.

**store_counters** — PK `(store_id, key)`; `value bigint`. `key='order_number'`. Incremento con `UPDATE ... SET value = value + 1 RETURNING value` dentro de la transacción del pedido. Esto garantiza números secuenciales sin huecos por concurrencia, a costo de serializar la creación de pedidos por tienda (aceptable hasta cientos de pedidos por minuto por tienda).

**orders**
- PK `id`; UQ `(store_id, id)`; UQ `(store_id, number)`.
- `number bigint` (mostrado como `#1001` + prefijo configurable), `customer_id?` → FK compuesta SET NULL, `email`, `phone?`, `currency`.
- Estados: `status` CK in (`pending_payment`,`open`,`completed`,`cancelled`), `payment_status` CK in (`unpaid`,`pending`,`authorized`,`paid`,`partially_refunded`,`refunded`,`failed`,`voided`), `fulfillment_status` CK in (`unfulfilled`,`partially_fulfilled`,`fulfilled`,`partially_returned`,`returned`).
- Totales (bigint): `subtotal`, `discount_total`, `shipping_total`, `tax_total`, `total`, `refunded_total`. CK `total = subtotal - discount_total + shipping_total + tax_total` (cuando los precios no incluyen impuesto; con impuesto incluido, `tax_total` es informativo y no suma; se resuelve con un CK condicional sobre `prices_include_tax`).
- `prices_include_tax bool` (snapshot), `shipping_rate_snapshot jsonb`, `discount_snapshot jsonb?`, `customer_note?`, `staff_note?`, `cancel_reason?`, `cancelled_at?`, `paid_at?`, `placed_at`, `source` CK in (`storefront`,`admin`,`api`), `guest_access_token_hash`, `checkout_idempotency_key` UQ `(store_id, checkout_idempotency_key)`.
- IX `(store_id, placed_at desc)`, `(store_id, status, payment_status)`, `(store_id, customer_id)`, `(store_id, lower(email))`.

**order_items** (snapshot inmutable)
- PK `id`; FK compuesta (store_id, order_id) → orders RESTRICT.
- `variant_id?` y `product_id?`: **sin FK compuesta**, solo FK simple con ON DELETE SET NULL. El pedido no depende del catálogo vivo.
- Snapshot: `product_title`, `variant_title`, `sku?`, `option_values jsonb`, `image_path?`, `product_type`, `requires_shipping`, `weight_grams?`, `unit_price`, `compare_at_price?`, `quantity CK > 0`, `discount_allocation`, `tax_lines jsonb`, `line_total`, `fulfilled_quantity`, `refunded_quantity`.
- CK `fulfilled_quantity <= quantity`, `refunded_quantity <= quantity`.
- Inmutable tras crearse, salvo `fulfilled_quantity` y `refunded_quantity` (trigger).

**order_addresses** — PK `id`; FK compuesta → orders CASCADE; `type` CK in (`shipping`,`billing`); campos de dirección; UQ `(order_id, type)`.

**order_events** — PK `id`; FK compuesta → orders RESTRICT; `type` (`status_changed`,`payment_*`,`fulfillment_*`,`note`,`email_sent`,`refund_*`), `from_value?`, `to_value?`, `message?`, `actor_type` CK in (`customer`,`staff`,`system`,`provider`), `actor_user_id?`, `metadata jsonb`. Append-only.

**payment_accounts**
- PK `id`; UQ `(store_id, id)`; `provider` CK in (`mercadopago`,`stripe`,`manual`), `mode` CK in (`test`,`live`), `display_name`, `status` CK in (`pending`,`active`,`disabled`,`error`), `public_config jsonb` (public key, etc.), `secret_ref uuid` (id en Supabase Vault; **nunca** el secreto en una columna), `webhook_secret_ref uuid?`, `enabled_methods text[]`.
- UQ parcial `(store_id, provider, mode) where status <> 'disabled'`.

**payments**
- PK `id`; FK compuestas → orders RESTRICT, → payment_accounts RESTRICT.
- `provider`, `provider_payment_id?`, `provider_checkout_id?`, `amount`, `currency`, `status` CK in (`created`,`pending`,`authorized`,`succeeded`,`failed`,`cancelled`,`expired`), `method?`, `failure_code?`, `raw_last_status jsonb?` (sin PAN ni datos sensibles), `idempotency_key` UQ.
- UQ parcial `(provider, provider_payment_id) where provider_payment_id is not null`.

**payment_events** (webhooks entrantes)
- PK `id`; `payment_account_id`; `provider`, `provider_event_id`, `event_type`, `signature_valid bool`, `payload jsonb` (sanitizado), `received_at`, `processed_at?`, `processing_error?`, `attempts`.
- UQ `(provider, payment_account_id, provider_event_id)` → **idempotencia**.

**refunds** — PK `id`; FK compuestas → orders, payments RESTRICT; `amount CK > 0`, `reason?`, `status` CK in (`pending`,`succeeded`,`failed`), `provider_refund_id?`, `restock bool`, `items jsonb` (variante y cantidad), `created_by`, `idempotency_key` UQ. CK en función: suma de reembolsos ≤ monto cobrado.

**discounts**
- PK `id`; UQ `(store_id, id)`; `code citext?` (null = automática, P2), `type` CK in (`percentage`,`fixed_amount`,`free_shipping`), `value bigint` (para porcentaje, puntos base 0–10000), `min_subtotal?`, `starts_at?`, `ends_at?`, `usage_limit?`, `usage_limit_per_customer?`, `times_used int`, `status` CK in (`active`,`disabled`), `applies_to` CK in (`all`,`categories`,`products`) + tabla puente P2.
- UQ parcial `(store_id, code) where code is not null`.

**discount_redemptions** — PK `id`; `discount_id`, `order_id` UQ (un descuento por pedido en el MVP), `customer_id?`, `email`, `amount`. El incremento de `times_used` y la validación del límite ocurren en la misma transacción del pedido con `UPDATE ... WHERE times_used < usage_limit`.

**tax_rates** — PK `id`; `store_id`; `name`, `rate_bps int` (1600 = 16%), `country`, `region?`, `applies_to_shipping bool`, `is_default bool`. P2: clases de impuesto por producto.

#### Customers

**customers**
- PK `id`; UQ `(store_id, id)`; `user_id?` → auth.users ON DELETE SET NULL; `email citext`, `first_name?`, `last_name?`, `phone?`, `accepts_marketing bool default false`, `marketing_consent_at?`, `orders_count`, `total_spent` (denormalizados, mantenidos por la función de pedido), `note?`, `deleted_at?`.
- UQ `(store_id, email)`; UQ parcial `(store_id, user_id) where user_id is not null`.
- Un mismo usuario puede ser cliente de varias tiendas con filas distintas. Ninguna tienda ve las filas de otra.

**customer_addresses** — PK `id`; FK compuesta → customers CASCADE; campos de dirección; `is_default bool`; UQ parcial `(customer_id) where is_default`.

#### Shipping

**shipping_zones** — PK `id`; UQ `(store_id, id)`; `name`, `countries char(2)[]`, `regions text[]?`.
**shipping_rates** — PK `id`; FK compuesta → shipping_zones CASCADE; `name`, `type` CK in (`flat`,`free_over`,`pickup`), `price bigint`, `free_over_subtotal?`, `min_weight_g?`, `max_weight_g?`, `estimated_days_min?`, `estimated_days_max?`, `is_active`.
**shipments** — PK `id`; FK compuesta → orders RESTRICT; `status` CK in (`pending`,`shipped`,`delivered`,`returned`,`cancelled`), `carrier?`, `tracking_number?`, `tracking_url?` (validada: solo `https`), `shipped_at?`, `delivered_at?`.
**shipment_items** — PK `(shipment_id, order_item_id)`; `quantity CK > 0`. La función valida que la suma enviada ≤ cantidad pedida.

#### Storefront

**store_domains**
- PK `id`; FK → stores CASCADE; `hostname citext` **UQ global**, `type` CK in (`platform_subdomain`,`custom`), `status` CK in (`pending`,`verifying`,`active`,`failed`,`removed`), `is_primary bool`, `verification_token?`, `verified_at?`, `last_checked_at?`, `provider_ref?`.
- UQ parcial `(store_id) where is_primary`.

**store_themes** (1:1) — PK `store_id`; `theme_key`, `theme_version`, `settings jsonb` (tokens), `home_sections jsonb`, `draft_settings jsonb?`, `draft_home_sections jsonb?`, `published_at`. Validado contra un esquema Zod del tema en el servidor y con CK `jsonb_typeof = 'object'`.

**menus** — PK `id`; UQ `(store_id, handle)` (`main`, `footer`). **menu_items** — PK `id`; FK compuesta → menus CASCADE; `parent_id?`; `label`, `link_type` CK in (`category`,`product`,`page`,`collection`,`url`,`home`,`search`), `target_id?`, `url?` (CK: https o ruta relativa), `position`. Máximo 2 niveles.

**store_pages** — PK `id`; UQ `(store_id, slug)`; `title`, `body_html` (sanitizado), `type` CK in (`content`,`policy_privacy`,`policy_terms`,`policy_returns`,`policy_shipping`), `is_published`, SEO.

#### SaaS y System
Especificados en §26, §27, §28 y §19.

### 8.3 Cardinalidades destacadas
- **1:1** — `auth.users`↔`profiles`; `stores`↔`store_themes`; `product_variants`↔`variant_costs`; `organizations`↔`subscriptions` (la vigente).
- **1:N** — organización→tiendas; tienda→todo lo de comercio; producto→variantes; pedido→items/pagos/eventos/envíos; pago→reembolsos.
- **N:M** — usuarios↔organizaciones; usuarios↔tiendas; roles↔permisos; productos↔categorías; variantes↔valores de opción; (P2) productos↔colecciones/tags.

### 8.4 Cómo se evita cada inconsistencia

| Riesgo | Mecanismo en la base de datos | Mecanismo en la aplicación |
|---|---|---|
| Productos duplicados | UQ `(store_id, slug)`; en importación, coincidencia por `handle` o SKU (upsert explícito). | Advertencia de título similar (trigram) al crear. |
| SKU duplicados | UQ parcial `(store_id, sku)`, normalizado (trim/upper) por trigger. | Validación inline en el formulario. |
| Variantes duplicadas | UQ `(product_id, option_signature)`. | Generador de combinaciones. |
| Categorías inconsistentes | FK compuesta del padre, trigger anti-ciclos, `depth <= 4`, `path` mantenido por trigger, UQ `(store_id, path)`. | Árbol con arrastrar y soltar que llama a una sola RPC `move_category`. |
| Referencias huérfanas | FK en todas las relaciones; `RESTRICT` por defecto; `CASCADE` solo en hijos sin vida propia (opciones, imágenes, items de carrito). | — |
| Referencias cross-tenant | **FK compuestas `(store_id, x_id)`.** | Contexto de tienda resuelto en el servidor. |
| Stock negativo | CK `on_hand >= 0`, `reserved >= 0`; actualización condicional atómica. | — |
| Pedidos inconsistentes | CK de totales; transiciones validadas por trigger `orders_state_guard`; items inmutables; pedidos nunca borrables (DELETE revocado). | El pedido se crea solo vía la RPC `place_order`. |
| Doble cobro / doble pedido | UQ `checkout_idempotency_key`; UQ `payment_events`; UQ `(provider, provider_payment_id)`. | Botón de pago deshabilitado tras el primer clic. |

### 8.5 Política de borrado (cascade)

| Entidad | Al "eliminar" desde la UI | Borrado físico |
|---|---|---|
| Organización / tienda | `status = closed` + `deleted_at`. Storefront desactivado. | Job de plataforma tras el periodo de retención (Q12, [DEF] 90 días), con export previo. |
| Producto | Si nunca se vendió: borrado real (cascada a opciones, variantes e imágenes). Si se vendió: `archived` + `deleted_at`. | — |
| Categoría | Soft delete; sus productos pierden la relación. Bloqueado si tiene hijos. | — |
| Cliente | Soft delete + anonimización a petición (derecho ARCO/GDPR): se borran PII de `customers` y `order_addresses`, se conservan importes. | — |
| Pedido, pago, reembolso, movimiento, auditoría | **Nunca.** | — |

---

## 9. RLS Strategy

### 9.1 Principios
1. **RLS habilitado y forzado (`FORCE ROW LEVEL SECURITY`) en el 100% de las tablas de `public`.** Una prueba de CI falla si una tabla no lo tiene (§23).
2. Sin políticas = sin acceso. Ninguna tabla tiene `USING (true)` para `authenticated`.
3. **Permisos en una sola función** reutilizada por todas las políticas:
   - `app.has_store_permission(p_store_id uuid, p_permission text) returns boolean` — `STABLE`, `SECURITY DEFINER`, `search_path = ''`. Lógica: `auth.uid()` es miembro de la tienda con un rol que incluye el permiso, **o** es `org_owner`/`org_admin` de la organización dueña de la tienda, y la tienda y la organización no están suspendidas. Los *platform admins* **no** pasan por aquí (ver §9.4).
   - `app.is_store_member(p_store_id)` para lecturas genéricas.
   - En las políticas se usa `(select auth.uid())` y `(select app.has_store_permission(store_id, 'x'))` para que Postgres evalúe una vez por consulta (initPlan) y no por fila.
4. Índices en `store_id` (prefijo) en todas las tablas, y en `store_members(user_id, store_id)`, para que la verificación sea barata.
5. **Las escrituras complejas no pasan por políticas de tabla.** Checkout, reservas, reembolsos, ajustes de stock y transiciones de pedido se hacen con funciones `SECURITY DEFINER` en `app` que verifican el permiso internamente y se exponen como RPC. Las tablas correspondientes **no** tienen política de INSERT/UPDATE para `authenticated`.

### 9.2 Matriz por tabla (MVP)

Notación: `perm(x)` = `app.has_store_permission(store_id, 'x')`; `member` = `app.is_store_member(store_id)`; `pub` = condición pública (§9.3); `RPC` = solo mediante función; `—` = denegado; `SR` = solo service role.

| Tabla | store_id | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| profiles | no | propio (`id = uid`) + co-miembros (nombre/avatar vía vista) | trigger al registrarse | propio | — |
| platform_staff | no | propio | SR | SR | SR |
| organizations | no (es la raíz) | miembros de la org | RPC `create_organization` (plataforma) | org_owner/org_admin (campos no sensibles) | — |
| organization_members | no (`organization_id`) | miembros de la org | RPC (aceptar invitación) | RPC (`change_member_role`) | RPC |
| organization_invitations | `organization_id` | org_admin+ / `perm(staff.manage)` | RPC | — | RPC |
| stores | es la raíz | member; anon: solo campos públicos vía vista `storefront_stores` | RPC (límite de plan) | `perm(settings.update)` | — |
| store_members | sí | member | RPC | RPC | RPC |
| roles / role_permissions / permissions | no | authenticated (catálogo de sistema) | SR | SR | SR |
| brands, categories | sí | member; anon: pub | `perm(products.create)` | `perm(products.update)` | `perm(products.delete)` |
| products, product_options, product_option_values, product_variants, variant_option_values, product_categories, product_media | sí | member; anon: pub | `perm(products.create)` | `perm(products.update)` | `perm(products.delete)` |
| variant_costs | sí | `perm(products.cost.read)` | `perm(products.update)` | `perm(products.update)` | — (cascada) |
| inventory_locations | sí | `perm(inventory.read)` | `perm(inventory.manage_locations)` | idem | — |
| inventory_levels | sí | `perm(inventory.read)`; anon: solo un booleano de disponibilidad vía vista | RPC | RPC | — |
| inventory_movements | sí | `perm(inventory.read)` | RPC | — (inmutable) | — |
| stock_reservations | sí | `perm(inventory.read)` | RPC | RPC | — |
| carts, cart_items | sí | — (solo SR mediante el servicio de carrito con token) | SR | SR | SR |
| orders, order_items, order_addresses | sí | `perm(orders.read)`; comprador: `customer.user_id = uid` | RPC `place_order` | RPC | — |
| order_events | sí | `perm(orders.read)`; comprador: solo los `is_customer_visible` | RPC | — | — |
| payments, refunds | sí | `perm(orders.read)` | RPC / SR | RPC / SR | — |
| payment_events | sí | `perm(settings.payments)` | SR | SR | — |
| payment_accounts | sí | `perm(settings.payments)` (sin `secret_ref`, vía vista) | RPC | RPC | RPC (desactivar) |
| discounts | sí | `perm(marketing.read)` | `perm(marketing.manage)` | idem | idem |
| discount_redemptions | sí | `perm(orders.read)` | RPC | — | — |
| customers, customer_addresses | sí | `perm(customers.read)`; comprador: propio | RPC / comprador propio (direcciones) | `perm(customers.update)` / comprador propio | `perm(customers.delete)` / comprador (direcciones) |
| shipping_zones, shipping_rates, tax_rates | sí | member; anon: pub (tarifas activas de tiendas activas) | `perm(settings.shipping)` / `perm(settings.taxes)` | idem | idem |
| shipments, shipment_items | sí | `perm(orders.read)`; comprador: propio | RPC (`perm(orders.fulfill)`) | RPC | — |
| store_domains | sí | member; anon: — (la resolución usa SR con caché) | RPC (`perm(settings.domains)`) | RPC | RPC |
| store_themes, menus, menu_items, store_pages | sí | member; anon: pub (publicados) | `perm(appearance.update)` | idem | idem |
| plans, plan_entitlements | no | authenticated (planes públicos) | SR | SR | SR |
| subscriptions, organization_entitlement_overrides | `organization_id` | org_owner/org_admin | SR | SR | SR |
| feature_flags, overrides | no | vía función `app.flag_enabled()` | SR | SR | SR |
| jobs, notification_outbox | sí | — | RPC (`enqueue`) | SR | SR |
| import_jobs, import_job_rows | sí | `perm(products.import)` | RPC | SR | — |
| audit.audit_logs | sí (null para plataforma) | `perm(audit.read)` (vía RPC paginada) | trigger / función | — | — |
| security_events | opcional | plataforma | SR | — | — |

### 9.3 Lectura pública (anon) — la condición `pub`
Para catálogo, tema y páginas, el comprador anónimo lee **solo** si se cumplen todas estas condiciones:
- la tienda está `active` (o `draft` y el lector es miembro: preview);
- la organización está `active`;
- el registro está publicado (`status = 'active'`, `published_at <= now()`, `deleted_at is null`);
- para variantes, también el producto padre cumple lo anterior.

Para que `anon` no pueda enumerar todo el catálogo de **todas** las tiendas en una sola consulta (técnicamente estarían permitidas, porque es público, pero facilita el scraping cruzado y la enumeración de tenants), el storefront **no** consulta PostgREST desde el navegador. Las lecturas ocurren en el servidor (RSC) con filtro explícito por `store_id`, y el rol `anon` del API público de Supabase puede quedar restringido a vistas `storefront_*` con columnas mínimas. [DEC] MVP: las tablas no se exponen a `anon` por PostgREST (se revoca `select` a `anon` en `public` salvo vistas). El storefront usa un cliente de servidor que pasa `store_id` explícito y aplica las mismas condiciones. Ver ADR-005.

### 9.4 Actores especiales

| Actor | Cómo accede | Controles |
|---|---|---|
| **anon** | Solo vistas públicas, y solo desde el servidor. | Rate limit por IP y por tienda. |
| **authenticated (staff)** | RLS con `has_store_permission`. | MFA obligatorio para `org_owner`, `org_admin` y `store_admin` (P2: obligatorio para todos). |
| **authenticated (comprador)** | Solo filas donde `customers.user_id = auth.uid()` **y** `store_id` = tienda actual. Como el JWT es global, la política siempre exige un `store_id`; un comprador que inicia sesión en la tienda A no ve en la tienda A pedidos de la tienda B, porque las consultas se filtran por la tienda del host. | Cookie de sesión por dominio de tienda. |
| **service_role** | Omite RLS. Solo en `src/server/privileged/*`. | Toda función privilegiada recibe `store_id` explícito, lo usa en cada consulta y escribe `audit_logs` con `actor_type = 'system'`. Las FK compuestas siguen impidiendo referencias cruzadas. |
| **Operaciones de servidor** | Server Actions con el JWT del usuario (RLS activo) — por defecto. | Doble verificación: `requirePermission()` en TS (para UX y error claro) + RLS/RPC en la base de datos (garantía). |
| **Platform admin** | **Nunca por RLS sobre datos de tenant.** Usa la consola de plataforma, que llama a funciones `app.platform_*` SECURITY DEFINER que verifican `platform_staff` y registran cada lectura de datos de tenant en `audit_logs` y `security_events`. | "Acceso de soporte": sesión de soporte con motivo obligatorio, de solo lectura por defecto, con expiración de 60 minutos y notificación visible al `org_owner` (P2). |
| **Background jobs** | Service role vía `/api/jobs/run` autenticado por HMAC. | El payload lleva `store_id`; el worker valida que la entidad pertenece a esa tienda antes de actuar. |
| **Webhooks** | Service role tras verificar la firma. | La tienda se deriva de `payment_account_id` en la URL, se verifica la firma con el secreto de **esa** cuenta y se re-consulta el estado en la API del proveedor. Ver §14. |

### 9.5 Riesgos específicos y mitigación

| Riesgo | Vector | Mitigación |
|---|---|---|
| IDOR | `GET /admin/tienda-a/pedidos/{id-de-tienda-b}` | RLS filtra por permiso de la tienda del registro, no de la URL; la consulta devuelve 0 filas → 404. Pruebas explícitas (§23.3). |
| Escalada de privilegios | Un `store_admin` se asigna `org_owner`, o edita `store_members` directamente | Sin política de escritura directa en las tablas de membresía; RPC `change_member_role` que impide asignar un rol superior al propio y modificar al `org_owner`. |
| Enumeración de tenants | Probar handles o IDs | UUIDs; respuestas genéricas idénticas para "no existe" y "sin permiso"; rate limit en resolución de hosts y en login. |
| Fuga accidental | Endpoint nuevo que usa service role sin filtrar | Lint que prohíbe importar el cliente privilegiado fuera de su carpeta; revisión obligatoria de esa carpeta (CODEOWNERS); FK compuestas como red de seguridad. |
| Columnas sensibles | anon o staff sin permiso lee `cost`, `secret_ref` o PII | Costos en tabla separada; secretos en Vault; vistas sin columnas sensibles; `REVOKE` de columnas donde aplique. |
| Funciones SECURITY DEFINER inseguras | `search_path` manipulable | `set search_path = ''` y nombres calificados en todas; `REVOKE EXECUTE ... FROM public` y `GRANT` explícito solo a los roles necesarios; Supabase advisors en CI. |
| Vistas que omiten RLS | Las vistas corren como su dueño | Vistas con `security_invoker = true`. |
| Realtime | Supabase Realtime podría transmitir cambios | No se habilita Realtime en el MVP. Si se usa después, solo en tablas con RLS y canales filtrados por `store_id`. |

### 9.6 Ejemplo conceptual (no implementación)

```
-- Concepto: products
policy products_select_staff  : for select to authenticated using ( (select app.is_store_member(store_id)) )
policy products_insert        : for insert to authenticated with check ( (select app.has_store_permission(store_id,'products.create')) )
policy products_update        : for update to authenticated using (... 'products.update') with check (... 'products.update')
policy products_delete        : for delete to authenticated using (... 'products.delete')
-- WITH CHECK en UPDATE impide "mover" un producto a otra tienda cambiando store_id;
-- además, trigger que prohíbe modificar store_id en cualquier tabla (columna inmutable).
```

**Regla global:** `store_id` es **inmutable** en todas las tablas (trigger genérico `prevent_store_id_change`).

---

## 10. RBAC

### 10.1 Evaluación de los roles propuestos

| Propuesto | Decisión | Motivo |
|---|---|---|
| PLATFORM_OWNER | ✅ `platform_owner` | Tú. Único con poder sobre `platform_staff`, planes y borrado de tenants. |
| PLATFORM_ADMIN | ✅ `platform_admin` | Gestiona tenants, planes, flags, suspensiones. No gestiona `platform_staff`. |
| — | ➕ `platform_support` | Necesario: soporte de solo lectura con sesiones auditadas. Evita dar `platform_admin` a todo el equipo. |
| STORE_OWNER | 🔁 = `org_owner` | El dueño es dueño del negocio (organización), no de una tienda suelta. Tiene todo en todas sus tiendas, más facturación y transferencia de propiedad. |
| — | ➕ `org_admin` | Socio o gerente general: todo excepto facturación, borrado de la organización y transferencia de propiedad. |
| — | ➕ `org_member` | Pertenece a la organización pero solo accede a las tiendas donde tiene `store_members`. |
| STORE_ADMIN | ✅ `store_admin` | Todo dentro de una tienda excepto facturación y dominios (configurable). |
| MANAGER | ❌ eliminado | Ambiguo; se solapa con `store_admin` y con los roles por área. |
| — | ➕ `catalog_manager` | Faltaba un rol para productos, categorías y marcas. |
| INVENTORY_MANAGER | ✅ | |
| ORDER_MANAGER | ✅ | Pedidos y envíos. Reembolsos como permiso separado (`orders.refund`), asignado por defecto. |
| MARKETING_MANAGER | ✅ | Descuentos, apariencia y contenido (P2: campañas). |
| SUPPORT | ✅ | Leer pedidos y clientes, agregar notas, editar datos de contacto; sin reembolsos ni costos. |
| VIEWER | ✅ | Solo lectura; sin PII de clientes (configurable) ni costos. |

### 10.2 Catálogo de permisos (MVP)

```
catalog:     products.read · products.create · products.update · products.delete
             products.publish · products.import · products.export · products.cost.read
inventory:   inventory.read · inventory.adjust · inventory.manage_locations
orders:      orders.read · orders.update · orders.fulfill · orders.cancel · orders.refund
             orders.export · orders.create (pedidos manuales, P2)
customers:   customers.read · customers.update · customers.delete · customers.export
marketing:   marketing.read · marketing.manage
appearance:  appearance.update · content.update
analytics:   analytics.read
settings:    settings.read · settings.update · settings.payments · settings.shipping
             settings.taxes · settings.domains · settings.notifications
staff:       staff.read · staff.manage
audit:       audit.read
org (implícitos por rol de organización, no asignables por tienda):
             org.billing · org.stores.create · org.delete · org.transfer_ownership
```

### 10.3 Matriz rol → permisos (MVP)

| Permiso \ Rol | store_admin | catalog_mgr | inventory_mgr | order_mgr | marketing_mgr | support | viewer |
|---|---|---|---|---|---|---|---|
| products.read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| products.create/update/publish | ✅ | ✅ | — | — | — | — | — |
| products.delete | ✅ | ✅ | — | — | — | — | — |
| products.import/export | ✅ | ✅ | — | — | — | — | — |
| products.cost.read | ✅ | ✅ | ✅ | — | — | — | — |
| inventory.read | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| inventory.adjust | ✅ | — | ✅ | — | — | — | — |
| inventory.manage_locations | ✅ | — | ✅ | — | — | — | — |
| orders.read | ✅ | — | ✅ | ✅ | — | ✅ | ✅ |
| orders.update/fulfill | ✅ | — | — | ✅ | — | — | — |
| orders.cancel/refund | ✅ | — | — | ✅ | — | — | — |
| orders.export | ✅ | — | — | ✅ | — | — | — |
| customers.read | ✅ | — | — | ✅ | ✅ | ✅ | — |
| customers.update | ✅ | — | — | ✅ | — | ✅ | — |
| customers.delete/export | ✅ | — | — | — | — | — | — |
| marketing.read/manage | ✅ | — | — | — | ✅ | — | (read) |
| appearance/content.update | ✅ | — | — | — | ✅ | — | — |
| analytics.read | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| settings.read | ✅ | — | — | — | — | — | ✅ |
| settings.update/shipping/taxes/notifications | ✅ | — | — | — | — | — | — |
| settings.payments, settings.domains | ✅* | — | — | — | — | — | — |
| staff.read | ✅ | — | — | — | — | — | — |
| staff.manage | ✅** | — | — | — | — | — | — |
| audit.read | ✅ | — | — | — | — | — | — |

\* Configurable por la organización: [DEF] `store_admin` sí lo tiene; el `org_owner` puede quitarlo (P2).
\*\* `store_admin` no puede invitar ni asignar `store_admin`; solo roles inferiores. Solo `org_owner`/`org_admin` crean `store_admin`.

`org_owner` y `org_admin` = todos los permisos de tienda en todas las tiendas de la organización (resuelto en `has_store_permission`).

### 10.4 Reglas de aplicación
- **Fuente de verdad de permisos en código**: `src/modules/access/permissions.ts` (constantes tipadas). Una migración o seed sincroniza la tabla `permissions` y los roles del sistema. Un test verifica que código y base coinciden.
- **Servidor:** `requirePermission(ctx, 'orders.refund')` al inicio de cada Server Action y Route Handler. Lanza `ForbiddenError` → 403 o 404 según el caso.
- **Base de datos:** RLS y RPC verifican de nuevo. Si el TS se equivoca, la base de datos rechaza.
- **UI:** `can('orders.refund')` oculta o deshabilita controles. Es solo UX, nunca seguridad.
- El conjunto de permisos del usuario por tienda se carga una vez por request (`getStoreContext()`, cacheado con `React.cache`).

### 10.5 Evolución a permisos personalizados (P2)
1. `roles.organization_id` no nulo = rol personalizado de esa organización (ya previsto en el esquema).
2. UI "Duplicar rol del sistema y editar permisos".
3. Restricción: un rol personalizado no puede incluir permisos `org.*` ni exceder los del creador.
4. P2+: varios roles por miembro (tabla `store_member_roles`) y permisos condicionados (por ubicación de inventario), solo si hay demanda real. Limitar por plan (`custom_roles`).

---

## 11. Catalog Architecture

### 11.1 Modelo
- **Producto** = contenido comercial (título, descripción, medios, categorías, SEO).
- **Opción** = dimensión de variación (máx. 3 por producto, máx. 100 variantes por producto en el MVP; ambos configurables como límite).
- **Variante** = unidad vendible con SKU, precio, precio comparativo, costo (tabla aparte), stock (vía `inventory_levels`), peso, dimensiones, imagen, barcode y estado.
- **Producto simple** = un producto con una sola variante implícita. La UI oculta la variante y edita sus campos como si fueran del producto. **Una sola ruta de código** para carrito, inventario y pedidos.

```
Playera (product, options: Color, Talla)
 ├── option Color: Negro, Blanco
 ├── option Talla: S, M, L
 └── variants (6) — option_signature "Color:Negro|Talla:S", ... cada una con sku, price, stock...
```

### 11.2 Generación y edición de variantes
- Al definir opciones y valores, la UI genera el producto cartesiano y el usuario desmarca las combinaciones que no existen.
- Agregar un valor nuevo crea solo las variantes nuevas; las existentes conservan SKU, precio y stock.
- Eliminar un valor de opción con variantes vendidas → esas variantes pasan a `inactive` (no se borran).
- Edición masiva en tabla: precio, SKU y stock por variante, con "aplicar a todas".

### 11.3 Tipos de producto

| Tipo | MVP | Implicaciones |
|---|---|---|
| `physical` | ✅ | `requires_shipping = true`, peso, inventario. |
| `digital` | Esquema sí; entrega **P2** | `requires_shipping = false`; requiere `digital_assets` en bucket privado + URL firmada con expiración y límite de descargas tras el pago. No se hace en el MVP porque exige un flujo de entrega propio. |
| `service` | Esquema sí; UI P2 | Sin envío ni inventario (`track_inventory = false`). Reservas o agenda: FUT. |
| Bajo pedido / preventa | ✅ vía `inventory_policy = 'continue'` | Se permite vender sin stock; la UI muestra "Bajo pedido" + días estimados (`variant.lead_time_days?`, P2). |

### 11.4 Categorías, marcas y colecciones
- Árbol de categorías con máximo 4 niveles; categoría principal por producto (para breadcrumb y URL canónica).
- Marcas: entidad simple con página propia (`/marca/[slug]`).
- Colecciones (P2): manuales (lista ordenada) o automáticas (reglas: tag, marca, precio, categoría), evaluadas con una consulta generada, no con lógica en TS.

### 11.5 Medios
- Imágenes en Storage (§Anexo C), con `position`, `alt_text` (obligatorio para publicar; advertencia en MVP) y dimensiones guardadas para evitar CLS.
- Variante → 0..1 imagen principal (referencia a `product_media`).

### 11.6 Precios
- `price` y `compare_at_price` en la variante. El rango "desde $X" se calcula con agregado y se denormaliza en `products.min_price` y `max_price` (trigger) para listados y ordenamiento.
- Precios con o sin IVA según `stores.prices_include_tax` ([DEF] incluidos, práctica común en retail mexicano; Q1).
- Historial de precios: lo cubre la auditoría (`product_variant.price` antes/después). Tabla dedicada en FUT si se requiere (por ejemplo, normas de "precio anterior" de PROFECO o la UE).

### 11.7 Publicación con validación [REQ de la conversación anterior, generalizado]
Un producto solo puede pasar a `active` si la función `app.validate_product_for_publish(product_id)` devuelve cero errores:
- al menos 1 variante activa con precio > 0 (o precio 0 permitido explícitamente);
- slug válido y único;
- al menos 1 imagen ([DEF] advertencia, no bloqueo);
- `compare_at_price > price` si existe;
- si `track_inventory` y `deny`: se permite publicar con stock 0 (se muestra "Agotado").

La misma idea se aplica a la tienda: `app.validate_store_for_launch(store_id)` exige método de pago activo, al menos una zona de envío (si hay productos físicos), políticas publicadas (privacidad, términos, devoluciones), datos de contacto y al menos un producto activo. Sin validación aprobada, la tienda no pasa de `draft` a `active`. **Así se impide que una configuración inválida llegue accidentalmente a producción.**

Este mecanismo es el punto de extensión para el módulo de cumplimiento futuro (reglas por jurisdicción, §32): validadores adicionales registrados por tipo de tienda, sin hardcodear reglas.

---

## 12. Inventory Architecture

### 12.1 Cantidades

| Campo | Significado |
|---|---|
| `on_hand` | Unidades físicamente en la ubicación. |
| `reserved` | Unidades comprometidas con checkouts en curso o pedidos pagados aún no enviados. |
| `available` | `on_hand - reserved` (generada). Lo que puede venderse. |
| `incoming` | Unidades en órdenes de compra no recibidas (P2). Informativo; no vendible. |

### 12.2 Movimientos y su efecto

| Tipo | Δ on_hand | Δ reserved | Cuándo |
|---|---|---|---|
| `initial` | +n | 0 | Alta o importación. |
| `purchase` | +n | 0 | Recepción de mercancía (P2: desde una OC; `incoming -n`). |
| `reservation` | 0 | +n | Se crea el pedido `pending_payment`. |
| `release` | 0 | −n | Pago fallido o expirado, pedido cancelado antes del envío. |
| `sale` | −n | −n | Fulfillment (envío) de un pedido pagado. |
| `return` | +n (si restock) | 0 | Devolución o reembolso con reingreso. |
| `adjustment` | ±n | 0 | Conteo físico, con motivo obligatorio. |
| `damage` / `loss` | −n | 0 | Merma, con motivo. |
| `transfer_out` / `transfer_in` | −n / +n | 0 | Entre ubicaciones (P2), en la misma transacción. |

[DEC] La venta descuenta `on_hand` **al enviar**, no al pagar. Al pagar, la unidad ya está en `reserved`. Así `on_hand` refleja lo físicamente presente y el panel puede mostrar "comprometido". Alternativa más simple (descontar al pagar) descartada porque mezcla "vendido" con "despachado" y complica las cancelaciones de pedidos pagados no enviados.

### 12.3 Consistencia transaccional
Toda modificación pasa por **una sola función**: `app.apply_inventory_movement(level_id, type, qty_delta, reserved_delta, reference, idempotency_key)`, que en una transacción:
1. `UPDATE inventory_levels SET on_hand = on_hand + Δ1, reserved = reserved + Δ2 WHERE id = $1 AND (on_hand + Δ1) >= 0 AND (reserved + Δ2) >= 0 AND (policy = 'continue' OR (on_hand + Δ1) >= (reserved + Δ2)) RETURNING ...`
2. Si actualiza 0 filas → `insufficient_stock` (error tipado).
3. Inserta `inventory_movements` con los valores resultantes (`on_hand_after`, `reserved_after`).
4. La idempotencia (UQ en `idempotency_key`) impide aplicar dos veces el mismo movimiento cuando se reintenta un webhook o un job.

### 12.4 Concurrencia y overselling
- **Actualización condicional atómica** (paso 1): dos compradores por la última unidad → Postgres serializa las dos `UPDATE` sobre la misma fila; la segunda no cumple el `WHERE` y falla limpiamente. Sin `SELECT ... FOR UPDATE` previo, sin ventanas de carrera.
- **Pedidos con varias líneas:** reservar en orden determinista (por `level_id` ascendente) para evitar deadlocks; si una línea falla, toda la transacción revierte.
- **Nivel de aislamiento:** READ COMMITTED basta gracias a la actualización condicional; no hace falta SERIALIZABLE.

### 12.5 Ciclo de reservas
1. **Carrito:** no reserva (evita que bots bloqueen stock). Se muestra el disponible en vivo.
2. **Checkout → "Pagar":** `place_order` crea el pedido `pending_payment` y las reservas (`stock_reservations.status = active`, `expires_at = now() + 30 min` [DEF], configurable; debe superar el tiempo máximo del proveedor de pago para pagos en efectivo — ver §14.6).
3. **Pago aprobado (webhook):** la reserva pasa a `consumed`; `reserved` se mantiene hasta el envío.
4. **Pago fallido, expirado o pedido cancelado:** `release` y reserva `released`/`expired`.
5. **Job cada minuto:** expira reservas vencidas y marca el pedido `cancelled` con `payment_status = 'expired'` (o `failed`).
6. **Pago aprobado después de expirar la reserva** (pago tardío, p. ej. OXXO): se intenta reservar de nuevo; si no hay stock → el pedido queda `open` con `payment_status = paid` y bandera `needs_attention` para reembolsar o surtir manualmente. **Nunca se pierde un pago.** Caso cubierto por pruebas.

### 12.6 Cancelaciones y devoluciones
- Cancelar pedido no enviado → `release` de lo reservado.
- Cancelar pedido pagado → `release` + reembolso (§14).
- Reembolso con `restock = true` de unidades enviadas → `return` (+on_hand).
- Devoluciones formales (RMA, inspección, estado de la mercancía) → P2 con `returns`.

### 12.7 Multi-almacén (preparado)
- El MVP crea una ubicación `is_default` por tienda; la UI no la muestra.
- P2: varias ubicaciones, prioridad de surtido, stock por ubicación en el panel, transferencias y asignación de ubicación por pedido (`order_items.location_id`).
- Al venderse, el "disponible del storefront" = suma de `available` de las ubicaciones activas (vista `variant_availability`).

---

## 13. Order Architecture

### 13.1 Estados — tres ejes [DEC]
Un solo enum lineal (`pending → paid → shipped...`) no representa casos reales: pagado pero parcialmente enviado; enviado y luego parcialmente reembolsado. Se separan:

```
status:              pending_payment → open → completed
                                  ↘ cancelled (desde pending_payment u open)
payment_status:      unpaid → pending → (authorized) → paid → partially_refunded → refunded
                                     ↘ failed / voided / expired
fulfillment_status:  unfulfilled → partially_fulfilled → fulfilled → (partially_)returned
```

Mapeo con tu lifecycle:

| Tu estado | Representación |
|---|---|
| cart | `carts.status = active` |
| checkout | Carrito con email, dirección y envío elegidos (estado de UI y servidor, sin tabla aparte) |
| pending_payment | `status = pending_payment`, `payment_status in (unpaid, pending)` |
| paid | `payment_status = paid`, `status = open` |
| processing | `status = open`, `fulfillment_status = unfulfilled` (se puede etiquetar en la UI como "Por preparar") |
| shipped | `fulfillment_status = fulfilled` + `shipments.status = shipped` |
| delivered | `shipments.status = delivered`; al entregarse todo → `status = completed` |
| cancelled | `status = cancelled` |
| payment_failed | `payment_status = failed` (el pedido se cancela al expirar) |
| refunded / partially_refunded | `payment_status` |
| returned | `fulfillment_status = returned` |

El **estado visible** (badge) se deriva con una función pura `deriveOrderDisplayStatus()`, probada exhaustivamente.

Transiciones válidas aplicadas por el trigger `orders_state_guard` (tabla de transiciones permitidas) y por las RPC. Toda transición inserta un `order_events`.

### 13.2 Número de pedido
- Secuencial por tienda desde 1001 ([DEF]), vía `store_counters`. Prefijo opcional por tienda (`#`, `AB-`).
- El número es **visible pero no es un secreto**. Para pedidos de invitado, la página de estado requiere `order_id` (UUID) + `guest_access_token` (en el enlace del email), o número + email + código OTP.

### 13.3 Snapshot
Al crearse, el pedido copia todo lo necesario para mostrarse, facturarse y auditarse sin consultar el catálogo:
- **Por línea:** título del producto y la variante, opciones, SKU, imagen (ruta), tipo, peso, precio unitario, precio comparativo, cantidad, descuento asignado y desglose de impuestos.
- **A nivel pedido:** email, teléfono, direcciones (`order_addresses`), tarifa de envío elegida (`shipping_rate_snapshot`), descuento aplicado (`discount_snapshot`), moneda, `prices_include_tax`, tasas de impuesto aplicadas.
- **Imágenes:** la ruta se copia; si el comerciante borra la imagen, el pedido muestra un placeholder. [DEF] No se duplican archivos. P2 opcional: copiar la miniatura a una carpeta `orders/` si se exige fidelidad visual.

### 13.4 Cálculo de totales (en el servidor, función única)
`app.calculate_cart(cart_id, shipping_rate_id?, discount_code?)` devuelve líneas, subtotal, descuento, envío, impuestos y total. La usan el carrito (vista previa), el checkout y `place_order`, que recalcula y **compara con el total que el cliente vio** (`expected_total`); si difiere (cambió un precio o venció un descuento), devuelve `price_changed` y la UI muestra el nuevo total antes de cobrar.

Orden de cálculo:
1. Subtotal = Σ precio × cantidad.
2. Descuento (prorrateado por línea, redondeo con el método del residuo mayor para que sume exacto).
3. Envío (sobre el subtotal ya descontado para "gratis desde X").
4. Impuestos sobre (línea − descuento) [+ envío si aplica].
5. Total.

Todo en enteros (centavos); redondeo *half-even* documentado y probado.

### 13.5 Impuestos [DEF] (depende de Q1)
- MVP: una tasa por tienda (`tax_rates.is_default`, p. ej. IVA 16%) con precios que **incluyen** impuesto. El impuesto se desglosa informativamente: `tax = round(price × rate / (1 + rate))`.
- Opción: precios sin impuesto (se suma al total).
- P2: tasas por región, clases de impuesto por producto (exento, tasa 0%).
- FUT: facturación electrónica (CFDI 4.0 en México vía PAC) como integración (`InvoicingProvider`). No es parte del MVP salvo que Q11 diga lo contrario.

### 13.6 Ediciones posteriores
- MVP: no se editan líneas de un pedido pagado. Se cancela o se reembolsa parcialmente.
- Notas internas y datos de contacto: editables, con auditoría.
- P2: pedidos manuales creados por staff (`orders.create`), con enlace de pago.

---

## 14. Payment Architecture

### 14.1 Modelo de negocio del cobro [DEF] (Q2)
**Cada tienda conecta su propia cuenta del proveedor** (la tienda es el *merchant of record*). La plataforma no toca el dinero de los compradores.
- Ventajas: la plataforma no se convierte en agregador ni facilitador de pagos (obligaciones regulatorias, KYC de submerchants, contracargos); cada tienda tiene su propia conciliación.
- Contras: el onboarding exige que cada tienda abra su cuenta; la plataforma no puede cobrar comisión por transacción automáticamente (se cobra vía suscripción). Mercado Pago (marketplace con `application_fee`) y Stripe Connect permiten comisión de plataforma después, en FUT, sin rehacer la abstracción.

### 14.2 Abstracción

```
interface PaymentProvider {
  key: 'mercadopago' | 'stripe' | 'manual'
  capabilities: { refunds: boolean; partialRefunds: boolean; redirectCheckout: boolean;
                  embeddedCheckout: boolean; delayedMethods: boolean /* OXXO, SPEI */ }
  createCheckout(input: { account, order, items, buyer, returnUrls, idempotencyKey }): Promise<{ redirectUrl?, clientSecret?, providerCheckoutId }>
  verifyWebhook(input: { account, headers, rawBody }): Promise<VerifiedWebhook | InvalidSignature>
  fetchPayment(input: { account, providerPaymentId }): Promise<NormalizedPayment>   // fuente de verdad
  refund(input: { account, payment, amount, idempotencyKey }): Promise<NormalizedRefund>
  validateCredentials(account): Promise<CredentialCheck>
}
NormalizedPayment.status ∈ created|pending|authorized|succeeded|failed|cancelled|expired
```

- Registro de adaptadores: `providers/payments/registry.ts`. El dominio (`modules/payments`) solo conoce la interfaz.
- [DEF] Proveedor 1: **Mercado Pago (Checkout Pro, redirección)**: menor alcance PCI (no se manejan datos de tarjeta, SAQ A) y soporta tarjetas, OXXO y SPEI. Proveedor 2 (P2): Stripe Checkout. `manual` (transferencia o efectivo con confirmación del staff) también en el MVP, porque es útil y barato.

### 14.3 Flujo

```
Comprador "Pagar"
 → Server Action placeOrder: place_order() [pedido pending_payment + reservas + payment(created)]
 → provider.createCheckout(idempotencyKey = payment.id)
 → redirige al proveedor
 → (vuelve a /checkout/resultado?order=...) — la página NO marca pagado; muestra "procesando" y consulta el estado
 → Webhook /api/webhooks/payments/{provider}/{payment_account_id}
     1. Leer raw body; verificar firma con el secreto de ESA cuenta; si es inválida → 401 + security_event
     2. Insert payment_events ON CONFLICT DO NOTHING (idempotencia); si ya fue procesado → 200
     3. provider.fetchPayment() — re-consultar en la API: nunca confiar en el payload
     4. Validar: monto == payment.amount, moneda == order.currency, referencia externa == order.id
     5. app.apply_payment_status(payment_id, normalized) → transiciona payment, order y reservas,
        y encola notificaciones (outbox); todo en una transacción
     6. 200 rápido (< 5 s); el trabajo pesado va al outbox
 → Job de reconciliación cada 10 min: pagos `pending` de más de 15 min → fetchPayment() (por si se perdió un webhook)
```

### 14.4 Idempotencia
- Hacia el proveedor: `idempotency_key = payment.id` / `refund.id`.
- Desde el proveedor: UQ en `payment_events` y aplicación de estado monótona (no se retrocede de `succeeded` a `pending`; tabla de transiciones permitidas).
- Desde el comprador: `checkout_idempotency_key` (generada al cargar el checkout y enviada con el formulario) → doble clic = el mismo pedido.

### 14.5 Reembolsos
- RPC `request_refund(order_id, amount, items[], restock, reason)` con `perm(orders.refund)`: valida que el total reembolsado ≤ cobrado, crea `refunds(pending)` → job o llamada al proveedor → webhook o respuesta → `succeeded` → actualiza `payment_status` y `refunded_total` → movimientos `return` si hay restock → evento y email.
- Proveedores sin reembolso por API (manual): se registra como manual con confirmación.

### 14.6 Particularidades
- **Métodos diferidos** (OXXO/SPEI): el pago puede llegar horas o días después. [DEF] Si la tienda habilita métodos diferidos, la reserva dura lo que la vigencia del voucher (configurable, p. ej. 48 h) o se acepta el riesgo de la §12.5 punto 6. Es una decisión por tienda en Ajustes → Pagos, con explicación en la UI.
- **Fraude (MVP):** se delega al antifraude del proveedor; rate limit de checkout por IP, email y tienda; límite de intentos de pago por pedido; CAPTCHA invisible (Turnstile) en checkout si el volumen de intentos fallidos supera un umbral. P2: reglas de riesgo (dirección distinta de facturación, monto alto) → `needs_review`.
- **Contracargos:** se registran desde webhook (`payment_events`) como `order_events` y alerta al staff. Gestión de disputas: P2.
- **Credenciales:** en Supabase Vault (`vault.secrets`); la tabla guarda solo `secret_ref`. Las lee únicamente el servidor privilegiado al momento de llamar al proveedor. Cambio de credenciales = nueva versión + `validateCredentials` antes de activarse.
- **Modo test/live:** por cuenta. Una tienda en `draft` puede usar test; para pasar a `active` exige una cuenta `live` válida (validación de lanzamiento §11.7).

---

## 15. Storefront Architecture

### 15.1 Resolución y renderizado
- `middleware`/`proxy` lee el `Host`, lo normaliza (minúsculas, sin puerto, sin `www.` según la configuración del dominio) y busca `store_id` y estado en caché (LRU en memoria por instancia con TTL de 60 s + `unstable_cache`/`use cache` con tag `domain:{hostname}`). Reescribe a `/_store/[storeId]/...` (ruta interna inaccesible directamente: bloqueada si llega sin la cabecera interna).
- Host desconocido → página "Tienda no encontrada" genérica (sin revelar si existió).
- Tienda `paused`/`suspended` → página de mantenimiento con `503` y `Retry-After`; `draft` → solo staff con sesión (preview).
- RSC por defecto. Componentes cliente solo para: selector de variantes, carrito (drawer), formularios de checkout, búsqueda con sugerencias y galería.

### 15.2 Rutas (español, fijas en el MVP [DEF])

| Ruta | Página | Render | Caché |
|---|---|---|---|
| `/` | Home (secciones del tema) | RSC estático + revalidación por tag | `store:{id}:home` |
| `/productos` | Catálogo completo con filtros | Dinámico (searchParams) con datos cacheados | `store:{id}:catalog` |
| `/productos/[slug]` | Producto | Estático por demanda + tag | `product:{id}` |
| `/categoria/[...path]` | Categoría (con anidación: `/categoria/ropa/hombre`) | igual que catálogo | `store:{id}:category:{id}` |
| `/marca/[slug]` | Marca | igual | |
| `/coleccion/[slug]` | Colección (P2) | | |
| `/buscar?q=` | Búsqueda | Dinámico, `noindex` | sin caché de página |
| `/carrito` | Carrito (también disponible como drawer) | Dinámico, `noindex` | no |
| `/checkout` | Checkout de una página | Dinámico, `noindex` | no |
| `/checkout/resultado` | Resultado / pendiente | Dinámico | no |
| `/pedido/[id]?t=` | Estado del pedido (invitado) | Dinámico, `noindex` | no |
| `/cuenta/ingresar` | Login (OTP por email) | | |
| `/cuenta` | Resumen | Dinámico | no |
| `/cuenta/pedidos`, `/cuenta/pedidos/[number]` | Pedidos | | |
| `/cuenta/direcciones` | Direcciones | | |
| `/cuenta/favoritos` | Wishlist (P2) | | |
| `/paginas/[slug]` | Contenido y políticas | Estático + tag | |
| `/sitemap.xml`, `/robots.txt` | SEO por tienda | Generado por host | 1 h |

Login y registro se unifican en una sola pantalla con OTP o *magic link*: menos fricción y menos contraseñas compartidas entre tiendas (ver ADR-006).

### 15.3 Navegación
- **Header:** logo, menú principal (`menus.main`), buscador, cuenta y carrito (con contador). En móvil: menú hamburguesa en drawer, buscador expandible y carrito fijo.
- **Footer:** menú del footer, políticas, contacto, redes sociales y medios de pago aceptados.
- **Breadcrumbs** en categoría y producto (basados en la categoría principal).

### 15.4 Checkout (una página, enfoque en conversión)
1. Contacto (email; teléfono opcional u obligatorio según la tienda) — compra como invitado por defecto; "¿Ya tienes cuenta?" opcional.
2. Entrega: dirección (autocompletar código postal → estado y municipio en P2) o recoger en tienda.
3. Método de envío (tarifas aplicables a la zona).
4. Código de descuento (colapsado).
5. Resumen fijo (desktop: columna derecha; móvil: acordeón superior con el total).
6. "Pagar $X" → proveedor.

Validación con el mismo esquema Zod en cliente y servidor; errores inline; nunca se borra lo capturado ante un error.

### 15.5 SEO del storefront
Ver Anexo C.4.

---

## 16. Admin Architecture

### 16.1 Estructura y navegación
- Host: `app.{plataforma}`. Rutas: `/admin/[storeHandle]/...`. Selector de tienda (si hay más de una) y de organización en el encabezado.
- Navegación lateral (desktop) o barra inferior más menú (móvil): **Inicio · Pedidos · Productos · Inventario · Clientes · Marketing · Apariencia · Ajustes**. Los elementos se ocultan según los permisos.
- Paleta de comandos (⌘K): ir a un pedido por número, a un producto por SKU o título, a ajustes (SHOULD).

### 16.2 Secciones y funcionalidades

| Sección | MVP | P2 |
|---|---|---|
| **Inicio (Dashboard)** | Ventas e ingresos (hoy, 7 y 30 días, con variación vs. el periodo anterior), pedidos, ticket promedio, clientes nuevos, top 5 productos, alertas de stock bajo, pedidos por preparar, checklist de lanzamiento (si la tienda está en `draft`). | Conversión (requiere eventos), gráfico por canal, comparativos personalizados. |
| **Productos** | Listado con búsqueda, filtros (estado, categoría, marca, stock) y orden; crear, editar, duplicar, archivar o eliminar; acciones masivas (publicar, archivar, asignar categoría, cambiar precio en %); importar y exportar CSV; categorías y marcas. | Colecciones, tags gestionables, atributos filtrables, edición masiva estilo hoja de cálculo. |
| **Inventario** | Tabla de stock por variante (on_hand, reservado, disponible), ajuste con motivo, historial de movimientos por variante, umbral y alerta de stock bajo. | Almacenes, transferencias, proveedores, órdenes de compra, conteos cíclicos. |
| **Pedidos** | Listado con filtros (estado, pago, envío, fecha, búsqueda por número, email o nombre), detalle con timeline, marcar como enviado (paquetería y guía), entregado, cancelar, reembolso total o parcial con restock, notas internas, reenviar email, imprimir hoja de surtido. | Devoluciones (RMA), pedidos manuales, edición de pedido, etiquetas de envío, exportación avanzada. |
| **Clientes** | Listado y búsqueda, perfil (datos, direcciones, pedidos, total gastado, consentimiento de marketing), editar, anonimizar. | Grupos, segmentos, notas con historial. |
| **Marketing** | Códigos de descuento (porcentaje, monto fijo, envío gratis; vigencia, mínimo, límites). | Promociones automáticas, carritos abandonados, suscriptores, campañas. |
| **Apariencia** | Branding (logo, favicon, colores, tipografía de una lista), secciones de la home (agregar, quitar, ordenar y editar de un catálogo fijo), menús, páginas y políticas, redes y contacto, con vista previa y "Publicar". | Más temas, CSS personalizado (con restricciones), traducciones. |
| **Ajustes** | Tienda (nombre, contacto, moneda, zona horaria, datos legales), Pagos (conectar cuenta, métodos), Envíos (zonas y tarifas), Impuestos, Notificaciones (destinatarios de alertas, remitente), Equipo (invitar, roles), Dominios (ver subdominio; dominio propio en P2), Plan y uso (solo lectura en MVP), Auditoría (registro de actividad). | API keys, webhooks, integraciones. |

### 16.3 Patrones del panel
- Listados con **paginación por cursor** (keyset), 25/50/100 filas, filtros reflejados en la URL (compartibles), columnas configurables (P2).
- Formularios largos (producto) con secciones, guardado explícito y protección de cambios sin guardar; **concurrencia optimista**: `updated_at` como versión; si otro usuario guardó antes → conflicto con opción de recargar.
- Acciones destructivas: confirmación con resumen ("Se archivarán 12 productos"); las irreversibles exigen escribir el nombre o número.
- Acciones masivas sobre más de 500 elementos → job asíncrono con progreso.

### 16.4 Super Admin (`/platform`)

| Módulo | MVP |
|---|---|
| Tenants | Listar y buscar organizaciones y tiendas, crear organización + tienda + invitar al dueño (onboarding asistido [DEF], Q9), suspender o reactivar, cerrar. |
| Planes | CRUD de planes y entitlements; asignar plan; overrides por organización. |
| Suscripciones | Estado manual (trial, active, past_due, cancelled), fechas y notas. |
| Feature flags | Globales y overrides. |
| Soporte | Sesión de soporte de solo lectura y auditada sobre una tienda. |
| Salud | Jobs fallidos, webhooks fallidos, errores recientes (enlace a Sentry), métricas agregadas (tiendas activas, GMV total, pedidos del día). |
| Auditoría | Eventos de seguridad y acciones de plataforma. |
| Staff de plataforma | Solo `platform_owner`. |

---

## 17. White-Label Architecture

### 17.1 Capas [DEC]

```
Tema (código versionado: layout, componentes, accesibilidad, SEO, rendimiento)   ← estructural, NO editable
  + Tokens de tema (settings jsonb validados)                                     ← configurable
  + Secciones de la home (lista ordenada de tipos predefinidos con sus props)     ← configurable
  + Contenido (menús, páginas, políticas, banners como props de sección)          ← configurable
```

### 17.2 Configurable (MVP)

| Grupo | Ajustes |
|---|---|
| Marca | Logo (claro/oscuro), favicon (genera los tamaños), nombre visible |
| Color | Primario, acento, fondo, texto. Se derivan automáticamente hover, bordes y estados. **Validación de contraste AA**: se rechaza o advierte si texto/fondo < 4.5:1. |
| Tipografía | Encabezados y cuerpo, de una lista curada (8–10 Google Fonts autoalojadas con `next/font`) |
| Forma | Radio de bordes (cuadrado, suave, redondeado), estilo de botón (sólido o contorno) |
| Header | Logo a la izquierda o al centro, barra de anuncio (texto + enlace + color), menú |
| Footer | Menú, texto legal, redes sociales, mostrar medios de pago |
| Home | Secciones: `hero` (imagen, título, CTA), `featured_products` (manual o "más vendidos"), `category_grid`, `promo_banner`, `image_with_text`, `brand_logos`, `testimonials` (texto estático), `newsletter` (P2), `rich_text`. Máximo 12 secciones. |
| Contacto | Email, teléfono, WhatsApp (enlace), dirección, horario |
| Políticas | Privacidad, términos, devoluciones, envíos (plantillas base editables, con el aviso de que el comerciante es responsable del contenido legal) |
| SEO global | Título, descripción, imagen social por defecto |

### 17.3 Estructural (no configurable en el MVP)
Estructura de páginas de producto, catálogo, carrito y checkout; orden de pasos del checkout; marcado semántico y SEO; comportamiento responsive; componentes de accesibilidad. Es lo que garantiza conversión, rendimiento y calidad en todas las tiendas, y reduce enormemente el costo de soporte.

### 17.4 Mecánica
- Los tokens se convierten en variables CSS (`--color-primary`, etc.) inyectadas en `<html>` por el layout del storefront. Tailwind consume las variables (`bg-[--color-primary]` vía tema). **Sin CSS arbitrario del comerciante** en el MVP: elimina un vector XSS completo.
- **Borrador → Publicar:** el editor escribe en `draft_settings`/`draft_home_sections`; la vista previa usa el borrador (solo staff, mediante una cookie de preview firmada); "Publicar" copia a los campos vigentes, invalida tags de caché y audita.
- Esquema por tema (`themes/{key}/schema.ts`, Zod). La base guarda `theme_version`; las migraciones de tema transforman settings viejos al cambiar de versión.
- MVP: **1 tema** bien hecho, flexible vía tokens. P2: 2–3 temas adicionales con el mismo contrato de secciones.

---

## 18. Domain Architecture

### 18.1 Tipos de host

| Host | Uso |
|---|---|
| `{plataforma}` / `www.{plataforma}` | Sitio de marketing del SaaS |
| `app.{plataforma}` | Panel de tiendas y Super Admin |
| `{handle}.{plataforma-tiendas}` | Storefront por subdominio |
| `www.tienda.com` / `tienda.com` | Dominio propio (P2) |

[DEC] Usar **un dominio raíz distinto para los storefronts** (p. ej. `{handle}.mitiendaonline.app`) respecto del dominio del panel. Motivo: aislamiento de cookies y de orígenes. Una vulnerabilidad XSS en una tienda no puede leer cookies de `app.` ni del dominio principal, y las tiendas no comparten "site" con el panel (protege contra ataques same-site y facilita la Public Suffix List). Si se usa el mismo dominio raíz, debe solicitarse su inclusión en la **Public Suffix List** para aislar cookies entre tiendas. Ver Q6 y ADR-011.

### 18.2 Subdominios (MVP)
- DNS wildcard `*.{dominio-tiendas}` → Vercel; certificado wildcard gestionado por Vercel.
- Lista reservada: `www, app, admin, api, platform, mail, static, assets, cdn, help, soporte, status, blog, docs, m, shop, store, tienda, test, staging, dev`, más términos ofensivos o de marcas de terceros (lista ampliable).
- Cambio de `handle`: permitido con redirección 301 desde el anterior durante 90 días (P2; MVP: solo platform admin).

### 18.3 Dominios propios (P2)
1. El comerciante ingresa `www.tienda.com` → `store_domains(status=pending)`; se valida el formato y que no exista en otra tienda.
2. `DomainProvider.add(hostname)` (Vercel Domains API) → devuelve los registros DNS requeridos (CNAME para `www`, A/ALIAS para el apex, TXT de verificación si el dominio está en otra cuenta de Vercel).
3. La UI muestra instrucciones paso a paso (con guías por registrador comunes).
4. Job de verificación (cada 5 min durante 72 h, luego diario) → `verifying` → `active`. El SSL lo emite Vercel automáticamente.
5. Marcar como primario → **canonical** y `sitemap` usan el primario; los demás hosts de la tienda (incluido el subdominio) responden 301 al primario.
6. Eliminación → `removed` + `DomainProvider.remove`.
7. Límite por plan (`max_custom_domains`).

### 18.4 Implicaciones con Supabase Auth
- La sesión del comprador vive en cookies del dominio de la tienda (cada dominio, sesión propia).
- Los *redirect URLs* de Auth (magic link, OAuth) deben estar en la lista de permitidos de Supabase: para subdominios, wildcard `https://*.{dominio-tiendas}/**`; para dominios propios hay que agregar cada dominio mediante la Management API al activarlo, o usar un **flujo OTP de 6 dígitos sin redirección** para compradores [DEF], que evita por completo el problema de las URLs de retorno. Ver riesgo R-07.
- Los emails de Auth deben llevar la marca de la tienda: se usa el **Send Email Hook** de Supabase Auth para enviar con nuestro `EmailProvider` y plantillas por tienda (Supabase por sí solo usa plantillas globales del proyecto).

---

## 19. API Architecture

### 19.1 Capas y elección [DEC]

| Mecanismo | Para qué | Por qué |
|---|---|---|
| **Server Actions** | Mutaciones del panel y del storefront (formularios: guardar producto, ajustar stock, agregar al carrito, checkout) | Colocalizadas con la UI, tipadas de punta a punta, protección CSRF integrada (verificación de Origin), sin endpoints públicos innecesarios. |
| **RSC con queries de servidor** | Lecturas | Sin capa API intermedia; caché por tags. |
| **Postgres RPC (funciones)** | Operaciones transaccionales multi-tabla con invariantes: `place_order`, `apply_inventory_movement`, `apply_payment_status`, `request_refund`, `move_category`, `change_member_role`, `publish_product`, `launch_store` | Atomicidad e invariantes en la base de datos; la misma lógica para cualquier cliente futuro (API pública, jobs, apps). |
| **Route Handlers** | Webhooks entrantes, endpoint de jobs, sitemap/robots, health, OAuth callbacks, descarga de exportaciones, API pública futura | Necesitan URL estable, raw body o métodos HTTP específicos. |
| **API REST pública `/api/v1`** | FUT (P2 tardía): integraciones, apps móviles, POS, ERP | Versionada; recursos (`/products`, `/orders`, `/inventory`); autenticación por API key con scopes = permisos; paginación por cursor; rate limit por key. Se construye sobre los **mismos servicios** de `modules/*`, no reimplementa lógica. |

**Regla:** la lógica de negocio vive en `modules/*/services` (TS) y en funciones RPC (base de datos). Server Actions y Route Handlers son adaptadores delgados: autenticación → validación (Zod) → servicio → respuesta.

### 19.2 Contratos
- Errores tipados (`AppError` con `code`: `forbidden`, `not_found`, `validation`, `conflict`, `insufficient_stock`, `price_changed`, `limit_reached`, `rate_limited`), mapeados a mensajes en español en la UI y a HTTP en la API.
- Server Actions devuelven `{ ok: true, data } | { ok: false, error }` — nunca lanzan errores con datos internos al cliente.

### 19.3 Preparado para el futuro
- **API keys** (FUT): `api_keys(id, store_id, name, prefix, hash (argon2id/sha256 con pepper), scopes text[], last_used_at, expires_at, revoked_at, created_by)`. Se muestra una sola vez.
- **Webhooks salientes** (FUT): `webhook_endpoints` + `webhook_deliveries` alimentados desde el mismo outbox; firma HMAC por endpoint; reintentos con backoff; protección SSRF (resolución de DNS y bloqueo de IPs privadas).
- **Apps móviles:** usarían la API v1 o Supabase directo con RLS (ya garantiza el aislamiento).
- **Marketplaces, POS y ERP:** vía API v1 + webhooks; conectores como integraciones (FUT).

---

## 20. Analytics

### 20.1 Niveles

| Nivel | Audiencia | Fuente | Fase |
|---|---|---|---|
| Analítica de tienda (ventas) | Comerciante | Consultas sobre `orders`/`order_items` (agregados con índices; materializados si crecen) | MVP |
| Analítica de producto | Comerciante | `order_items` (vendidos, ingresos); vistas de producto vía eventos | MVP (ventas) / P2 (vistas, conversión) |
| Analítica de comportamiento (embudo) | Comerciante | `analytics_events` | P2 |
| Analítica de plataforma | Tú | Rollups por tienda + tablas SaaS (tiendas activas, GMV, MRR, churn, uso por plan) | MVP básico / P2 |

### 20.2 Eventos (P2)
`page_view, product_view, search (q, results_count), add_to_cart, remove_from_cart, checkout_started, payment_started, purchase (desde el servidor, nunca del cliente), refund (servidor)`.

- `analytics_events(id, store_id, occurred_at, type, session_id, anonymous_id, customer_id?, path, referrer_host?, utm jsonb, device, country, properties jsonb)` **particionada por mes** (`occurred_at`); retención de 13 meses en crudo; rollups indefinidos.
- Ingesta: `navigator.sendBeacon` → `/api/e` (Route Handler) → validación de esquema + rate limit → inserción por lotes. **Sin cookies de terceros**; `anonymous_id` en cookie de primera parte; IP no almacenada (solo país derivado). Banner de consentimiento si el país lo exige.
- `purchase` y `refund` se emiten en el servidor desde la transición del pedido (fuente de verdad), no desde el navegador.
- Rollup diario (job): `analytics_daily_store_metrics(store_id, date, sessions, product_views, add_to_carts, checkouts, orders, revenue, ...)` y `analytics_daily_product_metrics`.
- Conversión = pedidos / sesiones. Hasta tener eventos, el MVP no muestra conversión (no se inventan métricas).
- Integraciones del comerciante (GA4, Meta Pixel): P2 vía configuración de IDs con carga condicionada al consentimiento.

---

## 21. Security Threat Model

Metodología: STRIDE sobre los activos (datos de tenant, PII de compradores, credenciales de pago, integridad de pedidos y precios, disponibilidad). Severidad = impacto × probabilidad, sin mitigación.

| # | Amenaza | Severidad | Mitigación |
|---|---|---|---|
| T1 | **Acceso cross-tenant** (lectura o escritura de datos de otra tienda) | **CRITICAL** | RLS forzado en 100% de las tablas; `has_store_permission`; FK compuestas; `store_id` inmutable; cliente privilegiado aislado por lint; suite de aislamiento obligatoria en CI (§23.3). |
| T2 | **Abuso del service role** (clave filtrada o usada en código cliente) | **CRITICAL** | Solo en variables de servidor (sin prefijo `NEXT_PUBLIC_`); `server-only`; escaneo de secretos en CI (gitleaks); prueba de build que busca la clave en `.next/static`; rotación documentada. |
| T3 | **Manipulación de precios o totales** desde el cliente | **CRITICAL** | El cliente envía solo variante y cantidad; totales calculados en el servidor y en la base de datos; `expected_total` solo para detectar cambios. |
| T4 | **Webhook spoofing** (falso "pagado") | **CRITICAL** | Verificación de firma por cuenta; re-consulta a la API del proveedor; validación de monto, moneda y referencia; idempotencia; endpoint por cuenta. |
| T5 | **Escalada de privilegios** (rol superior, auto-invitación, platform admin) | **CRITICAL** | Membresías solo vía RPC con reglas (no asignar rol ≥ propio); `platform_staff` solo escribible por service role; MFA para roles altos y de plataforma; auditoría y alerta de cambios de rol. |
| T6 | **IDOR** en panel, cuenta de comprador o página de pedido | **HIGH** | RLS; UUIDs; token de acceso para pedidos de invitado; respuestas 404 uniformes. |
| T7 | **XSS almacenado** (descripciones, páginas, nombres, settings de tema) | **HIGH** | HTML de editor sanitizado en el servidor con lista blanca (DOMPurify/`sanitize-html`) al guardar **y** al renderizar; React escapa por defecto; prohibido `dangerouslySetInnerHTML` salvo en el componente `SafeHtml`; sin CSS ni JS arbitrario del comerciante; CSP estricta con nonce; SVG no permitido en uploads. |
| T8 | **Robo de sesión entre tiendas** (cookies compartidas) | **HIGH** | Dominio raíz separado para storefronts o entrada en la Public Suffix List; cookies `HttpOnly; Secure; SameSite=Lax`, host-only. |
| T9 | **Fuerza bruta / credential stuffing** en login de staff y compradores | **HIGH** | Rate limit de Supabase Auth + rate limit propio por IP y por email; OTP con expiración corta y límite de intentos; MFA para staff; Turnstile tras N fallos; `security_events`. |
| T10 | **Subida de archivos maliciosos** (polyglots, SVG con script, archivos enormes, EXIF con PII) | **HIGH** | Lista blanca de MIME verificada por *magic bytes* en el servidor; límites de tamaño por bucket; re-codificación de imágenes (sharp) que elimina metadatos; nombres generados (UUID), nunca el nombre del usuario; buckets privados para documentos; `Content-Disposition: attachment` para no-imágenes. |
| T11 | **CSV/Formula injection** en exportaciones | **MEDIUM** | Escapar celdas que empiezan con `= + - @ \t \r` (prefijo `'`). |
| T12 | **SQL injection** | **MEDIUM** (bajo por diseño) | Solo supabase-js/PostgREST y RPC parametrizadas; prohibido SQL dinámico con concatenación en funciones (`format()` con `%L`/`%I` si fuera necesario; revisión obligatoria). |
| T13 | **CSRF** | **MEDIUM** | Server Actions verifican Origin y Host; Route Handlers mutantes requieren token o firma; cookies `SameSite=Lax`. |
| T14 | **SSRF** (URLs de imágenes importadas, webhooks salientes, dominios) | **MEDIUM** (HIGH cuando existan webhooks salientes) | MVP: la importación por URL de imagen se descarga en un worker con resolución de DNS validada (bloquea rangos privados, link-local y metadata), timeout, tamaño máximo y solo `https`; o se pospone a P2 [DEF]. |
| T15 | **Abuso de API / scraping / DoS de checkout** | **MEDIUM** | Rate limiting por IP + tienda (Vercel Firewall/WAF + limitador en middleware respaldado por Postgres o Upstash si hace falta); límites de tamaño de payload; paginación obligatoria con máximo de 100. |
| T16 | **Enumeración de tenants** (handles, emails de staff) | **LOW** | Respuestas uniformes; rate limit; los handles son públicos por naturaleza (subdominio), aceptado. |
| T17 | **Gestión de secretos** (credenciales de pago de tiendas) | **HIGH** | Supabase Vault; nunca en logs (redacción en el logger); acceso solo desde el módulo privilegiado de pagos; rotación. |
| T18 | **Inyección de enlaces** (open redirect en login/returnUrl; URLs de menú o rastreo con `javascript:`) | **MEDIUM** | `safeRedirect()` que solo acepta rutas relativas que empiezan con `/` y no con `//` ni `/\` (lección aprendida, documentada en `CAMBIOS-FASE-1-2.md` del otro proyecto); validación `https:` en URLs configurables. |
| T19 | **Fuga de PII en logs, errores o analítica** | **MEDIUM** | Logger con redacción (email, teléfono, dirección, tokens); Sentry con `sendDefaultPii = false` y scrubbing; eventos sin IP. |
| T20 | **Insider de plataforma** (soporte que ve datos sin necesidad) | **MEDIUM** | Sesiones de soporte con motivo, expiración y auditoría visible para el tenant; mínimo privilegio (`platform_support` de solo lectura). |
| T21 | **Dependencias comprometidas** (supply chain) | **MEDIUM** | Lockfile; `pnpm audit`/Dependabot; pocas dependencias; versiones fijadas; revisión de nuevas dependencias en PR. |
| T22 | **Takeover de dominio propio** (DNS que apunta a Vercel tras eliminar el dominio) | **MEDIUM** (P2) | Verificación TXT de propiedad; al eliminar, se quita del proyecto de Vercel; jobs que detectan dominios activos sin DNS válido. |

**Cabeceras de seguridad (Fase 1):** CSP con nonce (`script-src 'self' 'nonce-…'` + dominios del proveedor de pago si hay checkout embebido), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictiva y `frame-ancestors 'none'` en el panel (el storefront también, salvo la vista previa del panel, que se permite desde `app.`).

---

## 22. Performance Strategy

### 22.1 Objetivos

| Métrica | Objetivo (p75, móvil, 4G) |
|---|---|
| LCP storefront (home, producto, categoría) | < 2.5 s (meta: < 2.0 s) |
| INP | < 200 ms |
| CLS | < 0.1 |
| TTFB storefront con caché | < 200 ms; sin caché < 600 ms |
| JS de primera carga, página de producto | < 120 KB gzip (presupuesto verificado en CI) |
| Listados del panel (10k productos / 100k pedidos por tienda) | p95 < 400 ms en servidor |
| `place_order` | p95 < 300 ms (sin contar el proveedor) |
| Lighthouse (storefront) | ≥ 90 en Performance, Accessibility, Best Practices y SEO |

### 22.2 Tácticas
- **Rendering:** RSC por defecto; storefront estático y cacheado con revalidación por tag (`revalidateTag('product:'+id)` al guardar o publicar); el carrito y la cuenta son dinámicos y no bloquean la página cacheada (islas cliente).
- **Imágenes:** dimensiones guardadas; `next/image` con loader de Supabase Storage (transformaciones) o del CDN; `sizes` correctos; AVIF/WebP; `priority` solo en la imagen LCP; lazy loading en el resto. Variantes de tamaño acotadas para controlar costo.
- **Fuentes:** `next/font` autoalojadas, `display: swap`, máximo 2 familias.
- **Base de datos:** índices compuestos con `store_id` al inicio para cada patrón de consulta conocido; paginación por cursor (`(placed_at, id) < ($1, $2)`); `select` de columnas explícitas (nunca `*` en listados); conteos aproximados en listados grandes; `EXPLAIN` revisado para las 20 consultas principales en Fase 12; conexiones vía el pooler de Supabase (Supavisor, modo transacción) desde serverless.
- **Caché:** no se agrega Redis en el MVP. Next Data Cache + CDN de Vercel + caché en memoria para la resolución de host. Reevaluar con métricas.
- **Bundle:** sin librerías UI pesadas en el storefront; componentes del panel cargados bajo demanda (editor de texto enriquecido, gráficos e importador con `dynamic()`).
- **Terceros:** scripts de analítica y píxeles cargados tras la interacción o el consentimiento.

---

## 23. Testing Strategy

### 23.1 Herramientas [DEC]

| Tipo | Herramienta | Alcance |
|---|---|---|
| Unit | Vitest | Funciones puras: cálculo de totales, redondeos, derivación de estado, validadores Zod, permisos, `safeRedirect`, sanitización, generación de variantes, parsers CSV. |
| Integración (servicios) | Vitest + Supabase local (CLI, Docker) | Servicios de `modules/*` contra una base real; adaptadores con mocks HTTP (MSW). |
| Base de datos | **pgTAP** (`supabase test db`) | Constraints, triggers, funciones RPC, transiciones de estado e inventario concurrente. |
| **RLS / aislamiento** | pgTAP + Vitest con JWT reales de usuarios de prueba | Suite explícita (§23.3). |
| API / webhooks | Vitest sobre Route Handlers | Firmas inválidas, idempotencia, montos alterados, eventos fuera de orden. |
| E2E | Playwright (Chromium; WebKit móvil para el storefront) | Recorridos críticos (§23.4). |
| Accesibilidad | `@axe-core/playwright` en E2E + Lighthouse CI | Cero violaciones serias o críticas en páginas clave. |
| Visual regression | Playwright screenshots (P2) | Storefront con 2–3 configuraciones de tema; componentes del design system. |
| Performance | Lighthouse CI (presupuestos) + k6 para `place_order` y el catálogo (Fase 12) | |
| Seguridad | gitleaks, `pnpm audit`, Supabase advisors (`get_advisors` de seguridad y rendimiento), ZAP baseline contra staging (Fase 12), pentest externo antes de producción comercial | |

### 23.2 Datos de prueba
- Seed determinista: plataforma con **dos organizaciones** (A, B); A con dos tiendas (A1, A2); usuarios: `owner_A`, `admin_A1`, `catalog_A1`, `support_A1`, `viewer_A1`, `staff_A2_only`, `owner_B`, `buyer_1` (cliente de A1 y de B), `platform_admin`, `platform_support` y anónimo.
- Factories en TS para crear entidades por tienda en las pruebas.

### 23.3 Suite obligatoria de aislamiento multi-tenant
Ejecutada en cada PR. **Un fallo bloquea el merge.**

1. **Meta-test de cobertura:** consulta `pg_class`/`pg_policies`:
   - toda tabla de `public` tiene RLS habilitado **y forzado**;
   - toda tabla con columna `store_id` tiene políticas para cada operación permitida, que referencian `store_id`;
   - toda tabla con `store_id` tiene el trigger `prevent_store_id_change`;
   - toda FK hacia una tabla con `store_id` es compuesta (excepto la lista blanca documentada, p. ej. `order_items.variant_id`);
   - toda función `SECURITY DEFINER` tiene `search_path` fijo y no es ejecutable por `public`.
2. **Matriz generada:** para cada tabla con `store_id` × operación (`select`, `insert`, `update`, `delete`) × actor (`owner_B`, `staff_A2_only`, `buyer_1` en el contexto de B, `anon`) → intentar sobre filas de A1 → esperar 0 filas o error de permiso.
3. **Casos dirigidos:**
   - un `staff_A2_only` no ve pedidos ni clientes de A1 (misma organización, distinta tienda);
   - `buyer_1` autenticado ve sus pedidos de A1 solo en A1 y no ve sus pedidos de B desde A1;
   - insertar una variante en A1 con `product_id` de B → falla por FK compuesta, **incluso con service role**;
   - `UPDATE products SET store_id = B` → falla;
   - `admin_A1` intenta `change_member_role` a `org_owner` → falla;
   - `admin_A1` intenta asignarse `store_admin` en A2 → falla;
   - `support_A1` intenta `request_refund` → falla;
   - RPC `place_order` con `store_id` de A1 y variante de B → falla;
   - webhook con `payment_account_id` de A1 y un pago cuya referencia pertenece a un pedido de B → rechazado;
   - storage: `admin_A1` sube a `store-public/{B}/...` → falla; lee `store-private/{B}/...` → falla;
   - vistas públicas: con el host de A1 no aparece ningún producto de B.
4. **E2E de aislamiento:** con dos navegadores (A y B), cambiar IDs en las URLs del panel → 404.

### 23.4 E2E críticos (gate de release)
1. Onboarding: el platform admin crea la organización y la tienda → el dueño acepta la invitación → configura → validación de lanzamiento → tienda activa.
2. Crear producto con variantes → publicar → aparece en el storefront.
3. Compra como invitado con el sandbox de Mercado Pago (o proveedor `fake` en CI) → webhook → pedido pagado → stock reservado → email en el outbox.
4. Enviar pedido → stock descontado → email de envío.
5. Reembolso parcial con restock.
6. Concurrencia: dos checkouts por la última unidad → uno solo exitoso (test de integración con promesas paralelas contra la base de datos).
7. Pago expirado → reserva liberada.
8. Comprador inicia sesión con OTP → ve su pedido.
9. Invitar staff con rol limitado → no ve secciones prohibidas y el servidor rechaza acciones forzadas.
10. Importación CSV con errores → reporte por fila → corregir → importación exitosa.

### 23.5 Gates
- **Por PR:** lint, typecheck, unit, integración, pgTAP, suite de aislamiento, build, gitleaks, presupuesto de bundle.
- **Por release (a producción):** todo lo anterior + E2E críticos contra staging + axe + Lighthouse CI + advisors de Supabase sin errores de seguridad + migraciones probadas contra una copia de producción (Supabase branching o restore en staging).

---

## 24. Observability

| Tipo | Qué | Dónde | Retención |
|---|---|---|---|
| **Application logs** | Logs estructurados JSON (`level, msg, request_id, store_id, user_id?, route, duration_ms, error_code`) con redacción de PII | Vercel Logs → *log drain* a un proveedor (Axiom/Better Stack/Datadog) [DEF Axiom por costo] | 30 días |
| **Errores** | Excepciones de servidor y cliente con `store_id` y `release` como tags | Sentry (abstraído con `observability/errors.ts`) | 90 días |
| **Security logs** | `security_events`: login fallido o exitoso de staff, MFA, cambios de rol, invitaciones, sesiones de soporte, firmas de webhook inválidas, rate limits, accesos denegados repetidos | Postgres (tabla) + alertas | 1 año |
| **Business audit** | `audit_logs` (§28) | Postgres | 2 años en caliente, luego archivo |
| **Métricas** | Pedidos por minuto, tasa de pagos fallidos, latencia de `place_order`, profundidad y antigüedad de la cola de jobs, webhooks fallidos, reservas activas, errores 5xx | Rollups en Postgres + dashboard del Super Admin; Vercel Analytics / Speed Insights para Web Vitals | — |
| **Health checks** | `/api/health` (liveness), `/api/health/ready` (base de datos, Storage, cola de jobs con antigüedad < 5 min) | Monitor externo (Better Stack/UptimeRobot) cada 1 min | — |
| **Alertas** | Error rate > umbral, cola de jobs atascada, más de 5 webhooks fallidos en 10 min, cero pedidos en N horas en tiendas con volumen, latencia de base de datos, almacenamiento cerca del límite | Email + Slack/Telegram | — |

`request_id` se propaga desde el middleware a logs, Sentry y `audit_logs.metadata`.

---

## 25. Backup & Recovery

| Escenario | Estrategia | RPO / RTO objetivo |
|---|---|---|
| Fallo de base de datos / corrupción | Backups diarios de Supabase (Pro) + **PITR** (add-on) activado antes del primer cliente de pago [DEF] | RPO ≤ 5 min (con PITR) / RTO ≤ 4 h |
| Borrado accidental por un comerciante | Soft delete con papelera de 30 días (productos, categorías, clientes); auditoría con estado anterior (`before` jsonb) que permite reconstruir un registro | Inmediato (autoservicio) |
| Borrado accidental de datos de **un** tenant por error de plataforma | PITR a una base temporal (branch/restore) → extracción selectiva de las filas de `store_id` → reinserción con script probado. Documentado como runbook. | RTO ≤ 24 h |
| Migración fallida | Migraciones *forward-only* probadas en staging con datos copiados; patrón expand/contract (nunca `DROP` en la misma release que deja de usarse); migración de reversa escrita para cambios riesgosos; backup previo manual a cada release con migraciones. | — |
| Fallo de Storage | Supabase Storage (S3 subyacente, durable). P2: replicación nocturna de `store-public` y `store-private` a un bucket externo (Cloudflare R2/S3) vía job. | RPO 24 h (P2) |
| Pérdida de proveedor de email o pagos | Outbox con reintentos; adaptador alternativo configurable; reconciliación de pagos al restablecerse. | — |
| Compromiso de credenciales | Runbook de rotación: claves de Supabase, secretos de webhook, credenciales en Vault, `JOBS_HMAC_SECRET`. | — |
| Exportación del tenant | Exportación completa por tienda (JSON/CSV por entidad) disponible para el dueño y para la plataforma: portabilidad y respaldo propio. P2. | — |

**Simulacro de restauración** trimestral (restore a staging + verificación de conteos y de la suite de aislamiento).

---

## 26. SaaS Billing Architecture

### 26.1 Modelo de datos

```
plans(id, key UQ, name, is_public, sort, price_monthly?, price_yearly?, currency, status)
plan_entitlements(plan_id, key, value_int?, value_bool?, PK(plan_id,key))
subscriptions(id, organization_id UQ (vigente), plan_id, status CK in
              ('trialing','active','past_due','paused','cancelled'),
              current_period_start, current_period_end, trial_ends_at?, cancel_at?,
              provider?, provider_customer_id?, provider_subscription_id?, notes?)
organization_entitlement_overrides(organization_id, key, value_int?, value_bool?, reason, expires_at?, created_by)
usage_counters(organization_id, key, period_start, value, PK(...))   -- pedidos/mes, almacenamiento
```

### 26.2 Entitlements (claves) — ejemplo de planes (los valores son placeholders a definir por ti, Q10)

| Clave | Tipo | Starter | Business | Pro | Enterprise |
|---|---|---|---|---|---|
| `max_stores` | int | 1 | 1 | 3 | a medida |
| `max_products` | int | 100 | 1,000 | 10,000 | a medida |
| `max_staff` | int | 2 | 5 | 15 | a medida |
| `max_locations` | int | 1 | 1 | 5 | a medida |
| `max_orders_per_month` | int | (sin límite recomendado; limitar pedidos castiga el éxito del cliente) | | | |
| `max_custom_domains` | int | 0 | 1 | 3 | a medida |
| `storage_mb` | int | 1,000 | 5,000 | 20,000 | a medida |
| `advanced_analytics` | bool | ✗ | ✗ | ✓ | ✓ |
| `abandoned_cart` | bool | ✗ | ✓ | ✓ | ✓ |
| `custom_roles` | bool | ✗ | ✗ | ✓ | ✓ |
| `api_access` | bool | ✗ | ✗ | ✓ | ✓ |
| `remove_platform_branding` | bool | ✗ | ✓ | ✓ | ✓ |

### 26.3 Aplicación de límites
- **En la base de datos** para límites de conteo: la función `app.assert_within_limit(org_id, 'max_products')` se llama en triggers `BEFORE INSERT` de `products`, `store_members`, `stores` e `inventory_locations`. Bloqueo `pg_advisory_xact_lock(hash(org_id, key))` para evitar carreras al acercarse al límite.
- **En la aplicación** para funcionalidades booleanas: `entitlements.has(org, 'api_access')` (con flags, §27).
- **Al bajar de plan:** no se borra nada; se bloquea crear más y se muestran avisos (p. ej. 150 productos con límite de 100 → no se publican nuevos, los existentes siguen activos; política definida en Q10).
- **Estado de suscripción:** `past_due` → aviso + gracia de 7 días [DEF]; luego `paused` → panel en solo lectura y storefront activo (no perjudicar a los compradores) durante X días → `suspended` → storefront en mantenimiento. Todo configurable en `platform_settings`.

### 26.4 Cobro
- MVP: **manual** (tú marcas `active` y las fechas en el Super Admin, y facturas por fuera).
- P2: `BillingProvider` (Stripe Billing o Mercado Pago Suscripciones) con webhooks que sincronizan `subscriptions`. El resto del sistema solo lee `subscriptions` y entitlements, así que el proveedor de billing se conecta sin tocar el dominio.

---

## 27. Feature Flags

### 27.1 Modelo

```
feature_flags(key PK, description, default_enabled bool, kill_switch bool default false,
              owner, created_at)
feature_flag_overrides(id, flag_key, scope CK in ('plan','organization','store','user'),
                       scope_id, enabled bool, expires_at?, UQ(flag_key, scope, scope_id))
```

### 27.2 Resolución (`app.flag_enabled(key, ctx)` y su espejo en TS)

```
1. kill_switch activo           → false (apagado global de emergencia)
2. override de user             → valor
3. override de store            → valor
4. override de organization     → valor
5. entitlement del plan (si el flag está ligado a una clave de plan) / override de plan → valor
6. default_enabled              → valor
```

- Evaluación en el servidor con caché por request; se pasa al cliente solo el conjunto de flags resueltos que la UI necesita.
- Flags iniciales: `custom_domains`, `multi_warehouse`, `advanced_analytics`, `api_access`, `abandoned_cart`, `digital_products`, `stripe_provider`, `new_checkout` (para lanzamientos graduales).
- **Distinción:** *entitlement* = lo que el plan da (comercial); *flag* = lo que está activado (técnico, lanzamiento gradual, kill switch). Un flag puede depender de un entitlement, nunca al revés.
- Higiene: cada flag tiene dueño y se elimina del código cuando llega al 100% (revisión mensual).

---

## 28. Audit Logs

### 28.1 Modelo

```
audit.audit_logs(
  id uuid, occurred_at timestamptz default now(),
  store_id uuid?, organization_id uuid?,        -- null en acciones de plataforma
  actor_type CK in ('user','platform_staff','system','api_key','provider'),
  actor_user_id uuid?, actor_label text,         -- snapshot del email/nombre
  impersonated_by uuid?,                         -- sesiones de soporte
  action text,                                   -- 'product.updated'
  entity_type text, entity_id uuid?,
  changes jsonb?,                                -- {campo: [antes, después]} solo campos cambiados, con redacción
  metadata jsonb,                                -- request_id, ip_hash, user_agent, motivo
) PARTITION BY RANGE (occurred_at)  -- mensual (desde que el volumen lo justifique; diseño listo en MVP)
IX (store_id, occurred_at desc), (entity_type, entity_id), (actor_user_id, occurred_at desc)
```

- **Append-only:** sin UPDATE ni DELETE para ningún rol de la aplicación (privilegios revocados + trigger). Retención por partición (*drop partition* tras 2 años, previo archivo).
- **Escritura:**
  - **Triggers genéricos** (`audit.log_change()`) en tablas críticas: products, product_variants (precio y estado), variant_costs, inventory_levels (vía movimientos, que ya son ledger), discounts, payment_accounts (sin secretos), store_members, organization_members, stores, store_themes (publicación), store_domains, shipping_rates, tax_rates.
  - **Acciones semánticas** desde las RPC (`order.refunded`, `order.cancelled`, `inventory.adjusted`, `user.invited`, `role.changed`, `settings.changed`, `store.launched`, `support_session.started`), con contexto rico.
- **Actor en triggers:** `auth.uid()` para usuarios; las operaciones privilegiadas ejecutan `set_config('app.actor', json, true)` al inicio de la transacción, y el trigger lo lee.
- **UI:** Ajustes → Actividad (filtros por usuario, entidad y fecha) con `audit.read`; en cada entidad, pestaña "Historial".
- **Catálogo de acciones** definido en código (`modules/audit/actions.ts`), tipado.

---

## 29. Project Structure

[DEC] Una sola app Next.js organizada por **módulos de dominio** (feature-sliced pragmático). Sin monorepo hasta que exista un segundo despliegable (API separada, app móvil, workers dedicados).

```
.
├── docs/                          # blueprint oficial (Anexo A) + runbooks + ADRs
├── supabase/
│   ├── config.toml
│   ├── migrations/                # SQL versionado (Supabase CLI)
│   ├── seed.sql                   # seed determinista de desarrollo y pruebas
│   └── tests/                     # pgTAP: constraints, rpc/, rls/, isolation/
├── src/
│   ├── app/
│   │   ├── (marketing)/           # sitio del SaaS (mínimo en el MVP)
│   │   ├── (admin)/admin/[storeHandle]/...   # panel de tienda
│   │   ├── (platform)/platform/...           # Super Admin
│   │   ├── (auth)/                # login staff, invitaciones, MFA
│   │   ├── _store/[storeId]/...   # storefront (accesible solo vía rewrite del middleware)
│   │   └── api/
│   │       ├── webhooks/payments/[provider]/[accountId]/route.ts
│   │       ├── jobs/run/route.ts
│   │       ├── health/route.ts
│   │       └── e/route.ts         # ingesta de eventos (P2)
│   ├── middleware.ts              # resolución de host, sesión, headers, rate limit
│   ├── modules/                   # DOMINIO: cada módulo expone index.ts (API pública del módulo)
│   │   ├── access/                # tenancy, contexto, permisos, membresías, invitaciones
│   │   ├── catalog/               # products, variants, categories, brands, media
│   │   ├── inventory/
│   │   ├── cart/
│   │   ├── checkout/              # cálculo de totales, descuentos, impuestos, envío
│   │   ├── orders/
│   │   ├── payments/
│   │   ├── customers/
│   │   ├── shipping/
│   │   ├── storefront/            # resolución de tienda, tema, menús, páginas
│   │   ├── theming/               # esquemas de tema, tokens → CSS
│   │   ├── marketing/             # descuentos (P2: campañas)
│   │   ├── imports/               # CSV import/export
│   │   ├── notifications/         # outbox, plantillas
│   │   ├── billing/               # planes, entitlements, límites
│   │   ├── flags/
│   │   ├── audit/
│   │   ├── analytics/
│   │   └── platform/              # operaciones de Super Admin
│   │       # estructura interna de cada módulo:
│   │       #   schemas.ts (Zod) · types.ts · queries.ts (lecturas) · service.ts (escrituras)
│   │       #   actions.ts (Server Actions delgadas) · components/ · __tests__/
│   ├── providers/                 # ADAPTADORES a terceros (implementan interfaces de modules/*)
│   │   ├── payments/{mercadopago,stripe,manual,fake}/
│   │   ├── email/{resend,fake}/
│   │   ├── domains/{vercel,fake}/
│   │   └── storage/{supabase}/
│   ├── server/                    # infraestructura de servidor
│   │   ├── db/                    # clientes supabase (user, anon) + tipos generados
│   │   ├── privileged/            # ÚNICO lugar con service role (server-only, CODEOWNERS)
│   │   ├── auth/                  # sesión, MFA, requirePermission
│   │   ├── jobs/                  # enqueue, worker, handlers
│   │   ├── rate-limit/
│   │   └── observability/         # logger con redacción, errores, request_id
│   ├── ui/                        # design system: primitives (Radix) + componentes compartidos
│   │   ├── primitives/            # Button, Input, Dialog, Drawer, Table, Toast...
│   │   ├── admin/                 # layout, DataTable, Filters, PageHeader, EmptyState
│   │   └── storefront/            # componentes del tema base
│   ├── themes/
│   │   └── base/                  # tema 1: schema.ts, sections/, layout
│   ├── lib/                       # utilidades puras sin dependencias de dominio (money, slug, dates, safeRedirect)
│   └── config/                    # env.ts (validación Zod de variables), constants, reserved-handles
├── tests/
│   ├── e2e/                       # Playwright
│   ├── integration/               # Vitest + Supabase local
│   └── fixtures/                  # factories, usuarios de prueba
├── .github/workflows/             # CI
├── .env.example
├── .gitignore  .nvmrc  package.json  pnpm-lock.yaml  tsconfig.json  eslint.config.mjs
└── CLAUDE.md                      # guía para agentes (convenciones, reglas de seguridad)
```

**Reglas de dependencia** (verificadas con `eslint-plugin-boundaries` o `dependency-cruiser`):
- `app/` → `modules/*` (vía `index.ts`), `ui/`, `lib/`.
- `modules/X` → `modules/Y` solo vía `index.ts` de Y; nunca a `providers/` concretos (los recibe por el registro).
- `server/privileged` solo importable desde `modules/*/service.ts` marcados, `api/webhooks` y `server/jobs`.
- `ui/` no importa `modules/`.

**Stack de librerías propuesto (mínimo):** `next`, `react`, `typescript`, `tailwindcss`, `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `react-hook-form`, Radix UI primitives (o shadcn/ui copiado, que no es dependencia), `lucide-react`, `sanitize-html` o `isomorphic-dompurify`, `sharp` (procesamiento de imágenes en el servidor), `papaparse` (CSV), `@react-email/components` (plantillas), `@sentry/nextjs`, `date-fns`. Dev: `vitest`, `@playwright/test`, `@axe-core/playwright`, `eslint` + `typescript-eslint`, `prettier`, `supabase` CLI, `msw`. Cualquier otra dependencia requiere justificación en el PR.

Versiones: se fijan en la Fase 1 a la última estable de Next.js (App Router) y React compatibles, Node LTS (22.x, coherente con el entorno actual) en `.nvmrc` y `engines`.

---

## 30. Development Roadmap

> Cada fase termina con el informe: cambios realizados, archivos modificados, migraciones, tests, riesgos, pendientes, criterios de aceptación y resultado de tests. **No se avanza sin verificar la fase anterior** (tu regla).

### PHASE 0 — Architecture sign-off
- **Objetivo:** aprobar este blueprint, responder las preguntas abiertas y crear `/docs`.
- **Entregables:** los 19 documentos de `/docs` + `CLAUDE.md` + ADRs aceptados.
- **DoD:** tu aprobación explícita; preguntas Q1–Q12 resueltas o con el default aceptado.

### PHASE 1 — Foundation
- **Objetivo:** proyecto ejecutable, seguro por defecto, con CI.
- **Funcionalidades:** app Next.js + TS estricto + Tailwind; ESLint (con reglas de límites y de import restringido del service role), Prettier; `.gitignore`, `.nvmrc`, `.env.example`, `config/env.ts` (validación Zod que falla el build si falta una variable); Supabase local (CLI) con migración 0 (extensiones: `pgcrypto`, `citext`, `pg_trgm`, `unaccent`, `pg_cron`, `pg_net`, `ltree`; esquemas `app`, `audit`, `private`); helpers base (trigger `set_updated_at`, `prevent_store_id_change`); logger con redacción; manejo de errores tipados; cabeceras de seguridad y CSP; design system base (tokens, Button, Input, Field, Dialog, Drawer, Toast, Table skeleton, EmptyState); CI (lint, typecheck, unit, pgTAP, build, gitleaks); `/api/health`.
- **Tablas:** ninguna de dominio (solo infraestructura).
- **Rutas:** `/` placeholder, `/api/health`.
- **Dependencias:** Phase 0.
- **Riesgos:** elección de versión de Next.js; Docker disponible en CI para Supabase local.
- **Tests:** smoke de build; unit de `env`, `safeRedirect`, `money`; meta-test de RLS (pasa vacío).
- **DoD:** `pnpm verify` (lint + typecheck + test + build) verde en local y en CI; cero secretos en el repo; headers verificados con un test.

### PHASE 2 — Identity, Tenancy & Access
- **Objetivo:** multi-tenancy real y verificable antes de cualquier dato de comercio.
- **Funcionalidades:** Supabase Auth para staff (email + contraseña o magic link, MFA TOTP para roles altos); `profiles`; organizaciones, tiendas, membresías, invitaciones; roles, permisos y matriz; `has_store_permission`; `getStoreContext()`/`requirePermission()`; panel shell con selector de tienda; Super Admin mínimo (crear organización + tienda + invitar dueño; suspender); `platform_staff`; `audit_logs` y `security_events` base; `stores.handle` con lista reservada; `plans`/`entitlements`/`subscriptions` (sin UI completa) y `assert_within_limit` para `max_stores` y `max_staff`; feature flags base.
- **Tablas:** profiles, platform_staff, organizations, organization_members, organization_invitations, stores, store_members, roles, permissions, role_permissions, plans, plan_entitlements, subscriptions, organization_entitlement_overrides, feature_flags, feature_flag_overrides, audit.audit_logs, security_events, jobs, notification_outbox, platform_settings.
- **Rutas:** `/login`, `/invitacion/[token]`, `/admin`, `/admin/[storeHandle]`, `/admin/[storeHandle]/ajustes/equipo`, `/platform`, `/platform/organizaciones`.
- **APIs:** RPC `create_organization_with_store`, `invite_member`, `accept_invitation`, `change_member_role`, `remove_member`, `transfer_ownership`.
- **Riesgos:** errores de RLS (mitigados con la suite de aislamiento desde aquí); emails de Auth sin branding (Send Email Hook en la Fase 7; aquí basta el email de plataforma).
- **Tests:** **suite de aislamiento v1** (meta-test + matriz para las tablas de esta fase); pgTAP de RPC de membresías (escalada); E2E: invitación → aceptación → acceso limitado por rol.
- **DoD:** un usuario de la organización B no puede ver ni modificar nada de A (probado); escalada de roles imposible (probado); auditoría registrada para invitaciones y cambios de rol.

### PHASE 3 — Catalog
- **Objetivo:** gestión completa de catálogo por tienda.
- **Funcionalidades:** marcas, categorías (árbol, mover, anti-ciclos), productos simples y con variantes (opciones, generación de combinaciones, edición masiva de variantes), costos separados, medios (subida segura a Storage, reordenar, alt), estados y publicación con validación, duplicar, archivar o eliminar, listado con filtros y acciones masivas, búsqueda por título y SKU (FTS + trigram), límite `max_products`, auditoría de cambios.
- **Tablas:** brands, categories, products, product_options, product_option_values, product_variants, variant_option_values, variant_costs, product_categories, product_media + buckets de Storage y sus políticas.
- **Rutas:** `/admin/[h]/productos`, `/productos/nuevo`, `/productos/[id]`, `/categorias`, `/marcas`.
- **APIs:** Server Actions del catálogo; RPC `upsert_product_with_variants` (transaccional), `move_category`, `publish_product`.
- **Dependencias:** Phase 2.
- **Riesgos:** complejidad de la UI de variantes; seguridad de uploads.
- **Tests:** pgTAP (SKU único, combinaciones únicas, FK compuestas, ciclos), unit (generador de combinaciones, `option_signature`), aislamiento ampliado a las tablas de catálogo y Storage, E2E de creación y publicación.
- **DoD:** se puede crear la "Playera" de 6 variantes, editarla, publicarla y archivarla; todas las invariantes probadas.

### PHASE 4 — Inventory
- **Objetivo:** inventario consistente, a prueba de concurrencia.
- **Funcionalidades:** ubicación por defecto automática, niveles, ledger, `apply_inventory_movement`, ajustes con motivo, historial, stock bajo (umbral + alerta en el dashboard), política `deny`/`continue`.
- **Tablas:** inventory_locations, inventory_levels, inventory_movements, stock_reservations.
- **Rutas:** `/admin/[h]/inventario`, `/inventario/[variantId]`.
- **APIs:** RPC `adjust_inventory`, `reserve_stock`, `release_stock` (las dos últimas internas, usadas por checkout).
- **Riesgos:** deadlocks (orden determinista), errores de signo (tests).
- **Tests:** pgTAP del ledger e inmutabilidad; **test de concurrencia** (N reservas paralelas sobre stock M < N → exactamente M exitosas); idempotencia de movimientos.
- **DoD:** el stock nunca queda negativo bajo carga concurrente (probado); cada cambio tiene un movimiento.

### PHASE 5 — Storefront (lectura)
- **Objetivo:** tiendas públicas rápidas por subdominio.
- **Funcionalidades:** middleware de resolución de host con caché; estados de tienda (draft/preview, paused); tema base con tokens por defecto; home con secciones; catálogo, categoría, marca, producto (selector de variantes, disponibilidad, galería), búsqueda básica, páginas y políticas; header y footer con menús; SEO base (metadata, canonical, OG, sitemap, robots, JSON-LD Product/Breadcrumb/Organization); caché por tags e invalidación desde el panel; 404 y 503.
- **Tablas:** store_domains (subdominio creado automáticamente con la tienda), store_themes, menus, menu_items, store_pages (con plantillas de políticas).
- **Rutas:** las de §15.2 (excepto carrito, checkout y cuenta).
- **Riesgos:** fuga entre tiendas en caché (tags y claves siempre con `store_id`; test específico); rendimiento.
- **Tests:** E2E de navegación en dos tiendas con datos distintos (nunca se mezclan), test de caché cross-tenant, axe, Lighthouse CI con presupuestos.
- **DoD:** dos tiendas en subdominios distintos, cada una con su catálogo; Lighthouse ≥ 90; sin violaciones axe serias.

### PHASE 6 — Cart, Shipping, Taxes, Discounts & Checkout
- **Objetivo:** del carrito al pedido `pending_payment`, con totales correctos.
- **Funcionalidades:** carrito con token (cookie httpOnly), drawer y página; zonas y tarifas de envío; tasa de impuesto; descuentos básicos por código; `calculate_cart`; checkout de una página (invitado); `place_order` (snapshot + reservas + número + idempotencia + validación de descuento y límites); detección de `price_changed`; rate limit de checkout.
- **Tablas:** carts, cart_items, shipping_zones, shipping_rates, tax_rates, discounts, discount_redemptions, orders, order_items, order_addresses, order_events, store_counters, customers, customer_addresses.
- **Rutas:** `/carrito`, `/checkout`; panel: `/ajustes/envios`, `/ajustes/impuestos`, `/marketing/descuentos`.
- **Riesgos:** errores de redondeo; carreras en descuentos con límite.
- **Tests:** unit exhaustivo de totales (tabla de casos: impuesto incluido o no, descuento %, fijo, envío gratis, redondeos, multi-línea); pgTAP de `place_order` (atomicidad, falta de stock, descuento agotado, variante de otra tienda, idempotencia); E2E del checkout hasta antes del pago.
- **DoD:** el pedido creado tiene snapshot completo y totales idénticos a los mostrados; doble envío → un pedido.

### PHASE 7 — Payments, Order Lifecycle & Notifications
- **Objetivo:** cobrar de verdad y gestionar el pedido hasta la entrega.
- **Funcionalidades:** `PaymentProvider` + adaptadores `fake`, `manual` y `mercadopago`; `payment_accounts` con Vault; conexión de cuenta y validación de credenciales; webhooks (firma, idempotencia, re-consulta); `apply_payment_status`; expiración de reservas y pedidos (job); reconciliación; fulfillment (envíos con guía, parciales), entrega, cancelación, reembolsos totales o parciales con restock; outbox + `EmailProvider` + plantillas con branding por tienda (confirmación, pago, envío, reembolso, cancelación); Send Email Hook de Supabase Auth para emails de Auth con marca; alertas de stock bajo y de nuevo pedido al staff; panel de pedidos (listado, detalle y timeline); validación de lanzamiento de tienda (`launch_store`).
- **Tablas:** payment_accounts, payments, payment_events, refunds, shipments, shipment_items.
- **Rutas:** `/checkout/resultado`, `/pedido/[id]`, `/api/webhooks/payments/...`, `/api/jobs/run`; panel: `/pedidos`, `/pedidos/[id]`, `/ajustes/pagos`, `/ajustes/notificaciones`.
- **Riesgos:** comportamiento real del proveedor (sandbox); pagos tardíos; entregabilidad de email (SPF, DKIM, DMARC del dominio remitente).
- **Tests:** webhooks (firma inválida, duplicado, fuera de orden, monto alterado, cuenta equivocada); pago tardío sin stock → `needs_attention`; reembolso > cobrado → rechazado; E2E completo con el proveedor `fake` en CI y con el sandbox de Mercado Pago en staging.
- **DoD:** compra de punta a punta en staging con el sandbox; cero estados inconsistentes en 100 checkouts simulados con fallos aleatorios.

### PHASE 8 — Customer Accounts & Admin Operations
- **Objetivo:** completar la operación diaria.
- **Funcionalidades:** cuenta del comprador (OTP por email por tienda, pedidos, direcciones); clientes en el panel (listado, perfil, anonimización); dashboard con KPIs; importación CSV de productos, variantes e inventario (validación, vista previa, errores por fila, commit atómico por lote); exportación CSV (productos, pedidos, clientes, inventario) con protección contra formula injection; acciones masivas; Actividad (auditoría) en Ajustes; paleta de comandos (si da tiempo, SHOULD).
- **Tablas:** import_jobs, import_job_rows, export_jobs.
- **Rutas:** `/cuenta/*`; panel: `/clientes`, `/clientes/[id]`, `/` (dashboard), `/productos/importar`, `/ajustes/actividad`.
- **Tests:** importación (duplicados, SKU existentes, filas inválidas, 5k filas), exportación (escape), KPIs contra datos semilla conocidos, aislamiento de cuentas de comprador entre tiendas.
- **DoD:** un comerciante opera su tienda una semana sin intervención técnica (prueba guiada con un usuario real o simulado).

### PHASE 9 — White-Label Customization
- **Objetivo:** cada tienda con identidad propia, sin romper calidad.
- **Funcionalidades:** editor de branding (logo, favicon, colores con validación de contraste, tipografía, forma), editor de secciones de la home con vista previa en borrador y publicación, menús, páginas y políticas, redes y contacto, SEO global, "Powered by" removible por plan.
- **Rutas:** `/admin/[h]/apariencia/*`.
- **Tests:** esquemas de tema (valores inválidos rechazados), contraste, la vista previa no se filtra al público, invalidación de caché tras publicar, visual regression (P2).
- **DoD:** dos tiendas visualmente distintas, ambas con Lighthouse ≥ 90 y axe sin violaciones serias.

### PHASE 10 — Platform Admin & SaaS Plans (sin cobro automático)
- **Objetivo:** que tú operes el negocio SaaS.
- **Funcionalidades:** Super Admin completo (§16.4): tenants, planes y entitlements, suscripciones manuales, overrides, flags, salud, sesiones de soporte auditadas; uso por organización en "Plan y uso" del panel; aplicación de límites y estados de suscripción (past_due → paused → suspended).
- **Tests:** límites en el borde (concurrencia al crear el producto N+1), transición de estados de suscripción, sesión de soporte de solo lectura y auditada, `platform_support` no puede escribir.
- **DoD:** se puede dar de alta, limitar, suspender y reactivar un tenant sin SQL manual.

### PHASE 11 — Hardening & Launch Readiness
- **Objetivo:** listo para el primer cliente de pago.
- **Funcionalidades:** revisión de seguridad completa (checklist de §21), ZAP baseline, pentest externo (recomendado), k6 en checkout y catálogo, revisión de `EXPLAIN` de las consultas top, Supabase advisors limpios, PITR activado, runbooks (incidentes, restauración, rotación de secretos), monitoreo y alertas, páginas legales de la plataforma (términos del SaaS, DPA, política de uso aceptable con productos prohibidos), simulacro de restauración, staging = producción en configuración.
- **DoD:** §36 cumplido; checklist firmado.

### PHASE 12 — Production Launch & Pilot
- **Objetivo:** 1–3 tiendas piloto en producción con acompañamiento.
- **Funcionalidades:** deploy de producción, dominio, DNS, email remitente verificado, monitoreo activo, soporte cercano; recolección de feedback para priorizar la Fase 2.
- **DoD:** pilotos vendiendo con cero incidentes críticos durante 2 semanas.

### Post-MVP (P2) — fases sugeridas
- **P2-A Dominios propios** (§18.3).
- **P2-B Billing automatizado** (`BillingProvider`).
- **P2-C Analítica de eventos** (§20) + conversión + píxeles.
- **P2-D Marketing:** promociones automáticas, carritos abandonados, suscriptores.
- **P2-E Catálogo avanzado:** colecciones, atributos filtrables con facetas, tags gestionables, relacionados, reseñas, wishlist.
- **P2-F Operaciones:** devoluciones (RMA), pedidos manuales, multi-almacén, proveedores y órdenes de compra.
- **P2-G Stripe** como segundo proveedor; productos digitales.
- **P2-H Roles personalizados** y exportación completa del tenant.

---

## 31. MVP Definition

**El MVP es:** una plataforma en la que tú creas tiendas para clientes (onboarding asistido), cada tienda vende productos físicos (simples o con variantes) en su subdominio, con checkout de invitado, pago con Mercado Pago o manual, envío con tarifas fijas, descuentos por código, gestión de pedidos, inventario y clientes, personalización de marca y home por secciones, roles de equipo y aislamiento total entre tenants, y tú los administras desde el Super Admin con planes y límites (cobro manual).

### Priorización (MoSCoW)

| MUST HAVE (MVP) | SHOULD HAVE (MVP si cabe; si no, P2 temprana) | COULD HAVE (P2) | FUTURE |
|---|---|---|---|
| Multi-tenancy Org→Store con RLS + FK compuestas + suite de aislamiento | Paleta de comandos ⌘K | Dominios propios | Marketplaces, POS, ERP |
| Auth de staff con MFA para roles altos; invitaciones; RBAC de sistema | Wishlist | Colecciones, tags, atributos filtrables, facetas | API pública v1 + API keys + webhooks salientes |
| Super Admin: tenants, planes, límites, suspensión, soporte auditado, flags | Exportación de clientes e inventario | Promociones automáticas | Apps móviles |
| Catálogo: productos simples y con variantes, categorías, marcas, medios, publicación validada | Edición masiva tipo hoja | Carritos abandonados, suscriptores | Page builder libre / temas de terceros |
| Inventario: ledger, reservas, ajustes, stock bajo (1 ubicación) | Plantillas de política mejoradas | Reseñas | Multi-moneda / multi-idioma por tienda |
| Storefront por subdominio: home por secciones, catálogo, categoría, marca, producto, búsqueda básica, páginas | Notas internas en clientes | Analítica de eventos + conversión | Facturación electrónica (CFDI) |
| Carrito, checkout de invitado, envío fijo/gratis/pickup, impuesto simple, descuentos por código | | Stripe; productos digitales | Cotización de envíos en vivo, guías automáticas |
| Pagos: abstracción + Mercado Pago + manual; webhooks seguros; reembolsos | | Devoluciones (RMA), pedidos manuales | Búsqueda externa (Meilisearch/Typesense) |
| Pedidos: lifecycle de 3 ejes, snapshot, envíos con guía manual, cancelaciones | | Multi-almacén operativo, proveedores, OC | Recomendaciones personalizadas |
| Notificaciones transaccionales con marca por tienda | | Billing automatizado de tenants | Catálogo compartido entre tiendas |
| Cuenta de comprador (OTP), clientes en el panel | | Roles personalizados | Módulo de cumplimiento regulatorio por jurisdicción (ver §32) |
| Dashboard de KPIs de ventas | | Visual regression | Gift cards, programas de lealtad |
| Importación y exportación CSV de productos; exportación de pedidos | | Excel (.xlsx) | B2B (listas de precios, grupos) |
| White-label: tokens, home por secciones, menús, páginas, SEO | | 2–3 temas extra | |
| SEO técnico completo | | | |
| Auditoría, security events, observabilidad, backups/PITR | | | |
| Seguridad: CSP, rate limiting, sanitización, uploads seguros | | | |

---

## 32. Future Roadmap

1. **Crecimiento comercial (P2):** dominios propios, billing automatizado, analítica de eventos, marketing (promociones automáticas, carritos abandonados), catálogo avanzado.
2. **Operación avanzada:** multi-almacén, compras, devoluciones, pedidos manuales, POS ligero.
3. **Ecosistema:** API pública v1, webhooks salientes, conectores (ERP, marketplaces, paqueterías), apps.
4. **Internacionalización:** multi-idioma del storefront (rutas localizadas), multi-moneda, impuestos por región.
5. **Módulo de cumplimiento por jurisdicción** (retoma tu requisito de la conversación anterior, como módulo opcional por tienda y nunca en el núcleo):
   - `jurisdictions`, `compliance_rules` (producto/categoría × jurisdicción × acción: vender, enviar, pagar, promocionar), denegación por defecto;
   - verificación de edad (proveedor externo);
   - validadores adicionales registrados en `validate_product_for_publish` y `validate_store_for_launch`;
   - auditoría de cada decisión de checkout.
   Se activa por flag y entitlement. **No se diseñará ningún mecanismo para evadir restricciones legales.**
6. **Escala:** particionado de `orders` por `store_id` (hash) si alguna tabla supera ~100M filas; réplicas de lectura para analítica; *tenant pinning* en un proyecto dedicado para Enterprise.

---

## 33. Architecture Decision Records

| ADR | Decision | Context | Options | Chosen | Why | Trade-offs | Future implications |
|---|---|---|---|---|---|---|---|
| 001 | Modelo de multi-tenancy | Muchas tiendas, presupuesto inicial bajo, un equipo pequeño | (a) DB por tenant; (b) esquema por tenant; (c) esquema compartido + RLS | **(c)** | Un despliegue y una migración para todos; RLS nativo de Supabase; costo mínimo; escala a miles de tenants | El aislamiento depende de RLS correcto (mitigado con FK compuestas + suite); *noisy neighbor* | Tenant pinning a una DB dedicada para Enterprise sin cambiar el código (mismo esquema) |
| 002 | Jerarquía Org → Store | Clientes con una o varias marcas | (a) solo Store; (b) solo Org; (c) Org + Store | **(c)** | Facturación y equipo por Org, datos por Store; multi-tienda = límite de plan | Una tabla y un join extra | Multi-marca sin migración |
| 003 | Clave de aislamiento | — | `organization_id` vs `store_id` en tablas de comercio | **`store_id`** | Contexto natural de toda operación; evita fugas entre tiendas de la misma organización | Reportes por organización requieren join | Reportes consolidados vía vistas |
| 004 | FK compuestas `(store_id, id)` | RLS no protege contra bugs con service role | Solo RLS / RLS + FK compuestas | **RLS + FK compuestas** | Garantía estructural: imposible referenciar filas de otra tienda | Índices únicos extra; FKs más verbosas | Base sólida para la API pública y las integraciones |
| 005 | Acceso del storefront a datos | El catálogo es público pero no debe ser enumerable globalmente | (a) anon PostgREST desde el navegador; (b) servidor con filtro por tienda y vistas | **(b)** | Menor superficie, caché en el servidor, sin scraping cruzado vía API | Menos "sin backend" | La API pública v1 será el canal oficial para terceros |
| 006 | Identidad de compradores | Supabase Auth tiene un solo pool de usuarios por proyecto | (a) pool único + `customers` por tienda; (b) auth propia por tienda; (c) proyecto Supabase por tienda | **(a) + OTP/magic link sin contraseña** | Simple; aislamiento de datos por `customers.store_id`; sin contraseñas compartidas entre marcas que confundan al comprador | Un email = una identidad global (invisible para el comprador; cada tienda solo ve su `customer`) | Si un tenant exige identidad aislada: auth propia por tienda (FUT) |
| 007 | Ubicación de la lógica transaccional | Checkout, inventario y pagos requieren atomicidad | TS con transacciones vía SQL directo / funciones Postgres | **Funciones Postgres (RPC) para invariantes, TS para orquestación** | PostgREST no ofrece transacciones multi-llamada; invariantes junto a los datos | Lógica en dos lenguajes; requiere pgTAP | Reutilizable por API, jobs y apps |
| 008 | Enums | Estados evolucionan | `CREATE TYPE ENUM` / text + CHECK | **text + CHECK** | Cambiar valores = cambiar el CHECK en una migración; sin bloqueos de tipos | Sin tipo nominal en la base de datos (los tipos de TS generados lo compensan) | — |
| 009 | Dinero | Precisión | float / numeric / bigint en centavos | **bigint centavos + moneda** | Exacto, rápido, sin errores de redondeo implícito | Conversión en la UI | Multi-moneda: agregar tablas de precios por moneda |
| 010 | Pagos | Varios proveedores por mercado | Acoplar a uno / abstracción | **`PaymentProvider` + cuenta propia de la tienda (merchant of record)** | Sin riesgo regulatorio de agregador; cambiar o agregar proveedor = adaptador | Onboarding de la tienda más largo; sin comisión automática de plataforma | Marketplace/Connect para comisiones (FUT) |
| 011 | Dominios y hosting | Subdominios, dominios propios y SSL automático | Vercel / Cloudflare for SaaS / auto-hospedado | **Vercel + `DomainProvider`** | SSL automático, API de dominios, integración nativa con Next.js | Costo por uso y dependencia de Vercel (abstraída) | Migrable a Cloudflare for SaaS con otro adaptador |
| 012 | Dominio raíz de storefronts | Aislamiento de cookies y orígenes | Mismo dominio que el panel / dominio separado | **Dominio separado** (o el mismo con entrada en la PSL) | Contiene XSS de tienda y aísla sesiones | Comprar un dominio extra | — |
| 013 | Búsqueda | Nombre, SKU, categoría, marca, tags | Postgres FTS + trigram / Meilisearch / Algolia | **Postgres (tsvector + `unaccent` + `pg_trgm`)** detrás de `SearchProvider` | Sin infraestructura extra; suficiente para miles de SKUs por tienda | Ranking y tolerancia a errores limitados | Indexar en un motor externo vía outbox cuando haga falta |
| 014 | Jobs | Reservas, emails, importaciones, reconciliación | Inngest/Trigger.dev / pgmq / tabla `jobs` + pg_cron | **Tabla `jobs` (SKIP LOCKED) + pg_cron → endpoint HMAC** | Cero servicios extra; transaccional con los datos (outbox real) | Throughput limitado (suficiente para cientos de tiendas); el worker vive en serverless (límite de duración) | Migrar a pgmq o Inngest sin cambiar `enqueue()` |
| 015 | Caché | Storefront rápido | Redis / Next Data Cache + CDN | **Next cache por tags + CDN de Vercel** | Sin infraestructura extra; invalidación precisa por tienda y producto | Acoplado al runtime de Next/Vercel | Redis si aparecen datos calientes compartidos |
| 016 | API | Panel, storefront y terceros | REST para todo / GraphQL / Server Actions + RPC + REST futura | **Server Actions + RSC internamente; RPC para transacciones; REST v1 para terceros (FUT)** | Mínimo código de API en el MVP sin cerrar la puerta a integraciones | Server Actions no son API pública | La API v1 reutiliza los servicios |
| 017 | Temas | White-label sin explotar el alcance | Page builder libre / temas por código + tokens + secciones | **Tema en código + tokens + secciones predefinidas** | Calidad, rendimiento y accesibilidad garantizados; soporte barato | Menos libertad para el comerciante | Más temas y secciones; builder si el mercado lo exige |
| 018 | Billing SaaS | Sin clientes aún | Integrar billing ya / manual con modelo listo | **Modelo completo + cobro manual** | No construir lo que aún no se necesita; los límites ya se aplican | Trabajo manual al inicio | `BillingProvider` en P2 |
| 019 | Analítica | KPIs vs. comportamiento | Pipeline de eventos en MVP / KPIs desde pedidos | **KPIs desde pedidos (MVP); eventos particionados (P2)** | Datos reales sin infraestructura nueva | Sin conversión en el MVP | Eventos particionados → rollups → warehouse si escala |
| 020 | Storage | Imágenes y documentos por tienda | Bucket por tienda / buckets por tipo con prefijo `store_id` | **Buckets por tipo + prefijo `{store_id}/`** + políticas por membresía | Pocas políticas, aislamiento por ruta, CDN público para imágenes | Requiere validar el prefijo en las políticas | CDN externo si crece el costo |
| 021 | Auth de staff | Seguridad del panel | Solo contraseña / + MFA / SSO | **Email + contraseña o magic link, MFA TOTP obligatorio para roles altos y de plataforma** | Equilibrio entre seguridad y fricción | Soporte de recuperación de MFA | SSO/SAML para Enterprise (FUT) |
| 022 | Estados de pedido | Casos reales parciales | Enum único / tres ejes | **Tres ejes + estado visible derivado** | Representa envíos y reembolsos parciales sin estados combinatorios | Más complejidad conceptual (documentada) | Compatible con devoluciones y edición de pedidos |

---

## 34. Risk Register

| ID | Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|---|
| R-01 | Fuga de datos entre tenants por una política RLS incorrecta o por uso del service role | Media | Crítico | **CRITICAL** | FK compuestas, suite de aislamiento obligatoria, meta-tests, lint del service role, CODEOWNERS, pentest |
| R-02 | Alcance del MVP excesivo (no se termina) | Alta | Alto | **HIGH** | MoSCoW estricto (§31); fases con DoD; todo lo nuevo entra como P2 por defecto |
| R-03 | Overselling por concurrencia o pagos tardíos | Media | Alto | **HIGH** | Actualización condicional atómica, reservas, test de concurrencia, manejo de `needs_attention` |
| R-04 | Pedido marcado como pagado sin pago real (webhook falso o mal procesado) | Baja | Crítico | **HIGH** | Firma + re-consulta + validación de monto + idempotencia + reconciliación |
| R-05 | Dependencia de Vercel o Supabase (precios, límites, caídas) | Media | Alto | **HIGH** | Adaptadores; Postgres estándar (portable); monitoreo de costos; plan de salida documentado |
| R-06 | Costos de infraestructura que crecen más rápido que los ingresos (imágenes, funciones, ancho de banda) | Media | Medio | **MEDIUM** | Presupuestos y alertas de costo; transformaciones de imagen acotadas; caché agresiva; límites de almacenamiento por plan |
| R-07 | Límites de Supabase Auth con dominios propios (redirect URLs, emails sin marca) | Alta | Medio | **MEDIUM** | OTP sin redirección para compradores; Send Email Hook; alta de dominios en la allowlist vía Management API |
| R-08 | Errores de cálculo de impuestos, redondeo o descuentos | Media | Alto | **HIGH** | Una función única, enteros, tests tabulares exhaustivos, revisión contable de casos |
| R-09 | Cumplimiento legal (protección de datos —LFPDPPP en México, GDPR si aplica—, PROFECO, términos del SaaS, productos prohibidos) | Media | Alto | **HIGH** | Asesoría legal antes del lanzamiento; política de uso aceptable; anonimización; consentimiento; registro de consentimiento de marketing |
| R-10 | XSS almacenado vía contenido del comerciante que afecta a compradores | Media | Alto | **HIGH** | Sanitización en escritura y lectura, CSP con nonce, sin CSS/JS personalizado, dominio separado |
| R-11 | Credenciales de pago de una tienda filtradas | Baja | Crítico | **HIGH** | Vault, redacción en logs, acceso mínimo, rotación |
| R-12 | *Noisy neighbor* (una tienda grande degrada a las demás) | Baja (al inicio) | Medio | **MEDIUM** | Índices por `store_id`, rate limits por tienda, monitoreo por tienda, tenant pinning futuro |
| R-13 | Migración destructiva en producción | Baja | Crítico | **HIGH** | Expand/contract, staging con copia, backup previo, PITR, revisión obligatoria |
| R-14 | Pérdida de webhooks del proveedor | Media | Medio | **MEDIUM** | Job de reconciliación; panel de webhooks fallidos |
| R-15 | Entregabilidad de email baja (pedidos sin confirmación) | Media | Medio | **MEDIUM** | SPF, DKIM y DMARC; dominio remitente de la plataforma con nombre de la tienda; P2: dominio remitente propio por tienda |
| R-16 | UX del editor de variantes o del panel demasiado compleja para comerciantes no técnicos | Media | Medio | **MEDIUM** | Pruebas con usuarios en la Fase 8; defaults inteligentes; productos simples sin ver "variantes" |
| R-17 | Abuso de la plataforma por tenants (productos ilegales, fraude, phishing) | Media | Alto | **HIGH** | Onboarding asistido (KYC ligero), política de uso aceptable, suspensión desde el Super Admin, revisión de tiendas nuevas antes de activarlas |
| R-18 | Proveedor de pago rechaza la categoría de un tenant | Media | Medio | **MEDIUM** | Validación de credenciales live antes del lanzamiento; múltiples proveedores (P2) |
| R-19 | Rendimiento degradado con catálogos grandes (> 10k SKUs) | Baja | Medio | **LOW** | Paginación por cursor, índices, límites por plan, búsqueda externa futura |
| R-20 | Deriva entre el blueprint y la implementación (decisiones ad hoc de agentes) | Media | Medio | **MEDIUM** | `/docs` como fuente oficial, `CLAUDE.md` con reglas, ADR obligatorio para desviaciones, revisión por fase |
| R-21 | Restauración por tenant compleja en el modelo compartido | Baja | Alto | **MEDIUM** | Runbook probado de restore selectivo, soft deletes, auditoría con estado anterior, exportación por tenant |

---

## 35. Open Questions

Solo las decisiones que realmente son tuyas. Cada una trae un default propuesto: si no respondes, se usa el default.

| # | Pregunta | Por qué importa | Default propuesto [DEF] |
|---|---|---|---|
| Q1 | **¿País, moneda e idioma de lanzamiento?** | Impuestos, formato de dirección, proveedores de pago y envío, textos legales | México, MXN, español (es-MX), precios con IVA 16% incluido |
| Q2 | **¿Cada tienda cobra con su propia cuenta de pago, o la plataforma cobra y luego paga a las tiendas?** | Responsabilidad regulatoria, contracargos, modelo de ingresos | Cada tienda con su propia cuenta (merchant of record); la plataforma cobra solo la suscripción |
| Q3 | **¿Primer proveedor de pago?** | Orden de implementación | Mercado Pago Checkout Pro + método "manual"; Stripe en P2 |
| Q4 | **¿Hosting en Vercel y base de datos en Supabase (plan Pro con PITR)?** | Costos mensuales fijos desde el inicio (aprox. Supabase Pro + PITR + Vercel Pro) | Sí. Confirmar presupuesto |
| Q5 | **¿Aceptas que los compradores inicien sesión sin contraseña (código por email) y que la compra sea como invitado por defecto?** | Simplifica la identidad multi-tienda y mejora la conversión | Sí |
| Q6 | **¿Nombre y dominio(s) de la plataforma?** | Subdominios, emails, cookies; recomiendo un dominio separado para las tiendas | Necesito tu respuesta; propongo 2 dominios: `{marca}.com` (panel y marketing) + `{marca}-tiendas.com` o similar (storefronts) |
| Q7 | **¿Qué pasa con la tienda de productos regulados de la conversación anterior?** ¿Es el primer tenant? | Si es el primer tenant, el módulo de cumplimiento por jurisdicción pasa de FUT a ser bloqueante para *ese* tenant (no para la plataforma), y su catálogo PDF sigue pendiente | La plataforma se construye sin módulo regulatorio. Ese tenant no se activa hasta que exista el módulo de cumplimiento y su catálogo esté verificado. La política de uso aceptable prohíbe categorías ilegales |
| Q8 | **¿Productos digitales o servicios en el MVP?** | Flujo de entrega propio | No en el MVP (esquema listo, P2) |
| Q9 | **¿Alta de tiendas: asistida por ti o autoservicio (registro público)?** | El autoservicio exige verificación, antifraude y facturación automática | Asistida en el MVP (tú creas el tenant e invitas al dueño); autoservicio en P2 |
| Q10 | **Planes: nombres, precios, límites y política al bajar de plan** | Valores de entitlements | Estructura de §26.2 con valores placeholder; al bajar de plan no se borra nada, solo se bloquean altas nuevas |
| Q11 | **¿Se requiere facturación electrónica (CFDI) en el lanzamiento?** | Integración con PAC, datos fiscales del comprador | No en el MVP; capturar RFC opcional en el checkout (P2) |
| Q12 | **Retención de datos de tiendas cerradas** | Privacidad y costo | Exportación disponible por 90 días tras el cierre; luego borrado físico, conservando solo lo exigido por ley (pedidos/fiscal) en forma anonimizada |

Decisiones que **no** necesito que tomes (las resuelve la arquitectura): stack, modelo de tenancy, RLS, estructura de roles, estados de pedido, modelo de inventario, búsqueda, jobs, caché, estructura del proyecto, herramientas de prueba y proveedor de email ([DEF] Resend, intercambiable).

---

## 36. Definition of Done

### 36.1 Por historia o PR
- [ ] Cumple los criterios de aceptación de la historia.
- [ ] Typecheck, lint y formato verdes; sin `any` ni `@ts-ignore` sin justificación.
- [ ] Tests nuevos: unit para lógica pura; pgTAP para constraints y RPC nuevas; RLS y aislamiento para tablas nuevas.
- [ ] Toda tabla nueva: RLS forzado, políticas, `store_id` con trigger de inmutabilidad, FK compuestas, índices por patrón de consulta, entrada en la matriz de §9.2 en `docs/MULTI_TENANCY.md`.
- [ ] Toda acción mutante: Zod + `requirePermission` + auditoría si es crítica.
- [ ] Sin secretos; uso del service role solo en `server/privileged`.
- [ ] UI: estados de carga, vacío, error y éxito; accesible con teclado; etiquetas; contraste; probada a 375 px y a 1280 px.
- [ ] Migración reversible o con plan de reversa documentado; probada desde cero y sobre el estado anterior.
- [ ] Documentación de `/docs` actualizada si cambió una decisión (+ ADR si contradice el blueprint).

### 36.2 Por fase
- [ ] Todas las historias de la fase cumplen 36.1.
- [ ] Suite completa verde en CI (incluido el aislamiento).
- [ ] E2E críticos de la fase verdes en staging.
- [ ] Informe de fase: cambios, archivos, migraciones, tests (con resultados), riesgos, pendientes y criterios de aceptación.
- [ ] Tu aprobación antes de iniciar la siguiente fase.

### 36.3 Para producción (release)
- [ ] Gates de §23.5.
- [ ] Supabase advisors sin hallazgos de seguridad.
- [ ] PITR activo y backup previo verificado.
- [ ] Monitoreo, alertas y health checks activos.
- [ ] Runbooks vigentes.
- [ ] Changelog.

---

## 37. Recommended Implementation Order

1. **Phase 0**: aprobación + `/docs` + `CLAUDE.md`.
2. **Phase 1**: Foundation.
3. **Phase 2**: Identity, Tenancy & Access **+ suite de aislamiento** (antes de cualquier dato de comercio; es el cimiento que no se puede reconstruir después).
4. **Phase 3**: Catalog.
5. **Phase 4**: Inventory (antes del checkout: el checkout depende de las reservas).
6. **Phase 5**: Storefront de lectura (primer resultado visible para un comerciante).
7. **Phase 6**: Cart, Shipping, Taxes, Discounts & Checkout.
8. **Phase 7**: Payments, Lifecycle & Notifications (primer pedido real en sandbox).
9. **Phase 8**: Customer Accounts & Admin Operations.
10. **Phase 9**: White-Label.
11. **Phase 10**: Platform Admin & Plans. *Nota:* las piezas mínimas del Super Admin (crear tenant, suspender) ya existen desde la Fase 2; esta fase las completa.
12. **Phase 11**: Hardening.
13. **Phase 12**: Pilot launch.

**Paralelizable** (si hay más de un implementador): Fase 9 (UI del editor de tema) en paralelo con 7–8; diseño visual del tema base desde la Fase 3; plantillas de email desde la Fase 5.

**Hito de "primera venta real en sandbox":** fin de la Fase 7. **Hito de "listo para piloto":** fin de la Fase 11.

---

## 38. Final Architectural Recommendation

Construir **una sola aplicación Next.js modular sobre una sola base Supabase compartida**, con multi-tenancy **Organization → Store** donde `store_id` aísla todos los datos de comercio, protegida por **dos barreras independientes en la base de datos**: RLS forzado con una función de permisos única, y FK compuestas `(store_id, id)` que hacen estructuralmente imposible mezclar datos de tiendas. Una suite de aislamiento obligatoria en CI lo demuestra en cada cambio.

Las invariantes de negocio (stock no negativo, numeración, totales, transiciones de pedido y pago, límites de plan) viven en **funciones Postgres transaccionales**. La UI y los Server Actions son adaptadores delgados. Los terceros (pagos, email, dominios, búsqueda) quedan detrás de interfaces para no acoplar el negocio a ningún proveedor.

El MVP se mantiene deliberadamente acotado: productos físicos, una ubicación de inventario, subdominios, un tema configurable por tokens y secciones, Mercado Pago + manual, cobro SaaS manual. Pero el **esquema ya contempla** multi-tienda, multi-almacén, dominios propios, roles personalizados, billing, flags y eventos, para que cada evolución sea una funcionalidad nueva y no una reconstrucción. Esa es la línea entre "simple al inicio" y "no reescribir a las 100 tiendas".

El primer paso de implementación, cuando lo autorices, es la Fase 1 seguida inmediatamente de la Fase 2 con su suite de aislamiento, **antes** de escribir una sola tabla de comercio.

---

## Anexo A — Contenido propuesto de `/docs` (no creados)

| Documento | Contenido (secciones de este blueprint) |
|---|---|
| `PRODUCT_SPEC.md` | §3, §4, §31 (MVP y MoSCoW), §32, glosario |
| `ARCHITECTURE.md` | §1, §6, §29, reglas de dependencia, flujo de request, jobs |
| `DATABASE.md` | §7, §8 (especificación por tabla), convenciones, política de migraciones y borrado |
| `MULTI_TENANCY.md` | §5, §9 (matriz completa por tabla), resolución de contexto, checklist para tablas nuevas |
| `SECURITY.md` | §21, cabeceras, gestión de secretos, uploads, runbook de incidentes y rotación |
| `RBAC.md` | §10 (roles, permisos, matriz, reglas de aplicación, evolución) |
| `CATALOG.md` | §11 + importación (Anexo C.1) + búsqueda (C.3) |
| `INVENTORY.md` | §12 (cantidades, movimientos, función única, concurrencia, reservas) |
| `ORDERS.md` | §13 (estados, transiciones, snapshot, totales, impuestos) + envíos |
| `PAYMENTS.md` | §14 (interfaz, flujo, webhooks, idempotencia, reembolsos, por proveedor) |
| `STOREFRONT.md` | §15, §18 (dominios), SEO (C.4), rendimiento del storefront (§22) |
| `ADMIN.md` | §16 (secciones, patrones, Super Admin) |
| `THEMING.md` | §17 + Anexo B (design system) |
| `API.md` | §19 (capas, contratos de error, futura v1, API keys, webhooks salientes) |
| `ANALYTICS.md` | §20 + métricas de plataforma |
| `TESTING.md` | §23 (herramientas, seed, suite de aislamiento, E2E críticos, gates) |
| `ROADMAP.md` | §30, §37 |
| `ADR.md` | §33 (un ADR por decisión, con formato completo) |
| `RISKS.md` | §34 |
| *(adicionales propuestos)* `OBSERVABILITY.md` (§24), `OPERATIONS.md` (§25 backups y runbooks), `BILLING.md` (§26–27), `AUDIT.md` (§28), y `CLAUDE.md` en la raíz (reglas no negociables para agentes: RLS, service role, dinero en centavos, no hardcodear tenant, cada tabla con `store_id`, etc.) | |

---

## Anexo B — UX/UI, Responsive y Accesibilidad (pasos 25–27)

### B.1 Design system
- **Base:** primitivas de Radix (accesibles) con estilos propios en Tailwind (estilo shadcn/ui copiado al repo, sin dependencia de runtime). Iconos Lucide.
- **Dos "pieles" sobre los mismos primitivos:**
  - **Panel:** neutro, denso, profesional. Inter o Geist; base de 14 px; escala 12/13/14/16/20/24/30; espaciado en múltiplos de 4; contenedores de ancho completo; color de acento de la plataforma; modo oscuro (SHOULD).
  - **Storefront:** tokens del comerciante; base de 16 px; jerarquía más amplia y respiración.
- **Jerarquía:** un CTA primario por vista; acciones secundarias en contorno o *ghost*; las destructivas en rojo y separadas.

### B.2 Componentes clave y estados

| Componente | Reglas |
|---|---|
| Tablas (panel) | Encabezado fijo, columnas alineadas (números a la derecha, tabulares), selección múltiple con barra de acciones masivas, filas clicables, estados vacío, carga (skeleton de filas) y error con reintento. En móvil se convierten en lista de tarjetas con los 3 campos clave. |
| Formularios | Etiqueta visible siempre (no solo placeholder), ayuda bajo el campo, error inline con icono y texto, foco en el primer error al enviar, autoguardado solo en borradores del editor de tema; botón de guardar fijo en móvil. |
| Modales | Solo para confirmaciones y tareas cortas; foco atrapado; `Esc` cierra; nunca modales anidados. |
| Drawers | Edición rápida (stock, nota de pedido), filtros en móvil y carrito del storefront. |
| Toasts | Confirmación no bloqueante ("Producto guardado" con "Deshacer" cuando aplique); errores críticos inline, no en toast; `aria-live="polite"`. |
| Empty states | Explican qué es la sección y ofrecen la acción principal ("Aún no tienes productos — Crear producto / Importar CSV"). |
| Loading | Skeletons con la forma del contenido (sin spinners de página completa); `loading.tsx` por segmento; acciones con estado pendiente en el botón. |
| Errores | Mensaje humano + qué hacer + código de referencia (`request_id`) para soporte; `error.tsx` por segmento; nunca trazas técnicas. |
| Confirmaciones | Resumen del impacto; las irreversibles requieren escribir la confirmación. |

### B.3 Storefront — principios de conversión
Confianza (políticas visibles, contacto, medios de pago, estado del envío claro), velocidad (§22), claridad (precio, disponibilidad y tiempo de entrega cerca del botón de compra), móvil (botón "Agregar" fijo en la página de producto en móvil, checkout de una columna, teclados adecuados por campo con `inputmode` y `autocomplete`).

### B.4 Responsive

| Breakpoint | Storefront (mobile-first) | Panel |
|---|---|---|
| < 640 (móvil) | 2 columnas de producto, menú en drawer, CTA fijo, checkout en una columna con resumen en acordeón | Barra inferior (Inicio, Pedidos, Productos, Más), tablas → tarjetas, formularios de una columna; operaciones frecuentes (ver o enviar pedido, ajustar stock) completamente usables |
| 640–1024 (tablet) | 3 columnas, filtros en drawer | Sidebar colapsable, tablas con columnas prioritarias |
| 1024–1440 (desktop) | 4 columnas, filtros laterales, checkout en dos columnas | Sidebar fija, tablas completas, detalle con columna lateral |
| > 1440 (wide) | Contenido con ancho máximo (1280–1440 px) centrado | Tablas y paneles de detalle lado a lado (lista + detalle) |

Optimizadas para escritorio (usables pero no prioritarias en móvil): editor de variantes masivo, importación CSV y editor de tema.

### B.5 Accesibilidad (objetivo WCAG 2.2 AA)
- HTML semántico (`header`, `nav`, `main`, `button` real; encabezados en orden); *skip link*.
- Navegación completa por teclado; orden de foco lógico; **foco visible** (anillo de 2 px con contraste ≥ 3:1); objetivos táctiles ≥ 24×24 px (criterio 2.5.8; recomendado 44×44 en el storefront).
- Etiquetas en todos los campos; errores asociados con `aria-describedby`; `aria-invalid`; resumen de errores enlazado.
- Contraste de texto ≥ 4.5:1 (≥ 3:1 en texto grande y componentes de UI), **verificado en tokens del comerciante**.
- Imágenes con `alt` (obligatorio para publicar productos: [DEF] advertencia en el MVP); iconos decorativos con `aria-hidden`.
- `prefers-reduced-motion` respetado (sin carruseles automáticos; transiciones mínimas).
- Anuncios dinámicos (carrito actualizado, errores) con regiones `aria-live`.
- Verificación: axe en E2E + revisión manual con teclado y lector de pantalla (VoiceOver/NVDA) en los flujos de compra y de alta de producto en la Fase 11.

---

## Anexo C — Importación/Exportación, Búsqueda, SEO, Storage y Notificaciones

### C.1 Importación y exportación (paso 16)
- **Formato MVP:** CSV UTF-8 (con detección de BOM y de separador `,` o `;`). Plantilla descargable. Excel (.xlsx) en P2.
- **Entidades MVP:** productos + variantes (una fila por variante, agrupadas por `handle`), inventario (SKU → cantidad). Categorías (por ruta "Ropa > Hombre") se crean al importar productos. Clientes: P2.
- **Flujo:**
  1. Subida al bucket privado (máx. 10 MB / 20k filas en el MVP) → `import_jobs(status=uploaded)`.
  2. Job: parseo en streaming → `import_job_rows(row_number, raw jsonb, normalized jsonb, errors jsonb, action ∈ create|update|skip)` validando con los mismos esquemas Zod del panel.
  3. **Vista previa:** "120 se crearán, 30 se actualizarán, 4 con errores" + descarga del CSV de errores.
  4. **Modo:** `create_only` / `update_existing` (coincidencia por SKU o `handle`) / `upsert`.
  5. **Commit:** por lotes de 500 filas en transacciones; [DEF] *todo o nada* hasta 5,000 filas (una transacción), por lotes con reporte por encima de eso; cada lote es idempotente (`import_job_id + row_number`) para reintentos seguros.
  6. Movimientos de inventario con `reference_type = 'import'`; auditoría `import.completed` con resumen.
- **Duplicados:** dentro del archivo (mismo SKU dos veces → error en ambas filas) y contra la base de datos (según el modo).
- **Rollback:** dentro del umbral, la transacción revierte; por encima, se registra el `import_job_id` en las filas creadas para permitir "deshacer importación" (P2).
- **Exportación:** productos, pedidos, clientes e inventario; síncrona hasta 5k filas, asíncrona por encima (archivo en el bucket privado + URL firmada de 15 min + email); escape de *formula injection*; permisos `*.export`; auditoría.

### C.2 Storage (paso 21)

| Bucket | Público | Contenido | Ruta | Límite | MIME |
|---|---|---|---|---|---|
| `store-public` | Sí (lectura) | Logos, favicons, imágenes de producto, marcas, categorías, banners | `{store_id}/{kind}/{entity_id}/{uuid}.{ext}` | 10 MB | image/jpeg, image/png, image/webp, image/avif (sin SVG) |
| `store-private` | No | Importaciones, exportaciones, documentos, activos digitales (P2) | `{store_id}/{kind}/{uuid}.{ext}` | 25 MB (imports), 500 MB (digitales P2) | text/csv, application/pdf, (xlsx P2) |
| `avatars` | Sí | Avatares de usuario | `{user_id}/{uuid}.webp` | 2 MB | imagen |
| `platform` | Mixto | Assets de la plataforma | — | — | — |

- **Políticas de `storage.objects`:** escritura en `store-*` solo si `app.has_store_permission(((storage.foldername(name))[1])::uuid, '<perm según kind>')`; lectura de `store-private` igual; `store-public` legible por todos, pero **no listable** por anon.
- **Flujo de subida:** el cliente pide al servidor una URL firmada de subida (`createSignedUploadUrl`) indicando tipo y entidad → el servidor valida permiso, cuota (`storage_mb`) y tipo declarado → el cliente sube directo → un job o callback de finalización verifica *magic bytes*, re-codifica con sharp (quita EXIF, limita a 4096 px), guarda dimensiones y registra en `product_media`; si falla, borra el objeto.
- **Transformaciones:** tamaños fijos permitidos (p. ej. 160, 320, 640, 960, 1280, 1920) vía las transformaciones de Supabase Storage o el optimizador de Next con lista blanca de anchos, para evitar abuso de costos.
- **Huérfanos:** job semanal que elimina objetos sin referencia de más de 24 h.

### C.3 Búsqueda (paso 17)
- **MVP:** `products.search_vector` (generada): `setweight(to_tsvector('spanish', unaccent(title)), 'A') || setweight(... brand name, tags, 'B') || setweight(... SKUs de variantes, categoría, 'C') || setweight(... descripción sin HTML, 'D')`. Mantenida por trigger cuando cambian variantes o marca (los SKUs viven en otra tabla). Más trigram sobre `title` para tolerancia a errores (`similarity > 0.3`) cuando FTS da pocos resultados. Búsqueda exacta de SKU prioritaria.
- **Filtros MVP:** categoría, marca, rango de precio, disponibilidad; orden por relevancia, precio, novedad y más vendidos (`products.sales_count` denormalizado).
- **Facetas con conteos:** P2 (consultas agregadas; motor externo si hace falta).
- **`SearchProvider`** permite reemplazar por Meilisearch o Typesense (indexación vía outbox) sin cambiar la UI.
- Panel: misma infraestructura + búsqueda por SKU y barcode exactos.

### C.4 SEO (paso 18)
- **Metadata:** `generateMetadata` por página: título `"{Producto} | {Tienda}"`, descripción (SEO personalizada o extracto), canonical absoluto al **dominio primario**, `og:*`/`twitter:*` con imagen del producto (1200×630 generada vía `opengraph-image` o la imagen principal).
- **Structured data (JSON-LD):** `Organization`/`OnlineStore` + `WebSite` con `SearchAction` (home); `Product` con `offers` (precio, moneda, `availability`, `priceValidUntil` si hay oferta, `sku`, `gtin` si hay barcode, `brand`) y `AggregateRating` solo si hay reseñas reales (P2); `BreadcrumbList` en categoría y producto; `ItemList` en categorías.
- **Sitemap por tienda:** `/sitemap.xml` (índice) → productos, categorías, marcas y páginas; solo publicados; `lastmod` real; resuelto por host. Por encima de 50k URLs, sitemaps paginados.
- **robots.txt por tienda:** permite el catálogo; bloquea `/carrito`, `/checkout`, `/cuenta`, `/buscar`, `/pedido`; apunta al sitemap. Tiendas `draft`: `Disallow: /` + `noindex`.
- **Canonicalización:** filtros y orden como searchParams con canonical a la URL limpia de la categoría; paginación con canonical propio por página; el subdominio redirige 301 al dominio propio primario cuando exista.
- **SEO de categoría y tienda:** título, descripción y texto introductorio editables por categoría; SEO global de la tienda en Apariencia.
- **Slugs:** generados del título (sin acentos), editables; al cambiarlos se crea un redirect 301 (`store_redirects`, P2; MVP: no se permite cambiar el slug de productos publicados sin advertencia).

### C.5 Notificaciones (paso 22)
- **Patrón:** la transacción de negocio inserta en `notification_outbox(store_id, type, recipient, payload, dedupe_key UQ, status, attempts, send_after)` → worker → `EmailProvider.send()` → `sent`/`failed` (reintentos con backoff, máximo 5) → `order_events` "email enviado".
- **`EmailProvider`:** interfaz `send({ from, replyTo, to, subject, html, text, tags })`. Adaptadores: Resend ([DEF]), Postmark o SES; `fake` en pruebas (captura en memoria o en Mailpit local).
- **Plantillas** (React Email, en código, versionadas) con branding por tienda (logo, color, nombre, contacto): `order_confirmation`, `payment_received` (si el pago fue diferido), `order_shipped` (con rastreo), `order_delivered` (P2), `order_cancelled`, `refund_issued`, `staff_invitation`, `staff_new_order`, `low_stock_alert` (resumen diario o inmediato, configurable), `customer_login_code` y `password_reset`/`magic_link` (vía Send Email Hook de Supabase Auth, con marca de la tienda o de la plataforma según el contexto), `welcome` (P2, al crear cuenta de comprador).
- **Remitente:** `"{Tienda}" <pedidos@{dominio-de-envío-de-la-plataforma}>` con `Reply-To` = email de contacto de la tienda; SPF, DKIM y DMARC en el dominio de la plataforma. P2: dominio remitente propio por tienda (verificación DNS en el proveedor).
- **Preferencias:** el staff configura quién recibe alertas; el comprador recibe solo transaccionales (los de marketing exigen consentimiento, P2).
- **Futuro:** canal WhatsApp o SMS vía `MessagingProvider` con el mismo outbox.

---

**PLANEACIÓN COMPLETADA — ESPERANDO REVISIÓN**
