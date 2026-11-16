# ADR-066 — Venta de mostrador mínima (O3 / PB-17)

**Estado:** PROPUESTO, pendiente de aprobación del propietario (2026-11-16).
**Alcance de este documento:** solo decisión y diseño. **No se crea ninguna migración ni código hasta que se apruebe.**
**Contratos críticos que toca (GATE0 §43):** `PermissionKey` (clave nueva), `PaymentProvider` (valor nuevo de proveedor sin pasarela), `Order snapshot v1` (valor nuevo en `orders.source`, sin cambiar la forma). Por eso requiere ADR (GATE0 §44.21, CLAUDE.md).

Convención: **[Verificar]** marca lo que no se confirmó leyendo el código; todo lo demás cita el archivo donde se comprobó.

---

## 1. Contexto y problema

Muchos comercios del piloto también venden en su local. Hoy PRUVA solo registra ventas en línea, así que:

- **Dos inventarios que divergen.** Lo que se vende en el local no baja las existencias de la tienda en línea. El comercio corrige a mano con «Ajustar inventario» (`public.inventory_adjust`, motivo obligatorio para `adjustment`/`damage`/`loss`; `supabase/migrations/20261011000400_inventory_gate_fixes.sql`), tarde o nunca.
- **Riesgo de sobreventa.** Con `inventory_policy = 'deny'` la tienda en línea acepta pedidos de unidades que ya se vendieron en el mostrador; el pedido queda pagado y sin producto.
- **Reportes incompletos.** Inicio (`public.dashboard_kpis`, última versión en `20261015000700_phase8_gate_fixes.sql`) y Rentabilidad (`public.profit_report`, `20261110000300_profit_report.sql`) solo ven ventas en línea.

El tablero lo registra como **PB-17 «Punto de venta e inventario compartido»**: problema «Dos inventarios, el del local y el de la tienda», objetivo «Sin sobreventa», estado «BACKLOG (no antes de 10 tiendas)» (`docs/audit/PRUVA_PRODUCTIZATION_BOARD.md`, línea 45). Este ADR lo prepara para cuando el propietario decida activarlo; no cambia esa prioridad.

### 1.1 Competencia (sin cifras nuevas)

- La auditoría de mercado ya marca «Ecosistema de apps, **POS**, canales sociales» como algo que «No existe; los competidores lo incluyen» y lo lista como paridad funcional pendiente (`docs/audit/AUDITORIA-2026-10-27/08-MERCADO-COMPETENCIA.md`, líneas 134 y 182).
- Referencias de producto: **Shopify POS** (nivel Pro), **Tiendanube** (punto de venta, PDV), **Jumpseller** (planes superiores) y **Loyverse** (POS independiente). Todos comparten la idea de un solo inventario para tienda física y en línea. Qué incluye cada uno, en qué plan y a qué precio: **[Verificar]**. No se consultó la web (tarea sin red) y este documento no agrega precios ni cifras.
- Lectura para PRUVA: no se trata de competir con un POS completo, sino de cerrar la brecha mínima: **vender en el local sin romper el inventario en línea**.

## 2. Alcance

### 2.1 Sí entra (v1 mínima)

1. Pantalla «Mostrador» en el panel para vender a una persona presente.
2. Búsqueda por **SKU** o **código de barras** (lector tipo teclado) y por nombre.
3. Cobro registrado con **efectivo**, **transferencia** o **terminal externa** (la del comercio). PRUVA solo **anota** cómo se cobró.
4. Una **transacción única** en la base: pedido de canal mostrador, pagado y entregado, más su movimiento `sale` en el libro de inventario.
5. **Anulación** que devuelve existencias (movimiento `return`) y deja rastro.
6. Ventas de mostrador visibles en Pedidos, Inicio y Rentabilidad, **separadas por canal**.
7. Permiso propio, interruptor por tienda y auditoría.

### 2.2 No entra (explícito)

- **No es un POS completo:** sin descuentos manuales, propinas, ventas en espera, clientes frecuentes, lealtad ni varios tickets a la vez.
- **Sin hardware:** sin impresora de tickets, cajón de dinero ni integración con terminales. El lector de códigos funciona solo porque se comporta como teclado.
- **PRUVA no cobra ni toca dinero:** no hay cobro con tarjeta por PRUVA ni pasarela. La terminal externa es del comercio y PRUVA solo anota «terminal externa».
- **Sin turnos ni cortes de caja** en v1 (apertura, arqueo, retiros).
- **Sin multi-ubicación:** se vende de la ubicación principal (`inventory_locations.is_default`, siempre `kind = 'own'`; `20261018000700_suppliers.sql`). No se toca existencia de proveedores.
- **Sin CFDI** (sigue fuera de alcance, MER-08).
- **Sin modo sin conexión:** sin internet no se puede vender desde PRUVA.
- **Sin devoluciones parciales nuevas** desde el mostrador: la anulación es total. Para lo parcial siguen Devoluciones (ADR-061) y el reembolso existente.

