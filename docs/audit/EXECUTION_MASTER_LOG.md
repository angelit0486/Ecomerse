# Bitácora maestra — Orden 06 (endurecimiento continuo, QA extremo y capacidad)

Meta del programa: 500 tiendas × 10,000 productos = 5,000,000 de productos.
Rama `audit/hardening-capacity-2026-11`, creada desde `532ac6ed43839721f26df34ca0dc509694aa448d` (verificado: igual a `origin/mejoras/2026-11`, árbol limpio).
Tablero resumido: `EXECUTION_BOARD.md`.

Etiquetas: **[VERIFICADO]** lo medí o ejecuté yo; **[ESTIMADO]** cálculo a partir de mediciones; **[PROPUESTA]** aún no hecho.

## Entorno de las mediciones [VERIFICADO]

- Máquina de la sesión: 4 núcleos, 16 GB de RAM, 26 GB de disco libre. PostgreSQL 16.15 local (`shared_buffers` 128 MB, `work_mem` 4 MB, 100 conexiones). Node 24.
- Staging usa PostgreSQL 17.11 en el plan gratuito de Supabase: los tiempos de aquí **no** son los de staging ni los de producción; sirven para comparar «antes y después» y para encontrar crecimientos malos.
- Todo corrió en bases locales desechables (`pruva_cap`, `pruva_cap_antes`, `pruva_cap_import`, `pruva_cap_t05`). No se escribió, leyó ni cargó staging ni producción. No se desplegó nada ni se aplicó ninguna migración fuera de esta máquina.
- La evidencia del incidente (`docs/audit/incidente/`) se apartó durante las corridas y se devolvió intacta; no forma parte de ningún commit.

## T01 — Suite completa sobre el commit base [VERIFICADO]

| Etapa                          | Resultado                      | Duración |
| ------------------------------ | ------------------------------ | -------- |
| ESLint                         | sin errores                    | 32 s     |
| Prettier (revisión)            | sin diferencias                | 25 s     |
| TypeScript                     | sin errores                    | 4 s      |
| Unitarias (Vitest)             | 1,279 de 1,279 en 145 archivos | 15 s     |
| Build de Next.js               | correcto                       | 31 s     |
| Base de datos: pgTAP           | 2,935 de 2,935 en 140 archivos | 163 s\*  |
| Base de datos: integración     | 437 de 437 en 35 archivos      | (\*)     |
| E2E (Playwright, 1 trabajador) | 148 de 149; **1 falla**        | 1,150 s  |

(\*) 163 s es la etapa completa `pnpm db:test` (migraciones desde cero + pgTAP + integración).
Pruebas omitidas o en cuarentena: 0 (no hay `skip` ni `fixme` en el repositorio).

Falla (T01-F1, S3): `tests/e2e/logo.spec.ts` esperaba ver «Procesando el logo…». Desde D-MEJ-26 (commit base) la subida arranca la cola de imágenes y el logo queda listo antes de que el aviso alcance a verse. La prueba pasaba o no según la carga de la máquina. Corrección: acepta cualquiera de los dos estados (aviso o botón «Usar este logo») y el resto de la prueba sigue exigiendo el resultado final. No es un defecto del producto.

## T02 — Generador sintético [VERIFICADO]

`scripts/capacity/generator.sql` (esquema `capgen`, solo en bases locales; nunca es una migración) y `scripts/capacity/build.sh`.

- `capgen.store(índice, productos, semilla)` crea en una transacción: organización, plan de capacidad, tienda activa con dominio y tema, dueña y 4 personas con roles reales (administración, catálogo, pedidos, solo lectura), 20 marcas, 36 categorías en dos niveles, productos (85 % activos, 10 % borrador, 5 % archivados), variantes (60 % una; 40 % tres tallas con su opción), SKU únicos, precios, precio de comparación (20 %), costos (80 %), categoría principal y «Ofertas» (15 %), existencias por `app.apply_inventory_movement` (10 % agotado) y referencias de imagen sin archivo (70 %).
- `capgen.orders(índice, pedidos)` agrega clientes y pedidos pagados (para listas y aislamiento).
- Todo pasa por los triggers reales del catálogo (búsqueda, precios mínimos, validación de variantes, niveles de inventario).
- Determinismo: ids, SKU, precios y relaciones salen de un hash de `(semilla, tienda, n)`; no usa `random()`. La huella `capgen.fingerprint` de la tienda 1 con 300 productos fue `b4f7a9e22297135f8fe5cd4e798911bd` en dos bases creadas por separado, y con 10,000 productos `a8284167d89314de55544d65ab491019` antes y después de las correcciones. Otra semilla da otra huella.
- Sin datos personales: correos `@capgen.test`, nombres inventados.

