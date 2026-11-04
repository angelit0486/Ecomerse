# Escalabilidad (2026-11-04)

## Cómo se midió

- **Base aparte (`pruva_bench`):** todas las migraciones, más datos sintéticos.
  - Una tienda con **200 000 pedidos** en dos años.
  - **50 tiendas** más con 2 000 pedidos cada una, como ruido.
  - Total: 300 000 pedidos.
- **Como la dueña real:** rol `authenticated` con su sesión, así que la seguridad por filas (RLS) está activa; ve solo sus 200 000 pedidos. Mismo PostgreSQL 16 local que las pruebas.
- **Repetición:** cada consulta se corre dos veces y se reporta la segunda (sin arranque en frío). La máquina es un contenedor compartido; los tiempos sirven para comparar antes y después, no como cifra absoluta de producción.
- **Diagnóstico de Supabase en staging (solo lectura):**
  - Sin alertas de RLS evaluada fila por fila.
  - 54 llaves foráneas sin índice que las cubra: nivel informativo y casi todas en tablas que no se borran. Las búsquedas frecuentes ya tienen su índice por la columna que se usa (`cart_id`, `reservation_id`, `order_id`, `product_id`…).
  - Dos políticas dobles en `customers` (cliente y personal), a propósito.

## Panel: antes y después de la migración `20261104000500`

| Consulta                                                    | Antes  | Después | Causa                                                     |
| ----------------------------------------------------------- | ------ | ------- | --------------------------------------------------------- |
| Lista «por surtir» (más antiguo primero)                    | 60 ms  | 3 ms    | Recorría toda la tabla                                    |
| Lista «requieren atención»                                  | 43 ms  | 2 ms    | Igual                                                     |
| Aviso «por surtir» (conteo)                                 | 44 ms  | 7 ms    | Igual                                                     |
| Aviso «requieren atención» (conteo)                         | 39 ms  | 3 ms    | Igual                                                     |
| Inicio: indicadores de 30 días (se piden 2 veces por carga) | 220 ms | 22 ms   | Ventas y serie por día filtraban por `paid_at` sin índice |
| Inicio: indicadores de 365 días                             | 224 ms | 49 ms   | Igual                                                     |
| Buscar un pedido por número (antiguo)                       | 146 ms | 1.2 ms  | `ilike '%…%'` revisaba los 200 000                        |
| Buscar un número que no existe                              | 132 ms | 2.1 ms  | Igual                                                     |
| Lista «todos», «pagados», «cancelados»                      | ~2 ms  | ~2 ms   | Ya tenían índice                                          |

**Antes, las consultas crecían con el historial de la tienda;** con un millón de pedidos habrían sido unas cinco veces más lentas. Ahora usan índices y no dependen del tamaño del historial. La excepción es el rango de 365 días, que suma los pedidos del año.

## Qué se agregó

Solo índices, sin cambios de datos, funciones, permisos ni RLS:

- **`orders_store_status_fulfillment_idx`** `(store_id, status, fulfillment_status, placed_at, id)`.
- **`orders_store_attention_idx`** `(store_id, needs_attention, placed_at desc, id desc)`.
- **`orders_store_paid_idx`** `(store_id, paid_at) include (total) where paid_at is not null`.
- **`orders_number_trgm_idx`** `gin (store_id, display_number gin_trgm_ops)`.

Para las listas se usaron índices compuestos normales y no parciales: PostgREST manda los filtros como parámetros, y un índice parcial puede no aplicarse con ellos.

## Checkout bajo carga

En medición (banco de carga con compradores simultáneos).