## 3. Opciones

### Opción A — Pedido con canal «mostrador» reutilizando `orders` ✅ recomendada

El pedido de mostrador es un `public.orders` más, con `source = 'pos'`, pagado, entregado y completado en la misma transacción.

- **Pros:**
  - Reutiliza todo lo probado: snapshot inmutable (`app.orders_guard`, `app.order_items_guard`), máquina de estados (`app.assert_order_transition`), numeración (`public.store_counters`), libro de inventario, reembolsos con reposición (`app.request_refund` + `system.apply_refund_result`, que ya hace el movimiento `return`), `order_events`, auditoría y RLS.
  - Inicio, Rentabilidad, exportaciones e historial lo ven sin tablas nuevas; solo hay que **separar por canal**.
  - La columna `orders.source` ya existe con `check (source in ('storefront', 'admin', 'api'))` (`20261013000100_checkout_tables.sql`, línea 183) y `'admin'` no se usa en ningún lado (grep). Agregar `'pos'` es un cambio aditivo.
  - Ninguna tabla nueva de tienda, así que no hay superficie RLS nueva.
- **Contras:**
  - `orders.email` es `NOT NULL` con formato; una venta de mostrador no tiene correo (ver §4.1).
  - `payments.payment_account_id` es `NOT NULL`; hay que darle una cuenta de cobro al mostrador (ver §4.2).
  - Los manejadores de correo y avisos (`order.paid` en `src/server/notifications/order-handlers.ts:201`) deben distinguir el canal.

### Opción B — Tabla separada de ventas físicas

`public.pos_sales` + `public.pos_sale_items` propias.

- **Pros:** aislamiento total del flujo en línea; libertad de forma.
- **Contras:**
  - Duplica snapshot, estados, numeración, reembolsos, reportes y exportaciones.
  - Dos tablas nuevas de tienda con todo lo de la regla 2 (RLS forzado, FK compuestas, `prevent_tenant_change`, metatests).
  - Inicio y Rentabilidad tendrían que unir dos fuentes, y el riesgo de divergencia contable vuelve por otro lado.
  - Más código y más pruebas para el mismo resultado.

### Opción C — Solo ajuste de inventario con motivo «venta física»

Un botón que llama `public.inventory_adjust` con un motivo fijo.

- **Pros:** casi sin código; ya existe el permiso `inventory.adjust`.
- **Contras:**
  - Registra la salida como `adjustment` en lugar de `sale`: el libro miente sobre la causa.
  - Sin importe, sin método de cobro y sin pedido: no aparece en ventas, Inicio ni Rentabilidad.
  - No hay anulación con rastro ni idempotencia de negocio.
  - No resuelve el problema comercial (saber cuánto se vende en el local); solo maquilla la existencia.

### Recomendación

**Opción A.** Es la única que cumple los criterios de aceptación reutilizando contratos probados. Su costo es acotado: valores nuevos en dos `CHECK`, un permiso, un interruptor y cuatro funciones RPC. La B duplica el dominio de pedidos sin beneficio para el comercio. La C es útil hoy como **paliativo manual** (ya existe), pero no como solución.

## 4. Diseño propuesto (Opción A)

### 4.1 Cambios de esquema (una migración aditiva, _expand_)

| Objeto                                                          | Cambio                                                                                                                                                                                                                                                         | Motivo                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `public.orders.source`                                          | `check (source in ('storefront','admin','api','pos'))`                                                                                                                                                                                                         | Canal mostrador. La forma del snapshot no cambia: `snapshot_version` sigue en 1.                                                 |
| `public.orders.email`                                           | **Sin cambio de esquema.** Si el comprador no da correo, se guarda una dirección sintética `mostrador-<id sin guiones>@mostrador.invalid`, con el mismo patrón que la anonimización (ADR-046, `app.orders_guard` en `20261029000600_store_anonymization.sql`). | Mantiene `NOT NULL` y su `CHECK`, así no se toca el contrato del snapshot. El dominio `.invalid` (RFC 2606) no se entrega nunca. |
| `public.orders.customer_name`                                   | Valor fijo «Venta de mostrador» si no se captura nombre.                                                                                                                                                                                                       | `NOT NULL`, de 1 a 160 caracteres.                                                                                               |
| `public.orders.requires_shipping`                               | `false`; `shipping_address` nulo.                                                                                                                                                                                                                              | Cumple `orders_shipping_address`.                                                                                                |
| `public.orders.checkout_idempotency_key`                        | Recibe la **llave de idempotencia del mostrador** (de 16 a 100 caracteres).                                                                                                                                                                                    | Ya existe `unique (store_id, checkout_idempotency_key)`: el doble clic queda resuelto en la base, **sin columna nueva**.         |
| `public.payment_accounts.provider` y `public.payments.provider` | Agregar `'in_store'` al `CHECK` (hoy: `manual`, `fake`, `stripe`, `mercadopago`; `20261018001200_mercadopago.sql`).                                                                                                                                            | Cuenta de cobro propia del mostrador. Ver §4.2.                                                                                  |
| `public.payments.method`                                        | Sin cambio de esquema (ya es `text`, ≤ 50, mutable según `app.payments_guard`). La RPC solo acepta `cash`, `transfer` o `external_terminal` para `in_store`. Opcional: un `CHECK (provider <> 'in_store' or method in (...))`.                                 | Método manual de cobro.                                                                                                          |
| `public.permissions`                                            | `('pos.sell','orders','operational', false, false, 'Vender en mostrador')`                                                                                                                                                                                     | Permiso nuevo (§4.4).                                                                                                            |
| `public.roles` + `public.role_permissions`                      | Rol de sistema `cashier` («Mostrador», rank 20) y asignaciones.                                                                                                                                                                                                | §4.4.                                                                                                                            |
| `public.feature_flags`                                          | `pos_counter_sales`, `default_enabled = false`.                                                                                                                                                                                                                | §4.5.                                                                                                                            |

