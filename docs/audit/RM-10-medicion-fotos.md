# RM-10 — Medir el procesamiento de 1,000 y 10,000 fotos

> Protocolo de mejora continua (2026-11-28). Este documento fija los **criterios de
> aceptación antes de tocar código**. Los resultados se agregan al final, con la misma
> base (`9fd3e34`) y la misma máquina que la línea base
> (`docs/audit/LINEA_BASE_2026-11-28.md`).

## Qué ya existía y qué faltaba

- D-PROD-01 / PB-05 (Orden 09) midió **1,280 fotos en tandas de 60 a 400** y **extrapoló**
  a 10,000 (`tests/capacity/media-throughput.test.ts`). Re-ejecutado hoy: 187 ms por foto
  de catálogo con 1 pasada; 46 ms con 4.
- Faltaba lo que pide el roadmap: correr **1,000 y 10,000 fotos de verdad** por la cola,
  en pasadas con los límites de producción (45 s, un trabajo por reclamo), contar las
  pasadas necesarias y calcular **la frecuencia de cola** para la entrega en 5 días.
  Tampoco se había estimado el efecto de la red hacia Storage.

## Alcance

- Solo pruebas de capacidad y documentación: **ningún cambio en código de producción,
  migraciones, pagos, checkout ni inventario**.
- Solo contra PostgreSQL local desechable (`pruva_cap_*`). El script se niega a correr
  contra otro host.
- No cambia el cron (`vercel.json` sigue diario). Cambiarlo es decisión del propietario
  (plan de Vercel y costo).

## Criterios de aceptación

| #   | Criterio                                                                                                                                                                                           | Cómo se comprueba                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| A1  | 1,000 fotos de catálogo (JPEG 1200 px) procesadas por el `media.process` real, la cola real en PostgreSQL y el rol `system_worker`, en **pasadas sucesivas de 45 s** con 1 pasada y con 4 a la vez | Prueba nueva `tests/capacity/media-volume.test.ts`        |
| A2  | **10,000 fotos** con el mismo camino, con 1 pasada a la vez (lo que hace hoy cada llamada del cron) y con 4                                                                                        | Misma prueba, caso 10,000                                 |
| A3  | Por caso: ms por foto, fotos por pasada de 45 s (medidas, no calculadas), número de pasadas y tiempo total                                                                                         | Tabla impresa por la prueba y copiada aquí                |
| A4  | Sensibilidad a la red de Storage: 1,000 fotos con **50 ms simulados por operación** de Storage                                                                                                     | Caso con latencia; se etiqueta como **simulado**          |
| A5  | Integridad: todas `ready`, 0 `pending`/`processing`/`failed`, 0 trabajos muertos o pendientes, ninguna foto de otra tienda tocada, cada foto procesada **una sola vez**                            | Aserciones en la prueba                                   |
| A6  | Memoria: pico de RSS del proceso durante 10,000 fotos                                                                                                                                              | Medido con `process.memoryUsage()`                        |
| A7  | Tabla de frecuencia de cola: tiempo para dejar listas 10,000 fotos con cron cada 1, 5 y 15 min y diario, a partir de las fotos por pasada **medidas**                                              | Sección de resultados                                     |
| A8  | Sin regresión frente a la línea base: lint, formato, tipos, unitarias (≥ 1,796), build, `db:test` (≥ 3,330 pgTAP, ≥ 468 integración) y CI                                                          | Re-ejecución local y CI de la rama                        |
| A9  | La prueba nueva **no entra** en las suites normales (proyecto `capacity`, solo con su script)                                                                                                      | `vitest.config.mts` sin cambios; `pnpm test` cuenta igual |

## Límites conocidos (se dicen, no se esconden)

- El almacenamiento es en memoria: la latencia de A4 es una simulación, no Supabase
  Storage real (medirlo exige el entorno alojado).
- No incluye el arranque en frío de cada función de Vercel ni el tope de concurrencia
  del plan.