Hallazgo de negocio (CAP-09): ningún plan permite 10,000 productos (el mayor, `demo_plan`, llega a 1,000). El generador crea su propio plan `capacity_plan`; para vender tiendas de 10,000 hay que definir ese plan y su precio.

## T03 — Una tienda con 10,000 productos [VERIFICADO]

`bash scripts/capacity/t03.sh 10000` · datos: 10,000 productos, 17,940 variantes, 2,000 pedidos.

- Alta de los 10,000: 47 s antes de las correcciones, 69 s después (ver «Costo de las correcciones»).
- Tamaño de la base con una tienda de 10,000: 102 MB antes, 123 MB después.
- Consultas: mediana de 5 corridas, en ms. Panel como la dueña con RLS activo; tienda con el rol `storefront_gateway`.

| Consulta                                   | Antes | Después | Nota            |
| ------------------------------------------ | ----- | ------- | --------------- |
| Tienda: «solo disponibles»                 | 3,582 | 153     | CAP-02          |
| Tienda: productos relacionados             | 1,821 | 32      | CAP-02          |
| Tienda: buscar una frase                   | 495   | 41      | CAP-01          |
| Tienda: buscar una palabra                 | 359   | 36      | CAP-01          |
| Tienda: buscar sin resultados              | 349   | 4       | CAP-01          |
| Tienda: filtros de una búsqueda            | 348   | 19      | CAP-01          |
| Tienda: sugerencias al escribir            | 331   | 26      | CAP-01          |
| Tienda: lista, categoría, marca, precio    | 9–46  | 10–55   | sin cambio      |
| Tienda: ficha de producto                  | 6     | 9       | sin cambio      |
| Tienda: mapa del sitio (8,550 direcciones) | 9     | 11      | sin cambio      |
| Panel: listas, filtros y página profunda   | 1–9   | 1–11    | sin cambio      |
| Panel: «agotados»                          | 57    | 61      | aceptable       |
| Panel: buscar (palabra, frase, SKU)        | 46–53 | 48–62   | CAP-08, S3      |
| Panel: inventario (lista, búsqueda)        | 16–45 | 19–59   | aceptable       |
| Panel: calidad del catálogo                | 702   | 839     | CAP-07, S3      |
| Panel: 100 precios en bloque (aplicar)     | 90    | 179     | costo de CAP-01 |
| Panel: detalle, estado, publicar           | 0.4–5 | 0.5–5   | sin cambio      |

Sin consultas N+1 en lo medido: cada pantalla hace un número fijo de consultas.

### CAP-01 (S1) — Búsqueda de la tienda

- Causa: `app.product_lexicon` armaba, en cada búsqueda, el texto de **cada** producto (título, marca, categorías, atributos, opciones). Medido: 586 ms de 690 ms eran eso.
- Corrección (`20261111000100_search_lexicon.sql`): el texto se guarda en `products.search_lexicon`, lo mantiene el trigger que ya mantenía `search_vector`, se agregaron los avisos que faltaban (opciones del producto; baja de marca o categoría) y un índice de trigramas por tienda. La búsqueda arma primero las coincidencias con índices.
- Mismos resultados: pgTAP `139_search_lexicon` compara, para 11 búsquedas (acentos, errores de escritura, SKU, código de barras, varias palabras), la regla anterior contra la nueva, y comprueba que el texto guardado siempre es igual al recién calculado tras cada tipo de cambio.

### CAP-02 (S1) — Disponibilidad

- Causa: `app.product_state` se llamaba una vez por producto candidato (dos veces en el listado).
- Corrección (`20261111000200_listing_availability.sql`): `app.product_states` calcula el estado de todos los candidatos en una pasada. Solo funciones; sin cambios de tablas.
- Mismos resultados: pgTAP `140_listing_availability` compara el cálculo por lote contra el anterior en los seis casos (con existencias, agotado, bajo pedido, sin control, pocas piezas, una talla sí y otra no).

