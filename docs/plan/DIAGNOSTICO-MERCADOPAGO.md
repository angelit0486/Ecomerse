# Cobro con Mercado Pago en `demo2` (2026-11-04)

Objetivo: que `demo2` cobre con Mercado Pago real y que el pedido pase a «pagado» solo con un webhook firmado. La tienda `demo` no se toca.

## 1. Configuración que falta (solo nombres, nunca valores)

### Variables de entorno en Vercel (proyecto de la tienda, entorno Production)

| Variable                                         | Qué es                                                                             | Obligatoria                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------- |
| `MERCADOPAGO_ACCESS_TOKEN`                       | Access token de la **aplicación de la plataforma** en Mercado Pago (`APP_USR-…`)   | Sí                                      |
| `MERCADOPAGO_WEBHOOK_SECRET`                     | Clave secreta de la firma de webhooks de esa aplicación                            | Sí (va junto con la anterior)           |
| `MERCADOPAGO_CLIENT_ID`                          | Client ID de la aplicación, para que cada tienda conecte **su** cuenta (ADR-041)   | Sí, para cobrar en la cuenta de `demo2` |
| `MERCADOPAGO_CLIENT_SECRET`                      | Client secret de la aplicación                                                     | Sí (van las tres juntas)                |
| `PAYMENT_CREDENTIALS_KEY`                        | Llave con que se cifran las credenciales de cada tienda (32 bytes al azar, base64) | Sí (van las tres juntas)                |
| `APP_URL`                                        | Dirección pública **https** de la plataforma                                       | Ya existe; debe ser https               |
| `APP_ENV`                                        | `production`: solo acepta eventos reales (`live_mode`)                             | Ya existe                               |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | Correo: `resend`, la API key y el remitente de un dominio verificado               | Sí, para los correos (bloqueo B3)       |
| `RESEND_WEBHOOK_SECRET`                          | Firma del webhook de rebotes y quejas de Resend                                    | Recomendada                             |

Para el preview y las pruebas: las mismas variables con las credenciales **de prueba** de la aplicación, en el entorno Preview.

### En el panel de Mercado Pago («Tus integraciones» → la aplicación)

- **Webhook:** `https://<APP_URL>/api/webhooks/payments/mercadopago`, evento «Pagos». La clave secreta que muestra Mercado Pago es `MERCADOPAGO_WEBHOOK_SECRET`.
- **URL de redirección de OAuth:** `https://<APP_URL>/api/payments/mercadopago/callback`.

### URLs de retorno (éxito, pendiente y fallo)

No hay que configurarlas: la tienda las manda en cada preferencia (`src/server/storefront/checkout.ts`, línea 126). Las tres llevan a la página del pedido, que muestra el estado guardado en la base. **El regreso del comprador nunca confirma un pago.** Con `APP_URL` en https, Mercado Pago regresa solo al comprador después de un pago aprobado.

### En la tienda `demo2`

- **Hoy en staging:** su única forma de pago es `fake`, el pago simulado.
- **Falta:** que la dueña conecte su cuenta en Panel → Ajustes → Pagos → «Conectar Mercado Pago».

## 2. Prueba de punta a punta en modo prueba

**No se pudo hacer desde aquí [NO VERIFICADO]:**

- la red de este entorno rechaza `api.mercadopago.com`;
- no hay credenciales de prueba de Mercado Pago (bloqueo B4).

No se simuló con resultados inventados. Lo que sí está probado:

- **Pruebas automáticas:** con la API de Mercado Pago simulada en el servidor de pruebas: firma, nueva consulta, montos y estados (tabla de abajo).
- **Flujo de la tienda hasta la pantalla de pago:** con el proveedor `fake`, en las E2E.

## 3. Casos y dónde están probados

