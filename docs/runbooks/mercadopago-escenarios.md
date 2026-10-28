# Mercado Pago: escenarios probados (misión vendible F1.4)

Todo lo de esta página está probado contra un **Mercado Pago simulado** (API falsa en las pruebas): **[SIMULADOR]**. Nada se ha probado aún con la aplicación real del propietario: **[NO VERIFICADO con Mercado Pago real]** hasta tener credenciales de prueba (ver `docs/runbooks/mercadopago.md`).

## Matriz

| #   | Escenario                                                         | Resultado esperado                                            | Prueba                                                        | Estado                   |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------ |
| 1   | Pago aprobado con tarjeta                                         | Pedido pagado solo tras re-consultar el cobro a Mercado Pago  | `mercadopago-webhook`: «pago confirmado solo por re-consulta» | ✅ [SIMULADOR]           |
| 2   | El mismo aviso llega dos veces                                    | No se repiten correos, inventario ni pagos                    | Mismo caso (idempotencia)                                     | ✅ [SIMULADOR]           |
| 3   | Tarjeta rechazada y luego aprobada en el mismo checkout           | El pedido se paga con el aprobado                             | «rechazado y reintento aprobado»                              | ✅ [SIMULADOR]           |
| 4   | OXXO: pendiente y días después pagado                             | Un solo cobro; pedido pagado al llegar el aprobado            | «OXXO pendiente y después aprobado»                           | ✅ [SIMULADOR]           |
| 5   | OXXO o transferencia que nunca se paga                            | El pedido vence, se libera el inventario y el cupón           | pgTAP `29_payments_expiry`                                    | ✅ [SIMULADOR]           |
| 6   | Monto alterado (cobro distinto al total)                          | No se marca pagado; pedido en atención                        | «monto alterado → needs_attention y NO pagado»                | ✅ [SIMULADOR]           |
| 7   | Cobro de otra cuenta de Mercado Pago                              | No se aplica                                                  | «cobro de otro collector», `mercadopago-oauth` (A y B)        | ✅ [SIMULADOR]           |
| 8   | Dos cobros aprobados del mismo intento (doble clic)               | Uno paga; el otro queda en atención para reembolsar           | «segundo cobro aprobado…», «dos cobros aprobados a la vez»    | ✅ [SIMULADOR]           |
| 9   | Firma inválida o aviso viejo reenviado (replay)                   | 401, evento de seguridad, nada se aplica                      | «firma inválida», «firma vieja (replay)»                      | ✅ [SIMULADOR]           |
| 10  | Aviso de modo prueba en producción                                | Se ignora                                                     | «producción: un evento de modo prueba se ignora»              | ✅ [SIMULADOR]           |
| 11  | El aviso nunca llega                                              | La reconciliación (cada 10 min) busca el cobro y lo aplica    | «reconciliación: un intento abierto con más de 15 minutos…»   | ✅ [SIMULADOR]           |
| 12  | Reembolso desde el panel de la tienda                             | Se crea con idempotencia y se consulta hasta confirmarse      | `refunds-job`: «mercadopago: crea con idempotencia…»          | ✅ [SIMULADOR]           |
| 13  | Mercado Pago caído (5xx o 429)                                    | Se reintenta; un 4xx es definitivo                            | unitarias `mercadopago.test.ts`                               | ✅ [SIMULADOR]           |
| 14  | Llaves del comercio por vencer                                    | Se renuevan solas y se guardan las nuevas                     | `mercadopago-oauth`: «las llaves por vencer se renuevan»      | ✅ [SIMULADOR]           |
| 15  | **Contracargo, o reembolso hecho desde el panel de Mercado Pago** | Hoy se **ignora**: el pedido sigue «pagado» y nadie se entera | Sonda del 2026-10-28 (resultado `ignored`, sin atención)      | ❌ **ADR-043 propuesto** |

## Lo que falta para marcarlo [VERIFICADO]

1. Credenciales de **prueba** de la aplicación de Mercado Pago del propietario (Client ID, Client Secret y la clave secreta del webhook) en Vercel.
2. Repetir en staging los escenarios 1, 3, 4, 9, 11 y 12 con las tarjetas y el OXXO de prueba que Mercado Pago publica, y anotar aquí fecha y resultado de cada uno.
3. Aprobar ADR-043 (escenario 15) e implementarlo.
