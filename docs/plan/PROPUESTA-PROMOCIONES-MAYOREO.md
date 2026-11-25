# Promociones y mayoreo en el panel — propuesta de diseño (Fase 1)

**Estado: DECIDIDO por el propietario el 2026-11-25 (§14) — fase 1 (motor y datos, sin pantallas) en el PR #37,
sin aplicar.** Registro: ADR-070 en `docs/DECISIONS.md`. Lo que cambió respecto a este bosquejo al implementarlo está
en §14.1.

- Pedido del propietario (2026-11-25): «Quiero también añadir ventas a mayoreo al panel… ofertas como 3×2, mayoreo a
  partir de 5, paga 1 y la segunda al 50 % de descuento, etc. Todas las ofertas que ayuden a mis clientes a tener más
  ventas en sus tiendas».
- Base revisada: rama por omisión `claude/ecommerce-regulated-platform-41vu1e`, HEAD `62d4dc6` (2026-11-24 22:22,
  hora de Hermosillo). Ya no es `producto/orden-10`/`1c12b6f`.
- Rama de este documento: `feat/promociones-mayoreo` (solo este archivo).

---

## 0. Resumen en una página

| Tema               | Propuesta                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qué es             | **Promociones automáticas**: se aplican solas en el carrito, sin código. Conviven con los **cupones** que ya existen.                                                |
| Tipos v1           | 1) **Mayoreo por cantidad** (escalones: «desde 5 piezas, $80 c/u»), 2) **Lleva N, paga M** (3×2, 2×1), 3) **N-ésima pieza con X % de descuento** («la 2.ª al 50 %»). |
| Tipos v2           | 4) Descuento automático por **monto mínimo** («$100 menos en compras desde $1,000»), 5) **Paquetes / kits** con precio fijo.                                         |
| Dónde se calcula   | Solo en la base: `app.calculate_cart` → `storefront.place_order`. El navegador nunca calcula ni manda precios (igual que hoy).                                       |
| Combinación        | Una sola promoción automática por pieza (la que más ahorra al comprador). Cupón encima **solo si el cupón lo permite** (recomendado: no, por omisión).               |
| Pedido             | Cada pedido guarda una copia inmutable de qué promoción se aplicó, a qué piezas y cuánto ahorró.                                                                     |
| Mercado Pago / IVA | Sin cambios en la integración: MP ya cobra un solo concepto por el total calculado. El IVA se calcula sobre lo cobrado ya con descuento (como hoy).                  |
| Panel              | Nueva sección **Promociones** junto a **Descuentos**: crear con asistente, programar fechas, activar/pausar, vista previa con un carrito de ejemplo.                 |
| Tienda             | Insignias «3×2», «Mayoreo», «2.ª al 50 %»; tabla de escalones en la ficha; línea «Ahorras $X con promociones» en carrito, checkout, correo y pedido.                 |
| Esfuerzo v1        | **≈ 12–15 días** de trabajo en 4 fases (§13).                                                                                                                        |

---

## 1. Lo que existe hoy (inventario con evidencia)

### 1.1 Cupones («Descuentos»): sí existen, solo con código

| Pieza                        | Qué hace                                                                                                                                                                                                                | Evidencia                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Tabla `public.discounts`     | Código (`^[A-Z0-9][A-Z0-9_-]{2,31}$`), tipo `percentage` (puntos base) / `fixed_amount` (centavos) / `free_shipping`, mínimo de compra, vigencia, límite total y por cliente, contadores `times_reserved`/`times_used`. | `supabase/migrations/20261013000100_checkout_tables.sql:92-118`                                                              |
| Código bloqueado tras usarse | Trigger `app.discounts_guard`.                                                                                                                                                                                          | `20261013000100_checkout_tables.sql:121-133`                                                                                 |
| Redenciones                  | `discount_redemptions` (`reserved → confirmed / released`), una por pedido (`unique (order_id)`): **solo cabe un cupón por pedido**.                                                                                    | `20261013000100_checkout_tables.sql:316-334`                                                                                 |
| Estado de un código          | `app.discount_status`: ok / not_found / inactive / not_started / expired / min_subtotal / exhausted / customer_limit.                                                                                                   | `supabase/migrations/20261013000200_calculate_cart.sql:209-239`                                                              |
| Guardar desde el panel       | RPC `public.discounts_upsert` (permiso `discounts.manage`, vigencia por día en la zona de la tienda, auditoría `discount.saved`).                                                                                       | `supabase/migrations/20261013000600_phase6_gate_fixes.sql:716-786` (auditoría en `:782`)                                     |
| Freno a adivinar códigos     | `storefront.discount_guard` (límite por IP).                                                                                                                                                                            | `20261013000600_phase6_gate_fixes.sql:671-690`                                                                               |
| Permisos                     | `discounts.read` / `discounts.manage` (área «marketing»; roles `marketing_manager`, `viewer`, etc.).                                                                                                                    | `supabase/migrations/20261006000100_identity_tenancy_tables.sql:656-657, 717-733`; `src/server/auth/permissions.ts:20-21`    |
| RLS                          | `discounts_select` con `discounts.read`; `discount_redemptions_select` con `orders.read`. Escritura solo por funciones.                                                                                                 | `20261013000100_checkout_tables.sql:707-716`                                                                                 |
| Panel                        | Página `/admin/[tienda]/descuentos`: lista + formulario + activar/desactivar/archivar.                                                                                                                                  | `src/app/admin/[storeHandle]/descuentos/page.tsx:38-123`, `actions.ts:34-111`, `forms.tsx:16-40`; menú en `layout.tsx:72-73` |