### Costo de las correcciones [VERIFICADO]

Guardar el texto de búsqueda hace más cara cada escritura que toca un producto: el alta sintética de 10,000 pasó de 47 a 69 s y cambiar 100 precios en bloque de 90 a 179 ms. A cambio, cada búsqueda del comprador cuesta 10 veces menos. La importación real, con CAP-03, terminó más rápida que antes (abajo).

## T04 — Importación de 10,000 con fallas y reintentos [VERIFICADO]

`bash scripts/capacity/t04.sh` · `tests/capacity/import-10k.test.ts` · 8 de 8 casos. Usa el mismo camino que el panel: CSV → lector → plan → `imports_create` como la dueña → `imports_commit` → job `import.commit` con el rol del worker.

| Caso                                                                  | Resultado                                                                                 |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Columnas equivocadas                                                  | Sin `handle` no pasa; las desconocidas se ignoran y se avisan                             |
| Archivo de 5,001 filas                                                | Rechazado por el servidor y por la base; nada escrito                                     |
| 5,000 filas con 40 precios ilegibles, 29 sin título, 24 SKU repetidos | No se confirma tal cual; con «importar las buenas» entran 4,908; ningún producto a medias |
| Interrupción a media importación                                      | 0 productos escritos; el job vuelve a la cola; el reintento deja 5,000 exactos            |
| Confirmar dos veces                                                   | La segunda responde «ya aplicada»; no se encola otro job                                  |
| Subir el mismo archivo otra vez                                       | 5,000 filas marcadas «ya existe»; no se puede confirmar; sin duplicados                   |
| SKU que ya es de otro producto                                        | Error en esa fila; el lote abandonado no escribe nada                                     |
| Reproceso en modo «actualizar o crear»                                | 5,000 precios actualizados, 0 productos nuevos                                            |

Total final: 9,908 productos (10,000 menos los 92 con error), todos con su texto de búsqueda correcto y ninguno en otra tienda.

Tiempos por archivo de 5,000 filas:

| Paso                          | Base (532ac6e) | Con CAP-01/02 | Con CAP-03 |
| ----------------------------- | -------------- | ------------- | ---------- |
| Subir y validar               | 3.1–4.6 s      | 3.3–4.9 s     | 3.4–4.9 s  |
| Aplicar archivo 1             | 42.6 s         | 45.4 s        | 26.7 s     |
| Aplicar archivo 2             | 37.3 s         | 60.0 s        | 23.1 s     |
| Aplicar actualización         | 34.9 s         | 40.3 s        | 29.9 s     |
| Vista previa de 5,000 cambios | 0.29 s         | 0.24 s        | 0.27 s     |

### CAP-03 (S2) — Importación al límite del tiempo

- Causa: el job forzaba un plan nuevo para cada sentencia (`plan_cache_mode = force_custom_plan`); con ~50 sentencias por fila, un tercio del tiempo se iba en planificar. El worker de Vercel tiene 55 s por ejecución: 5,000 filas tardaban 37–60 s aquí, es decir, podían no terminar nunca y quedar «fallida» tras tres intentos.
- Corrección (`src/server/imports/handlers.ts`): se conserva `enable_seqscan = off` (evita el crecimiento cuadrático que motivó el ajuste original) y se deja de forzar el plan por sentencia. Medido en una base nueva y vacía (peor caso de estadísticas): 5,000 filas en 28.5 s y otras 5,000 encima en 29.5 s (lineal).
- Regresión: T04 falla si aplicar un archivo pasa de 52 s. La prueba de integración `import-5k` (lineal, todo o nada) sigue pasando.

### CAP-04 (S2, abierto) — Tope de 5,000 filas por archivo

Una fila es una variante. 10,000 productos de una variante son 2 archivos; con 3 tallas por producto, 6. Además hay un límite de 30 importaciones por hora por tienda. [PROPUESTA] Para tiendas de 10,000 productos: partir el archivo automáticamente en el servidor y encolar un job por parte (cada parte todo o nada), en lugar de subir el tope. Requiere decisión del propietario: cambia el contrato «todo o nada por archivo» (GATE0 §26.1).

### CAP-06 (S3, observación)

