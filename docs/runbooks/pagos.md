# Pagos y correos de pedido: qué hacer ante cada falla (2026-10-29)

Para el dueño de la plataforma y para soporte. El detalle técnico está en `mercadopago.md`, `mercadopago-escenarios.md` y `stripe-billing.md`. Decisiones: DECISIONS §30 (ADR-050 a ADR-053, propuestos).

Etiquetas: **[SIMULADOR]** = probado con una API falsa en las pruebas automáticas; **[VERIFICADO]** = probado con el servicio real; **[NO VERIFICADO]** = falta probarlo con el servicio real.

## Cómo funciona

1. El comprador paga: el pedido nace **«Pendiente de pago»**.
2. Mercado Pago avisa por **webhook firmado**. PRUVA no confía en el aviso: vuelve a consultar el cobro en Mercado Pago y comprueba monto, moneda, referencia del pedido y cuenta de la tienda. Solo entonces el pedido pasa a **pagado**.
   - Volver de Mercado Pago al navegador **no** cambia nada.
3. Con el pago confirmado sale **un solo** correo de confirmación al comprador (clave única por pedido) y el aviso a la tienda.
4. Si el aviso nunca llega, la **reconciliación** (cada 10 minutos) consulta los intentos abiertos y aplica lo que encuentre.
5. Si el comprador reintenta el pago, se usa **el mismo pedido**: no se duplica.

## Ante cada falla

| Qué pasa                                           | Cómo se nota                                                                           | Qué hacer                                                                                                                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| El comprador pagó pero el pedido sigue pendiente   | Consola → Salud: «intentos abiertos más de 2 horas»; el comprador escribe              | Esperar 10 minutos (reconciliación). Si sigue igual: Consola → Trabajos, revisar `payments.reconcile`. Revisar en Mercado Pago que el cobro esté aprobado y sea de la cuenta de esa tienda                                           |
| El monto cobrado no coincide con el total          | Pedido «en atención» con motivo                                                        | No se marca pagado a propósito. La tienda revisa y reembolsa desde el panel                                                                                                                                                          |
| Dos cobros aprobados del mismo pedido (doble clic) | Pedido «en atención»                                                                   | Uno paga el pedido; el otro se reembolsa desde el panel                                                                                                                                                                              |
| Pago tardío (llegó después de vencer el pedido)    | Si hay existencias, el pedido se paga normal. Si no hay, correo «Atención» a la tienda | Sin existencias, el reembolso se inicia solo; la tienda revisa que se complete                                                                                                                                                       |
| Contracargo o reembolso hecho desde Mercado Pago   | Correo «Atención: contracargo» a la tienda; pedido en atención                         | Detener el envío si no salió. Responder el contracargo en Mercado Pago con la evidencia de entrega (guía, paquetería, fecha)                                                                                                         |
| Firma inválida en los webhooks                     | Consola → Salud: «rechazos de firma»                                                   | Si son muchos y de golpe, alguien está probando: no hace falta hacer nada (se rechazan). Si son todos, el secreto del webhook en Vercel no coincide con el de Mercado Pago: corregirlo (`rotacion-de-claves.md`)                     |
| Mercado Pago caído                                 | Errores 5xx en logs; pagos que no avanzan                                              | Se reintenta solo. Si dura horas: avisar a las tiendas y activar el pago por transferencia (siguiente fila)                                                                                                                          |
| **Cuenta de Mercado Pago suspendida**              | La tienda no puede cobrar; errores 401/403 de esa cuenta                               | 1) La tienda activa **Ajustes → Pagos → Transferencia** (CLABE e instrucciones) y desactiva Mercado Pago. 2) La tienda contacta a Mercado Pago. 3) Si la suspensión es larga, segundo procesador (ADR-051)                           |
| La llave de un comercio venció                     | Pagos de esa tienda fallan; aviso en Salud                                             | Se renuevan solas 30 días antes. Si falló: la tienda vuelve a conectar Mercado Pago en Ajustes → Pagos                                                                                                                               |
| El correo de confirmación no llegó                 | El comprador escribe; Consola → Salud: «correos no enviados»                           | Revisar en Resend → Emails si se envió, rebotó o se marcó como spam. Si rebotó, el correo queda **suprimido** (ya no se le escribe): confirmar con el comprador su dirección; para corregirlo, la tienda edita el correo del cliente |
| El comprador escribió mal su correo                | El envío rebota                                                                        | El correo queda suprimido y el pedido sigue normal. La tienda puede contactarlo por teléfono                                                                                                                                         |
| El proveedor de correo no responde                 | Trabajos de notificación que reintentan                                                | Se reintenta con espera creciente (1, 2, 4… hasta 64 minutos). Nunca se duplica: cada correo tiene su clave única                                                                                                                    |
| Un comprador se queja de spam                      | Evento de queja de Resend                                                              | Su correo queda suprimido para siempre. Si fue un error, se quita a mano de `system.email_suppressions` con auditoría (no hay pantalla todavía)                                                                                      |
| Mercado Pago cambia sus políticas de productos     | Aviso de Mercado Pago a la tienda o a la plataforma                                    | Revisar la lista de categorías bloqueadas de la plataforma (ADR-053) y actualizarla desde la consola                                                                                                                                 |

## Estado de la verificación (2026-10-29)

| Caso                                 | Prueba automática                                                                                | Con Mercado Pago real                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Aprobado                             | integración `mercadopago-webhook`                                                                | [NO VERIFICADO]: faltan credenciales de prueba |
| Rechazado y luego aprobado           | integración «rechazado y reintento aprobado»                                                     | [NO VERIFICADO]                                |
| Pendiente (OXXO) y después pagado    | integración «OXXO pendiente y después aprobado»                                                  | [NO VERIFICADO]                                |
| Expirado                             | pgTAP `29_payments_expiry`                                                                       | [NO VERIFICADO]                                |
| Reembolso total y parcial            | integración `refunds-job`; pgTAP `32_fulfillment_refunds` (parcial)                              | [NO VERIFICADO]                                |
| Webhook duplicado                    | integración `mercadopago-webhook` (idempotencia) y `order-notifications` (un solo correo)        | [NO VERIFICADO]                                |
| Webhook fuera de orden               | integración `stripe-webhook` «fuera de orden» (la misma regla de la base para ambos proveedores) | [NO VERIFICADO]                                |
| Pago tardío con y sin existencias    | integración `stripe-webhook` «pago tardío…» (misma regla de la base)                             | [NO VERIFICADO]                                |
| Correo de confirmación completo      | unitarias `order-templates` y pgTAP 115                                                          | Correo real: [NO VERIFICADO] (falta Resend)    |
| Rebotes, quejas y correo mal escrito | unitarias `email-events`; pgTAP 115; integración `order-notifications`                           | [NO VERIFICADO contra Resend]                  |
| Vista en Gmail, Outlook y celular    | Solo HTML con tablas, estilos en línea y ancho máximo de 560 px                                  | [NO VERIFICADO]: necesita envíos reales        |

## Lo que falta del propietario

1. **Credenciales de prueba de Mercado Pago:** Client ID, Client Secret y la clave secreta del webhook. Van en la configuración del entorno, nunca en el chat (ver el resumen del prompt).
2. **Resend:** cuenta, dominio verificado y API key (`correo-resend.md`). Sin esto no sale ningún correo real.
3. Decisiones de ADR-050 a ADR-053.