**Qué no existe:** promociones automáticas (sin código), descuentos por cantidad, NxM, «2.ª pieza», precios por
cliente o listas de precios, paquetes. `rg -i "mayoreo|wholesale|price_list|bundle"` en `src/` y
`supabase/migrations/` no encuentra nada relacionado.

### 1.2 Precios de oferta («precio antes / precio ahora»): sí existen

| Pieza                                         | Qué hace                                                                                                                                                                                 | Evidencia                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `product_variants.price` + `compare_at_price` | Un solo precio vigente; el «precio antes» solo se muestra tachado.                                                                                                                       | `order_items.compare_at_price` copia en `20261013000100_checkout_tables.sql:269-270` |
| Ofertas con fecha (ADR-030)                   | `variant_price_schedules`: cambia `price` al empezar y lo regresa al terminar (máx. 90 días, worker cada minuto). **Regla de diseño ya aprobada: «el precio vigente sigue siendo UNO».** | `supabase/migrations/20261018003000_scheduled_sale_prices.sql:1-80`                  |
| «En oferta» en la tienda                      | `app.product_on_sale` = alguna presentación con `compare_at_price > price`; filtro «Ofertas» en el listado.                                                                              | `supabase/migrations/20261018000400_discovery_price_offers_brands.sql:17-27`         |
| Tarjeta de producto                           | Precio tachado + ahorro.                                                                                                                                                                 | `src/app/%5Fstore/[storeId]/_components/product-card.tsx:105, 118, 211-214`          |
| Ficha de producto                             | «Ahorras $X (Y %)» y «Oferta válida hasta…» (la LFPC pide informar la vigencia).                                                                                                         | `src/app/%5Fstore/[storeId]/productos/[slug]/page.tsx:185-203, 351-369, 413-417`     |

### 1.3 Cálculo del carrito y del pedido (dónde entrarían las promociones)