**Sin tabla nueva de tienda.** Si la revisión decidiera agregar una (por ejemplo, para cortes de caja en una v2), aplica la regla 2 completa: `store_id NOT NULL`, RLS forzado, políticas, trigger `app.prevent_tenant_change`, `UNIQUE (store_id, id)` y FK compuestas.

Todo el dinero queda en `bigint` (centavos): `unit_price`, `line_total`, `total` y `payments.amount` ya lo son.

### 4.2 Cuenta de cobro del mostrador

`payments.payment_account_id` es `NOT NULL` con FK compuesta a `payment_accounts` (`20261013000100_checkout_tables.sql`, líneas 362–405). Reutilizar la cuenta `manual` obligaría a activarla, y entonces la tienda en línea ofrecería «transferencia» aunque el comercio no quiera.

Propuesta:

- Proveedor `in_store`. La cuenta se crea **activa** al encender el interruptor de la tienda, con `display_name = 'Mostrador'` (una por tienda por `payment_accounts_active_uq`).
- `in_store` **no es** un adaptador de `PaymentProvider`: no tiene `createCheckout`, webhook ni red. En el código, `src/server/orders/refunds.ts:65` debe tratarlo como `manual`/`fake` (sin pasarela).
- **El checkout en línea nunca debe listarlo.** Hay que comprobar el filtro de métodos de pago del checkout **[Verificar]** y cubrirlo con una prueba (§7).

Alternativa descartada: usar `manual` con `status = 'disabled'`. Es semánticamente falsa y frágil.

### 4.3 Funciones RPC (`SECURITY DEFINER`, `set search_path = ''`, nombres calificados, `REVOKE EXECUTE FROM public`, `GRANT EXECUTE` solo a `authenticated`)

Todas empiezan con `app.require_store_permission(p_store_id, 'pos.sell')` (salvo la anulación, ver abajo) y con `app.flag_enabled('pos_counter_sales', p_store_id)`. Si la tienda no tiene el interruptor, responden `not_found`/`feature`.

1. **`public.pos_lookup(p_store_id, p_query, p_limit)`**, de solo lectura.
   - Primero busca coincidencia exacta por `product_variants.barcode` (índice `product_variants_barcode_uq (store_id, barcode)`, `20261009000100_catalog_tables.sql`, línea 273) o por `sku` en mayúsculas. Es el mismo criterio que ya usa la búsqueda de la tienda (`sv.sku = upper(v_q) or sv.barcode = v_q`, `20261111000100_search_lexicon.sql`, línea 183).
   - Después busca por título, con límite de 20.
   - Devuelve `variant_id`, título, opción, SKU, precio, `track_inventory`, `inventory_policy` y **disponible** (`on_hand − reserved` de la ubicación principal).
   - Excluye variantes y productos borrados (`deleted_at`). Si se pueden vender borradores: pregunta abierta 4.

2. **`public.pos_quote(p_store_id, p_lines jsonb)`**, de solo lectura. Recibe `[{variant_id, quantity}]` (sin precios) y devuelve los totales calculados por el servidor con `app.cart_totals(p_lines, p_rules)`, la aritmética pura que ya usa el checkout (`20261013000200_calculate_cart.sql`, línea 86). Las reglas de impuesto salen de `public.stores` (`tax_rate_bps`, `prices_include_tax`), sin envío y sin descuento.

