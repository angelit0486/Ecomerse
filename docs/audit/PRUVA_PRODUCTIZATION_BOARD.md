# PRUVA — Tablero de productización (Órdenes 09 y 10)

Actualizado: 2026-11-13 (Orden 10, bloque 1). Rama de trabajo: `producto/orden-10` (parte de `producto/orden-09`, `b6cd725`). Decisiones: `docs/DECISIONS.md` §37.

Estados: BACKLOG, READY, IN PROGRESS, BLOCKED, IN REVIEW, TESTING, DONE.

**Regla de este tablero:** DONE significa implementado y probado en local, con las suites completas en verde. No significa desplegado ni validado con un comercio. Esas dos columnas van aparte.

Línea base: los siete documentos `docs/audit/PRUVA_*.md` de la Orden 08. Los IDs `RM-xx`, `RSK-xx` y `F-xx` vienen de ahí. Bitácora: `PRUVA_PRODUCTIZATION_EXECUTION_LOG.md`.

**Orden 07.** No existe un archivo de la Orden 07 en el repositorio. Sus requisitos (programa de implementación comercial de tiendas) se reconstruyeron de la sección 5 de la Orden 09 y están repartidos en las fases A y B de este tablero.

## Fase A — Preparación comercial

| ID    | Descripción                                                   | Objetivo comercial                                                     | Prioridad | Responsable | Estado    | Depende de          | Archivos                                                                                 | Pruebas                                                                 | Evidencia                        | Criterio de aceptación                                                                                                       | Bloqueos                                                       |
| ----- | ------------------------------------------------------------- | ---------------------------------------------------------------------- | --------- | ----------- | --------- | ------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| PB-01 | Hoja simple con tallas, colores, sabores y presentaciones     | Que una tienda de ropa cargue su Excel sin aprender el formato técnico | P0        | Agente      | DONE      | —                   | `src/lib/imports/platforms.ts`, `paste-sheet.tsx`                                        | `platforms.test.ts` (+6), `sheet-variants.spec.ts`                      | D-PROD-02                        | Filas con el mismo producto y distinta talla o color crean un producto con sus presentaciones; sin esas columnas nada cambia | —                                                              |
| PB-02 | Hoja de inicio por giro (ropa, hogar, abarrotes, suplementos) | Que el comercio sepa qué entregar                                      | P0        | Agente      | DONE      | PB-01               | `src/lib/imports/sheet-templates.ts`, `importar/plantilla/route.ts`, `importar/page.tsx` | `sheet-templates.test.ts`, `sheet-variants.spec.ts`                     | D-PROD-03                        | Cada hoja se descarga y la tienda entiende todas sus columnas                                                                | —                                                              |
| PB-03 | Guion de implementación de 5 días con checklist de entrega    | Proceso repetible                                                      | P0        | Agente      | IN REVIEW | PB-01, PB-02, PB-05 | `docs/runbooks/implementacion-de-tienda.md`                                              | Ensayo O10-01: 4 tiendas sintéticas, de punta a punta (`tests/ensayo/`) | D-O10-05; resultados en el guion | Una tienda de cada giro queda lista siguiendo solo el guion                                                                  | Falta el primer piloto con un comercio real (horas de persona) |
| PB-04 | Inventario de brechas comerciales                             | Saber qué falta para vender                                            | P0        | Agente      | DONE      | —                   | `docs/audit/PRUVA_COMMERCIAL_READINESS.md`                                               | —                                                                       | Orden 08                         | —                                                                                                                            | —                                                              |

## Fase B — Productización