| Paso                               | Qué hace hoy                                                                                                                                                                                                                                  | Evidencia                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app.cart_totals(lines, rules)`    | Función **pura e inmutable**: subtotal → descuento (uno) → reparto por línea con residuo mayor (`app.allocate_largest_remainder`) → envío (el «gratis desde» se evalúa sobre el subtotal **ya descontado**) → IVA por línea sobre lo cobrado. | `supabase/migrations/20261013000200_calculate_cart.sql:86-160`                                                                                                                                   |
| Casos dorados                      | `tests/fixtures/golden-cart-cases.json` + `tests/integration/golden-cart.test.ts` (documentados en `docs/phases/golden-cart-cases.md`).                                                                                                       | `tests/integration/golden-cart.test.ts:1-30`                                                                                                                                                     |
| `app.calculate_cart`               | Lee líneas desde la base (precio en vivo), valida el cupón, opciones de envío y llama a `cart_totals`.                                                                                                                                        | `supabase/migrations/20261013000600_phase6_gate_fixes.sql:48-215` (cupón `:136-152`, totales `:178-187`)                                                                                         |
| `storefront.place_order` (vigente) | Idempotencia, bloqueo del carrito, recálculo, `p_expected_total` solo detecta cambios (`price_changed`), reserva del cupón con `for update`, pedido + partidas con snapshot, reserva de inventario, intento de pago.                          | `supabase/migrations/20261117000600_manual_payment_hold.sql:20-264` (cálculo `:131`, `price_changed` `:150-152`, cupón `:154-164`, pedido `:183-203`, partidas `:205-220`, redención `:222-225`) |
| Lado TypeScript                    | Solo muestra lo que devuelve la base: `CartView` (`discount`, `discount_total`, `discount_allocation`).                                                                                                                                       | `src/server/storefront/cart.ts:28-31, 68-76`; `src/server/storefront/checkout.ts:31, 166-177`; `src/app/%5Fstore/[storeId]/_components/totals.tsx:5-32` («el navegador nunca los calcula»)       |
| Barra «envío gratis»               | Usa subtotal − descuento.                                                                                                                                                                                                                     | `src/app/%5Fstore/[storeId]/carrito/page.tsx:229-245`                                                                                                                                            |

### 1.4 Registro del pedido

- `orders`: `subtotal`, `discount_total`, `discount_snapshot` (jsonb), `snapshot_version`, CHECK
  `total = subtotal − discount_total + envío + IVA (si no va incluido)` y `discount_total ≤ subtotal`
  (`20261013000100_checkout_tables.sql:177-246`, CHECK en `:240-243`).
- `order_items`: `unit_price`, `compare_at_price`, `discount_allocation`, `tax_amount`, CHECK
  `line_total = unit_price × quantity − discount_allocation` (`:254-288`, CHECK en `:284`).
- El pedido es inmutable salvo estados y pagos (`app.orders_guard`, `20261013000600_phase6_gate_fixes.sql:20-46`).
- Panel del pedido: muestra «Descuento CÓDIGO −$X» (`src/app/admin/[storeHandle]/pedidos/[orderId]/page.tsx:402-405`);
  correo: `src/server/notifications/order-templates.ts:216`; WhatsApp: `src/lib/whatsapp/order-messages.ts`.

### 1.5 Pagos, devoluciones y reportes

- **Mercado Pago**: una sola partida «Pedido #N» por el total calculado por la base
  (`src/server/payments/mercadopago.ts:316-325`). Las promociones **no cambian** la integración.
- **Devoluciones**: el monto sugerido es la parte proporcional del renglón ya con su descuento
  (`supabase/migrations/20261105000600_returns.sql:373-375`); cancelaciones parciales igual
  (`20261014000600_phase7_gate_fixes.sql:886`). Si la promoción se guarda dentro de `discount_allocation`, esto sigue
  funcionando sin cambios.
- **Reportes**: rentabilidad usa `line_total` (`20261110000300_profit_report.sql:118-120`); KPIs del tablero y
  resumen semanal (`20261015000300_dashboard_kpis.sql`, `20261105000300_weekly_summary.sql`). **No hay reporte de
  ventas por cupón ni por promoción.**

### 1.6 Planes

- Planes aprobados (ADR-068): **Tienda $699** y **Tienda Plus $1,299** al mes
  (`docs/plan/PROPUESTA-PLANES-Y-PRECIOS.md:3-19`).
- Límites del plan: `plans` / `plan_entitlements` con claves fijas en `app.entitlement_type`
  (`20261006000100_identity_tenancy_tables.sql:106-119, 174-196`): hoy `max_stores`, `max_products`, …,
  `advanced_analytics`, `abandoned_cart`, `custom_roles`, `api_access`, … **No hay ninguna clave de promociones**;
  habría que agregarla (p. ej. `max_active_promotions`, `promotion_reports`).

### 1.7 Lo que hay que cuidar

- Otra sesión trabaja en paralelo el checkout (`fix/checkout-validacion-rapida`: `carrito/actions.ts`,
  `server/db/role-clients.ts`). Este documento no lo toca; la Fase 3 (tienda) sí tocará el carrito: se debe rebasar
  sobre lo que se integre antes.
- PR #13 (`feat/adr-venta-mostrador`, venta de mostrador) también calculará totales: el motor de promociones debe
  ser una función reutilizable para que el mostrador lo use igual.

---

## 2. Cómo lo hacen otros (comparativa breve)

| Plataforma        | Tipos                                                                                                                                                                                         | Combinación                                                                                                                                                                                                                                                                   | Cómo lo ve el comprador                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Shopify**       | Monto/porcentaje en productos, en pedido, envío gratis, «Compra X y llévate Y»; **precios por volumen** (hasta 10 escalones por producto, por presentación) solo en B2B.                      | Tres clases: producto → pedido → envío. Por omisión no se combinan; cada descuento elige con qué clases sí. Máximo 25 automáticos activos; hasta 5 códigos + 1 de envío por pedido. Varios descuentos de producto en la **misma** pieza solo en Plus.                         | Precio rebajado en carrito/checkout, nombre del descuento; tabla de volumen en B2B.                     |
| **Tiendanube**    | Precio promocional; **por cantidad** (2×1, 3×2, progresivo); en el total (cupón, medio de pago, envío gratis). Apps como «Creador de Promociones» agregan «Lleva más paga menos» y escalones. | Orden: precio promocional → por cantidad → cupón. Dos promociones del mismo tipo nunca se suman: **gana la de mayor descuento**. El cupón se combina solo si se marca «Permitir combinar». 2×1/3×2 descuentan **la pieza más barata**; en una categoría se mezclan productos. | **Etiqueta** «3×2» en la tarjeta; **tabla de escalones** en la ficha; nombre de la promo en el carrito. |
| **Mercado Libre** | **Precio por cantidad (PxQ)**: hasta **5** escalones por publicación con cantidad mínima, precio que baja con la cantidad; además campañas/ofertas del vendedor.                              | El precio por cantidad es «el que gana» para esa cantidad (no se suma a otro precio de cantidad). Desde el 27-oct-2026 en % y **solo para compradores empresa habilitados** (México incluido).                                                                                | Precio por unidad según cantidad; las ventas por ese flujo quedan marcadas (`tags: b2b`).               |

Fuentes: Shopify Help Center («Combining discounts», «Volume pricing in B2B»); Ayuda Tiendanube («¿Cómo funcionan
las promociones y los descuentos?», «Reglas para combinar descuentos», «Preguntas frecuentes»); Mercado Libre
Developers, «Precio por cantidad» (actualizado 25/08/2026). Consultadas el 2026-11-25.

**Qué tomamos:** clases separadas (pieza / pedido / envío) como Shopify; «gana la mejor, no se suman dos del mismo
tipo» y «descuenta la pieza más barata» como Tiendanube; escalones cortos (máx. 5) como Mercado Libre; y algo que
ninguno hace bien de fábrica: **ver ahorro y vigencia en todas partes** (exigido por la LFPC) y **vista previa en el
panel antes de activar**.

---

## 3. Tipos de oferta: valor contra esfuerzo

| #   | Tipo                                         | Ejemplo                                    | Valor para la tienda                                                | Esfuerzo                      | Recomendación       |
| --- | -------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- | ----------------------------- | ------------------- |
| 1   | **Mayoreo por cantidad** (escalones)         | 1–4: $100 · 5–11: $85 · 12+: $75           | Alto: sube piezas por pedido; es lo que pidió el propietario.       | Medio                         | **v1**              |
| 2   | **Lleva N, paga M** (NxM)                    | 3×2, 2×1, 5×4                              | Alto: el más reconocido en México; mueve inventario.                | Medio                         | **v1**              |
| 3   | **N-ésima pieza al X %**                     | 2.ª al 50 %, 3.ª al 70 %                   | Alto: sube ticket con menos margen sacrificado que el 2×1.          | Bajo (comparte motor con NxM) | **v1**              |
| 4   | **Descuento automático por monto mínimo**    | $150 menos desde $1,500; 10 % desde $2,000 | Medio: sube ticket; hoy se puede casi igual con un cupón y mínimo.  | Bajo                          | v2 (o v1.1)         |
| 5   | **Paquete / kit** con precio fijo            | Shaker + proteína + creatina $999          | Medio-alto, pero requiere UX de «arma tu kit» y stock combinado.    | Alto                          | v2                  |
| 6   | Precio por tipo de cliente (lista mayorista) | Revendedores registrados pagan $80         | Alto para distribuidores; requiere cuentas de cliente y aprobación. | Alto                          | v3 (decisión §14-3) |
| 7   | Regalo con compra                            | Llévate una muestra gratis                 | Medio; complica inventario.                                         | Medio                         | Más adelante        |

### 3.1 Definición exacta de los tipos v1

**Alcance de cada promoción:** toda la tienda, una o varias categorías, o productos elegidos. (Presentaciones:
siempre todas las del producto; ver §11.)

1. **Mayoreo por cantidad (`volume`)**: de 1 a 5 escalones `{desde N piezas → precio por pieza $P}` o
   `{desde N → X % menos}`. Se cuenta por **producto** (sumando sus presentaciones) y **todas** las piezas toman el
   precio del escalón alcanzado («precio por volumen», no por tramos). Ej.: 6 piezas con escalón 5+ = $85 → las 6 a $85.
2. **Lleva N, paga M (`buy_n_pay_m`)**: N > M ≥ 1. Por cada grupo completo de N piezas elegibles, las N − M **más
   baratas** del grupo salen gratis. Se agrupan las piezas elegibles de toda la promoción (así «3×2 en playeras» acepta
   tallas o modelos distintos). 7 piezas en 3×2 → 2 grupos, 2 gratis, 1 sin descuento.
3. **N-ésima pieza al X % (`nth_percent`)**: por cada grupo de N piezas, la más barata del grupo lleva X % de descuento
   (1–100 %). «2.ª al 50 %» = N 2, X 50. Con X = 100 equivale a NxM con M = N − 1, pero se deja como tipo aparte porque
   así lo nombra el comerciante.

---

## 4. Combinación (cómo se suman las ofertas)

Orden de cálculo, siempre igual:

1. **Precio vigente** de la presentación (`product_variants.price`, que ya incluye una oferta con fecha de ADR-030).
2. **Promociones automáticas de pieza** (tipos 1–3). **Una sola por pieza**: si una pieza califica para varias, se
   elige la combinación que **más ahorra al comprador** (como Tiendanube). Empate: la de alcance más específico
   (producto > categoría > tienda), luego la más antigua.
3. **Cupón** (lo que existe hoy) sobre el subtotal ya con promociones.
   - Nuevo campo en el cupón: **«Se combina con promociones»** (por omisión **no**; ver decisión §14-2).
   - Si **no** se combina: el cupón solo descuenta las piezas que **no** tienen promoción (el cálculo y el mínimo de
     compra se hacen sobre esas piezas). El carrito lo explica: «Tu cupón no aplica a piezas en promoción».
   - Cupón de **envío gratis**: siempre se combina (no toca precio de piezas).
4. **Envío**: el «gratis desde $X» se evalúa sobre el subtotal ya con promociones y cupón (igual que hoy,
   `calculate_cart.sql:126-134`).
5. **IVA** por línea sobre lo realmente cobrado (igual que hoy).

Opción por promoción: **«También aplica a productos con precio de oferta»** (por omisión **no**, para no apilar
rebajas sin querer; ver §14-4).

Tope de seguridad: ninguna combinación puede dejar una línea en negativo ni el pedido en $0 (hoy `place_order` ya
rechaza total 0, `manual_payment_hold.sql:146-149`).

---

## 5. Cálculo en el servidor (nunca confiar en el navegador)

Se respeta el contrato actual (GATE0 §17.3/§43): **el navegador nunca manda precios ni descuentos**; manda variantes,
cantidades y, si acaso, un código de cupón.

1. **Nueva función pura `app.promotion_apply(p_lines jsonb, p_promotions jsonb) returns jsonb`** (`immutable`, sin
   acceso a tablas): recibe las líneas `{variant_id, product_id, category_ids, unit_price, quantity, on_sale}` y las
   promociones vigentes ya normalizadas; devuelve por línea `promotion_allocation` y la lista de promociones aplicadas
   `{promotion_id, name, type, units, amount}`. Al ser pura se prueba con casos dorados igual que `app.cart_totals`, y
   la puede reutilizar la venta de mostrador (PR #13).
2. **`app.active_promotions(p_store_id, p_at timestamptz)`** (`stable`, `security definer`): lee las promociones
   activas y vigentes de la tienda con su alcance resuelto (productos y categorías).
3. **`app.calculate_cart`**: después de armar `v_sellable` llama a (2) y (1), y pasa a `app.cart_totals` las líneas con
   su `promotion_allocation`.
4. **`app.cart_totals`**: se extiende (compatibilidad hacia atrás: si no hay `promotion_allocation` el resultado es
   idéntico, verificado con **todos** los casos dorados actuales):
   - `line_subtotal = unit_price × qty` (sin cambio).
   - `promotion_total = Σ promotion_allocation`.
   - Cupón sobre `subtotal − promotion_total` (o solo sobre las líneas sin promoción si no se combina).
   - `discount_allocation` de la línea = promoción + parte del cupón → `order_items.line_total` sigue cumpliendo su
     CHECK sin cambiar la tabla.
5. **`storefront.place_order`**: no cambia su firma. Como hoy, recalcula todo dentro de la transacción y bloqueo del
   carrito; si la promoción terminó o cambió entre el carrito y el pago, el total cambia y responde `price_changed`
   (flujo que ya existe, `manual_payment_hold.sql:150-152`). Guarda el snapshot (§8).
6. **Si hay límite de usos** (v2: «solo las primeras 100 ventas»), se bloquea la fila de la promoción `for update`
   como hoy el cupón (`:154-164`).

---

## 6. Modelo de datos y esquema de migración (solo bosquejo; nada aplicado)

Dinero en centavos (`bigint`), porcentajes en puntos base, como todo el esquema.

```sql
-- 1. Promoción
create table public.promotions (
  id              uuid primary key default app.uuid_v7(),
  store_id        uuid not null references public.stores (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 80),   -- interno
  label           text not null check (char_length(btrim(label)) between 1 and 40),   -- lo que ve el comprador: «3×2», «Mayoreo»
  type            text not null check (type in ('volume', 'buy_n_pay_m', 'nth_percent')),  -- v2: 'order_amount', 'bundle'
  rules           jsonb not null,            -- validado por app.promotion_rules_valid(type, rules)
  scope           text not null check (scope in ('store', 'categories', 'products')),
  applies_to_sale_items boolean not null default false,
  starts_at       timestamptz,
  ends_at         timestamptz,               -- vigencia por día en la zona de la tienda, fin inclusivo (como cupones)
  status          text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  priority        smallint not null default 0,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (store_id, id),
  check (starts_at is null or ends_at is null or starts_at < ends_at)
);
-- rules por tipo:
--  volume:       {"tiers":[{"min_qty":5,"unit_price":8500},{"min_qty":12,"percent_bps":2500}]}  (1..5, min_qty creciente ≥ 2)
--  buy_n_pay_m:  {"buy":3,"pay":2}
--  nth_percent:  {"nth":2,"percent_bps":5000}

