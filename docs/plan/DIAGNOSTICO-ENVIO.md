# Diagnóstico: «elige una forma de envío» al pagar (2026-11-04)

Pedido: que un cliente complete el checkout en `demo2` sin el error de envío. La tienda `demo` no se toca: sigue suspendida por el incidente del 2026-11-03.

## 1. Reproducción

**El preview de Vercel de `mejoras/2026-11` no se pudo abrir [NO VERIFICADO]:**

- la red de este entorno bloquea `vercel.app`;
- el conector de Vercel responde 403 (sin acceso al equipo).

**Se reprodujo en local**, con el mismo código (`mejoras/2026-11`, `de33bf9`) y la misma configuración de `demo2` que staging (semilla `pnpm demo:seed:neutral`):

- zona «México» para todo MX;
- tarifa «Envío estándar», `free_over`, $99.00, gratis desde $999.00, activa;
- pago simulado (`fake`).

| Caso                                                                      | URL                                                                                                                                  | Envío ofrecido                                            | Respuesta del servidor                                                      | Resultado                                                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `demo2` tal como está                                                     | `http://demo2.localhost:3000/checkout` (POST de la acción `checkout`, `intent=place`, `expected_total=34800`, `requires_shipping=1`) | «Envío estándar · 2–5 días $99.00 (gratis desde $999.00)» | Redirección a `/pago-simulado/<pago>`                                       | **Funciona** [VERIFICADO]. Capturas `docs/audit/envio/demo2-formulario.png` y `demo2-pantalla-de-pago.png` |
| `demo2` con su tarifa desactivada (solo en local, restaurada al terminar) | La misma                                                                                                                             | «No hay envíos disponibles para esta dirección.»          | Acción con `error` «Elige una forma de envío disponible para tu dirección.» | **Error reproducido** [VERIFICADO]. Captura `docs/audit/envio/sin-tarifa-mensaje-actual.png`               |

## 2. Dónde nace el mensaje

El texto exacto «seleccione un envío válido» no existe en el código. El que ve el comprador es **«Elige una forma de envío disponible para tu dirección.»**, definido en `src/app/%5Fstore/[storeId]/carrito/actions.ts`, línea 53 (`ERRORS.shipping_rate_id`).

Se muestra cuando la base responde `validation_failed` con detalle `shipping_rate_id`. Eso ocurre en dos lugares:

1. **`storefront.cart_set_details`** (`supabase/migrations/20261013000500_checkout_admin.sql`, líneas 114–122): el id de tarifa que manda el navegador no es un uuid, no es de esa tienda o la tarifa está inactiva.
2. **`storefront.place_order`** (`supabase/migrations/20261013000600_phase6_gate_fixes.sql`, líneas 335–339): el carrito requiere envío y `app.calculate_cart` devuelve un estado distinto de `ok` y de `address_required`. Es `rate_required` (sin tarifa elegida, por ejemplo porque **no hay ninguna** para la dirección) o `unavailable` (la elegida ya no aplica).

Las opciones las calcula `app.shipping_options` (`20261013000200_calculate_cart.sql`). Solo entran las tarifas activas de la tienda cuya zona incluye el país y, si la zona limita estados, el estado de la dirección.

## 3. Datos de staging (solo lectura)

| Tienda                    | Zonas                                             | Tarifas                 | Pagos                          | Carritos                                                                                     |
| ------------------------- | ------------------------------------------------- | ----------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| `demo2` (activa, MXN, MX) | «México», todo MX                                 | «Envío estándar» activa | solo `fake` (sin Mercado Pago) | **0**: nadie ha intentado comprar ahí                                                        |
| `demo` (suspendida)       | 4 zonas (Sinaloa, «La paz», Baja California Sur…) | **las 2 inactivas**     | `fake`; `manual` desactivado   | 1 carrito: 2026-11-03 08:34 UTC, Baja California Sur, **0 opciones**, estado `rate_required` |

Las demás preguntas, contestadas:

- **¿El id que manda el navegador existe y está activo en esa tienda?** En `demo2` sí: es la única tarifa, activa y de la misma tienda.
- **¿RLS o tienda equivocada?** No: las funciones son `SECURITY DEFINER` y filtran por `store_id`; la tienda sale del host, nunca del cliente.
- **¿Moneda?** No influye en el envío.

## 4. Causa raíz

El error aparece cuando la tienda no tiene ninguna tarifa de envío activa que cubra la dirección del comprador. El único caso real en staging fue `demo`, con sus dos tarifas inactivas. `demo2` está bien configurada y su checkout llega al pago. Lo defectuoso es el mensaje: pide «elegir» cuando no hay nada que elegir y no dice qué falta.

## 5. Arreglo propuesto (mínimo, aditivo)

- **Interruptor `checkout_shipping_messages`**, apagado por defecto. No toca `app.calculate_cart`, `place_order`, precios, totales ni pagos, así que no hace falta ADR.
- **Sin tarifas para una dirección válida:** el mensaje dice qué falta. Ejemplo: «Esta tienda todavía no hace envíos a Baja California Sur. Revisa el estado de tu dirección o escríbele a la tienda.» Aparece en el recuadro de envío y al confirmar.
- **Una sola forma de envío:** se marca sola en el formulario. Ya se elegía sola al calcular el envío (`preferredRate`); queda cubierto por prueba.
- **Datos de `demo2`:** no faltan; no se crea migración de datos.
- **Mercado Pago:** `demo2` no tiene cuenta de Mercado Pago y staging no tiene credenciales de prueba (bloqueo B4). La captura llega a la pantalla del pago simulado. La de Mercado Pago requiere esas credenciales.

## 6. Qué se aplicó (2026-11-04)

| Commit    | Paso | Cambio                                                                                                                                                    |
| --------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3e01a21` | 1–4  | Este diagnóstico y sus capturas                                                                                                                           |
| `a356689` | 5–6  | Interruptor `checkout_shipping_messages` (apagado), mensaje que nombra el estado sin cobertura y forma de envío única marcada; migración `20261104000100` |
| `c1b504f` | 7    | Pruebas unitarias y E2E `tests/e2e/checkout-shipping.spec.ts`; el mensaje ya no se repite en gris si el error lo dice                                     |

- **Forma de envío única:** el servidor ya la elegía al confirmar. Lo nuevo cubre el caso en que la tarifa guardada en el carrito deja de ofrecerse (se desactivó o cambió la dirección): si queda una sola, se marca sola. Si eso cambia el total, la base pide confirmar con el total correcto (el navegador no manda en el total).
- **Pruebas:** las dos E2E fallan con el código anterior y pasan con el nuevo [VERIFICADO]. Capturas `prueba-pantalla-de-pago.png` y `prueba-sin-cobertura-mensaje-claro.png`.
- **Staging:** no se aplicó la migración. `demo2` no la necesita para cobrar, y el interruptor nace apagado.

## 7. Cómo revertir

1. **Sin desplegar nada:** apagar `checkout_shipping_messages` para la tienda (o no encenderlo). El checkout vuelve exactamente al comportamiento anterior; lo cubre la segunda prueba E2E.
2. **Código:** `git revert c1b504f a356689`. La migración es aditiva (una fila en `feature_flags`) y puede quedarse; el código anterior la ignora.
