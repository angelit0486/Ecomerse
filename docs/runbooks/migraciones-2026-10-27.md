# Aplicar las migraciones del 2026-10-27 en staging

Tres migraciones nuevas, para los pasos 8, 15 y 17 del plan «panel y tienda profesionales». Se aplican **en orden**, una por una, en el SQL Editor de Supabase. Cada una corre completa o no cambia nada.

| Orden | Archivo                                                     | Qué hace                                                |
| ----- | ----------------------------------------------------------- | ------------------------------------------------------- |
| 1     | `supabase/migrations/20261027000100_dead_jobs_console.sql`  | Consola → Trabajos: ver y reintentar trabajos fallidos  |
| 2     | `supabase/migrations/20261027000200_import_skip_errors.sql` | Importar solo los productos sin errores (ADR-040)       |
| 3     | `supabase/migrations/20261027000300_media_variants.sql`     | Fotos en varios tamaños (srcset) y su limpieza correcta |

## Pasos (desde el celular o la computadora)

1. Entra a Supabase → tu proyecto de staging → **SQL Editor** → **New query**.
2. En GitHub, abre el archivo 1 de la tabla, toca **Raw**, copia todo y pégalo en la consulta.
3. Toca **Run**. Debe decir «Success. No rows returned».
4. Repite con el archivo 2 y luego con el 3.
5. Comprueba con esta consulta (debe devolver `20261027000300`):

   ```sql
   select public.app_schema_version();
   ```

## Qué pasa antes y después

- **Antes de aplicarlas**, el panel muestra el aviso de que faltan migraciones. Mientras tanto:
  - la tienda sigue igual, sin `srcset`;
  - las fotos se siguen publicando;
  - importar con errores sigue bloqueado, como antes;
  - Consola → Trabajos no carga.
- **Después de aplicarlas**, el mantenimiento genera las copias de las fotos que ya existen, en tandas. Cuando termina con una tienda, esa tienda activa `srcset` sola. No hay que hacer nada más.
- Si algo falla al aplicar una migración, no se cambia nada. Copia el mensaje de error y compártelo.

No se necesita ninguna contraseña ni clave nueva.
