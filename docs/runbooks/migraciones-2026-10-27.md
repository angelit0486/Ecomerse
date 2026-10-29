# Aplicar las migraciones del 2026-10-27 en staging

Catorce migraciones nuevas: los pasos 8, 15 y 17 del plan «panel y tienda profesionales», los planes para vender la plataforma a otros comercios (Fase 10), Mercado Pago con la cuenta de cada comercio (ADR-041), la dirección de envío en el correo de confirmación la salud de la plataforma con alertas un ajuste de seguridad en las fotos, el aviso de contracargos (ADR-043) el resumen de cambios al importar las métricas de la consola los precios de los planes el cobro con Stripe (ADR-044) y la anonimización de tiendas cerradas (ADR-046). Se aplican **en orden**, una por una, en el SQL Editor de Supabase. Cada una corre completa o no cambia nada.

| Orden | Archivo                                                              | Qué hace                                                                      |
| ----- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1     | `supabase/migrations/20261027000100_dead_jobs_console.sql`           | Consola → Trabajos: ver y reintentar trabajos fallidos                        |
| 2     | `supabase/migrations/20261027000200_import_skip_errors.sql`          | Importar solo los productos sin errores (ADR-040)                             |
| 3     | `supabase/migrations/20261027000300_media_variants.sql`              | Fotos en varios tamaños (srcset) y su limpieza correcta                       |
| 4     | `supabase/migrations/20261028000100_plans_subscriptions.sql`         | Consola → Planes y suscripciones; «Plan y uso» en el panel                    |
| 5     | `supabase/migrations/20261028000200_mercadopago_oauth.sql`           | Cada comercio cobra en su propia cuenta de Mercado Pago                       |
| 6     | `supabase/migrations/20261028000300_order_email_address.sql`         | El correo de confirmación lleva la dirección de envío                         |
| 7     | `supabase/migrations/20261028000400_platform_health.sql`             | Consola → Salud y alertas por correo cada 15 minutos                          |
| 8     | `supabase/migrations/20261028000500_lock_media_permission_first.sql` | Fotos: sin acceso a la tienda no se puede saber si una foto existe            |
| 9     | `supabase/migrations/20261029000100_external_reversals.sql`          | Contracargos y reembolsos hechos en Mercado Pago: pedido en atención y aviso  |
| 10    | `supabase/migrations/20261029000200_import_preview_changes.sql`      | Importar: la vista previa dice qué precios y existencias cambian              |
| 11    | `supabase/migrations/20261029000300_platform_metrics.sql`            | Consola → Métricas: organizaciones, suscripciones, tiendas y ventas           |
| 12    | `supabase/migrations/20261029000400_plan_pricing.sql`                | Precios de los planes y MRR en Métricas (ADR-044)                             |
| 13    | `supabase/migrations/20261029000500_stripe_billing.sql`              | Cobro de la mensualidad con Stripe Billing (ADR-044)                          |
| 14    | `supabase/migrations/20261029000600_store_anonymization.sql`         | Anonimiza datos de compradores 30 días después de cerrar una tienda (ADR-046) |

## Pasos (desde el celular o la computadora)

1. Entra a Supabase → tu proyecto de staging → **SQL Editor** → **New query**.
2. En GitHub, abre el archivo 1 de la tabla, toca **Raw**, copia todo y pégalo en la consulta.
3. Toca **Run**. Debe decir «Success. No rows returned».
4. Repite con el archivo 2, luego el 3, el 4, el 5, el 6, el 7, el 8, el 9, el 10, el 11, el 12, el 13 y al final el 14.
5. Comprueba con esta consulta (debe devolver `20261029000600`):

   ```sql
   select public.app_schema_version();
   ```

## Qué pasa antes y después

- **Antes de aplicarlas**, el panel muestra el aviso de que faltan migraciones. Mientras tanto:
  - la tienda sigue igual, sin `srcset`;
  - las fotos se siguen publicando;
  - importar con errores sigue bloqueado, como antes;
  - Consola → Trabajos, Planes y la ficha de cada organización no cargan;
  - «Plan y uso» del panel dice que está por llegar.
- **Después de aplicarlas**, el mantenimiento genera las copias de las fotos que ya existen, en tandas. Cuando termina con una tienda, esa tienda activa `srcset` sola. No hay que hacer nada más.
- Si algo falla al aplicar una migración, no se cambia nada. Copia el mensaje de error y compártelo.

- **La migración 4 no cambia el acceso de nadie**: tus organizaciones de staging tienen la suscripción activa sin fecha de fin, y sin fecha no avanza sola. Después, en Consola → Planes, crea tus planes reales.

- **La migración 5 tampoco cambia nada por sí sola**: tu tienda sigue cobrando con tu cuenta. La conexión por comercio se enciende cuando agregues en Vercel las tres variables de `docs/runbooks/mercadopago.md`.

- **La migración 7 solo lee**: revisa la cola, los pagos y los correos y avisa a dueño y administración de la plataforma. Los avisos salen cuando Resend esté configurado (`docs/runbooks/salud-y-alertas.md`).

Para aplicar las migraciones no se necesita ninguna contraseña ni clave nueva.