3. **`public.pos_sell(p_store_id, p_lines jsonb, p_payment_method text, p_payment_reference text, p_expected_total bigint, p_buyer jsonb, p_idempotency_key text)`**, en **una sola transacción, sin red** (regla 10):
   1. Valida la llave (`^[A-Za-z0-9_-]{16,90}$`, como `orders_cancel`). **Repetición:** si ya existe un pedido con `(store_id, checkout_idempotency_key)`, lo devuelve con `replayed = true` cuando las partidas coinciden y responde `conflict`/`idempotency_key` si no.
   2. Valida las partidas (cantidad de 1 a 999, igual que el `CHECK` de `order_items.quantity`; variantes de la tienda y no borradas). Bloquea los niveles de inventario **en orden de `level_id`**, como `app.inventory_reserve`, para evitar _deadlocks_.
   3. **El precio sale siempre de la base:** `product_variants.price` (`20261009000100_catalog_tables.sql`, línea 251). Los totales salen de `app.cart_totals`. Si `total <> p_expected_total` responde `price_changed`, el mismo contrato que `place_order` (§43 Checkout), y el cliente vuelve a cotizar. El cliente nunca manda precio, impuesto ni total (regla 8).
   4. Asigna el número con el mismo upsert sobre `public.store_counters` (`key = 'order_number'`) que `storefront.place_order`.
   5. Inserta `orders` (`source = 'pos'`, snapshot de moneda e impuestos desde `stores`, `requires_shipping = false`) y `order_items` (snapshot de título, SKU, opción y precio).
   6. **Existencias**, solo con `app.apply_inventory_movement` (regla 10) y sobre el nivel de `app.default_level`. Por variante con `track_inventory`:
      - `reservation` (+q reservado) y enseguida `sale` (−q existencia, −q reservado). El `CHECK inventory_movements_direction` exige `sale` con `reserved_delta = on_hand_delta` (`20261011000100_inventory_tables.sql`, línea 131): por eso se reserva primero, como en el flujo en línea.
      - Llaves de idempotencia `pos:reservation:<order_id>:<level_id>` y `pos:sale:<order_id>:<level_id>`, con `reference_type = 'order'`.
      - Con `deny`, la reserva falla con `insufficient_stock` si `on_hand − reserved < q`. **El mostrador respeta lo apartado por pedidos en línea pendientes.**
      - Con `continue`, `apply_inventory_movement` permite reservar de más, pero **`on_hand` nunca baja de 0** (comentario y `UPDATE` de `app.apply_inventory_movement`, líneas 49–66 de `20261011000200_inventory_movements.sql`): sin existencia registrada, la venta falla igual. Propuesta: con `continue`, la RPC hace antes un `adjustment` con motivo «Venta de mostrador sin existencia registrada» por la diferencia, para que el libro diga la verdad (pregunta abierta 1). Con `deny` nunca se ajusta.
      - Variantes sin seguimiento (`track_inventory = false`): sin movimientos, igual que en línea.
   7. **Pago:** inserta `payments` (`provider = 'in_store'`, `method` validado, `amount = total`, `idempotency_key = 'pos_' || llave`). Lo confirma con `app.confirm_order_payment(payment_id, 'staff', método)`, la misma vía que `orders_mark_paid_manual` (`20261013000400_payments_expiry.sql`, línea 255). Eso pasa el pedido a `open`/`paid` y llama a `app.finalize_paid_order` (contadores y el trabajo `order.paid`).
      - Esto **no es** una confirmación de pago desde el frontend en el sentido de la regla 11: no hay pasarela. Es una declaración del personal con permiso, auditada, igual que la confirmación manual de transferencias que ya existe. **[Verificar con el propietario]** que esta lectura de la regla 11 es aceptable (es la misma que ya se aplicó a `manual`).
   8. **Entrega:** inserta `shipments` (`status = 'delivered'`, `carrier` nulo, `shipped_at = delivered_at = now()`) y `shipment_items`, y sube `fulfilled_quantity` → `fulfillment_status = 'fulfilled'`. Luego `open → completed` (actor `system`, con la condición «fulfilled y todos los envíos delivered» de GATE0 §16.4). Las transiciones pasan por `app.set_order_actor` y el trigger de estados; **no se cambia la máquina de estados**.
   9. Escribe `order_events` (`order.placed` con `metadata.source = 'pos'`, `payment.confirmed_in_store` y `fulfillment.delivered_in_store`) y `audit.record('order.pos_sale', 'order', id, org, store, null, {total, method, items})` **sin PII**.
   10. Devuelve `{order_id, display_number, total, replayed}`.

4. **`public.pos_void(p_store_id, p_order_id, p_reason, p_idempotency_key)`**: anula una venta.
   - Exige **`orders.refund`**, no `pos.sell`: separa funciones y la cajera sola no puede anular (control antifraude).
   - Solo aplica a `source = 'pos'` con `payment_status = 'paid'`.
   - Llama a `app.request_refund(order, total, todas las partidas, restock = true, 'Anulación de mostrador', 'void_' || llave)` (`20261014000600_phase7_gate_fixes.sql`, línea 363). Como `in_store` no tiene pasarela, en la **misma transacción** aplica `system.apply_refund_result(refund_id, 'succeeded', null, null)`, que ya hace el movimiento `return` con llave `return:<refund>:<item>` y sube `returned_quantity`.
   - El resultado es `payment_status = 'refunded'` y `fulfillment_status = 'returned'`. El pedido queda `completed`: es terminal por §16.4 y las devoluciones solo afectan los otros ejes. **El pedido no se borra (regla 9).**
   - Es idempotente por la llave del reembolso. Deja `audit.record('order.pos_voided', …)`.
   - **[Verificar]** que llamar a `system.apply_refund_result` desde una función `public` `SECURITY DEFINER` del mismo dueño no viola la separación de esquemas (es una llamada interna, no un `GRANT` a `authenticated`). Si se prefiere no hacerlo, la alternativa es encolar `refund.execute` como hoy: las existencias vuelven cuando corre la cola, en segundos.