Al cortar la conexión del worker a media escritura (`pg_terminate_backend`), la base quedó correcta (nada escrito, job en la cola con 1 intento), pero el controlador `postgres` 3.4.9 lanzó un `TypeError` sin capturar. En Vercel eso terminaría la ejecución del worker; el job se reintentaría en la siguiente. La prueba automatizada usa cancelación de la sentencia.

## T05 — Diez tiendas desiguales a la vez [VERIFICADO]

`bash scripts/capacity/t05.sh 10000 20` · una tienda de 10,000 y nueve de 200; por tienda, una persona del panel (roles alternados) y la tienda en línea, 20 conexiones en total, 20 s por fase.

- 10,766 operaciones, 0 errores. 324 intentos negados como se esperaba (rol sin permiso para editar; catálogo de otra tienda).
- 0 fugas: ninguna persona obtuvo filas de otra tienda, ningún rol sin permiso logró editar, y todos los ids que cada tienda vio eran suyos.
- Vecino ruidoso (p95 promedio de las tiendas chicas, solas → con la grande trabajando): lista de la tienda 66 → 74 ms; búsqueda 27 → 28 ms; «solo disponibles» 77 → 86 ms; sugerencias 41 → 44 ms; editar en el panel 53 → 41 ms. La tienda grande no frena a las chicas más allá del reparto de los 4 núcleos.
- Tienda grande bajo esa carga: lista del panel 53 ms (p50); lista de la tienda 268 ms; búsqueda 189 ms; «solo disponibles» 742 ms. Con 20 conexiones sobre 4 núcleos la máquina está saturada: son cifras de estrés, no de uso normal.

### CAP-05 (S2, mitigado) — Costo del permiso por fila

Leer una tabla de tienda directamente cuesta 16 µs por fila propia y 29 µs por fila ajena (la política llama a `app.has_store_permission` por fila). Contar los 10,000 productos propios: 160 ms. Una consulta **sin** filtro de tienda revisa las filas de todas las tiendas: 345 ms con 11,800 productos en la plataforma y, [ESTIMADO] por regla de tres, más de 2 minutos con 5,000,000.

- Hoy no ocurre: revisé todas las consultas del panel; solo 6 no filtran por `store_id` y las 6 acotan por producto o variante con índice (0.02–1.7 ms).
- Guardia: `tests/unit/tenant-queries.test.ts` falla si aparece una consulta a una tabla de tienda sin `store_id` (o sin su columna indexada anotada).
- [PROPUESTA] Para los escalones de millones: políticas que resuelvan las tiendas de la persona una vez por consulta en lugar de una vez por fila. Toca RLS (contrato crítico, GATE0 §43): requiere ADR aprobado; no se hizo.

## T06 — Matriz de aislamiento [VERIFICADO]

`scripts/capacity/t06-isolation.sql` y `t06-privileges.sql` · 3 tiendas × 5 roles (dueña, administración, catálogo, pedidos, solo lectura), cada persona contra las otras dos tiendas.

| Intento                                                                                  | Casos  | Fugas |
| ---------------------------------------------------------------------------------------- | ------ | ----- |
| Leer filas ajenas en las 67 tablas con `store_id` u `organization_id` (5 esquemas)       | 2,010  | 0     |
| Modificar filas ajenas                                                                   | 2,010  | 0     |
| Borrar filas ajenas                                                                      | 2,010  | 0     |
| Altas con tienda ajena (productos, clientes, membresías, medios, Storage) y leer Storage | 270    | 0     |
| Llamar las 164 funciones públicas con ids de otra tienda                                 | 4,920  | 0     |
| **Total**                                                                                | 11,220 | **0** |

- 4 funciones validan la forma de los datos antes del permiso (`access_invite_member`, `catalog_upsert_product`, `media_create_upload`, `store_copy_structure`): con datos válidos y tienda ajena, las cuatro responden `forbidden`. No revelan nada; sin acción.
- Privilegios dentro de la propia tienda (14 acciones × 5 roles): coincide con la tabla de permisos. Ejemplos: «solo lectura» y «pedidos» no editan productos ni ven costos; «catálogo» no ajusta existencias ni invita personas; nadie escribe directo en las tablas (`permission denied`), ni la dueña; nadie puede hacerse administrador modificando su membresía.
- `anon`: 0 tablas y 0 funciones accesibles. `storefront_gateway` y `system_worker`: 0 permisos de tabla.
- Exportaciones: van por funciones públicas con `p_store_id` y quedaron cubiertas en la fila de funciones.
- Límite de la prueba: el Storage real de Supabase (URL firmadas y políticas del servicio alojado) no existe en local; aquí se probó la tabla `storage.objects` del simulador. [NO VERIFICADO] contra el servicio real.

