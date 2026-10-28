# Mercado Pago (ADR-028 y ADR-041)

Cobro con Mercado Pago Checkout Pro. **Estado:** implementado y probado con la API simulada. **Falta la prueba con credenciales reales de prueba**.

## Qué necesita el propietario

1. Una cuenta de Mercado Pago de México, de preferencia de vendedor (empresa o persona con actividad).
2. En [Tus integraciones](https://www.mercadopago.com.mx/developers/panel/app), crear una aplicación de tipo «Pagos online» con Checkout Pro.
3. **Credenciales de prueba** primero: copiar el _Access Token_ de prueba. Nunca lo compartas por chat: va directo a las variables de entorno.
4. En la aplicación, ir a **Webhooks → Configurar notificaciones**:
   - URL de producción: `https://<dominio-del-panel>/api/webhooks/payments/mercadopago`
   - Eventos: **Pagos**.
   - Copiar la **clave secreta** que muestra Mercado Pago.

## Variables de entorno (Vercel → Settings → Environment Variables)

| Variable                     | Valor                                        |
| ---------------------------- | -------------------------------------------- |
| `MERCADOPAGO_ACCESS_TOKEN`   | Access Token (de prueba en la vista previa). |
| `MERCADOPAGO_WEBHOOK_SECRET` | Clave secreta de la firma de webhooks.       |

Van juntas: si falta una, la aplicación no arranca. Así se evita aceptar cobros que luego no se podrían confirmar.

## Conectar la tienda

Panel → **Ajustes → Pagos → Mercado Pago → Conectar Mercado Pago**. El servidor valida la credencial y registra la cuenta. A partir de ese momento el checkout ofrece «Mercado Pago».

## Cada comercio con su propia cuenta (ADR-041)

Con esto, el dinero de cada tienda llega a la cuenta de Mercado Pago **del comercio**, no a la tuya.

1. En la misma aplicación de [Tus integraciones](https://www.mercadopago.com.mx/developers/panel/app):
   - **Editar → URLs de redireccionamiento**: `https://<dominio-del-panel>/api/payments/mercadopago/callback` (exacta).
   - Activar **«Authorization code flow con PKCE»**.
   - Copiar el **Client ID** y el **Client Secret** (en «Credenciales de producción» o de prueba, según el ambiente).
2. Generar la clave de cifrado en una terminal: `openssl rand -base64 32`. Guárdala solo en Vercel: si se pierde, cada comercio tendrá que volver a conectar su cuenta.
3. Agregar en Vercel:

| Variable                    | Valor                                                |
| --------------------------- | ---------------------------------------------------- |
| `MERCADOPAGO_CLIENT_ID`     | Client ID de la aplicación.                          |
| `MERCADOPAGO_CLIENT_SECRET` | Client Secret de la aplicación.                      |
| `PAYMENT_CREDENTIALS_KEY`   | La clave del paso 2 (44 caracteres, termina en `=`). |

Las tres van juntas y necesitan las dos de arriba (el webhook sigue siendo el de la aplicación).

4. Cada comercio: **Ajustes → Pagos → Conectar mi cuenta de Mercado Pago**. Entra a Mercado Pago con SU cuenta, autoriza y regresa al panel con el aviso «Listo». Una tienda que ya cobraba con tu cuenta ve el mismo botón para pasarse a la suya.

Las llaves de los comercios duran 180 días y se renuevan solas. Nunca se muestran en el panel ni se guardan sin cifrar.

## Prueba de punta a punta (pendiente)

1. Comprar en la tienda de la vista previa y elegir Mercado Pago.
2. Pagar con una [tarjeta de prueba](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards) usando el titular `APRO` (aprobado).
3. El pedido pasa a «Pagado» **solo cuando llega el webhook**. Revisar Ajustes → Actividad y el historial del pedido.
4. Repetir con el titular `OTHE` (rechazado): el pedido queda con el pago fallido y el comprador puede reintentar.
5. Reembolsar desde el pedido y confirmar el reembolso en Mercado Pago.

## Qué hace el sistema

- El total lo calcula la base; Mercado Pago cobra exactamente ese total.
- El regreso del comprador a la tienda **no** confirma el pago.
- Los intentos sin noticias se reconcilian cada 10 minutos buscando por referencia.
- Si llegan dos cobros aprobados para un mismo pedido, el pedido queda «en atención» para reembolsar el sobrante.