### 4.4 Permisos y roles (`20261006000300_authorization.sql`, semilla en `20261006000100_identity_tenancy_tables.sql`, líneas 631–725)

- **Clave nueva `pos.sell`** (módulo `orders`, `kind = 'operational'`, no sensible, sin lectura de soporte). Se evalúa con la única función de autorización `app.has_store_permission`, en vivo y con AAL2; nunca en el JWT (regla 7).
- **Asignación:**
  - `org_owner`/`org_admin`: automático.
  - `store_admin`: **insert explícito**, porque la semilla original usó `cross join` en su momento y no incluye claves futuras.
  - `order_manager`: sí.
  - Rol nuevo `cashier` («Mostrador», rank 20, debajo de `support_agent` = 30): `store.read`, `products.read`, `inventory.read` y `pos.sell`. **Sin** `orders.refund`, `customers.pii.read` ni `analytics.read`. Si se quiere este rol: pregunta abierta 3.
- **Espejo TS:** agregar `"pos.sell"` a `STORE_PERMISSIONS` en `src/server/auth/permissions.ts`. `tests/integration/permissions-sync.test.ts` falla si no coinciden.
- Acciones de servidor: Zod + `requirePermission` + verificación en la base + auditoría (GATE0 §44.26).

### 4.5 Interruptor por tienda

- `feature_flags.key = 'pos_counter_sales'`, `default_enabled = false`, con _kill switch_ de plataforma (`app.flag_enabled`, `20261007000300_flags_tenant_status.sql`, línea 125).
- Propuesta para el piloto: **`store_toggle = false`**. La plataforma lo enciende por tienda desde la consola, porque la columna `store_toggle` está pensada para «mejoras de experiencia sin costo ni efecto en precios, pagos o planes» (`20261104000400_store_feature_toggles.sql`) y el mostrador sí afecta pagos. Pregunta abierta 2.
- Al encenderlo se crea la cuenta `in_store` (§4.2). Al apagarlo se oculta la pantalla y las RPC responden `not_found`. Las ventas ya hechas siguen visibles.

### 4.6 Inicio, reportes y exportaciones

- **`dashboard_kpis`:** agregar la clave `by_source`: `{storefront: {gross_sales, orders}, pos: {gross_sales, orders}}`. Es aditiva y las claves actuales no cambian, así que el panel viejo sigue funcionando. Los totales actuales ya incluirán el mostrador porque filtran por `paid_at`.
- **`profit_report`:** agregar `source` por pedido y subtotales por canal (aditivo).
- **Pedidos:** etiqueta «Mostrador» y filtro por canal en `src/app/admin/[storeHandle]/pedidos/orders-table.tsx`. «Por surtir» (`to_fulfill`) no cambia porque el pedido de mostrador nace surtido.
- **Resumen semanal y exportación de pedidos:** columna o línea por canal **[Verificar]** (`system.weekly_summary_window`, `20261105000300_weekly_summary.sql`; exportaciones `20261015000500_exports.sql`).
- **Efecto secundario a decidir:** `app.finalize_paid_order` sube `products.sales_count`, que alimenta «más vendidos» en la tienda. Propuesta: contar también las ventas del local (son ventas reales). Es un cambio menor si se prefiere excluirlas.

### 4.7 Correos y avisos

- **Por defecto no se envía correo al comprador.** El manejador `paid` (`src/server/notifications/order-handlers.ts:201`) debe salir sin enviar si `order.source = 'pos'` o si el correo termina en `.invalid`. Hoy no hay ningún filtro de `.invalid` en `src/server` (grep).
- El aviso al personal (`notify_paid`) tampoco se envía para `pos` (sería ruido en cada venta del local).
- **Opcional (pregunta 5):** si el comprador da su correo, enviar el comprobante con la plantilla de confirmación.
- El trabajo `order.paid` se encola igual (contadores e idempotencia). La pantalla llama `processQueueSoon` y declara `maxDuration = 60`, como exige `tests/unit/queue-entry-graph.ts` (D-O10-22).
- Después de vender o anular: `invalidateStore(storeId)`, para que la existencia publicada en línea se actualice (mismo patrón que `confirmManualPayment` en `pedidos/actions.ts:34`).

## 5. UX

**Ruta:** `src/app/admin/[storeHandle]/mostrador/` (`page.tsx`, `actions.ts`, componentes). Aparece en el menú solo si el interruptor está encendido y el usuario tiene `pos.sell`.

