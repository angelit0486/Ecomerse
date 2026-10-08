# Plan de ejecución autónoma — de la Fase 2 a la tienda lista para piloto

> **Para quién es:** Claude (u otro agente) trabajando sin supervisión continua.
> **Qué resuelve:** que el agente avance sesión tras sesión hasta terminar, sin pedir permiso para cada paso, sin romper la seguridad y sin inventar decisiones que no le corresponden.
> **Fuentes de verdad, en este orden:** `CLAUDE.md` (reglas de no regresión) → `docs/architecture/GATE0-ARCHITECTURE-REVIEW.md` (contrato) → `docs/DECISIONS.md` → este plan.
> **Estado vivo:** `docs/plan/PROGRESS.md`. Se lee al empezar cada sesión y se actualiza después de cada tarea.

---

## 1. Qué significa "terminar la tienda"

**Meta del modo autónomo (lo que Claude puede completar solo):** la plataforma completa del MVP (GATE0 §31) construida, probada y documentada hasta el final de la **Fase 11 (Hardening)**, lista para que una persona la despliegue. En concreto:

1. Un administrador de plataforma da de alta una tienda y el dueño la configura en 4 pasos (cuenta + 2FA, datos y branding, pagos, publicar).
2. El dueño gestiona catálogo con variantes, inventario, equipo con roles, envíos, impuestos, descuentos y apariencia.
3. Un comprador navega la tienda en su subdominio, busca, agrega al carrito, paga (Stripe Connect en modo prueba, o pago manual) y recibe sus emails.
4. El dueño surte, cancela y reembolsa pedidos; ve su dashboard; importa y exporta CSV.
5. El administrador de plataforma gestiona planes, límites, suspensiones y soporte auditado.
6. Todo con las suites de aislamiento, seguridad, accesibilidad y rendimiento en verde.
7. **La tienda de suplementos del propietario** (Q-B3 revisada, `DECISIONS.md` §11): ficha regulada con leyendas verificadas antes de publicar, filtros por objetivo, OXXO, meses sin intereses, descuento de primera compra y paquetes (Fases R y P). El contenido (catálogo, fotos, precios y leyendas) lo aporta el propietario con su asesor regulatorio.

**Fuera del modo autónomo (requiere a una persona):** la Fase 12 (producción) y todo lo listado en §3: cuentas reales, dominios, DNS, claves de producción, textos legales finales y la decisión de abrir a clientes.

---

## 2. Cómo trabaja Claude solo

### 2.1 Arranque de cada sesión (siempre, en este orden)

1. Leer `CLAUDE.md`, este plan y `docs/plan/PROGRESS.md`.
2. `git fetch` y `git status`. Comparar la rama local con `origin`. Si hay commits locales sin subir, **intentar el push primero** (§2.5).
3. Preparar el entorno (§6) y ejecutar `pnpm verify` y `pnpm db:test`. **Si algo está en rojo al arrancar, arreglarlo antes de cualquier tarea nueva.**
4. Tomar la primera tarea `pendiente` de `PROGRESS.md` cuyas dependencias estén `hecha`.

### 2.2 Ciclo por tarea

```
leer la tarea y las secciones del contrato que cita
  → escribir primero las pruebas que la definen (pgTAP / unit / integración / E2E)
  → implementar lo mínimo que las pone en verde
  → pnpm verify  +  pnpm db:test  (+ E2E si la tarea toca UI)
  → si la tarea toca seguridad: prueba de mutación (§5.3)
  → actualizar docs (DECISIONS.md si hubo decisión; runbook si hay pasos de entorno)
  → commit con el ID de la tarea  →  push (§2.5)
  → marcar la tarea `hecha` en PROGRESS.md con la evidencia (número de pruebas, commit)
```

**Tamaño:** cada tarea cabe en un commit revisable. Si al empezar resulta más grande, dividirla en `PROGRESS.md` antes de programar.

### 2.3 Cierre de fase (gate automático)

Cuando todas las tareas de una fase están `hecha`:

1. Ejecutar la checklist de la fase (§4, "Gate").
2. Ejecutar las skills `security-review` y `code-review` sobre el diff de la fase y corregir todo hallazgo de severidad media o mayor.
3. Escribir `docs/phases/PHASE-NN-REPORT.md` con el formato de `PHASE-01-REPORT.md`: cambios, archivos, migraciones, pruebas con resultados, riesgos, pendientes, criterios y DoD.
4. Commit + push y **continuar con la fase siguiente sin esperar aprobación**. La revisión humana de cada informe es asíncrona: si el propietario pide cambios, entran como tareas prioritarias al inicio de `PROGRESS.md`.

> Esto sustituye la regla "no avanzar sin aprobación humana" **solo para el modo autónomo, porque el propietario lo pidió explícitamente**. Las pruebas automáticas hacen de gate. Nunca se avanza con pruebas en rojo.

