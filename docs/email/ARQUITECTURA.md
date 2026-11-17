# Correos transaccionales de PRUVA

Arquitectura del envío de correos (código en esta rama). La configuración externa
(cuenta de Resend, DNS, variables en Vercel y una entrega real) la hace el
propietario: ver `docs/runbooks/correo-resend.md`.

## Flujo

```
Evento de negocio (pedido, pago, Auth, equipo)
        ↓
  app.enqueue_job(...)  o  Send Email Hook de Supabase
        ↓
  Cola system.jobs  (el checkout no espera al correo)
        ↓
  Handler  →  sendNotification()
        ↓
  ¿system.email_suppressed?  →  se registra 'suppressed' y no se envía
  ¿ya delivered (dedupe_key)? →  el handler no vuelve a llamar
        ↓
  EmailChannel (resend | mailpit | fake)
        ↓
  system.record_notification_delivery(..., 'sent', provider, provider_message_id)
```

Confirmación de **pago**: solo la encola `system.apply_mercadopago_payment` (o el
equivalente de Stripe) después de un webhook **verificado** y de reconsultar el
cobro al proveedor. El retorno del comprador al sitio no confirma ni dispara el
correo de pagado.

Un fallo de Resend no revierte el pedido: el trabajo queda en la cola y se
reintenta. Un rechazo definitivo (dirección inválida) suprime esa dirección y no
se reintenta. En desarrollo, test y vista previa, con Resend real, un
destinatario fuera de `EMAIL_ALLOWED_RECIPIENTS` se omite sin registrar ni
suprimir (no consume la clave de deduplicación).

«Aceptado por Resend» (`email.accepted` + id del mensaje) no es «entregado». La
entrega, el rebote o la queja llegan por `/api/webhooks/email/resend` cuando está
configurado `RESEND_WEBHOOK_SECRET`.

## Qué ya existía y qué se extendió

No se reemplazó el outbox ni las plantillas. Se extendió el canal:

- Canal Resend pasa del `fetch` manual al SDK oficial `resend@6.38.1`.
- `EMAIL_REPLY_TO` opcional (el contacto de la tienda sigue mandando en correos de pedido).
- Guardia `EMAIL_ALLOWED_RECIPIENTS` fuera de producción.
- Validación más estricta de `RESEND_API_KEY` (`re_…`).
- Logs de intento (`email.accepted` / `email.failed` / `email.skipped_not_allowed`) sin destinatario ni cuerpo.

## Eventos y plantillas

| Evento del dueño           | Qué hay en el código                                                                    | Quién lo dispara                                                      |
| -------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Confirmación de registro   | `authCodeEmail` (`signup` / `magiclink`)                                                | Send Email Hook de Supabase Auth                                      |
| Verificación de correo     | `authCodeEmail` (`email_change`)                                                        | Mismo hook                                                            |
| Recuperación de contraseña | `authCodeEmail` (`recovery`)                                                            | Mismo hook (si Auth está en códigos, no en enlace SMTP de Supabase)   |
| Confirmación de pedido     | `orderReceivedEmail`                                                                    | Job `order.created`                                                   |
| Confirmación de pago       | `orderConfirmationEmail`                                                                | Job `order.paid` (solo tras webhook verificado)                       |
| Pedido enviado             | `orderShippedEmail`                                                                     | Job `order.shipped`                                                   |
| Actualización de estado    | `orderDeliveredEmail`, `orderLinkEmail`, avisos de pago pendiente/fallido, devoluciones | Jobs `order.delivered`, `order.link_renewed`, `payment.*`, `return.*` |
| Cancelación                | `orderCancelledEmail`                                                                   | Job `order.cancelled`                                                 |
| Reembolso                  | `refundIssuedEmail`                                                                     | Job `refund.succeeded`                                                |

También hay correos de plataforma (invitación al equipo, aviso de soporte, avisos
al dueño, resumen semanal, recordatorio de carrito). El recordatorio de carrito
lleva baja en un clic (RFC 8058); los de pedido no.

## Idempotencia

- Clave de deduplicación por evento + plantilla + hash del destinatario
  (`notification_deliveries.dedupe_key` es único).
- `Idempotency-Key` hacia Resend (la misma clave).
- Eventos de pago: `record_payment_event` marca el aviso del proveedor como
  procesado; un duplicado no vuelve a aplicar ni a encolar `order.paid`.

## Variables

El código **no** usa `NEXT_PUBLIC_APP_URL` (no se publica un secreto ni la URL
en el cliente para esto). El equivalente es `APP_URL` (servidor). Ver el
runbook para el mapa completo y qué va en cada entorno de Vercel.

## Dependencia nueva

`resend@6.38.1`: SDK oficial de la API que ya se llamaba a mano. Sin
alternativas en el árbol (el `fetch` propio se sustituye, no se duplica).
