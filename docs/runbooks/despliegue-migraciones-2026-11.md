# Paquete de despliegue: 10 migraciones pendientes en staging (Orden 10, O10-05; actualizado en el mensaje 4)

> **Actualización (2026-11-13, Orden 10, mensaje 4, corrección D7): son 10 migraciones.**
>
> - Las 5 de la tabla 2.
> - La 6.ª, `20261112000100_store_alerts.sql` (anexo A).
> - Las 4 de `20261113`: fotos con límites persistentes, categorías al importar (ADR-065), publicación por candidatos e importación por partes (ADR-064). Están en el anexo B.
>
> Se aplican en ese orden. El ensayo local cubre las 10.
>
> **Estado: PREPARADO, NO APLICADO.** Nada de esto se ha ejecutado en staging ni en producción. Aplicarlo requiere la autorización expresa del propietario (Orden 10 lo prohíbe en este bloque).
>
> Ensayo local reproducible: `bash scripts/ops/migration-rehearsal.sh` (38 s). Último resultado: 2026-11-13, rama `producto/orden-10` (`07ba916`), las 10 en verde (sección 7).

## 1. Situación [staging VERIFICADO el 2026-11-12, solo lectura; repositorio al 2026-11-13]

|                             | Staging                                   | Repositorio         |
| --------------------------- | ----------------------------------------- | ------------------- |
| Versión del esquema         | `20261110000200`                          | `20261113000400`    |
| Migraciones                 | 162                                       | 172                 |
| Código desplegado en Vercel | `88edc6d`                                 | `producto/orden-10` |
| Datos                       | 3 tiendas, 91 productos, 0 pedidos, 38 MB | —                   |

## 2. Manifiesto (orden obligatorio)

| #   | Archivo                                       | sha256                                                             | Bytes  | Qué hace                                                                                                                                                                                   | Depende de               |
| --- | --------------------------------------------- | ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| 1   | `20261110000300_profit_report.sql`            | `479c7189eda58af932bf3862fab2995aeaff759b8a624fadf327c353138c3076` | 10,731 | Tabla `order_item_costs` (solo altas, RLS forzado), trigger que guarda el costo al vender, función `public.profit_report`, interruptor `profit_report` apagado                             | `20261110000200`         |
| 2   | `20261111000100_search_lexicon.sql`           | `a7f1944df033d4b3d13748ce8eeeb32c4b9a8ffd8fda4f2ccd4293ddb8298fcc` | 14,989 | Columna `products.search_lexicon`, rellenado de los productos existentes, índice de trigramas, búsqueda y sugerencias con índice, avisos al cambiar opciones, marcas y categorías (CAP-01) | 1 (versión)              |
| 3   | `20261111000200_listing_availability.sql`     | `07c70986eea1420348d87af089f3d4a77ab081a32a8322428c174345a24ba13d` | 12,193 | `app.product_states` (disponibilidad en lote); `storefront.list_products` y `storefront.related_products` la usan (CAP-02)                                                                 | 2                        |
| 4   | `20261111000300_panel_search_store_scope.sql` | `541a7f095da3b4cc2fe8896d4ea1c0e709ceba23ef50f1e70506ca11d6defcc8` | 10,154 | Búsqueda del panel acotada a la tienda (CAP-08); el texto de búsqueda con orden fijo y recalculado donde difiera                                                                           | 2 (usa `search_lexicon`) |
| 5   | `20261111000400_variant_limit_row_lock.sql`   | `589873e8dde7de00846bd0709a221de5e2e012a0b735759ba2d712ebddd2ae19` | 3,042  | El límite de variantes bloquea la fila del producto en lugar de un candado de aviso por producto (CAP-11)                                                                                  | —                        |

Las sumas se obtienen con `sha256sum supabase/migrations/<archivo>`. El ensayo las comprueba antes de ejecutar cada archivo y se niega si alguna cambió.

## 3. Orden con el código: migrar primero, desplegar después