## Escalones de capacidad

| Escalón | Tamaño                       | Productos | Estado                                                                     |
| ------- | ---------------------------- | --------- | -------------------------------------------------------------------------- |
| A       | 1 tienda × 10,000            | 10,000    | Aprobado [VERIFICADO]                                                      |
| B       | 10 tiendas × 10,000          | 100,000   | Aprobado [VERIFICADO] (ver abajo)                                          |
| C       | 5 tiendas × 50,000 (parcial) | 250,000   | Medido: funciona, pero 50,000 por tienda ya es lento (CAP-12) [VERIFICADO] |
| D       | 50 tiendas × 10,000          | 500,000   | Aprobado tras corregir CAP-08 [VERIFICADO] (ver abajo)                     |
| E       | 100 tiendas × 10,000         | 1,000,000 | Requiere propuesta técnica y de presupuesto                                |
| F       | 250 tiendas × 10,000         | 2,500,000 | Requiere propuesta técnica y de presupuesto                                |
| G       | 500 tiendas × 10,000         | 5,000,000 | Requiere propuesta técnica y de presupuesto                                |

### Escalón B — 10 tiendas × 10,000 (100,000 productos) [VERIFICADO]

Generación: 446 s (45 s por tienda, con 2,000 pedidos cada una). Base: 642 MB. Las mismas 48 consultas de T03, sobre la tienda 1 y la tienda 10 (mediana en ms; la base ya no cabe en los 128 MB de memoria de PostgreSQL local, así que parte de la diferencia es lectura de disco).

| Consulta                         | 1 tienda | Tienda 1 de 10 | Tienda 10 de 10 |
| -------------------------------- | -------- | -------------- | --------------- |
| Tienda: lista                    | 51       | 70             | 75              |
| Tienda: orden por precio         | 55       | 83             | 193             |
| Tienda: «solo disponibles»       | 153      | 187            | 268             |
| Tienda: buscar (palabra / frase) | 36 / 41  | 42 / 64        | 38 / 47         |
| Tienda: sugerencias              | 26       | 27             | 29              |
| Tienda: relacionados             | 32       | 33             | 32              |
| Tienda: portada                  | 47       | 88             | 152             |
| Panel: listas y filtros          | 1–11     | 1–12           | 1–11            |
| Panel: «agotados»                | 61       | 111            | 120             |
| Panel: «sin foto»                | 9        | 39             | 51              |
| Panel: buscar                    | 48–62    | 83–115         | 73–120          |
| Panel: inventario                | 19–59    | 20–41          | 18–51           |
| Panel: calidad del catálogo      | 839      | 909            | 869             |
| Panel: 100 precios en bloque     | 179      | 140            | 154             |

Lectura: con 10 veces más productos en la plataforma, lo que hace cada tienda cuesta entre lo mismo y el doble; nada crece 10 veces. Lo que más sube es lo que recorre todos los productos de la tienda (búsqueda del panel CAP-08, «agotados», orden por precio, portada). Ningún defecto nuevo de severidad S0–S2.

### Escalón D — 50 tiendas × 10,000 (500,000 productos) [VERIFICADO]

Generación de las 40 tiendas adicionales: 2,094 s (52 s por tienda). Base: 2,731 MB (≈54 MB por tienda de 10,000 con 2,000 pedidos). Mismas consultas sobre las tiendas 1, 25 y 50 (mediana en ms).

