# Tablero de ejecución — Orden 06 (endurecimiento y capacidad)

Rama `audit/hardening-capacity-2026-11` · base `532ac6ed43839721f26df34ca0dc509694aa448d` · actualizado 2026-11-11.
Estados: PENDING, IN_PROGRESS, BLOCKED, FAILED, PASSED, VERIFIED. Detalle y cifras: `EXECUTION_MASTER_LOG.md`.
Todo se midió en bases locales desechables (`pruva_cap*`); nada tocó staging ni producción.

## Tareas

| ID  | Descripción                                                       | Estado   | Prioridad | Depende de | Evidencia                                          | Commit    | Resultado                                                                                      | Siguiente acción                                 |
| --- | ----------------------------------------------------------------- | -------- | --------- | ---------- | -------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| T01 | Suite completa sobre el commit base                               | VERIFIED | P0        | —          | Bitácora §T01                                      | `2aa04c4` | Todo en verde salvo 1 de 149 E2E (prueba del logo con carrera); corregida y repetida           | —                                                |
| T02 | Generador sintético reproducible                                  | VERIFIED | P0        | —          | `scripts/capacity/generator.sql`, bitácora §T02    | `b8c9b06` | 10,000 productos en 47–69 s; misma huella en bases distintas                                   | Usarlo en los escalones B–D                      |
| T03 | Una tienda con 10,000 productos                                   | VERIFIED | P0        | T02        | `scripts/capacity/t03.sh`, bitácora §T03           | `2aa04c4` | 48 consultas medidas; 3 defectos de escala corregidos (CAP-01, CAP-02) y 2 anotados            | Repetir en cada escalón                          |
| T04 | Importar 10,000 con fallas y reintentos                           | VERIFIED | P0        | T02        | `tests/capacity/import-10k.test.ts`, bitácora §T04 | `2aa04c4` | 8 de 8 casos; sin duplicados ni productos a medias; importación 34 % más rápida (CAP-03)       | Decidir CAP-04 (tope de 5,000 filas por archivo) |
| T05 | Diez tiendas desiguales a la vez                                  | VERIFIED | P0        | T02        | `scripts/capacity/t05.sh`, bitácora §T05           | `b8c9b06` | 10,766 operaciones simultáneas, 0 fugas, 0 errores; la tienda grande no frena a las chicas     | Repetir con más conexiones en un entorno aislado |
| T06 | Matriz de aislamiento 3 tiendas × 5 roles                         | VERIFIED | P0        | T02        | `scripts/capacity/t06-*.sql`, bitácora §T06        | `b8c9b06` | 11,220 intentos cruzados: 0 fugas; matriz de privilegios por rol exacta                        | Repetir tras cada migración que toque permisos   |
| E-A | Escalón A: 1 tienda × 10,000                                      | VERIFIED | P0        | T03        | Bitácora §T03                                      | `2aa04c4` | Aprobado tras las correcciones                                                                 | Escalón B                                        |
| E-B | Escalón B: 10 tiendas × 10,000 (100,000 productos)                | VERIFIED | P1        | E-A        | Bitácora §Escalón B                                | (este)    | Nada crece 10 veces; lo más caro sube al doble (búsqueda del panel, «agotados»)                | Escalón D                                        |
| E-C | Escalón C: tiendas de 50,000 (medidas 5 de 10; 250,000 productos) | VERIFIED | P1        | E-B        | Bitácora §Escalón C                                | (este)    | Funciona sin errores; 50,000 por tienda ya es lento (CAP-12). Destapó y se corrigió CAP-11     | Decidir si se admiten tiendas de más de 10,000   |
| E-D | Escalón D: 50 tiendas × 10,000 (500,000 productos)                | VERIFIED | P1        | E-B        | Bitácora §Escalón D                                | (este)    | El comprador no nota el crecimiento; encontrado y corregido CAP-08                             | Escalón C                                        |
| E-E | Escalones E–G: 1 a 5 millones de productos                        | BLOCKED  | P2        | E-C, E-D   | Bitácora §Límites                                  | —         | Superan 500,000 productos: requieren propuesta técnica y de presupuesto y autorización expresa | Presentar propuesta tras C y D                   |

## Defectos (por causa raíz)