-- 2. Alcance
create table public.promotion_targets (
  store_id     uuid not null,
  promotion_id uuid not null,
  product_id   uuid,
  category_id  uuid,
  primary key (promotion_id, coalesce(product_id, category_id)),  -- (índice único equivalente)
  check (num_nonnulls(product_id, category_id) = 1),
  foreign key (store_id, promotion_id) references public.promotions (store_id, id) on delete cascade,
  foreign key (store_id, product_id)   references public.products (store_id, id)   on delete cascade
  -- category_id → categorías de la tienda, misma forma compuesta
);

-- 3. Lo aplicado en cada pedido (inmutable, append-only como order_events)
create table public.order_promotions (
  id             uuid primary key default app.uuid_v7(),
  store_id       uuid not null,
  order_id       uuid not null,
  order_item_id  uuid not null,
  promotion_id   uuid,                      -- set null si se archiva/borra
  snapshot       jsonb not null,            -- {name,label,type,rules} al momento de la compra
  units          integer not null check (units > 0),
  amount         bigint  not null check (amount > 0),
  created_at     timestamptz not null default now(),
  foreign key (store_id, order_id)      references public.orders (store_id, id)      on delete restrict,
  foreign key (store_id, order_item_id) references public.order_items (store_id, id) on delete restrict
);