| Consulta                        | 1 tienda | 10 tiendas | 50 tiendas (1 / 25 / 50) |
| ------------------------------- | -------- | ---------- | ------------------------ |
| Tienda: lista                   | 51       | 70         | 68 / 78 / 73             |
| Tienda: «solo disponibles»      | 153      | 187        | 226 / 250 / 204          |
| Tienda: buscar una palabra      | 36       | 42         | 43 / 38 / 35             |
| Tienda: sugerencias             | 26       | 27         | 33 / 42 / 30             |
| Tienda: relacionados            | 32       | 33         | 38 / 42 / 30             |
| Tienda: portada                 | 47       | 88         | 77 / 82 / 65             |
| Panel: listas y filtros         | 1–11     | 1–12       | 1–13                     |
| Panel: buscar (antes de CAP-08) | 48–62    | 83–115     | 105–185                  |
| Panel: buscar (con CAP-08)      | —        | —          | 60–83                    |
| Panel: «agotados»               | 61       | 111        | 187–203                  |
| Panel: calidad del catálogo     | 839      | 909        | 902–999                  |

Lectura: lo que ve el comprador no cambia entre 100,000 y 500,000 productos. La búsqueda del panel sí crecía con el número de tiendas (CAP-08) y quedó corregida.

#### CAP-08 (S2, corregido) — La búsqueda del panel recorría toda la plataforma

- Causa (plan de ejecución): las subconsultas de `catalog_search_products` que buscan el SKU exacto no decían de qué tienda eran; PostgreSQL recorría las variantes de **todas** las tiendas, dos veces por búsqueda (35,000 páginas leídas con 500,000 productos). Lo mismo, en pequeño, con las ubicaciones de inventario. Con una sola tienda no se notaba: por eso apareció hasta este escalón.
- Corrección (`20261111000300_panel_search_store_scope.sql`, solo la función): las subconsultas llevan `store_id`. Mismos resultados (pgTAP 141, incluido el mismo SKU en dos tiendas).
- Resultado con 500,000 productos: 105–185 ms → 60–83 ms.
- De paso, el texto de búsqueda guardado se arma con orden fijo (categorías, atributos y opciones): sin eso, el mismo producto podía guardar «vainilla chocolate» o «chocolate vainilla» y una prueba fallaba de forma intermitente.
- Suites completas con esta corrección: verify (1,280 unitarias), 2,978 pgTAP, 437 de integración y 149 de 149 E2E.
- «Agotados» (187–203 ms) no era esto: revisa las existencias de los 10,000 productos de la tienda antes de ordenar. Depende del tamaño de la tienda, no de la plataforma. Queda anotado como CAP-10 (S3).

### Escalón C, primer intento — CAP-11 (S1, corregido) [VERIFICADO]

Generar una tienda de 50,000 productos en una sola transacción falló con «out of shared memory». No era un problema del generador: destapó un defecto real.

- Causa: al crear cada variante, `app.enforce_variant_limit` tomaba un candado de aviso por producto y lo conservaba hasta el final de la transacción. Esos candados viven en una tabla de PostgreSQL de tamaño fijo, **compartida por todas las conexiones** (`max_locks_per_transaction` × `max_connections`: 64 × 100 = 6,400 en local; 64 × 60 = 3,840 en el staging actual, leído de su configuración).
- Medido en local: una importación de 5,000 productos retiene 5,001 candados. Tres importaciones de 5,000 a la vez, en tiendas distintas → una falla («Fila 4114: no se pudo aplicar este producto»). Mientras la tabla está llena, cualquier otra operación de cualquier tienda puede fallar igual.
- [ESTIMADO] En staging una sola importación de 5,000 productos ya rebasa el tamaño nominal (3,840). No lo probé allí (no está autorizado).
- Corrección (`20261111000400_variant_limit_row_lock.sql`, solo la función): el mismo efecto bloqueando la fila del producto, que no ocupa la tabla compartida. Cuatro importaciones de 5,000 a la vez: las cuatro terminan; candados de aviso en uso: 0.
- Regresión: pgTAP `142_variant_limit_row_lock` (40 productos en una transacción sin candado por producto; el límite se sigue respetando) e integración `variant-limit-concurrency` (dos sesiones sobre el mismo producto: la segunda espera y, con el límite lleno, se rechaza).

### Escalón C — tiendas de 50,000 productos [VERIFICADO, parcial]

Ya con CAP-11 corregido, generar una tienda de 50,000 productos en una transacción funciona. El contenedor de la sesión se reinició a media generación: quedaron completas 5 de las 10 tiendas (250,000 productos, 1.6 GB) y medí sobre ellas, porque lo nuevo de este escalón es el tamaño **por tienda** (el tamaño total de 500,000 ya lo cubrió el escalón D). Tiendas 1 y 5, mediana en ms:

