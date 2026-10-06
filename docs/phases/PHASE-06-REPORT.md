# Gate F6 — Informe de cierre: Fase 6 (Customers, Cart, Shipping, Taxes, Discounts & Checkout)

> Contrato: GATE0 §38 (PHASE 6), §16, §17, §18.2, §44. Decisiones: `docs/DECISIONS.md` D-F6-01 … D-F6-08.
> Rama `claude/ecommerce-regulated-platform-41vu1e`, commits `7544bab` … (ver `git log cd8dc6c..HEAD`).
> **Push bloqueado (P0):** GitHub devuelve 403. El CI no ha corrido; todos los resultados son locales. Respaldo: `pruva-f6.bundle`.

## 1. Cambios realizados

| Área                        | Resultado                                                                                                                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tablas (F6-T01)             | Direcciones, zonas y tarifas de envío, descuentos, carritos, pedidos, partidas, historial, redenciones, cuentas de pago y pagos; FK compuestas, RLS forzado, PII del pedido sin grant de columna, snapshot inmutable, transiciones de §16.4 por trigger, nada se borra. |
| Cálculo único (F6-T02)      | `app.cart_totals` (aritmética pura, casos dorados) + `app.calculate_cart` (precios vigentes, disponibilidad, código, tarifa).                                                                                                                                           |
| Checkout (F6-T03)           | `storefront.cart_*` y `storefront.place_order` en una transacción (§17.4): idempotencia ligada al carrito, `price_changed`, reserva, contador, cupón, rollback total.                                                                                                   |
| Pagos y expiración (F6-T04) | Contrato `PaymentProvider` con `manual` y `fake`; confirmación única; reintento; job `orders.expire` por minuto.                                                                                                                                                        |
| UI (F6-T05)                 | Carrito, checkout de una página, pedido del invitado, pago simulado; panel de Pedidos, Envíos, Impuestos y Descuentos; rate limits (§17.7, A20).                                                                                                                        |
| Gate                        | Correcciones de la revisión (§5).                                                                                                                                                                                                                                       |

## 2. Migraciones

`20261013000100` tablas · `…000200` cálculo · `…000300` carrito y place_order · `…000400` pagos y expiración · `…000500` panel y rate limits · `…000600` correcciones del gate. Forward-only, probadas desde cero.

## 3. Pruebas y resultados (locales, 2026-10-06)

| Suite                                             | Resultado |
| ------------------------------------------------- | --------- |
| `pnpm verify` (lint, formato, tipos, unit, build) | ✅ 281    |
| `pnpm db:test` — pgTAP (33 archivos)              | ✅ 982    |
| `pnpm db:test` — integración                      | ✅ 62     |
| `pnpm test:stack`                                 | ✅ 29     |
| `pnpm test:e2e` (con axe)                         | ✅ 20     |

**Casos dorados:** 17 casos de totales (`docs/phases/golden-cart-cases.md`, generado y verificado contra PostgreSQL) — mitad al par, impuesto por línea incluido o aparte, envío gravado, reparto por residuo mayor, envío gratis desde X tras el descuento, cupón de envío gratis.
**Concurrencia real** (una conexión por comprador): 20 compradores por la última unidad → 1 pedido; 20 por el último cupón → 1; 15 pedidos simultáneos sin fila de contador → números consecutivos (la prueba encontró una carrera real, corregida); doble envío con la misma clave → un pedido; expiración contra confirmación simultáneas → cada pedido pagado o cancelado, nunca a medias.
**Mutación:** half-even → half-up hace fallar 2 casos dorados; sin el CHECK de totales o sin el trigger de snapshot fallan 7 pgTAP; el contador no atómico hace fallar la prueba de numeración.

## 4. Criterios de aceptación (GATE0 §38, PHASE 6)

| Criterio                                                                                                                                                                | Estado                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Del carrito a `pending_payment` con totales correctos y stock reservado                                                                                                 | ✅ pgTAP + E2E                                        |
| Totales: tabla de casos (impuesto incluido o no, %, fijo, envío gratis, redondeos, multilínea, prorrateo exacto)                                                        | ✅ casos dorados                                      |
| `place_order`: idempotencia, `price_changed`, `insufficient_stock` con rollback total (contador incluido), cupón agotado concurrente, variante y carrito de otra tienda | ✅ pgTAP + concurrencia                               |
| Expiración (libera, cancela con `payment_expired`, libera el cupón)                                                                                                     | ✅ pgTAP + integración como `system_worker`           |
| El frontend no es autoridad; rate limits; token de carrito httpOnly                                                                                                     | ✅ E2E (total manipulado rechazado), pgTAP de límites |
| E2E: checkout con `fake` hasta «pagado»                                                                                                                                 | ✅                                                    |
| Confirmación manual del staff, auditada                                                                                                                                 | ✅ pgTAP                                              |

## 5. Revisión del gate

Revisión adversarial (dinero, idempotencia, estados, RLS, rate limits, UI): **sin hallazgos críticos ni altos**; el dinero lo calcula siempre la base, las referencias entre tiendas se rechazan y el rollback es total. Corregido (`20261013000600` y app):

1. Medio: cada acción del carrito marcaba obsoleta la caché de datos de todas las tiendas → `refresh()`.
2. Medio: el límite de códigos por carrito se evadía con carritos nuevos y los estados revelaban tipo y valor de códigos inactivos o futuros → límite por IP y respuesta mínima.
3. Medio: un pedido impago con un email ajeno registraba su consentimiento de marketing → el consentimiento pasa al cliente solo con el pago.
4. Medio: cualquiera podía agotar el límite diario de pedidos del email de otro → cuenta solo pedidos creados.
5. Bajo: orden de bloqueos invertido en `mark_payment_*`; actor por defecto `system`; confirmación tras reintento podía chocar con una transición de sistema; nota interna sin auditoría; `fake` listado sin el ajuste; fechas de descuentos en la zona del servidor; paginación de pedidos con empates.

Aceptado sin cambio (D-F6-08): IP desde `x-forwarded-for` (supone el proxy de Vercel); `ORDER_LINK_SECRET` sin versión; `requestOrigin()` desde el host verificado; confirmación manual sin clave de idempotencia (repetir da `conflict`).

## 6. Riesgos

- Sin pasarela real hasta la F7: una tienda solo cobra con `manual` (confirmación del staff); las cuentas de pago aún no se configuran desde el panel.
- Pedidos de total 0 rechazados en el MVP (cupón del 100 %): se reevalúa con `apply_payment_status` (F7).
- Pago tardío sobre un pedido expirado (CF-04): F7.

## 7. Pendientes

- F7: Stripe Connect, webhook verificado, `apply_payment_status`, reembolsos, envíos, notificaciones por email, Ajustes → Pagos, validación de lanzamiento.
- Owner: acceso de escritura a GitHub (P0), proyectos Supabase y Vercel, **cuenta de Stripe antes de la F7**, revisión de los casos dorados.

## 8. Definition of Done

- [x] Suite completa en verde (local), concurrencia incluida.
- [x] Migraciones forward-only probadas desde cero.
- [x] Decisiones registradas (D-F6-01 … D-F6-08).
- [ ] CI de GitHub (bloqueado por P0).