- **Distribución:**
  - Escritorio y tablet: dos columnas, a la izquierda búsqueda y resultados, a la derecha el ticket y el cobro.
  - Teléfono (menos de 768 px): una columna y una barra fija abajo con el total y «Cobrar».
  - Objetivos táctiles de al menos 44 px.
- **Búsqueda y lector:**
  - Un campo con foco automático: «Escanea o escribe SKU, código o nombre».
  - El lector envía los caracteres y `Enter`. Con `Enter`, si hay una coincidencia exacta de código o SKU, la agrega (+1) sin abrir lista y el foco vuelve al campo.
  - Si hay varias, se muestra la lista navegable con flechas.
  - Sin dependencia nueva: es un `<input>` normal.
- **Ticket:**
  - Cada partida tiene cantidad con − y +, quitar y precio unitario.
  - Los totales **siempre vienen de `pos_quote`**; el cliente nunca calcula importes que se guarden.
  - Con efectivo hay un campo «Recibido» y se muestra el **cambio**, solo como ayuda visual (no se guarda como dato contable en v1).
- **Cobro:**
  - Selector «Efectivo / Transferencia / Terminal externa», con referencia opcional de hasta 60 caracteres para las dos últimas.
  - El botón «Cobrar $X» se desactiva mientras se envía. La llave de idempotencia se genera al abrir el ticket y se conserva hasta el éxito: un doble clic, una recarga o un reintento por red usan la misma llave y devuelven el mismo pedido.
- **Éxito:** «Venta #1234 registrada», con «Nueva venta» (vacía el ticket y genera otra llave) y «Ver pedido». Imprimir un comprobante reutilizando `pedidos/_print` es opcional **[Verificar]**.
- **Estados:**
  - Vacío: «Escanea un producto para empezar».
  - Sin resultados: «No encontramos “X”. Revisa el código o busca por nombre».
  - Sin existencias (`deny`): partida marcada con «Solo quedan N» o «Sin existencias». «Cobrar» se bloquea hasta corregir.
  - `price_changed`: «El precio cambió; revisa el total» y se vuelve a cotizar.
  - Error de red: «No se pudo registrar. Reintentar» (misma llave).
  - Sin permiso o interruptor apagado: 404 del panel.
  - Todos los textos en español y los errores con `AppError` (`{ ok:false, error:{ code, message, request_id } }`).
- **Accesibilidad:**
  - Etiquetas visibles.
  - `aria-live="polite"` para «Agregado: X» y los errores.
  - Todo se puede hacer solo con teclado y el orden de foco es lógico.
  - Contraste con los tokens de `src/ui`.
  - Montos con `src/lib/money` (`parseMoneyToCents` y formato).

## 6. Seguridad multi-tenant y cumplimiento (CLAUDE.md 1–17 / GATE0 §44)

| Regla                   | Cómo se cumple                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 2 Aislamiento y RLS  | Sin tablas nuevas. Las RPC filtran siempre por `p_store_id` y verifican `has_store_permission` sobre esa tienda. Todas las escrituras usan FK compuestas `(store_id, …)` ya existentes. |
| 3, 4 Roles              | Solo `authenticated` recibe `EXECUTE`. Sin `anon`, `service_role`, `storefront_gateway` ni `system_worker` nuevos.                                                                      |
| 5 `SECURITY DEFINER`    | `search_path = ''`, nombres calificados y `REVOKE … FROM public`. Lo cubre `00_schema_security`.                                                                                        |
| 6 Esquemas              | No se expone `app`, `audit`, `private`, `storefront` ni `system`.                                                                                                                       |
| 7 JWT y caché           | Permiso evaluado en vivo y sin caché de la búsqueda entre requests.                                                                                                                     |
| 8 Cliente sin autoridad | Precio, total, impuestos, existencias y tienda salen de la base; `expected_total` solo detecta cambios.                                                                                 |
| 9 Inmutabilidad         | Snapshot por `orders_guard` y `order_items_guard`. La anulación es un reembolso, no un borrado.                                                                                         |
| 10 Inventario           | Solo `app.apply_inventory_movement`, sin red dentro de la transacción.                                                                                                                  |
| 11 Pagos e idempotencia | Sin pasarela; confirmación del personal auditada (ver §4.3, paso 7, [Verificar]). Llaves únicas en `orders`, `payments`, movimientos y reembolsos.                                      |
| 12 Logs                 | Sin PII en la auditoría; el logger redacta.                                                                                                                                             |
| 13 HTML                 | Sin `dangerouslySetInnerHTML`.                                                                                                                                                          |
| 14 Dinero               | `bigint`.                                                                                                                                                                               |
| 15 Fases y pruebas      | Ningún contrato futuro; sin pruebas omitidas.                                                                                                                                           |
| 16 Dependencias         | Ninguna nueva.                                                                                                                                                                          |
| 17 Migraciones          | Forward-only, aditivas y probadas desde cero (§8).                                                                                                                                      |

## 7. Plan de pruebas