-- 4. Pedido
alter table public.orders     add column promotion_total bigint not null default 0 check (promotion_total >= 0);
--   + constraint promotion_total <= discount_total; snapshot_version = 2 para pedidos con promociones.
alter table public.order_items add column promotion_allocation bigint not null default 0
                                 check (promotion_allocation >= 0 and promotion_allocation <= discount_allocation);

-- 5. Cupones
alter table public.discounts add column combines_with_promotions boolean not null default false;

-- 6. Plan
--   app.entitlement_type: + 'max_active_promotions' (int), + 'promotion_reports' (bool)
```

Además:

- **RLS**: `select` con nuevo permiso `promotions.read`; escritura solo por RPC con `promotions.manage` (o reutilizar
  `discounts.*`; ver §14-5 menor). `force row level security`, `revoke all … from anon, authenticated`, igual que
  `discounts`. `order_promotions` se lee con `orders.read`.
- **Triggers**: `set_updated_at`, `prevent_tenant_change`, y un guard: una promoción `active` que ya se usó no cambia
  `type`/`rules` (se pausa y se crea otra), igual que el código bloqueado del cupón.
- **RPC del panel**: `promotions_upsert`, `promotions_set_status`, `promotions_preview(p_store_id, p_promotion jsonb,
p_lines jsonb)` (calcula con `app.promotion_apply` sin guardar), `promotions_report(p_store_id, p_from, p_to)`.
  Todas con `audit.record('promotion.saved' | 'promotion.status_changed', …)`, como `discount.saved`.
- **Lectura pública**: `storefront.get_product` y `storefront.list_products` agregan `promotions: [{label, type,
rules_publicas, ends_at}]` por producto (solo promociones activas y vigentes).
- **Migraciones**: 3 archivos aditivos con su script de reversa en `scripts/ops/reversa/` (patrón de
  `20261117000600`): (a) tablas + RLS + RPC del panel; (b) motor + `calculate_cart`/`cart_totals`/`place_order` +
  lectura pública; (c) reporte + claves de plan. `app_schema_version()` al día.

---

## 7. Experiencia en el panel

Nueva entrada **«Promociones»** en el menú, junto a «Descuentos» (que se renombra en pantalla a **«Cupones»** para que
no se confundan; la ruta no cambia).

1. **Lista**: nombre, insignia, tipo, alcance, vigencia, estado (Borrador / Activa / Programada / Pausada /
   Terminada), piezas y ahorro dado en los últimos 30 días.
2. **Crear (asistente de 4 pasos, en lenguaje simple)**:
   1. _¿Qué oferta?_ Tarjetas: «Precio de mayoreo», «Lleva 3 paga 2», «2.ª pieza con descuento».
   2. _¿Cuánto?_ Formulario según el tipo. Mayoreo: tabla editable de escalones con el **margen** de cada escalón si
      el producto tiene costo cargado (aviso en ámbar si queda bajo costo).
   3. _¿A qué productos?_ Toda la tienda / categorías / productos (buscador). Casilla «También a productos con precio
      de oferta».
   4. _¿Cuándo?_ Desde / hasta (día, zona de la tienda) o «sin fecha de fin». Insignia que verá el comprador
      (sugerida: «3×2», «Mayoreo», «2.ª al 50 %»).
3. **Vista previa** (antes de activar): carrito de ejemplo editable («si alguien lleva 6 piezas de X…») que muestra
   el cálculo real del servidor (`promotions_preview`) y cómo se verá la insignia y la tabla en la ficha.
4. **Activar / Pausar / Archivar** con confirmación. Avisos: «Esta promoción choca con “2×1 Playeras”: el comprador
   recibirá la que más le ahorre».
5. **En la ficha del producto (panel)**: bloque «Promociones que aplican» con enlace.

Permisos: crear/editar con `promotions.manage` (rol `marketing_manager` y dueño); ver con `promotions.read`.

---

## 8. Experiencia en la tienda

- **Tarjeta de producto**: insignia con la etiqueta de la promoción («3×2», «Mayoreo desde 5», «2.ª al 50 %»), junto
  a la insignia actual de oferta. Una sola insignia de promoción por producto (la de mayor ahorro potencial).
- **Ficha de producto**:
  - Bloque «Promoción» con la regla en palabras: «Lleva 3 y paga 2. Se descuenta la pieza de menor precio.»
  - **Tabla de escalones** para mayoreo: `1–4 piezas $100 · 5–11 $85 (ahorras 15 %) · 12+ $75 (ahorras 25 %)`.
  - Vigencia: «Promoción válida hasta el 30 de noviembre» (LFPC), igual que «Oferta válida hasta…» hoy.
  - Mensaje dinámico junto al selector de cantidad: «Agrega 2 más y paga $85 c/u».
- **Carrito**:
  - Por línea: precio normal tachado → precio con promoción; leyenda «3×2 aplicado: 1 pieza gratis».
  - Sugerencia para completar: «Agrega 1 más y llévatela gratis (3×2)».
  - Totales: **«Ahorro por promociones −$X»** en su propia fila, separada de «Cupón CÓDIGO −$Y».
- **Checkout, correo, WhatsApp y página del pedido**: las mismas dos filas (promociones y cupón).
- Accesibilidad: insignias con texto real (no solo color), tabla con `<table>` y encabezados, cambios del carrito
  anunciados con `aria-live` (patrón existente).

---

## 9. Registro del pedido (copia del descuento)

- `orders.promotion_total` + `orders.discount_total` (= promociones + cupón). El CHECK de totales no cambia.
- `order_items.promotion_allocation` (parte de `discount_allocation`).
- `order_promotions`: una fila por línea y promoción, con la **copia completa** de la regla (`name`, `label`, `type`,
  `rules`) — si mañana la tienda edita o archiva la promoción, el pedido sigue diciendo exactamente qué se aplicó.
- `orders.discount_snapshot` sigue siendo solo el cupón; `snapshot_version = 2`.
- Evento `order.created` agrega `promotion_total` en `metadata`.

---

## 10. Mercado Pago, IVA y facturación

- **Mercado Pago**: sin cambios. Se cobra una sola partida por `orders.total`
  (`src/server/payments/mercadopago.ts:316-325`), que ya trae promociones, cupón, envío e IVA. No se desglosan
  descuentos ante MP. Transferencia/SPEI (proveedor `manual`): igual.
- **IVA**: se calcula por línea sobre lo cobrado (precio − promoción − parte del cupón), como hoy. Con precios con IVA
  incluido, el IVA se extrae del importe ya descontado; sin IVA incluido, se suma después. Una pieza «gratis» del 3×2
  lleva IVA $0 en su parte, sin trato especial.
- **CFDI (futuro)**: el modelo guarda por línea el precio unitario y el descuento (`discount_allocation`), que es lo
  que el CFDI 4.0 pide en el atributo `Descuento` del concepto. Nada que rehacer cuando se facture.
- **Redondeo**: centavos enteros; porcentajes con redondeo «al par» (`app.div_half_even`, el mismo de hoy); repartos
  entre líneas con residuo mayor (`app.allocate_largest_remainder`). La suma de las partes siempre da el total exacto.

---

## 11. Casos límite

| Caso                                                   | Regla                                                                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mezcla de presentaciones (tallas, sabores)             | Cuentan juntas dentro del **producto** (mayoreo) o de la **promoción** (NxM, N-ésima). El descuento cae en la pieza **más barata**. (Decisión §14-5.)                                                               |
| Presentaciones con precios distintos en mayoreo        | Escalón por porcentaje: cada una con su precio − %. Escalón por precio fijo: solo si todas las presentaciones tienen el mismo precio base; si no, el panel obliga a usar porcentaje.                                |
| Escalón que sube el precio                             | Prohibido: el precio de cada escalón debe ser menor que el anterior y que el precio vigente (si el precio vigente baja después, el escalón que ya no ahorra se ignora, como hace Mercado Libre).                    |
| Stock insuficiente                                     | No cambia: `place_order` reserva inventario y revierte todo si falta (`manual_payment_hold.sql:227-235`). El carrito ya avisa `insufficient_stock`.                                                                 |
| Promoción termina mientras el comprador paga           | El recálculo da otro total → `price_changed` (flujo existente). Si el pedido ya se creó, conserva su precio.                                                                                                        |
| Devolución parcial de un 3×2                           | Reembolso proporcional del renglón (`returns.sql:375`): devolver 1 de 3 piezas de $100 en 3×2 devuelve $66.67, no $100. El panel lo explica y la tienda puede ajustar el monto (ya existe).                         |
| Promoción entre productos distintos (3×2 en categoría) | Al devolver se usa el reparto por línea guardado en `order_promotions`; el monto es editable por la tienda.                                                                                                         |
| Cancelación o pago vencido                             | No hay contadores que liberar en v1 (sin límite de usos). En v2, como `discount_redemptions`.                                                                                                                       |
| Cantidad máxima por línea                              | La actual (1–999). Límites de compra regulatorios futuros se aplican **antes** que la promoción.                                                                                                                    |
| Productos regulados                                    | La promoción no salta ninguna regla de cumplimiento: solo aplica a productos publicables. Si un perfil regulatorio prohíbe promociones para una categoría, el motor la excluye (gancho en `app.active_promotions`). |
| Total $0                                               | Rechazado como hoy (D-F6-05).                                                                                                                                                                                       |
| Venta de mostrador (PR #13)                            | Usa la misma `app.promotion_apply`.                                                                                                                                                                                 |

---

## 12. Analítica

- **Reporte «Promociones»** (panel): por promoción y periodo → pedidos, piezas, venta neta, ahorro dado, ticket
  promedio con/sin promoción. Fuente: `order_promotions` ⨝ `orders` pagados (excluye cancelados y descuenta
  reembolsos).
- **Tablero**: tarjeta «Ahorro dado por promociones este mes».
- **Rentabilidad** (`profit_report`): ya usa `line_total`, así que el margen refleja la promoción sin cambios; se
  agrega el filtro por promoción.
- Cupones: el mismo reporte incluye cupones (hoy no existe).

---

## 13. Planes, pruebas y entrega por fases

### 13.1 Planes (propuesta; decisión §14-4)

| Función                                | Tienda ($699)     | Tienda Plus ($1,299) |
| -------------------------------------- | ----------------- | -------------------- |
| Mayoreo, 3×2, 2.ª pieza (tipos v1)     | Sí                | Sí                   |
| Promociones activas a la vez           | **5**             | Ilimitadas           |
| Reporte de ventas por promoción        | Resumen (30 días) | Completo + exportar  |
| v2: monto mínimo automático y paquetes | —                 | Sí                   |

Se controla con `max_active_promotions` y `promotion_reports` en `plan_entitlements` (al activar: «Llegaste a 5
promociones activas, el máximo de tu plan»; patrón de `feat/planes-limites-claros`).

### 13.2 Plan de pruebas

- **Unitarias (Vitest)**: validación de formularios del panel (escalones crecientes, N > M, %), textos de insignias y
  tabla, formato de ahorro.
- **pgTAP (`supabase/tests/database/`)**:
  - `app.promotion_apply`: casos dorados nuevos (≥ 40) — escalón exacto, debajo/encima; 3×2 con 2, 3, 7 piezas;
    precios mixtos (la más barata); 2.ª al 50 % con impares; empates; dos promociones sobre la misma pieza (gana la
    mejor); `applies_to_sale_items`; redondeo con IVA incluido y sin incluir.
  - `app.cart_totals`: **todos los casos dorados actuales siguen idénticos** + casos con promoción + cupón
    combinable / no combinable + envío gratis desde.
  - `place_order`: snapshot correcto, `price_changed` si la promoción termina, idempotencia, aislamiento entre
    tiendas (una promoción de la tienda A nunca afecta a la B), RLS y permisos de las RPC, auditoría.
  - Límites de plan.
- **Integración**: `golden-cart.test.ts` ampliado.
- **E2E (Playwright)**: crear 3×2 en el panel → vista previa → activar → la tienda muestra insignia → carrito con 3
  piezas muestra «1 gratis» → checkout con pago de prueba → pedido, correo y panel con la fila de promociones;
  mayoreo con tabla de escalones en la ficha; móvil 360 px; accesibilidad (axe) sin errores nuevos.
- **Revisión adversarial** antes de pedir el visto bueno (como en fases anteriores).

### 13.3 Entrega por fases

| Fase | Contenido                                                                                                                                                          | Estimado                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 0    | Este documento + decisiones del propietario.                                                                                                                       | Hecho / 1 día de respuesta |
| 1    | **Motor y datos**: migraciones (a) y (b), `promotion_apply`, integración en `calculate_cart`/`cart_totals`/`place_order`, snapshot, pgTAP y casos dorados. Sin UI. | **4–5 días**               |
| 2    | **Panel**: lista, asistente, vista previa, activar/pausar, avisos de choque, permisos, auditoría, límites de plan.                                                 | **3–4 días**               |
| 3    | **Tienda**: insignias, tabla de escalones, mensajes de «agrega 1 más», carrito/checkout/correo/WhatsApp/pedido con la fila de promociones.                         | **3 días**                 |
| 4    | **Reporte y cierre**: reporte por promoción (c), E2E, accesibilidad, revisión adversarial, documento de entrega.                                                   | **2–3 días**               |
| v2   | Monto mínimo automático, paquetes/kits, límite de usos por promoción.                                                                                              | 5–8 días                   |
| v3   | Precio para clientes mayoristas registrados (listas de precios).                                                                                                   | Por estimar                |

**Total v1: ≈ 12–15 días.** Cada fase en su rama y PR en borrador; nada se integra ni despliega sin autorización.
Migraciones a staging solo en ventana aprobada, con su reversa probada.

---

## 14. Decisiones del propietario (DECIDIDO el 2026-11-25)

1. **Alcance de la v1 — DECIDIDO:** **mayoreo por escalones, lleva N paga M (3×2) y la N-ésima pieza al X %.**
   Monto mínimo automático y paquetes quedan para v2.
2. **Promociones y cupones — DECIDIDO:** **no se combinan**, salvo los cupones marcados «Se combina con promociones».
   El cupón que no se combina no descuenta las piezas que usó una promoción. **El envío gratis se combina siempre.**
3. **Mayoreo — DECIDIDO:** aplica a **cualquier comprador** que lleve la cantidad (por pedido).
4. **Planes — DECIDIDO:** los 3 tipos en **ambos planes**. **Tienda: hasta 5 promociones activas. Tienda Plus: sin
   tope** y con el reporte completo. **Por omisión no aplican a productos con precio de oferta** (cada promoción
   puede permitirlo).
5. **Presentaciones — DECIDIDO:** las presentaciones del mismo producto **cuentan juntas** y el descuento cae en la
   **pieza más barata**.

### 14.1 Cambios al implementar la fase 1 (para aprobación)

- **Permisos:** en vez de crear `promotions.read/manage`, la fase 1 **reutiliza `discounts.read/manage`** (hoy los
  tienen exactamente los mismos roles). Evita tocar el catálogo de permisos y su espejo en TS. Si se prefieren
  permisos propios, es una migración pequeña.
- **Reglas:** el mayoreo guarda `{"mode": "unit_price" | "percent", "tiers": [{"min_qty", "value"}]}` (hasta 5
  escalones; en `unit_price` el valor es el **precio por pieza** del escalón). El alcance vive en una tabla aparte,
  `promotion_targets` (productos o categorías; las categorías incluyen sus subcategorías).
- **Varias promociones:** una por pieza; gana la que **más ahorra** (empate: producto > categoría > tienda, luego la
  más antigua).
- **«Sin tope» en Plus:** se captura como **1000** en la consola (la clave nueva es `max_active_promotions`, contada
  por organización al activar). Sin ese valor en el plan **no se puede activar ninguna promoción** (cerrado por
  omisión).
- **Pedido:** `discount_total` sigue siendo el total de descuentos; se agregan `promotion_total`,
  `promotion_allocation` por partida y `order_promotions` (copia inmutable). `snapshot_version` = 2 solo si hubo
  promoción.
- **Pospuesto:** el reporte (fase 4) y el gancho regulatorio para productos con reglas especiales (con la fase 3).

---

## 15. Riesgos

| Riesgo                                                    | Severidad | Mitigación                                                                                                           |
| --------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| Romper el cálculo de totales existente                    | Alta      | Motor separado y puro; `cart_totals` compatible hacia atrás; todos los casos dorados actuales deben dar igual.       |
| Venta bajo costo por promociones mal configuradas         | Media     | Aviso de margen con el costo cargado; cupones no combinables por omisión; vista previa obligatoria antes de activar. |
| Confusión del comprador (Profeco: información de ofertas) | Media     | Regla en palabras, vigencia visible y ahorro por fila en carrito, checkout, correo y pedido.                         |
| Rendimiento del carrito con muchas promociones            | Baja      | Índices por tienda/estado/vigencia; tope de promociones activas por plan; una sola consulta por carrito.             |
| Choque con otras ramas que tocan checkout/carrito         | Media     | Fases 1 y 3 se rebasan sobre lo integrado; la migración (b) se redacta sobre la **última** `place_order` vigente.    |