- El código decide si la base le sirve con `current >= EXPECTED_SCHEMA_VERSION` (`src/server/db/schema-version.ts`, `src/server/storefront/schema.ts`).
- El código desplegado (`88edc6d`) espera `20261110000200`. Con la base en `20261111000400` sigue funcionando: las 5 migraciones solo agregan una columna, una tabla, funciones nuevas y reemplazan funciones **con la misma firma**.
- El código nuevo espera `20261113000400`. Si se despliega antes de migrar, el panel y la tienda muestran **«mantenimiento»** hasta que se apliquen.
- **Con las 10, la ventana entre migrar y desplegar importa.**
  - El código desplegado no conoce el trabajo `catalog.publish_run` (migración 9). Una importación con «Publicado: sí» hecha en esa ventana deja sus productos en borrador.
  - La corrida se retoma sola hasta 3 veces, cada 15 min (migración 10). Si aún no está el código nuevo, termina fallida con el motivo.
  - Por eso: migrar y desplegar en la **misma ventana**, sin importaciones de por medio.

Por eso: **1) migraciones, 2) despliegue.** Entre uno y otro, staging funciona con el código anterior.

## 4. Verificación previa (antes de aplicar)

Todas son de solo lectura. Si una no da lo esperado, **no se aplica nada**.

| Comprobación                | Consulta                                                                                                                                                                 | Esperado                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Respaldo reciente           | Correr `scripts/ops/backup-export.sh` (runbook `respaldos.md`) y `restore-check.sh` en local                                                                             | Restauración sin diferencias          |
| Versión actual              | `select public.app_schema_version();`                                                                                                                                    | `20261110000200`                      |
| Ninguna de las 10 aplicada  | `select version from supabase_migrations.schema_migrations where version >= '20261110000300';`                                                                           | 0 filas                               |
| Cola sin trabajos corriendo | `select count(*) from system.jobs where status = 'running';`                                                                                                             | 0                                     |
| Sin importaciones en curso  | `select count(*) from public.import_jobs where status = 'committing';`                                                                                                   | 0                                     |
| Sumas del commit a usar     | `net.http_get` de cada archivo en `raw.githubusercontent.com/angelit0486/Ecomerse/<commit>/supabase/migrations/…` y `encode(sha256(convert_to(content, 'UTF8')), 'hex')` | Las 10 sumas (tabla 2 y anexos A y B) |

## 5. Procedimiento de aplicación

Es el mismo método ya usado en staging (`docs/runbooks/database-roles.md` §7), sin contraseña de la base:

1. Descargar los 10 archivos con `net.http_get` desde el **commit fijo** y comparar sus sumas con la tabla 2. Solo funciona mientras el repositorio sea público (riesgo R-08). Si se hace privado, hay que usar `MIGRATION_DATABASE_URL` y `scripts/deploy/migrate.mjs`.
2. Un solo bloque `do`, archivo por archivo **en orden**:
   - comprobar que no esté registrado;
   - comprobar que la suma coincide;
   - ejecutarlo;
   - registrarlo en `supabase_migrations.schema_migrations` con su versión, nombre y suma.

   Si uno falla, no queda aplicado ninguno: es una sola transacción.

3. `notify pgrst, 'reload schema';`
4. Verificación posterior (sección 6).
5. Solo entonces: desplegar `producto/orden-10` en la rama de Vercel (otra autorización, aparte), sin reescribir historia.

**Tiempo y bloqueos.** Medido en local con 2,000 productos: 2.1 s en total para las 10 (las 4 de `20261113`, de 56 a 74 ms cada una); con las 5 primeras, 1.9 s. La migración 2 tardó 1.1 s y la 4, 0.66 s. En staging (91 productos) será menos. La 2 agrega una columna y crea un índice **sin** `concurrently`: bloquea las escrituras en `products` mientras corre, un instante con 91 productos. En una base con cientos de miles de productos habría que programarla fuera de horario.

## 6. Verificación posterior

Son las mismas consultas que corre el ensayo (`scripts/ops/migration-rehearsal.sh`, paso 4).

