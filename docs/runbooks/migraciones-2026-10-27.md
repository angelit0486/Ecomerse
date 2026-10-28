# Aplicar las migraciones del 2026-10-27 en staging

Cinco migraciones nuevas: los pasos 8, 15 y 17 del plan «panel y tienda profesionales», los planes para vender la plataforma a otros comercios (Fase 10) y Mercado Pago con la cuenta de cada comercio (ADR-041). Se aplican **en orden**, una por una, en el SQL Editor de Supabase. Cada una corre completa o no cambia nada.

| Orden | Archivo                                                      | Qué hace                                                   |
| ----- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| 1     | `supabase/migrations/20261027000100_dead_jobs_console.sql`   | Consola → Trabajos: ver y reintentar trabajos fallidos     |
| 2     | `supabase/migrations/20261027000200_import_skip_errors.sql`  | Importar solo los productos sin errores (ADR-040)          |
| 3     | `supabase/migrations/20261027000300_media_variants.sql`      | Fotos en varios tamaños (srcset) y su limpieza correcta    |
| 4     | `supabase/migrations/20261028000100_plans_subscriptions.sql` | Consola → Planes y suscripciones; «Plan y uso» en el panel |
| 5     | `supabase/migrations/20261028000200_mercadopago_oauth.sql`   | Cada comercio cobra en su propia cuenta de Mercado Pago    |

## Pasos (desde el celular o la computadora)

1. Entra a Supabase → tu proyecto de staging → **SQL Editor** → **New query**.
2. En GitHub, abre el archivo 1 de la tabla, toca **Raw**, copia todo y pégalo en la consulta.
3. Toca **Run**. Debe decir «Success. No rows returned».
4. Repite con el archivo 2, luego el 3, el 4 y al final el 5.
5. Comprueba con esta consulta (debe devolver `20261028000200`):

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

Para aplicar las migraciones no se necesita ninguna contraseña ni clave nueva.
