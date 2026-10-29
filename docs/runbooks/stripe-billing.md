# Cobrar la mensualidad a los comercios con Stripe Billing (ADR-044)

Estado: probado con un **Stripe simulado** (pruebas unitarias, de integración y E2E). **[NO VERIFICADO con Stripe real]** hasta que el propietario configure su cuenta.

## Qué hace

- La **dueña de la organización** entra a **Ajustes → Plan y uso → Pagar con tarjeta**, elige plan y periodo (mensual o anual) y paga en Stripe Checkout.
  - PRUVA no ve ni guarda la tarjeta.
- El precio sale de **Consola → Planes → Precios**, nunca del navegador.
- **El plan cambia solo cuando Stripe avisa por webhook firmado.** Así se traduce cada estado de Stripe:

  | Estado en Stripe | Estado en PRUVA                    |
  | ---------------- | ---------------------------------- |
  | activa           | activa                             |
  | pago vencido     | pago vencido, con 7 días de gracia |
  | sin pagar        | pausada (solo lectura)             |
  | cancelada        | cancelada                          |

- Los avisos repetidos o atrasados se ignoran. Cada cambio queda en la auditoría.
- El cobro manual de la consola sigue disponible para quien pague por transferencia.

## Pasos del propietario (desde la computadora)

1. Crea o entra a tu cuenta de **Stripe México** (dashboard.stripe.com) a nombre de PRUVA. Empieza en **modo de prueba**.
2. **Developers → API keys:** copia la **Secret key** (`sk_test_…`).
3. **Developers → Webhooks → Add endpoint:**
   - URL: `https://[TU DOMINIO]/api/webhooks/billing/stripe`
   - Eventos: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
   - Copia el **Signing secret** (`whsec_…`).
4. En **Vercel → tu proyecto → Settings → Environment Variables**, agrega:
   - `STRIPE_SECRET_KEY` = la secret key;
   - `STRIPE_BILLING_WEBHOOK_SECRET` = el signing secret.

   Después vuelve a desplegar.

5. En **Consola → Planes**, carga los precios de cada plan («Precios de …»).
6. **Prueba:** con una organización de prueba, paga con la tarjeta de prueba que publica Stripe y confirma en Plan y uso que el plan quedó «Activa». Anota aquí la fecha y el resultado.
7. Para cobrar de verdad, repite los pasos 2 a 4 en **modo live** (`sk_live_…` y su propio webhook).

## Pendientes de decisión (ADR-044)

- **Cambio de plan a mitad de periodo:** prorratear o aplicarlo al siguiente periodo. Hoy se cambia desde la consola o cancelando y volviendo a pagar.
- **Precios y días de prueba de cada plan.**