| Consulta                         | Tienda de 10,000 | Tienda de 50,000 |
| -------------------------------- | ---------------- | ---------------- |
| Tienda: lista                    | 51–78            | 345–414          |
| Tienda: orden por precio         | 55–83            | 428–697          |
| Tienda: «solo disponibles»       | 153–250          | 1,004–1,340      |
| Tienda: buscar una palabra       | 35–43            | 146–168          |
| Tienda: sugerencias              | 26–42            | 121–138          |
| Tienda: relacionados             | 30–42            | 226–358          |
| Tienda: portada                  | 47–88            | 399–686          |
| Tienda: ficha de producto        | 3–9              | 3–4              |
| Panel: lista (recientes)         | 8–12             | 110–116          |
| Panel: buscar                    | 55–83            | 474–586          |
| Panel: «agotados»                | 61–203           | 787–860          |
| Panel: inventario                | 18–59            | 62–170           |
| Panel: calidad del catálogo      | 839–999          | 2,683–2,798      |
| Panel: detalle, estado, publicar | 0.5–9            | 0.5–8            |

Sin errores ni resultados incorrectos. Lectura honesta:

- **CAP-12 (S2 para tiendas de más de ~10,000 productos, abierto).** Las listas y la búsqueda leen todos los productos de la tienda, los ordenan y luego toman la página. Con 10,000 eso cuesta decenas de milisegundos; con 50,000, de 0.35 a 1.3 s por consulta. El tiempo crece con el tamaño de la tienda (5 veces más productos → 5 a 10 veces más tiempo).
- La meta del programa (500 tiendas × 10,000) queda dentro de lo medido como cómodo. Una tienda de 50,000 **no** es cómoda hoy.
- [PROPUESTA] Para admitir tiendas de 50,000: paginar siguiendo un índice por cada orden (sin ordenar todo), y guardar la disponibilidad del producto en una columna mantenida por el inventario. Es un cambio de diseño de `storefront.list_products` y `catalog_search_products`; no lo hice porque la meta actual no lo exige y cambia funciones centrales.

### Límites locales [ESTIMADO]

- [VERIFICADO] 500,000 productos en 50 tiendas ocupan 2.7 GB y se generan en ~42 minutos.
- 5,000,000 (G): ~27 GB y ~7 horas de generación, más espacio de trabajo para índices y pruebas. **No cabe en esta máquina.** Necesita un entorno aislado con al menos 100 GB de disco y más memoria; eso es gasto de infraestructura y no está autorizado.

### Evaluación honesta de la meta de 5 millones

- [VERIFICADO] Con 10,000 productos por tienda, tras estas correcciones, todo lo que ve el comprador responde en menos de 160 ms y el panel en menos de 70 ms (salvo el reporte de calidad), en una máquina modesta.
- [VERIFICADO] El aislamiento entre tiendas se sostiene con datos de volumen y con carga simultánea.
- [NO VERIFICADO] Nada por encima de 11,800 productos en la plataforma. Los escalones B–D dirán si los índices por tienda mantienen los tiempos cuando la plataforma crece 50 veces; el diseño (todo índice empieza por `store_id`) apunta a que sí, pero no está medido.
- [VERIFICADO] Staging está en el plan gratuito de Supabase (500 MB de base): ahí no caben ni 5 tiendas de 10,000 productos. La meta de 5 millones exige un plan de pago con cómputo dedicado; el tamaño concreto se propone después de C y D.

## Qué falta decidir (propietario)

1. Aplicar en staging las migraciones `20261111000100` y `20261111000200` (no aplicadas; el arreglo de importación CAP-03 es solo código).
2. CAP-04: cómo importar más de 5,000 filas (partir automáticamente o mantener varios archivos).
3. CAP-09: plan comercial para tiendas de 10,000 productos.
4. Autorización y presupuesto para los escalones E–G.

## Registro de commits

| Commit    | Contenido                                                                           |
| --------- | ----------------------------------------------------------------------------------- |
| `b8c9b06` | Herramientas de capacidad: generador, T03, T04, T05, T06 y guardia de consultas     |
| `2aa04c4` | Correcciones CAP-01, CAP-02, CAP-03 y prueba del logo, con sus pruebas de regresión |
| (este)    | Esta bitácora, el tablero, DECISIONS y PROGRESS                                     |