| ID    | Descripción                                                             | Objetivo comercial                            | Prioridad | Responsable | Estado            | Depende de          | Archivos                                                               | Pruebas                                                | Evidencia                                 | Criterio de aceptación                                                 | Bloqueos                                                     |
| ----- | ----------------------------------------------------------------------- | --------------------------------------------- | --------- | ----------- | ----------------- | ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| PB-05 | Medir el procesamiento de fotos (RM-10)                                 | Saber si 10,000 fotos caben en 5 días         | P0        | Agente      | DONE              | —                   | `tests/capacity/media-throughput.test.ts`, `scripts/capacity/media.sh` | 1,280 fotos procesadas, 4 de 4 casos                   | D-PROD-01                                 | Tiempo por foto y por pasada medidos                                   | Falta medir con el almacenamiento real (necesita producción) |
| PB-06 | Vista «Fotos en proceso»: avance, rechazadas con motivo, cola avanzando | Que quien implementa vea y resuelva las fotos | P0        | Agente      | DONE              | PB-05               | `importar/fotos/page.tsx`, `src/lib/media/progress.ts`                 | `progress.test.ts` (5), `photo-progress.spec.ts` (3)   | D-PROD-01                                 | Avance visible, motivo por foto rechazada, otra tienda no ve nada      | —                                                            |
| PB-07 | Revisor de archivo antes de importar (RM-12)                            | Corregir el archivo en una vuelta             | P0        | Agente      | DONE (ya existía) | —                   | `importar/[jobId]/page.tsx`                                            | `imports.spec.ts`, `paste-products.spec.ts`            | D-PROD-04                                 | Errores por columna y por fila, CSV de errores, importar solo lo bueno | —                                                            |
| PB-08 | Importar más de 5,000 filas (RM-11)                                     | 10,000 productos con tallas en una subida     | P1        | Agente      | BLOCKED           | ADR-064             | `importar/*`                                                           | —                                                      | ADR-064 redactado                         | 18,000 filas en una sola operación de la tienda                        | **Decisión del propietario: opción A o B**                   |
| PB-09 | Crear las categorías que falten al importar (RM-13)                     | Menos preparación previa                      | P1        | Agente      | BLOCKED           | ADR-065             | `app.import_resolve_base`                                              | —                                                      | ADR-065 redactado                         | Categorías nuevas creadas con vista previa                             | **Decisión del propietario: A, B o C**                       |
| PB-10 | Comprobar los enlaces de fotos antes de importar                        | Saber antes qué fotos fallarán                | P2        | Agente      | DONE              | —                   | `photo-check.ts`, `photo-check-actions.ts`, `remote-fetch.ts`          | `photo-check.test.ts` (20), `photo-link-check.spec.ts` | D-O10-04                                  | La vista previa marca los enlaces que no abren                         | —                                                            |
| PB-11 | Importar archivos de Excel (.xlsx) directamente                         | Menos pasos para el comercio                  | P2        | Agente      | BACKLOG           | —                   | —                                                                      | —                                                      | Hoy: pegar desde Excel o guardar como CSV | Subir un .xlsx sin convertirlo                                         | Dependencia nueva (regla 16): justificar                     |
| PB-12 | Asistente «Llena tu tienda»                                             | Guiar la primera carga                        | P2        | Agente      | BACKLOG           | PB-01, PB-02, PB-06 | —                                                                      | —                                                      | —                                         | —                                                                      | —                                                            |

## Fase C — Diferenciación

Cada línea lleva problema, usuario, beneficio, costo, riesgo y medida. Ninguna está en construcción.

| ID    | Idea                                                                          | Problema y usuario                              | Beneficio                      | Costo                                                             | Riesgo                                  | Cómo se mide                       | Estado                                                                                    |
| ----- | ----------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------ | ----------------------------------------------------------------- | --------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| PB-13 | Reporte de rentabilidad (ya construido, F-82)                                 | La dueña no sabe cuánto gana                    | Decide precios con datos       | 0: falta desplegarlo                                              | Bajo                                    | Tiendas que lo abren cada semana   | READY (espera despliegue)                                                                 |
| PB-14 | Alertas accionables en Inicio: sin existencias, baja rotación, sin foto       | La dueña pierde ventas sin saberlo              | Lista corta de «qué hacer hoy» | Bajo: los datos ya existen (`store_health`, calidad del catálogo) | Bajo                                    | Alertas resueltas por semana       | DONE (local, detrás de «Salud de tu tienda»; migración sin aplicar en staging) — D-O10-02 |
| PB-15 | Catálogo compartible por WhatsApp y código QR de la tienda y de cada producto | El comercio vende por WhatsApp y en mostrador   | Une el local con la tienda     | Bajo: enlaces y QR generados en el navegador, sin dependencia     | Bajo                                    | Visitas con ese origen             | DONE (local) — D-O10-03                                                                   |
| PB-16 | Asistente de catálogo: sugerir categoría y detectar fichas incompletas        | Cargar 10,000 productos a mano es lento         | Menos horas de implementación  | Medio; con IA hay costo por uso y revisión humana                 | Sugerencias malas; nunca inventar datos | Horas de implementación por tienda | BACKLOG (después del piloto)                                                              |
| PB-17 | Punto de venta e inventario compartido                                        | Dos inventarios, el del local y el de la tienda | Sin sobreventa                 | Alto                                                              | Alto                                    | —                                  | BACKLOG (no antes de 10 tiendas)                                                          |

## Fase D — Rentabilidad