**pgTAP: `supabase/tests/database/148_pos_sales.test.sql`** (el último hoy es `147_import_batches`). `00_schema_security` cubre las funciones nuevas sin cambios. Casos:

1. **Aislamiento:**
   - Un usuario de la tienda A no puede `pos_lookup`, `pos_quote`, `pos_sell` ni `pos_void` sobre la tienda B (`42501`), y no ve sus pedidos `pos`.
   - Una variante de B en las partidas de A responde `not_found`.
2. **Permisos:**
   - `cashier` vende, pero no anula ni ve PII.
   - `viewer` y `support_agent` no venden.
   - `order_manager` vende y anula.
   - Sin AAL2 no hay nada.
   - Tienda `suspended` o en `read_only` no puede vender.
3. **Interruptor:** apagado responde `not_found`/`feature`; con _kill switch_, apagado en todas.
4. **Precio:** cambiar `product_variants.price` entre la cotización y la venta da `price_changed`. Los snapshots guardan el precio de la base.
5. **Existencias:**
   - Con `deny` y disponible insuficiente (incluido lo reservado por un pedido en línea pendiente) da `insufficient_stock`, sin efectos parciales.
   - Con `continue`, el comportamiento acordado en la pregunta 1.
   - Variantes sin seguimiento no generan movimientos.
   - `system.inventory_ledger_mismatches()` queda vacío.
6. **Transacción:** una venta deja un pedido `source = 'pos'`, `completed`/`paid`/`fulfilled`; un `payment` `in_store` `succeeded`; un envío `delivered`; movimientos `reservation` y `sale`; los `order_events`; y la auditoría.
7. **Idempotencia:** la misma llave y partidas devuelven el mismo `order_id` (`replayed`); la misma llave con otras partidas da `conflict`; hay una sola fila en `orders` y `payments`.
8. **Anulación:** devuelve existencias (movimiento `return`), deja `refunded`/`returned`, es idempotente y rechaza pedidos que no son `pos`.
9. **Inmutabilidad:** `UPDATE` sobre el snapshot de un pedido `pos` da `immutable`.
10. **Checkout:** la cuenta `in_store` no aparece en los métodos de pago de la tienda en línea.
11. **KPIs:** `dashboard_kpis.by_source` separa los canales y la suma coincide con `gross_sales`.

**Integración (`tests/integration`):**

- Concurrencia: dos sesiones con la misma llave dan un solo pedido; dos ventas de la última unidad dan una venta y un `insufficient_stock`.
- `permissions-sync`.

**Unitarias (Vitest):**

- Esquemas Zod de las acciones.
- Reductor del ticket (agregar, sumar, quitar, cantidad máxima de 999).
- Manejo de `Enter` del lector.
- Cálculo visual del cambio.
- El manejador `paid` no envía correo para `pos` ni para `.invalid`.
- `queue-entry-graph` y `max-duration` reconocen la página nueva.

**E2E (Playwright, `tests/e2e/pos.spec.ts`):**

- Encender el interruptor en la tienda de prueba, escanear un código (escribir y `Enter`) y cobrar en efectivo.
- El pedido aparece en Pedidos con la etiqueta «Mostrador» y en Inicio por canal.
- La existencia baja en Inventario y en la tienda en línea.
- Un doble clic produce un solo pedido.
- La anulación desde un usuario con `orders.refund` devuelve la existencia.
- Un usuario `cashier` no ve otras secciones.
- Con la tienda B no se ve nada de A.
- Vista de teléfono (375 px) y navegación solo con teclado.

## 8. Migración forward-only (_expand → migrate → contract_)

1. **Expand** (una migración, por ejemplo `2026111x000100_pos_counter_sales.sql`):
   - `CHECK` ampliados (`orders.source` y proveedores), permiso, rol, asignaciones, interruptor apagado y las cuatro RPC.
   - `dashboard_kpis` y `profit_report` con claves aditivas.
   - Todo es aditivo: el código anterior sobre la base nueva funciona igual, porque el interruptor está apagado y no hay pedidos `pos`.
   - Se prueba desde cero y sobre el estado anterior, en el ensayo de migraciones de la ventana (`scripts/ops/ventana/01` y `02`).
2. **Migrate:** no hay datos que convertir (no existen ventas `pos` previas). Se despliega el código de la pantalla y se enciende el interruptor solo en la tienda piloto.
3. **Contract:** no hace falta. `'admin'` sigue permitido en `orders.source` aunque no se use; quitarlo sería otro ADR.
4. **Reversa:** apagar el interruptor (inmediato). La reversa de esquema solo procede si no existe ningún pedido `pos` ni cuenta `in_store` con pagos, y requiere guion con candado como el de la 0400 (D-O10-21).

## 9. Riesgos