| ID     | Severidad | Causa raíz                                                                                                                             | Estado                | Prueba de regresión                                                         |
| ------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------- |
| CAP-01 | S1        | La búsqueda reconstruía el texto de cada producto en cada consulta (~400 ms con 10,000 productos)                                      | Corregido             | pgTAP `139_search_lexicon`                                                  |
| CAP-02 | S1        | La disponibilidad se calculaba producto por producto («solo disponibles» 3.6 s; relacionados 1.8 s)                                    | Corregido             | pgTAP `140_listing_availability`                                            |
| CAP-03 | S2        | La importación replanificaba cada sentencia: 5,000 filas tardaban 37–60 s con un límite de 55 s                                        | Corregido             | `tests/capacity/import-10k.test.ts` (alarma de 52 s por archivo)            |
| CAP-04 | S2        | Un archivo admite 5,000 filas: 10,000 productos son 2 archivos (más si hay variantes)                                                  | Abierto (decisión)    | T04 lo documenta                                                            |
| CAP-05 | S2        | El permiso por fila cuesta 16–29 µs por fila: una consulta sin filtro de tienda crece con la plataforma                                | Mitigado (guardia)    | `tests/unit/tenant-queries.test.ts`                                         |
| CAP-06 | S3        | Si la conexión se corta a media escritura, el controlador `postgres` lanza un `TypeError` suelto                                       | Abierto (observación) | —                                                                           |
| CAP-07 | S3        | El reporte de calidad del catálogo revisa producto por producto (0.7–0.8 s con 10,000)                                                 | Abierto               | Medido en T03                                                               |
| CAP-08 | S2        | La búsqueda del panel recorría las variantes de toda la plataforma (105–185 ms con 500,000 productos)                                  | Corregido             | pgTAP `141_panel_search_store_scope`                                        |
| CAP-10 | S3        | «Agotados» revisa las existencias de todos los productos de la tienda (~190 ms con 10,000)                                             | Abierto               | Medido en el escalón D                                                      |
| CAP-11 | S1        | Un candado por producto en la tabla compartida de PostgreSQL: importaciones grandes o simultáneas la agotaban («out of shared memory») | Corregido             | pgTAP `142_variant_limit_row_lock`, integración `variant-limit-concurrency` |
| CAP-12 | S2        | Listas y búsqueda leen y ordenan todos los productos de la tienda: con 50,000, de 0.35 a 1.3 s por consulta                            | Abierto (propuesta)   | Medido en el escalón C                                                      |
| CAP-09 | S3        | Ningún plan permite 10,000 productos (máximo actual: 1,000)                                                                            | Abierto (negocio)     | —                                                                           |
| T01-F1 | S3        | La prueba E2E del logo esperaba un aviso que ya puede no verse (desde D-MEJ-26)                                                        | Corregido             | `tests/e2e/logo.spec.ts`                                                    |

Sin S0 abiertos. Los tres S1 encontrados (CAP-01, CAP-02, CAP-11) están corregidos y con prueba.

## Punto de reanudación

- Último commit: el de esta documentación (el siguiente a `b8c9b06`), en `audit/hardening-capacity-2026-11` (subido).
- Última tarea terminada: T01–T06 y escalones A, B, C (parcial) y D.
- Siguiente tarea: ninguna autorizada pendiente en local. Lo que sigue (escalones E–G, pruebas extremas en entorno aislado, CAP-04, CAP-09, CAP-12) requiere decisión del propietario.
- Pruebas pendientes: pruebas extremas en un entorno aislado (no en esta máquina compartida de 4 núcleos).
- Bloqueos: escalones E–G (autorización y presupuesto); CAP-04 y CAP-09 (decisiones de producto).
- Las cuatro migraciones nuevas (`20261111000100` a `20261111000400`) NO están aplicadas en staging: requieren aprobación del propietario.
- Comandos:
  - `bash scripts/capacity/t03.sh 10000` (una tienda; `CAP_UNTIL=20261110000300` mide «antes»)
  - `bash scripts/capacity/t04.sh` (importación de 10,000)
  - `bash scripts/capacity/t05.sh 10000 20` (diez tiendas a la vez)
  - `psql -d pruva_cap -f scripts/capacity/t06-isolation.sql` y `t06-privileges.sql` (requieren tiendas 1–3 generadas)
- No hay ningún proceso corriendo en segundo plano.