| ID    | Descripción                                                     | Estado    | Evidencia                                                                                  | Bloqueos                                            |
| ----- | --------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| PB-18 | Costos reales de infraestructura y consumo por tienda           | DONE      | `docs/venta/05-modelo-comercial-y-costos.md` §1–3 (precios oficiales leídos el 2026-11-12) | Uso de Vercel por encima del crédito sin verificar  |
| PB-19 | Propuesta de planes, cuota de implementación y servicios aparte | IN REVIEW | Mismo documento §6–7                                                                       | **Propietario: valor de su hora y precios finales** |
| PB-20 | Unit economics con horas medidas                                | BLOCKED   | —                                                                                          | Necesita el piloto                                  |

## Fase E — Preparación operativa

Tablero de bloqueos de la Orden 08. Nada de esto lo puede cerrar el agente sin autorización.

| ID    | Tema                                         | Estado  | Qué falta                                       | Quién       |
| ----- | -------------------------------------------- | ------- | ----------------------------------------------- | ----------- |
| PB-21 | Respaldo de staging (RM-01)                  | BLOCKED | Correr `scripts/ops/backup-export.sh`           | Propietario |
| PB-22 | Migraciones en staging (RM-02): 6 pendientes | BLOCKED | Autorización                                    | Propietario |
| PB-23 | Desplegar el código corregido (RM-03)        | BLOCKED | Autorización, después de PB-22                  | Propietario |
| PB-24 | Cola cada minuto (RM-05)                     | BLOCKED | Vercel Pro (20 USD al mes) y `CRON_SECRET`      | Propietario |
| PB-25 | Correo real (RM-06)                          | BLOCKED | Resend y dominio con SPF, DKIM y DMARC          | Propietario |
| PB-26 | Mercado Pago real (RM-07)                    | BLOCKED | Credenciales de prueba como secreto del entorno | Propietario |
| PB-27 | Producción separada con respaldos (RM-08)    | BLOCKED | Supabase Pro (25 USD; PITR 100 USD), dominio    | Propietario |
| PB-28 | Textos legales (RM-09)                       | BLOCKED | Abogado                                         | Propietario |
| PB-29 | Monitoreo (RM-17)                            | BLOCKED | DSN de Sentry                                   | Propietario |
| PB-30 | Restauración probada en un proyecto aparte   | BLOCKED | PB-27                                           | Propietario |

## Fase F — Piloto

| ID    | Descripción                                                          | Estado  | Bloqueos                    |
| ----- | -------------------------------------------------------------------- | ------- | --------------------------- |
| PB-31 | Elegir el comercio piloto (un giro objetivo, hasta ~1,000 productos) | BLOCKED | Propietario; fase E cerrada |
| PB-32 | Implementarlo con el guion y medir                                   | BLOCKED | PB-31                       |

## Fase G — Repetibilidad

| ID    | Descripción                                                                                | Estado | Bloqueos              |
| ----- | ------------------------------------------------------------------------------------------ | ------ | --------------------- |
| PB-33 | Medir horas, errores de importación, fotos y soporte por tienda (lista al final del guion) | READY  | Empieza con el piloto |

## Métricas

| Métrica                                         | Hoy                                    | Fuente     |
| ----------------------------------------------- | -------------------------------------- | ---------- |
| Tiempo de importación de 5,000 filas            | 23–30 s (local)                        | T04        |
| Tiempo por foto                                 | 0.25 s catálogo, 1.0 s celular (local) | PB-05      |
| Fugas entre tiendas                             | 0 de 11,220 intentos                   | T06        |
| Tiempo de inicio a entrega                      | Sin datos                              | Piloto     |
| Importaciones exitosas, errores por importación | Sin datos reales                       | Piloto     |
| Pedidos, conversión, incidencias por tienda     | Sin datos                              | Producción |
| Costo de infraestructura por tienda             | 86 MXN con 50 tiendas [ESTIMADO]       | PB-18      |

## Orden 10, bloque 1 — nuevos

| ID    | Descripción                                                              | Estado              | Evidencia                                     | Siguiente paso                                  |
| ----- | ------------------------------------------------------------------------ | ------------------- | --------------------------------------------- | ----------------------------------------------- |
| PB-34 | Paquete de despliegue de las 6 migraciones pendientes                    | DONE (preparado)    | D-O10-01, `despliegue-migraciones-2026-11.md` | **Autorización del propietario para aplicarlo** |
| PB-35 | Error: la tarifa de envío del panel quedaba inactiva                     | DONE (local)        | D-O10-06, `65ee7a0`, `shipping-rates.spec.ts` | Desplegar (staging lo conserva)                 |
| PB-36 | Columna «Publicado» en las hojas por giro (quita publicar de 100 en 100) | BACKLOG (propuesta) | D-O10-07, ensayo O10-01                       | Decisión del propietario                        |
| PB-37 | Completar las categorías de las plantillas de giro                       | BACKLOG (propuesta) | D-O10-07, ensayo O10-01                       | Decisión del propietario (o resolver ADR-065)   |