| Comprobación                     | Consulta                                                                                                                                                                            | Esperado                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Versión                          | `select public.app_schema_version();`                                                                                                                                               | `20261113000400`         |
| 1: RLS forzado en la tabla nueva | `select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.order_item_costs'::regclass;`                                                                      | `t`                      |
| 1: interruptor apagado           | `select default_enabled from public.feature_flags where key = 'profit_report';`                                                                                                     | `f`                      |
| 1: trigger                       | `select count(*) from pg_trigger where tgname = 'order_items_snapshot_cost';`                                                                                                       | 1                        |
| 2: texto de búsqueda al día      | `select count(*) from public.products p where p.search_lexicon is distinct from app.product_lexicon_of(p);`                                                                         | 0                        |
| 2: índice                        | `select count(*) from pg_indexes where indexname = 'products_lexicon_trgm_idx';`                                                                                                    | 1                        |
| 3: función interna no expuesta   | `select has_function_privilege('authenticated', 'app.product_states(uuid, uuid[])', 'execute');`                                                                                    | `f`                      |
| 4: búsqueda acotada              | `select prosrc ~ 'where pv\.product_id = p\.id' from pg_proc where oid = 'public.catalog_search_products(uuid,text,text,uuid,boolean,jsonb,integer,uuid,text,text)'::regprocedure;` | `f`                      |
| 5: sin candado por producto      | `select prosrc ~ 'pg_advisory_xact_lock' from pg_proc where oid = 'app.enforce_variant_limit'::regproc;`                                                                            | `f`                      |
| RLS en todo `public`             | Ver el ensayo                                                                                                                                                                       | 0 tablas sin RLS forzado |
| `anon` sin permisos              | Ver el ensayo                                                                                                                                                                       | 0                        |
| Asesores de Supabase             | `get_advisors` (seguridad y rendimiento)                                                                                                                                            | Sin nivel ERROR nuevo    |
| Salud                            | `/api/health` y consola → Salud                                                                                                                                                     | «ok»                     |
| Prueba funcional                 | En `pruva-tienda-demo2`: buscar un producto, filtrar «solo disponibles», abrir uno con relacionados                                                                                 | Resultados correctos     |

## 7. Ensayo local (evidencia)

`bash scripts/ops/migration-rehearsal.sh`, 2026-11-13, PostgreSQL 16 local, rama `producto/orden-10` (`07ba916`), 38 s:

1. Base con las 162 migraciones de staging y una tienda sintética de 2,000 productos y 400 pedidos.
2. Ninguna de las 10 aplicada; 0 candados de aviso retenidos.
3. Las 10 aplicadas en orden con su sha256, en milisegundos:

   | 1   | 2     | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  |
   | --- | ----- | --- | --- | --- | --- | --- | --- | --- | --- |
   | 53  | 1,007 | 64  | 620 | 39  | 48  | 56  | 56  | 74  | 62  |

4. 27 de 27 verificaciones posteriores correctas. Incluyen las 14 nuevas para 7 a 10: RLS forzado, funciones internas no expuestas, una importación viva por parte, partes que no se aplican sueltas, lote detenido por una parte atascada, publicación que se retoma, importaciones existentes intactas.
5. `pg_dump -s` de la base actualizada **idéntico** al de una base creada desde cero (24,084 líneas); permisos de funciones idénticos.
6. Un archivo alterado se rechaza por su suma.
7. pgTAP sobre la base actualizada: 307 de 307 (14 archivos: metatests de seguridad e índices, y las pruebas de las 10 migraciones).

Ensayo anterior (2026-11-12, 6 migraciones): 22,860 líneas idénticas y 109 de 109 pgTAP.

**No cubre** (no se puede reproducir en local):

- la descarga por `net.http_get`;
- la tabla `supabase_migrations` real;
- PostgreSQL 17 de staging;
- el comportamiento del pooler de Supabase.

## 8. Riesgos

| Riesgo                                            | Probabilidad          | Impacto                                            | Mitigación                                                                                   |
| ------------------------------------------------- | --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Desplegar el código antes de migrar               | Media                 | Panel y tienda en «mantenimiento»                  | Seguir la sección 3; volver a desplegar `88edc6d` si pasa                                    |
| El índice de la migración 2 bloquea escrituras    | Baja con 91 productos | Escrituras en `products` esperan unos milisegundos | Aplicar sin importaciones en curso (sección 4)                                               |
| Diferencias PostgreSQL 16 (ensayo) y 17 (staging) | Baja                  | Error al aplicar                                   | Al ser una sola transacción, no queda nada a medias                                          |
| Repositorio privado antes de aplicar              | —                     | `net.http_get` ya no descarga los archivos         | Configurar `MIGRATION_DATABASE_URL` o subir los archivos por otro canal con las mismas sumas |
| Texto de búsqueda distinto tras cambios futuros   | Baja                  | Resultados de búsqueda viejos                      | Verificación posterior «texto al día»; 0 diferencias en el ensayo                            |