| Caso                                  | Comportamiento                                                                                             | Prueba                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Pago aprobado                         | Pagado solo tras nueva consulta a Mercado Pago                                                             | `tests/integration/mercadopago-webhook.test.ts` «pago confirmado solo por re-consulta…» [VERIFICADO]   |
| Pago rechazado                        | Pedido sigue pendiente; aviso de cobro fallido; se puede reintentar                                        | misma, «rechazado y reintento aprobado…» [VERIFICADO]                                                  |
| Pendiente (OXXO/transferencia)        | Queda pendiente; pagado cuando llega el aprobado; un solo cobro                                            | misma, «OXXO pendiente y después aprobado…» [VERIFICADO]                                               |
| Cierra la ventana a mitad             | El pedido vence y se cancela; la reserva de stock se libera. Si paga después, la conciliación lo encuentra | `29_payments_expiry` (pgTAP), «reconciliación: un intento abierto con más de 15 minutos…» [VERIFICADO] |
| Webhook dos veces                     | El segundo responde «duplicate» y no repite efectos                                                        | «…el evento repetido no repite efectos» [VERIFICADO]                                                   |
| Webhook antes del regreso del cliente | La página del pedido lee el estado de la base: llega como «pagado». El regreso no cambia nada              | «el webhook llega antes que el comprador…» (nueva) [VERIFICADO]                                        |
| Firma inválida                        | 401, evento de seguridad, nada se aplica. Firma vieja: 401. `data.id` distinto: 400                        | «firma inválida → 401…», «firma vieja (replay)…» [VERIFICADO]                                          |
| Monto distinto                        | No se paga; queda «requiere atención» y evento de seguridad                                                | «monto alterado → needs_attention y NO pagado» [VERIFICADO]                                            |
| Cobro de otra cuenta                  | No se aplica                                                                                               | «cobro de otro collector → no se aplica» [VERIFICADO]                                                  |
| Segundo cobro aprobado                | Paga uno; el otro queda para reembolso                                                                     | «dos cobros aprobados distintos a la vez…» [VERIFICADO]                                                |

## 4. Estados y stock

- **Al crear:** el pedido queda en `pending_payment` y el stock se **reserva** (no se descuenta).
- **Pagado:** solo con webhook verificado o conciliación, con monto y moneda iguales a los del cobro (`system.apply_payment_status`). La reserva se confirma una vez (`app.inventory_commit`).
- **Vencido:** `system.expire_orders` cancela el pedido y libera la reserva.

## 5. Correos

- **Confirmación «Confirmamos tu pedido {número}»:** sale solo con el pedido pagado. Clave única pedido + plantilla + destinatario, así que se envía una sola vez. Lleva productos, subtotal, envío, total y dirección (`order-templates.ts`; pruebas `order-notifications.test.ts` y `order-templates.test.ts`).
- **«Pendiente de pago» con Mercado Pago (OXXO o transferencia): no existe.** Hoy solo sale con el pago manual. Se propone en **ADR-056** (`docs/DECISIONS.md` §34), porque toca una función de pagos. Falta tu aprobación.
- **Resend en producción (bloqueo B3):**
  - cuenta de Resend con el dominio verificado (registros SPF, DKIM y DMARC en el DNS);
  - `RESEND_API_KEY` y `EMAIL_FROM` de ese dominio;
  - `EMAIL_PROVIDER=resend`;
  - opcional: el webhook de rebotes en `https://<APP_URL>/api/webhooks/email/resend`, con `RESEND_WEBHOOK_SECRET`.

## 6. Restricciones que impedían cobrar

- **Corregida (`fa95e3d`, D-MEJ-04):** el teléfono escrito con puntos (`222.123.4567`), diagonales o «ext.» rechazaba el pedido con «Revisa la dirección de envío.». Ahora se normaliza antes de guardar. La prueba E2E falla antes y pasa después [VERIFICADO].
- **Revisadas y sin cambio, porque protegen al comercio o a la paquetería:**
  - correo, nombre, calle, colonia, ciudad, estado, CP y teléfono obligatorios;
  - hasta 999 piezas por producto y 50 productos distintos por carrito;
  - el total que manda el navegador no manda.
- **Sin tocar:** la firma del webhook, la comparación de montos y la idempotencia.

## 7. Cómo revertir

`git revert fa95e3d`: solo la normalización del teléfono, sin migración.
