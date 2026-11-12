# Paquete de despliegue: 5 migraciones pendientes en staging (Orden 10, O10-05)

> **Estado: PREPARADO, NO APLICADO.** Nada de esto se ha ejecutado en staging ni en producción. Aplicarlo requiere la autorización expresa del propietario (Orden 10 lo prohíbe en este bloque).
>
> Ensayo local reproducible: `bash scripts/ops/migration-rehearsal.sh` (32 s). Último resultado: 2026-11-12, rama `producto/orden-10`, todo en verde (sección 7).

## 1. Situación [VERIFICADO el 2026-11-12, solo lectura]

|                             | Staging                                   | Repositorio         |
| --------------------------- | ----------------------------------------- | ------------------- |
| Versión del esquema         | `20261110000200`                          | `20261111000400`    |
| Migraciones                 | 162                                       | 167                 |
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
- El código nuevo espera `20261111000400`. Si se despliega antes de migrar, el panel y la tienda muestran **«mantenimiento»** hasta que se apliquen.

Por eso: **1) migraciones, 2) despliegue.** Entre uno y otro, staging funciona con el código anterior.

## 4. Verificación previa (antes de aplicar)

Todas son de solo lectura. Si una no da lo esperado, **no se aplica nada**.

| Comprobación                | Consulta                                                                                                                                                                 | Esperado                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Respaldo reciente           | Correr `scripts/ops/backup-export.sh` (runbook `respaldos.md`) y `restore-check.sh` en local                                                                             | Restauración sin diferencias |
| Versión actual              | `select public.app_schema_version();`                                                                                                                                    | `20261110000200`             |
| Ninguna de las 5 aplicada   | `select version from supabase_migrations.schema_migrations where version >= '20261110000300';`                                                                           | 0 filas                      |
| Cola sin trabajos corriendo | `select count(*) from system.jobs where status = 'running';`                                                                                                             | 0                            |
| Sin importaciones en curso  | `select count(*) from public.import_jobs where status = 'committing';`                                                                                                   | 0                            |
| Sumas del commit a usar     | `net.http_get` de cada archivo en `raw.githubusercontent.com/angelit0486/Ecomerse/<commit>/supabase/migrations/…` y `encode(sha256(convert_to(content, 'UTF8')), 'hex')` | Las 5 sumas de la tabla 2    |

## 5. Procedimiento de aplicación

Es el mismo método ya usado en staging (`docs/runbooks/database-roles.md` §7), sin contraseña de la base:

1. Descargar los 5 archivos con `net.http_get` desde el **commit fijo** y comparar sus sumas con la tabla 2. Solo funciona mientras el repositorio sea público (riesgo R-08). Si se hace privado, hay que usar `MIGRATION_DATABASE_URL` y `scripts/deploy/migrate.mjs`.
2. Un solo bloque `do`, archivo por archivo **en orden**:
   - comprobar que no esté registrado;
   - comprobar que la suma coincide;
   - ejecutarlo;
   - registrarlo en `supabase_migrations.schema_migrations` con su versión, nombre y suma.

   Si uno falla, no queda aplicado ninguno: es una sola transacción.

3. `notify pgrst, 'reload schema';`
4. Verificación posterior (sección 6).
5. Solo entonces: desplegar `producto/orden-10` en la rama de Vercel (otra autorización, aparte), sin reescribir historia.

**Tiempo y bloqueos.** Medido en local con 2,000 productos: 1.9 s en total. La migración 2 tardó 1.1 s y la 4, 0.66 s. En staging (91 productos) será menos. La 2 agrega una columna y crea un índice **sin** `concurrently`: bloquea las escrituras en `products` mientras corre, un instante con 91 productos. En una base con cientos de miles de productos habría que programarla fuera de horario.

## 6. Verificación posterior

Son las mismas consultas que corre el ensayo (`scripts/ops/migration-rehearsal.sh`, paso 4).

| Comprobación                     | Consulta                                                                                                                                                                            | Esperado                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Versión                          | `select public.app_schema_version();`                                                                                                                                               | `20261111000400`         |
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

`bash scripts/ops/migration-rehearsal.sh`, 2026-11-12, PostgreSQL 16 local:

1. Base con las 162 migraciones de staging y una tienda sintética de 2,000 productos y 400 pedidos.
2. Ninguna de las 5 aplicada; 0 candados de aviso retenidos.
3. Las 5 aplicadas en orden con su sha256: 50, 1,115, 48, 658 y 43 ms.
4. 11 de 11 verificaciones posteriores correctas.
5. `pg_dump -s` de la base actualizada **idéntico** al de una base creada desde cero (22,814 líneas); permisos de funciones idénticos.
6. Un archivo alterado se rechaza por su suma.
7. pgTAP sobre la base actualizada: 93 de 93 (metatests de seguridad y las pruebas de las 5 migraciones).

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
2. Aplicar las 5 migraciones en staging (sección 5).
3. Desplegar el código (sección 5, paso 5), en una autorización aparte.