### 2.4 Cuándo DETENERSE y preguntar (lista cerrada)

Claude se detiene, escribe la pregunta en `PROGRESS.md` (sección "Bloqueos") y avisa al propietario **solo** si:

| #   | Situación                                                                                                        | Qué hacer mientras tanto                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Una tarea exige violar una regla de `CLAUDE.md` o cambiar un contrato crítico (GATE0 §43).                       | Escribir una propuesta de ADR y seguir con otra tarea que no dependa de ella.                                                                                                               |
| S2  | Se necesita una credencial, cuenta o servicio externo real (§3).                                                 | Usar el adaptador `fake` y seguir; la verificación real queda como pendiente de la fase.                                                                                                    |
| S3  | Una decisión es legal, fiscal, comercial o de marca y no está en §3.1.                                           | Usar un marcador de posición evidente (`PENDIENTE_DE_DEFINIR`) y seguir.                                                                                                                    |
| S4  | Una prueba de seguridad o aislamiento falla y la corrección no es obvia tras 3 intentos con hipótesis distintas. | Detenerse. **Nunca** se debilita, salta ni pone en cuarentena una prueba.                                                                                                                   |
| S5  | El push falla y hay 3 o más commits sin subir (riesgo de perder trabajo).                                        | Generar un `git bundle` en el scratchpad, enviarlo al propietario y seguir trabajando.                                                                                                      |
| S6  | Se detecta que una decisión aprobada es incorrecta (bug de diseño, vulnerabilidad).                              | Documentar el hallazgo con el formato "decisión actual → problema → impacto → alternativas → recomendación". Corregir solo si es una mejora de seguridad sin cambio de contrato; si no, S1. |

**Todo lo demás lo decide Claude** con criterio profesional y lo registra en `DECISIONS.md`: nombres, estructura interna, librerías pequeñas y justificadas, diseño visual dentro del sistema de diseño, orden interno de las tareas y casos de prueba adicionales.

### 2.5 Git y entrega

- Rama: `claude/ecommerce-regulated-platform-41vu1e`. Nunca se hace push a otra rama ni se crea un PR sin que lo pidan.
- `git push -u origin <rama>`; ante un error de red, reintentar con espera de 2, 4, 8 y 16 s.
- **Bloqueo actual (P0):** el push devuelve 403 porque la app de Claude no tiene acceso a `angelii33/pruva`. Mientras siga así, rige S5: commits locales + bundle de respaldo.
- Mensajes de commit en español: `[F3-T04] Catálogo: RPC catalog_upsert_product`, más las líneas de atribución que indique el sistema.

---

## 3. Lo que solo puede hacer una persona