| Riesgo                                                                               | Mitigación                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| El personal no registra todas las ventas del local y el inventario sigue divergiendo | La pantalla es más rápida que el ajuste manual. Alertas de existencia baja ya existentes. Guion de implementación.       |
| Vender en el local unidades apartadas por pedidos en línea                           | Con `deny` se respeta `on_hand − reserved` y se informa «apartado para pedidos en línea».                                |
| Abuso de anulaciones (fraude interno)                                                | Anular exige `orders.refund`, distinto de `pos.sell`. Auditoría `order.pos_voided` en Actividad.                         |
| Sin cortes de caja no se concilia el efectivo                                        | Fuera de alcance de v1. Por ahora, reporte por método de cobro en Pedidos (filtro). Cortes en una v2 con su propio ADR.  |
| Sin internet no se vende                                                             | Fuera de alcance. Indicación en la ayuda: anotar y capturar después; la llave evita duplicados al reintentar.            |
| La cuenta `in_store` aparece en el checkout en línea                                 | Filtro explícito y prueba pgTAP/E2E (§7, caso 10).                                                                       |
| Límite de 60 s en Vercel por la cola                                                 | `maxDuration = 60` y la prueba `queue-entry-graph` (D-O10-22). Límite real del plan [NO VERIFICADO, igual que D-O10-19]. |
| `sales_count` mezcla canales                                                         | Decisión explícita en §4.6.                                                                                              |

## 10. Estimación por fases (orientativa, días de agente)

| Fase      | Contenido                                                                                           | Estimación                                                                  |
| --------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| F1        | Migración _expand_, RPC, pgTAP `148`, integración de concurrencia y permisos                        | 2 días                                                                      |
| F2        | Pantalla Mostrador, acciones de servidor, unitarias y accesibilidad                                 | 2 días                                                                      |
| F3        | Inicio, Rentabilidad y Pedidos por canal; correos (`paid`); exportación y resumen                   | 1 día                                                                       |
| F4        | E2E, `pnpm verify` + `pnpm db:test` + `pnpm test:stack`, docs (DECISIONS, ayuda y guion) y revisión | 1 día                                                                       |
| **Total** |                                                                                                     | **≈ 6 días** + piloto con un comercio real (horas de persona, no estimadas) |

## 11. Preguntas abiertas para el propietario

1. **Sobreventa con `continue`:** ¿la venta de mostrador sin existencia registrada se permite con un ajuste automático y su motivo (recomendado), o se bloquea siempre?
2. **Quién lo enciende y en qué plan:** ¿solo la plataforma por tienda durante el piloto (recomendado), o la tienda desde Ajustes → Funciones? ¿Queda en todos los planes o en uno superior?
3. **Rol «Mostrador» (`cashier`):** ¿se crea (recomendado, mínimo privilegio) o basta con dueños, administradores y Pedidos?
4. **Productos en borrador:** ¿se pueden vender en el local productos no publicados en línea? (Recomendado: sí, si no están archivados ni borrados.)
5. **Comprobante por correo:** ¿pedir un correo opcional del comprador para enviarle el comprobante, o nunca en v1 (recomendado: nunca en v1)?

## 12. Criterios de aceptación

1. La búsqueda encuentra una variante por **SKU** o **código de barras** exacto. Con un lector tipo teclado (`Enter`), la agrega al ticket sin pasos extra.
2. Se puede registrar el cobro como **efectivo**, **transferencia** o **terminal externa**. Ninguno pasa por una pasarela.
3. Una venta crea en **una sola transacción** un pedido con canal mostrador (`source = 'pos'`) **pagado y entregado** y su movimiento **`sale`** por `app.apply_inventory_movement`. Si algo falla, no queda nada parcial.
4. **No sobrevende:** con `deny` rechaza si `on_hand − reserved` no alcanza. Solo se vende sin existencia cuando la variante lo permite (`continue`), con la regla aprobada en la pregunta 1.
5. El precio, los impuestos y el total salen de la base. Un total del cliente distinto da `price_changed`.
6. **Un doble clic o un reintento no duplica:** la misma llave devuelve el mismo pedido.
7. **La anulación devuelve existencias** (movimiento `return`), deja el pedido reembolsado y devuelto, no borra nada y exige `orders.refund`.
8. La venta aparece en **Pedidos, Inicio y Rentabilidad separada por canal**, y la existencia publicada en línea se actualiza.
9. **PRUVA no toca dinero:** no hay cobro, credenciales de pago ni llamadas de red en el flujo.
10. No se envía correo al comprador por defecto.
11. Permiso `pos.sell` e interruptor `pos_counter_sales` por tienda. Sin ellos, la pantalla y las RPC no responden.
12. **pgTAP** (aislamiento y RLS entre dos tiendas, permisos, sobreventa, idempotencia y anulación), **unitarias** y **E2E** en verde, con `pnpm verify` y `pnpm db:test` completos.

## 13. Estado

**PROPUESTO. Requiere aprobación del propietario antes de crear cualquier migración o código.** Al aprobarse:

- se registran las respuestas a §11 en `docs/DECISIONS.md` (§41);
- PB-17 pasa de BACKLOG a READY;
- la implementación sigue el plan de §8 y §10, en una rama propia y con las suites completas en verde antes de cada commit.