## 9. Recuperación

Las migraciones son **solo hacia adelante** (regla 17). No hay una reversa automática y no se promete. Si algo sale mal **después** de aplicarlas:

| #   | Si falla…                         | Recuperación                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | **Durante** la aplicación         | Nada que hacer: la transacción se revierte sola y la base queda en `20261110000200`                                                                                                                                                                                                                           |
| 1   | El reporte de rentabilidad        | `update public.feature_flags set kill_switch = true where key = 'profit_report';` lo oculta. Si el trigger de costo diera problemas, una migración nueva lo quita (`drop trigger order_items_snapshot_cost`). **No borrar** `order_item_costs` si ya tiene filas: es historia de pedidos (regla 9)            |
| 2   | La búsqueda o las sugerencias     | Corrección hacia adelante: una migración nueva vuelve a crear `app.listing_products` y `storefront.search_suggestions` con su definición anterior (`20261018003300_preview_drafts.sql` y `20261018000500_search_fuzzy.sql`). La columna y el índice pueden quedarse sin uso: son datos derivados, sin pérdida |
| 3   | «Solo disponibles» o relacionados | Una migración nueva vuelve a crear `storefront.list_products` y `storefront.related_products` con su definición de `20261018003300_preview_drafts.sql`                                                                                                                                                        |
| 4   | La búsqueda del panel             | Una migración nueva vuelve a crear `public.catalog_search_products` con su definición de `20261018002600_duplicate_and_low_stock.sql`                                                                                                                                                                         |
| 5   | El límite de variantes            | Una migración nueva vuelve a crear `app.enforce_variant_limit` con su definición de `20261009000100_catalog_tables.sql`. Vuelve el riesgo CAP-11                                                                                                                                                              |
| —   | Daño mayor                        | Restaurar el respaldo de la sección 4 (`docs/runbooks/respaldos.md`). Se pierde lo escrito después del respaldo                                                                                                                                                                                               |

Cada corrección hacia adelante se escribe y se prueba igual que cualquier migración: pgTAP, ensayo local y autorización.

## 10. Autorizaciones que hacen falta

1. Correr el respaldo (sección 4).
2. Aplicar las 10 migraciones en staging (sección 5).
3. Desplegar el código (sección 5, paso 5) en la misma ventana (sección 3), aunque se autorice aparte.
4. Después, corregir en staging las tarifas inactivas de la tienda `demo` (hallazgo D1): volver a guardarlas desde el panel ya desplegado.

## Anexo A. 6.ª migración: alertas de Inicio (agregada el 2026-11-13)

| #   | Archivo                           | sha256                                                             | Bytes  | Qué hace                                                                                                                                                                                                                            | Depende de |
| --- | --------------------------------- | ------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 6   | `20261112000100_store_alerts.sql` | `87eef6f0cc9a7112c3e028e1df55e15fd3c615028bee5f14281a375f063a373a` | 11,270 | Función `public.store_alerts` (conteos de Inicio; `security definer`, `search_path = ''`, solo `authenticated` con `products.read`) y filtro «Sin categoría» en `catalog_search_products` (misma firma). Versión → `20261112000100` | 4 y 5      |

- **Con el código:** el código de `producto/orden-10` espera `20261112000100`; migrar primero, desplegar después (sección 3). El código desplegado hoy sigue funcionando con la base en esa versión: solo se agrega una función y se reemplaza otra con la misma firma.
- **Verificación posterior:** `select public.app_schema_version()` → `20261112000100`; `select has_function_privilege('anon', 'public.store_alerts(uuid)', 'execute')` → `f`.
- **Riesgo:** bajo; no toca tablas ni datos. Las alertas solo se ven en tiendas con «Salud de tu tienda» encendida (apagado por defecto).
- **Recuperación:** volver a crear `catalog_search_products` como en `20261111000300_panel_search_store_scope.sql` y `drop function public.store_alerts(uuid)` en una migración correctiva. No hay datos que perder.
- **Ensayo (2026-11-13, local):** las 6 en orden sobre 2,000 productos y 400 pedidos; la 6.ª en 41 ms; esquema idéntico al de una base desde cero (22,860 líneas); 109 de 109 pruebas pgTAP (`bash scripts/ops/migration-rehearsal.sh`).