| Requisito                                                                                                            | Se necesita para                                            | Hasta entonces, Claude usa                                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **P0 · Acceso de escritura de Claude a GitHub** (https://claude.ai/connect-github + app instalada en el repositorio) | Guardar el trabajo y ejecutar el CI. **Bloquea de verdad.** | Commits locales + bundles (S5).                                                                            |
| Proyecto Supabase (Pro + PITR)                                                                                       | S-1, S-2, `supabase test db`, staging                       | PostgreSQL 16 local + shim + stack local (§6).                                                             |
| Proyecto Vercel (Pro, por el cron cada minuto)                                                                       | Despliegue de staging y producción                          | `next build` / `next start` local.                                                                         |
| Cuenta Stripe con Connect en modo prueba (claves `sk_test`/`pk_test` + secreto de webhook)                           | Verificar el adaptador real (S-4)                           | Adaptador `fake` + pruebas de contrato con payloads reales de la documentación de Stripe.                  |
| Proveedor de email (Resend) + dominio remitente verificado                                                           | Emails reales                                               | Canal `fake` que registra los mensajes (y los muestra en desarrollo).                                      |
| Nombres de los dos dominios (N-3)                                                                                    | Despliegue de la Fase 5 en adelante                         | `platform_settings.storefront.root_domain` y variables de entorno con valores de ejemplo (`tiendas.test`). |
| Valores comerciales de los planes (Q-N4)                                                                             | Venta del SaaS                                              | Planes de ejemplo marcados `PENDIENTE_DE_DEFINIR`.                                                         |
| Textos legales (términos, privacidad, uso aceptable)                                                                 | Lanzamiento                                                 | Plantillas con aviso visible "requiere revisión legal".                                                    |
| Pentest externo, decisión de lanzar, producción                                                                      | Fase 12                                                     | —                                                                                                          |

### 3.1 Decisiones preaprobadas para no detenerse

Se usan los defaults ya aceptados (Gate 0, Q-B1…Q-B5, Q-N1…Q-N8) y estos, que resuelven lo que quedaba abierto. Cada uno se registra en `DECISIONS.md` al aplicarse; el propietario puede revertir cualquiera.

| ID   | Decisión por defecto                                                                                                                                                                                                                                                                                                                                                                                                            | Razón                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-01 | **Pagos: Stripe Connect** (cuentas Standard, cargos directos; la tienda es el merchant of record) como primer adaptador real, más `manual` y `fake`. Mercado Pago queda como segundo adaptador (P2).                                                                                                                                                                                                                            | El propietario mencionó "Stripe Connect" dos veces (Q-B1 y Fase 2). Respeta ADR-009 y evita guardar secretos de cada tienda: basta el `stripe_account_id`. |
| A-02 | **Onboarding paso 3 (pagos):** en la Fase 2 se muestra como "Conectar pagos — disponible al activar pagos" y la tienda queda en borrador. Se completa en la Fase 7 con Stripe Connect. **Paso 4 (publicar):** solo después de la Fase 7, cuando la validación de lanzamiento lo permite; hasta entonces "Guardar en borrador".                                                                                                  | Respeta la regla 15 (no usar contratos de fases futuras) y la validación de lanzamiento (§14.3).                                                           |
| A-03 | **Stack local sin Docker** (las imágenes de Supabase están bloqueadas): PostgreSQL 16 + binarios de PostgREST y Supabase Auth (GoTrue) descargados de GitHub Releases + Mailpit para emails (spike S-6). Si S-6 falla, la capa de datos del usuario se implementa con conexión directa `SET LOCAL ROLE authenticated` + claims del JWT verificado en el servidor (misma semántica de RLS que PostgREST) y se registra como ADR. | Permite pruebas de integración y E2E reales del panel.                                                                                                     |
| A-04 | **UI:** primitivas de Radix (Dialog, Popover, Select, Checkbox, Tabs, Toast) estilizadas con los tokens propios. Sin librerías de componentes completas.                                                                                                                                                                                                                                                                        | Accesibilidad probada (WAI-ARIA) con poca dependencia.                                                                                                     |
| A-05 | **CSP del storefront (Fase 5):** renderizado dinámico + caché de datos por tags (`use cache`/`cacheTag`) con nonce. Se evalúa SRI experimental y se elige con un ADR según las mediciones de Lighthouse.                                                                                                                                                                                                                        | D-F1-02.                                                                                                                                                   |
| A-06 | **Imágenes:** optimizador de Next con lista blanca de anchos (S-3 default) y procesamiento con `sharp` en el worker.                                                                                                                                                                                                                                                                                                            | Sin depender del plan de Supabase.                                                                                                                         |
| A-07 | **Emails:** plantillas con React Email + adaptador Resend + canal `fake`.                                                                                                                                                                                                                                                                                                                                                       | GATE0 §27.                                                                                                                                                 |
| A-08 | **E2E:** Playwright con el Chromium preinstalado (`/opt/pw-browsers`), contra el stack local de A-03.                                                                                                                                                                                                                                                                                                                           | Ya disponible en el entorno.                                                                                                                               |
| A-09 | **Textos de interfaz:** español de México, tono directo y profesional, sin relleno de marketing.                                                                                                                                                                                                                                                                                                                                | GATE0 §32.1.                                                                                                                                               |
| A-10 | **Datos de demostración:** `supabase/seed.sql` con una tienda de ejemplo ficticia y genérica, claramente marcada como demo (sin marcas ni productos reales).                                                                                                                                                                                                                                                                    | Para E2E y revisión visual.                                                                                                                                |

---

## 4. Backlog por fase

**Leyenda de tamaño:** S ≤ ½ día · M ≈ 1 día · L ≈ 2 días o más (dividir si es posible).
Cada fase repite el ciclo de §2.2 y cierra con su **Gate** (§2.3). Las referencias (§x) son de GATE0.

### FASE 2 — Identity, Tenancy & Access (resto: C, servidor, UI, onboarding)

Ya hecho: A + B (commit `4b74b5d`): tablas, RLS, autorización, auditoría, RPC de alta e invitación, branding, resolución de host y 196 pruebas pgTAP.

| ID          | Tarea                                                                                                                                                                                                                                                                                                                                                                       | Tam. | Pruebas de aceptación                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| F2-T01      | **Spike S-6:** stack local sin Docker (PostgREST + GoTrue + Mailpit) con script `scripts/dev/stack.sh`; si falla, ADR del plan B (A-03).                                                                                                                                                                                                                                    | M    | Login OTP real contra GoTrue local; consulta con JWT a PostgREST respeta RLS.            |
| F2-T02      | RPC de equipo: `access_invite_member`, `access_change_member_role`, `access_suspend_member`/`reactivate`, `access_remove_member`, `access_revoke_invitation`, `access_transfer_ownership`, `access_list_store_members` (nombres de co-miembros). Reglas: rango (no asignar ≥ propio), nadie toca al dueño, `store_admin` no crea `store_admin`, límite de staff, auditoría. | L    | pgTAP de escalada: 1 caso por regla de §8.3 + ataques cross-tenant.                      |
| F2-T03      | RPC de soporte: `platform_grant_support_access` (motivo, ≤ 60 min, sin autoconcesión, encola aviso al dueño), `platform_revoke_support_access`, revocación por el dueño, `support_log_page_view` (auditoría).                                                                                                                                                               | M    | pgTAP: concesión, expiración, revocación por ambos lados, aviso encolado, auditoría.     |
| F2-T04      | Feature flags (`feature_flags`, overrides plan/org/tienda, `app.flag_enabled`, kill switch) y `platform_set_tenant_status`.                                                                                                                                                                                                                                                 | M    | pgTAP del orden de resolución (§27.2) y de la suspensión de tenant.                      |
| F2-T05      | Capa de servidor: cliente Supabase SSR (`@supabase/ssr`), `getSession`, `AuthorizationContext`, `requirePermission`, espejo TS de los permisos con prueba de sincronización con la base, mapeo de errores SQL → `AppError`, `gatewayDb`.                                                                                                                                    | L    | Unit + integración contra el stack local; la prueba de sincronización falla si difieren. |
| F2-T06      | Proxy: host del panel vs host de tienda; `storefront.resolve_host` con caché de 60 s; reescritura a `/_store/[storeId]`; bloqueo de `/_store` externo; 404 uniforme; 503 de suspensión; token de vista previa HMAC (CF-09).                                                                                                                                                 | M    | Unit del proxy + integración: dos hosts, dos tiendas, sin mezcla.                        |
| F2-T07      | Auth de staff: login con código por email → enrolamiento y verificación TOTP → AAL2; recuperación (reset de MFA por el dueño vía SR-1, auditado); eventos de seguridad de login.                                                                                                                                                                                            | L    | E2E: login, TOTP, sin TOTP no entra al panel; eventos registrados.                       |
| F2-T08      | Job `access.invitation_email`: emite el token (worker), arma el enlace y lo envía por el canal `fake` (visible en Mailpit o en el log de desarrollo).                                                                                                                                                                                                                       | S    | Integración: el email contiene el enlace; el token no queda en ningún log.               |
| F2-T09      | Primitivas de UI faltantes (D-F1-08): Dialog, Drawer, Toast, Select, Checkbox, Table, Tabs (A-04).                                                                                                                                                                                                                                                                          | M    | Unit con jsdom + axe (sin violaciones serias).                                           |
| F2-T10      | Panel: layout `/admin/[storeHandle]`, selector de tienda, aceptación de invitación, pantallas de MFA, Ajustes → Equipo (invitar, cambiar rol, suspender, quitar).                                                                                                                                                                                                           | L    | E2E: un `catalog_manager` no ve Equipo; las acciones forzadas devuelven 403.             |
| F2-T11      | Onboarding en 4 pasos: (1) cuenta + 2FA, (2) datos de la tienda + branding (colores con validación de contraste y vista previa), (3) pagos según A-02, (4) guardar en borrador.                                                                                                                                                                                             | L    | E2E del flujo completo; el contraste insuficiente bloquea guardar.                       |
| F2-T12      | Consola de plataforma mínima: crear tenant, suspender o reactivar, conceder o revocar soporte, ver concesiones.                                                                                                                                                                                                                                                             | M    | E2E: `platform_support` no puede crear tenants; concesión con motivo.                    |
| **Gate F2** | Suite de aislamiento + autorización + E2E; `security-review`; informe `PHASE-02-REPORT.md`.                                                                                                                                                                                                                                                                                 |      |                                                                                          |

### FASE 3 — Catalog & Media (§14, §25)

| ID          | Tarea                                                                                                                                                                                                                                                                                                                                                        | Tam. | Pruebas                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | -------------------------------------------------------------------------------------- |
| F3-T01      | Migraciones del catálogo: `brands`, `categories` (`path`, anti-ciclos, ≤ 4 niveles), `products`, `product_options`, `product_option_values`, `product_variants` (firma de opciones, SKU único por tienda), `variant_option_values`, `variant_costs`, `product_categories`, `media`. Extensiones `pg_trgm`, `unaccent`, `btree_gin`. RLS + grants + triggers. | L    | Metatests verdes; pgTAP de unicidades, FK compuestas, ciclos, inmutabilidad y límites. |
| F3-T02      | RPC: `catalog_upsert_product` (transaccional), `catalog_publish_product` + `validate_product_for_publish`, archivar, borrado lógico y restauración, duplicar, `catalog_move_category`, búsqueda del panel.                                                                                                                                                   | L    | pgTAP + la suite de aislamiento genérica cubre las tablas nuevas automáticamente.      |
| F3-T03      | Storage: buckets `store-media` y `store-private`, políticas por `store_id`, `media_create_upload`/`media_finalize`, job `media.process` (magic bytes, `sharp`, sin EXIF, límite de píxeles), purga de huérfanos (SR-2 en `server/privileged/storageAdmin.ts`).                                                                                               | L    | Fixtures maliciosos (polyglot, SVG, MIME falso, bomba de descompresión) → `rejected`.  |
| F3-T04      | Sanitización de HTML (`description_html`) y componente `SafeHtml` (única excepción a `react/no-danger`).                                                                                                                                                                                                                                                     | S    | Unit con payloads XSS conocidos.                                                       |
| F3-T05      | UI del catálogo: listado con filtros, cursor y acciones masivas; editor simple y con variantes (generador de combinaciones, tabla de variantes); categorías en árbol; marcas; subida de imágenes.                                                                                                                                                            | L    | E2E: la "Playera" de 6 variantes → publicar → archivar → restaurar; axe.               |
| F3-T06      | Logo de la tienda en el branding (pendiente de D-F2-05) con el pipeline de medios.                                                                                                                                                                                                                                                                           | S    | E2E.                                                                                   |
| **Gate F3** |                                                                                                                                                                                                                                                                                                                                                              |      |                                                                                        |

### FASE 4 — Inventory (§15)

| ID          | Tarea                                                                                                                                                   | Tam. | Pruebas                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| F4-T01      | `inventory_locations` (por defecto + backfill + trigger), `inventory_levels`, `inventory_movements` (append-only), `inventory_reservations` + `_items`. | M    | Metatests; pgTAP de inmutabilidad del ledger.                                                              |
| F4-T02      | `app.apply_inventory_movement` (UPDATE condicional atómico, idempotencia) y `inventory_adjust` (motivo obligatorio).                                    | M    | **Concurrencia: 20 compradores por 1 unidad → exactamente 1**; deadlock multilínea; invariante del ledger. |
| F4-T03      | UI: tabla de inventario, ajuste con motivo, historial, umbral de stock bajo.                                                                            | M    | E2E.                                                                                                       |
| **Gate F4** |                                                                                                                                                         |      |                                                                                                            |

### FASE 5 — Storefront, Content & SEO (§21, §24)

| ID          | Tarea                                                                                                                                                                                 | Tam. | Pruebas                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------- |
| F5-T01      | `menus`, `menu_items`, `store_pages` (+ plantillas de políticas en borrador).                                                                                                         | M    | pgTAP + aislamiento.                                           |
| F5-T02      | Funciones `storefront.*` de lectura: tienda, home, listado, producto, categoría, marca, búsqueda, menús, página, disponibilidad como estado (nunca cantidades), entradas del sitemap. | L    | pgTAP como `storefront_gateway`; nada de borradores ni costos. |
| F5-T03      | Tema base: home por secciones, catálogo, categoría, marca, producto (selector de variantes), búsqueda, páginas, header y footer, 404, 503, barra de vista previa. Mobile-first.       | L    | E2E en dos hosts; axe; capturas a 375 y 1280 px.               |
| F5-T04      | Caché por tags + invalidación desde el panel + ADR de CSP (A-05).                                                                                                                     | M    | La página de A nunca se sirve en el host de B.                 |
| F5-T05      | SEO: metadata, canonical al primario, OG/Twitter, JSON-LD (Product, BreadcrumbList, Organization), sitemap y robots por host, `noindex` en borrador o vista previa.                   | M    | Validación de JSON-LD; sitemap por host.                       |
| F5-T06      | Editor mínimo de menús y páginas en el panel.                                                                                                                                         | M    | E2E.                                                           |
| **Gate F5** | Lighthouse ≥ 90 en storefront (Lighthouse CI).                                                                                                                                        |      |                                                                |

### FASE 6 — Customers, Cart, Shipping, Taxes, Discounts & Checkout (§17)

| ID          | Tarea                                                                                                                                                                                                       | Tam. | Pruebas                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| F6-T01      | `customer_addresses`, `carts`, `cart_items`, `shipping_zones`, `shipping_rates`, `discounts`, `discount_redemptions` (con estado), `orders`, `order_items`, `order_events`, `payment_accounts`, `payments`. | L    | Metatests + aislamiento + pgTAP de CK de totales e inmutabilidad del snapshot.     |
| F6-T02      | `app.calculate_cart` (redondeo half-even, prorrateo por residuo mayor, impuesto incluido o no, envío gratis desde X).                                                                                       | M    | **Tabla de casos dorados** (que el propietario pueda revisar después).             |
| F6-T03      | `storefront.cart_*` y `storefront.place_order` (§17.4: idempotencia, `price_changed`, reservas, contador, cupón, rollback total).                                                                           | L    | pgTAP: cada error de §17.6; concurrencia sobre el último cupón y la última unidad. |
| F6-T04      | Job de expiración de reservas y pedidos; contrato `PaymentProvider` + adaptadores `manual` y `fake`.                                                                                                        | M    | Integración.                                                                       |
| F6-T05      | UI: drawer y página del carrito, checkout de una página, resultado, pedido de invitado; panel: envíos, impuestos, descuentos, listado de pedidos (lectura).                                                 | L    | E2E hasta "pagado" con `fake`; precio manipulado se ignora.                        |
| **Gate F6** |                                                                                                                                                                                                             |      |                                                                                    |

### FASE 7 — Payments, Lifecycle & Notifications (§18, §27)

| ID          | Tarea                                                                                                                                                                                        | Tam. | Pruebas                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| F7-T01      | Adaptador **Stripe Connect** (A-01): onboarding OAuth/Account Links, `createCheckout` con expiración, `verifyWebhook` (firma + tolerancia), `fetchPayment`, `refund`.                        | L    | Pruebas de contrato con payloads y firmas de ejemplo; verificación real en sandbox = pendiente humano (§3).                     |
| F7-T02      | `payment_events`, webhook `/api/webhooks/payments/[provider]/[accountId]`, `system.apply_payment_status` (monótono, pago tardío CF-04), reconciliación.                                      | L    | **§34.4 completa** (firma inválida, duplicado, fuera de orden, monto alterado, cuenta equivocada, pago tardío con y sin stock). |
| F7-T03      | `refunds`, `shipments`, `shipment_items`; `orders_fulfill`, `orders_cancel`, `orders_request_refund` + job.                                                                                  | L    | pgTAP + integración; reembolso mayor a lo cobrado → rechazado.                                                                  |
| F7-T04      | Notificaciones: `NotificationChannel` (Resend + `fake`), plantillas React Email con la marca de la tienda, reglas de §27.2, idempotencia por `dedupe_key`; Send Email Hook de Supabase Auth. | L    | Integración: un evento reprocesado envía un solo email.                                                                         |
| F7-T05      | `validate_store_for_launch` + `stores_launch`; **completar los pasos 3 y 4 del onboarding** (A-02).                                                                                          | M    | E2E: una tienda sin pagos ni políticas no se publica.                                                                           |
| F7-T06      | UI de pedidos: detalle con timeline, surtir (parcial), cancelar, reembolsar; Ajustes → Pagos y Notificaciones.                                                                               | L    | E2E de punta a punta con `fake`; 100 checkouts con fallos aleatorios → cero estados inconsistentes.                             |
| **Gate F7** |                                                                                                                                                                                              |      |                                                                                                                                 |

### FASE 8 — Customer Accounts & Admin Ops

| ID          | Tarea                                                                                                                                                             | Tam. | Pruebas                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------- |
| F8-T01      | Cuenta del comprador: login con código por tienda, `storefront_link_customer` (solo tras OTP), pedidos y direcciones.                                             | M    | Aislamiento de cuentas entre tiendas. |
| F8-T02      | Clientes en el panel: listado enmascarado por RPC, perfil, anonimización.                                                                                         | M    | Sin `customers.pii.read` no hay PII.  |
| F8-T03      | Dashboard de KPIs (ventas, pedidos, ticket promedio, top productos, stock bajo).                                                                                  | M    | KPIs contra un seed conocido.         |
| F8-T04      | Importación y exportación CSV (§26): vista previa, errores por fila, atomicidad ≤ 5k filas, `store_id` del archivo ignorado, protección contra formula injection. | L    | Integración con fixtures.             |
| F8-T05      | Ajustes → Actividad (lectura de auditoría paginada).                                                                                                              | S    | E2E.                                  |
| **Gate F8** |                                                                                                                                                                   |      |                                       |

### FASE R — Productos regulados: suplementos en México (ADR-021, ADR-022; Q-B3 revisada)

| ID         | Tarea                                                                                                                                                                                                                                                                                                                                                                                                                                   | Tam. | Pruebas                                                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-T01      | Modelo regulatorio: `regulated_categories`, `compliance_rules` (de plataforma, versionadas, texto `PENDIENTE_DE_DEFINIR` hasta que lo dé el asesor), `store_regulated_categories`, `product_regulatory_info` (clasificación + ficha versionada). RLS forzado, FK compuestas, triggers de tenant. RPC de plataforma (aal2, auditadas) y de tienda. `app.validate_product_compliance` en la publicación y en `validate_store_for_launch`. | L    | pgTAP: denegación por defecto (sin clasificación no se publica), leyenda sin texto bloquea, campos obligatorios, término prohibido, permisos, aislamiento, auditoría; mutación. |
| R-T02      | Panel: ficha del suplemento en el editor de producto (campos, tabla nutrimental, vista previa de leyendas); Ajustes → Cumplimiento (categorías que vende la tienda y estado de las reglas); página mínima de reglas en la consola de plataforma.                                                                                                                                                                                        | L    | E2E con axe: publicar bloqueado hasta completar; leyendas pendientes visibles.                                                                                                  |
| R-T03      | Storefront: "Información del suplemento" en la ficha (tabla nutrimental accesible, modo de uso, advertencias, leyendas); leyendas en carrito y checkout según la regla; JSON-LD sin afirmaciones de salud.                                                                                                                                                                                                                              | M    | E2E en dos tiendas (la no regulada no cambia); Lighthouse ≥ 90 en la ficha.                                                                                                     |
| R-T04      | Atributos filtrables: tablas, RPC y panel (atributos, valores y asignación en el producto); filtros con conteo en categorías y búsqueda del storefront.                                                                                                                                                                                                                                                                                 | L    | pgTAP (aislamiento, conteos, solo publicados) + E2E de filtros con axe.                                                                                                         |
| R-T05      | Importación y exportación de la ficha y de los atributos (columnas nuevas; tabla nutrimental en formato compacto).                                                                                                                                                                                                                                                                                                                      | M    | Unit del parser + pgTAP + ida y vuelta.                                                                                                                                         |
| **Gate R** | Revisión adversarial e informe `PHASE-R-REPORT.md`.                                                                                                                                                                                                                                                                                                                                                                                     |      |                                                                                                                                                                                 |

### FASE P — Pagos y promociones MX (ADR-023, ADR-024, D-S-04)

| ID         | Tarea                                                                                                                                                                                     | Tam. | Pruebas                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| P-T01      | OXXO con Stripe: ajuste por tienda, Checkout con `oxxo`, reserva y pago pendiente extendidos hasta el vencimiento de la ficha, avisos al comprador y al staff, vencimiento y pago tardío. | M    | Integración con payloads de Stripe (sesión completa sin pago, pago asíncrono aprobado o fallido, vencimiento) + E2E con `fake`. |
| P-T02      | Meses sin intereses: ajuste por tienda (monto mínimo y texto promocional), Checkout con `installments`, mensaje en la ficha y en el checkout.                                             | S    | Unit de contrato del adaptador + E2E.                                                                                           |
| P-T03      | Descuento de primera compra (D-S-04).                                                                                                                                                     | S    | pgTAP + concurrencia: dos checkouts simultáneos con el mismo email → uno con descuento.                                         |
| P-T04      | Paquetes (ADR-023, **solo con su aprobación**): componentes, disponibilidad, reserva, venta, liberación y devolución expandidas, `order_item_components`, panel y storefront.             | L    | Concurrencia (un componente compartido entre un paquete y una venta suelta), caos ampliado, pgTAP del snapshot.                 |
| **Gate P** | Revisión adversarial e informe `PHASE-P-REPORT.md`; verificación con el sandbox de Stripe pendiente (S-4).                                                                                |      |                                                                                                                                 |

### FASE 9 — White-label completo (§20)

| ID          | Tarea                                                                                                                                                     | Tam. | Pruebas                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------ |
| F9-T01      | Editor de branding completo (tipografía curada, forma, header con anuncio, footer, redes, contacto, SEO global) con vista previa y publicación.           | L    | Contraste bloquea; vista previa no se filtra al público.     |
| F9-T02      | Editor de secciones de la home (agregar, quitar, ordenar, editar), con secciones para comprar por objetivo (atributo de la Fase R) y paquetes destacados. | L    | Dos tiendas visualmente distintas, ambas ≥ 90 en Lighthouse. |
| **Gate F9** |                                                                                                                                                           |      |                                                              |

### FASE 10 — Platform Console & Plans (§19)

| ID           | Tarea                                                                                                                            | Tam. | Pruebas                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------- |
| F10-T01      | CRUD de planes y entitlements, overrides, suscripciones manuales con transiciones y job diario de gracias.                       | L    | pgTAP del modo de acceso por transición.                |
| F10-T02      | Consola completa: tenants, salud (cola, webhooks, errores), flags, auditoría de plataforma. "Plan y uso" en el panel del tenant. | L    | E2E: alta → límite → suspensión → reactivación sin SQL. |
| **Gate F10** |                                                                                                                                  |      |                                                         |

### FASE 11 — Hardening (§30, §33, §34)

| ID                                   | Tarea                                                                                                                                                                       | Tam. | Pruebas                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------ |
| F11-T01                              | Revisión de seguridad completa con §30 como checklist + `security-review` + ZAP baseline (si está disponible).                                                              | L    | Cero hallazgos altos abiertos. |
| F11-T02                              | Rendimiento: Lighthouse CI con presupuestos, presupuesto de bundle, `EXPLAIN ANALYZE` de las 20 consultas principales, prueba de carga de checkout (k6 si está disponible). | L    | Presupuestos de §33 cumplidos. |
| F11-T03                              | Accesibilidad: axe en todos los E2E + revisión manual con teclado de los flujos de compra y alta de producto.                                                               | M    | Cero violaciones serias.       |
| F11-T04                              | Runbooks: incidentes, restauración, rotación de secretos, despliegue a Vercel y Supabase paso a paso, checklist de go-live.                                                 | M    | Revisión del documento.        |
| F11-T05                              | Páginas legales de plataforma como plantillas con "requiere revisión legal".                                                                                                | S    | —                              |
| **Gate F11 = fin del modo autónomo** | `docs/phases/FINAL-REPORT.md`: estado, cobertura, riesgos residuales y lista exacta de lo que debe hacer una persona para la Fase 12.                                       |      |                                |

---

## 5. Calidad obligatoria (no negociable)

### 5.1 Antes de cada commit

`pnpm verify` y `pnpm db:test` en verde. Sin excepciones, sin `--no-verify`.

### 5.2 Toda tabla, función o endpoint nuevo

- Las tablas de tienda siguen la regla 2 de `CLAUDE.md`. Los metatests (`00_schema_security`) y la suite de aislamiento genérica (`05_tenant_isolation`) las cubren solas: **si una tabla nueva pasa esas suites sin escribir pruebas específicas, revisar que de verdad esté poblada en los fixtures**.
- Toda RPC: prueba de permiso denegado, de 2FA requerida y de ataque cross-tenant.
- Todo endpoint o Server Action: validación Zod, `requirePermission`, error con `AppError` y prueba del caso no autorizado.

### 5.3 Prueba de mutación en cambios de seguridad

Introducir temporalmente la regresión que la prueba debe atrapar (política `USING (true)`, quitar AAL2, grant indebido, firma sin verificar) y confirmar que alguna prueba falla. Restaurar y anotar el resultado en el informe de la fase.

### 5.4 UI

Cada pantalla tiene estados de carga, vacío, error y éxito; se prueba a 375 px y a 1280 px; pasa axe; y respeta los tokens y la guía anti-"hecho por IA" de §32.1.

### 5.5 Dependencias nuevas

Solo con justificación registrada en `DECISIONS.md` (propósito, alternativas, tamaño, mantenimiento). Versión exacta fijada.

---

## 6. Entorno de trabajo (cada sesión)

```bash
# PostgreSQL 16 + pgTAP (ya instalados en el contenedor; si no, apt-get install postgresql-16-pgtap)
pg_ctlcluster 16 main start
su postgres -c "psql -c \"alter user postgres password 'postgres'\""   # solo si es un contenedor nuevo
pnpm install --frozen-lockfile
cp -n .env.example .env.local   # y completar con valores de desarrollo
pnpm verify && pnpm db:test
# Stack local (desde F2-T01): bash scripts/dev/stack.sh up
```

**Limitaciones conocidas del contenedor:**

- Las imágenes Docker de Supabase y el repositorio PGDG están bloqueados → por eso A-03.
- GitHub Releases sí descarga (así se obtuvo la CLI de Supabase y gitleaks).
- Chromium para Playwright está en `/opt/pw-browsers`.
- El contenedor puede reiniciarse: PostgreSQL se detiene y hay que volver a levantarlo. Lo no commiteado se pierde.

---

## 7. Riesgos del modo autónomo

| Riesgo                                                               | Mitigación                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Perder trabajo (contenedor efímero + push bloqueado)                 | Commits pequeños y frecuentes; bundle cuando hay 3 o más sin subir (S5); P0 resuelto por el propietario.                              |
| Deriva respecto del contrato                                         | Cada tarea cita su sección de GATE0; toda desviación va a `DECISIONS.md`; ADR para contratos críticos.                                |
| Pérdida de contexto entre sesiones                                   | `PROGRESS.md` es la memoria: tarea actual, siguiente paso exacto y bloqueos. Se actualiza después de cada tarea, no al final del día. |
| Pruebas que "pasan" sin probar nada                                  | Controles positivos obligatorios en las suites de seguridad + pruebas de mutación (§5.3).                                             |
| Integraciones reales sin verificar (Stripe, email, Auth en Supabase) | Pruebas de contrato con payloads oficiales + lista explícita de verificaciones pendientes en cada informe y en el final.              |
| Alcance que crece                                                    | Solo lo del backlog. Ideas nuevas → sección "Ideas para después" de `PROGRESS.md`, nunca al código.                                   |