## Anexo B. 7.ª a 10.ª migración (Orden 10, mensaje 4, agregadas el 2026-11-13)

| #   | Archivo                                           | sha256                                                             | Bytes  | Qué hace                                                                                                                                                                                                                                                                               | Depende de |
| --- | ------------------------------------------------- | ------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 7   | `20261113000100_photo_checks_and_alerts_flag.sql` | `f3b4b5d2e6a452609afc1bea7bae3017996aa5b95addf5afa2b1c486b48be9d8` | 15,716 | Tabla `import_photo_checks` (RLS forzado) y `imports_photo_check_begin`/`finish`: límites persistentes de «Revisar los enlaces» (D3). `system.purge_retention` envuelve a la anterior para borrar revisiones vencidas. `store_alerts` exige el interruptor `store_health` (D6)         | 6          |
| 8   | `20261113000200_import_new_categories.sql`        | `31b44ed75cea0d1bfba1a998e201d0967e5d79aacdde9a019e84dd1b9d4f9579` | 30,690 | ADR-065 A: `import_jobs.new_categories`, vista previa y aceptación de categorías nuevas, creación dentro de `system.import_commit` (misma firma)                                                                                                                                       | 7          |
| 9   | `20261113000300_publish_runs.sql`                 | `8c8fc176daf8ff7e3685847a23dc44d0e8a32affb51ed3723defe5c3901022de` | 14,689 | Publicación por candidatos: `publish_runs`, `publish_run_items` (RLS forzado), trabajo `catalog.publish_run`, `system.publish_run_step`                                                                                                                                                | 8          |
| 10  | `20261113000400_import_batches.sql`               | `3f0eb416a75d8ca5d0c70c153ff868c38cd6bdae950838212b3c713303fe55a5` | 37,807 | ADR-064 A: `import_batches` (RLS forzado), partes en `import_jobs`, funciones del lote, `imports_commit` e `imports_accept_categories` rechazan partes sueltas, `fail_stuck_imports` detiene el lote de una parte atascada y retoma publicaciones sin trabajo (`publish_runs.resumes`) | 9          |

- **Con el código.**
  - Las 4 solo agregan tablas, columnas y funciones, o reemplazan funciones con la misma firma.
  - El código desplegado sigue funcionando con la base en `20261113000400`, con una excepción: la publicación por candidatos (sección 3). Hay que migrar y desplegar en la misma ventana.
  - Las importaciones existentes no cambian: ninguna queda en un lote.
- **Verificación posterior:** las 14 comprobaciones del ensayo para 7 a 10 (`scripts/ops/migration-rehearsal.sh`, paso 4). Entre ellas:
  - RLS forzado en las 4 tablas nuevas;
  - funciones internas no expuestas;
  - una sola importación viva por parte;
  - `imports_commit` rechaza partes sueltas.
- **Riesgo.** Bajo con los datos de staging (91 productos, 0 importaciones en curso):
  - no hay índices pesados;
  - `alter table import_jobs add column` sin valor por omisión volátil;
  - `publish_runs` nace vacía.
- **Recuperación** (hacia adelante, como en la sección 9):
  - **7:** volver a crear `public.store_alerts` como en `20261112000100_store_alerts.sql`; borrar el envoltorio `system.purge_retention`, renombrar `purge_retention_base` a `purge_retention` (definida en `20261105000500_data_retention.sql`) y devolverle el permiso de `system_worker`. La tabla `import_photo_checks` puede quedarse: solo guarda resultados de 7 días.
  - **8:** volver a crear `system.import_commit` como en `20261027000200_import_skip_errors.sql`; la columna `new_categories` puede quedarse sin uso.
  - **9:** volver a crear los ganchos de publicación de `20261113000200`, que publicaban dentro de la importación. **No borrar** `publish_runs` si ya tiene filas.
  - **10:** volver a crear `imports_commit`, `imports_accept_categories` y `fail_stuck_imports` como en sus migraciones anteriores (lo dice su encabezado). La reversa completa de la 10 se ensayó en local y deja el esquema idéntico al de la 9.
