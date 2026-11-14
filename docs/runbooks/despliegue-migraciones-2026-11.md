# Paquete de despliegue: 10 migraciones pendientes en staging (Orden 10, O10-05; actualizado en el mensaje 4)

> **Procedimiento vigente: §11, ventana única (Orden 10, mensaje 5).** Las secciones 4 a 6 explican cada comprobación; §11 dice en qué orden se hacen, con qué guiones y cuándo detenerse.
>
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

### 9.1 Cuatro cosas distintas (H2)

| Concepto                     | Qué es                                                                                | ¿Lo resuelve la reversa de la 10?                                   |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Reversa del esquema**      | Dejar las tablas y funciones como en `20261113000300`                                 | Sí. Comprobado: esquema idéntico (`comprobar-0400.sh`)              |
| **Compatibilidad de la app** | Que el código desplegado funcione con ese esquema                                     | **No.** Hay que desplegar antes otro código (§9.2)                  |
| **Pérdida de metadatos**     | Lo que la reversa borra: lotes, qué importación era qué parte, `publish_runs.resumes` | La **provoca**. No se puede reconstruir                             |
| **Recuperación de datos**    | Volver a tener lo borrado                                                             | **No.** Solo el respaldo del paso 2, con lo escrito después perdido |

La reversa **no es una recuperación de datos**.

### 9.2 La app actual no funciona con el esquema 0300

- **Por qué.** El código de `main` espera `20261113000400` (`EXPECTED_SCHEMA_VERSION`). Su trabajo `import.commit` llama a `system.import_batch_after_part` en **cada** importación, suelta o de lote, dentro de la misma transacción.
- **Qué pasaría.** Tras la reversa esa función no existe: la transacción se revierte, se reintenta 3 veces y **toda** importación queda fallida sin cambios. Además, el panel y la consola mostrarían «mantenimiento» (base 0300 < 0400). El runner `/api/jobs/run` no revisa la versión, así que seguiría tomando trabajos y fallándolos.
- **App compatible:** `a730989` (mensaje 4, antes de ADR-064). Espera `20261113000300` y no usa ninguno de los 13 objetos de la 10. Como `current >= expected`, también funciona con la base en 0400, así que puede desplegarse **antes** de la reversa.
- **Comprobado** (`comprobar-0400.sh`, con git y sin red): `a730989` espera 0300 y no nombra ningún objeto de la 10; la app actual sí; sobre 0300, la sentencia que ejecuta la app actual falla con «no existe».

### 9.3 Orden seguro

1. **Drenar con la app 0400 todavía desplegada.** Ningún lote aplicándose, ninguna parte validándose o aplicándose, ninguna publicación en curso. Avisar al propietario que nadie importe (no hay bloqueo técnico, §11.3).
2. **Desplegar `a730989`** (u otro commit que espere `20261113000300` y pase `comprobar-0400.sh`). Con la base aún en 0400 funciona.
3. **Correr la reversa con su candado:** `psql -X -1 -v ON_ERROR_STOP=1 -f scripts/ops/reversa/20261113000400_import_batches.reversa.sql`.
4. **Verificar:** `app_schema_version()` = `20261113000300`; una importación suelta de prueba en `pruva-ventana-a` se aplica.

**El candado** (paso G del guion) rechaza la reversa **sin cambiar nada** si:

- hay un lote aplicándose (`running`);
- hay una parte validándose o aplicándose;
- hay trabajos `import.commit` de partes, publicaciones en curso o trabajos `catalog.publish_run` en la cola;
- la base no está exactamente en `20261113000400` (por ejemplo, si ya se revirtió).

### 9.4 Si el candado rechaza: detener y conciliar

**No forzar.** No se edita el guion para saltarse el candado.

| Motivo del rechazo                                                     | Qué hacer                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Partes validándose o aplicándose; `import.commit` de partes en la cola | Esperar a que el trabajo termine (3 intentos como máximo) o a que el mantenimiento la marque fallida (30 min sin trabajo vivo). Volver a correr                                                                                   |
| Publicación en curso o `catalog.publish_run` en la cola                | Esperar a que termine. Si se quedó sin trabajo, el mantenimiento de la app 0400 la retoma o la marca fallida (§11.2)                                                                                                              |
| **Lote «aplicándose» sin ninguna parte aplicándose**                   | Pasa si la app vieja aplicó una parte: `a730989` no avanza lotes. Conciliar con la función del propio sistema: `select app.import_batch_advance('<id del lote>');` Si queda otra parte, esto la empieza: volver al primer renglón |
| Versión distinta de 0400                                               | Nada que revertir, o hay una migración más nueva: **detenerse** y escalar                                                                                                                                                         |

- La conciliación del lote está probada en `comprobar-0400.sh` (un lote de 1 parte aplicada por la app vieja queda `completed`).
- Si el lote tiene más partes, la siguiente se aplica con el código que esté desplegado. Con `a730989` el lote no avanza solo: hay que volver a conciliar parte por parte. Si eso no es aceptable, **volver a desplegar la app 0400**, dejar que el lote termine y empezar el orden seguro otra vez.

### 9.5 Qué pasa con las partes «aplicándose»

- **Con el candado**, la reversa no corre mientras exista una. Antes del candado (mensaje 5), el guion solo cancelaba las partes subidas o validadas; una parte «aplicándose» se quedaba así y, sin la función del lote, su trabajo fallaba con la app actual.
- **Las partes ya aplicadas** se quedan aplicadas: sus productos no cambian y la importación queda como suelta, `completed`.
- **Las partes subidas o validadas sin aplicar** se cancelan (paso 0 del guion), para que nadie las confirme sueltas.

## 10. Autorizaciones que hacen falta

1. Correr el respaldo (sección 4).
2. Aplicar las 10 migraciones en staging (sección 5).
3. Desplegar el código (sección 5, paso 5) en la misma ventana (sección 3), aunque se autorice aparte. El orden y los criterios están en §11.
4. Después, corregir en staging las tarifas inactivas de la tienda `demo` (hallazgo D1): volver a guardarlas desde el panel ya desplegado.

## 11. Ventana única: migrar y desplegar juntos (Orden 10, mensajes 5 y 7)

**Por qué una sola ventana.** Con las 10 migraciones aplicadas, el código desplegado hoy (`88edc6d`) sigue funcionando: su E2E de importar, pegar, catálogo, tienda, dos tiendas, checkout, envíos y fotos pasó **17 de 17** contra la base con las 10 [MEDIDO, local, 2026-11-14]. Pero **no conoce el trabajo `catalog.publish_run`**:

- una importación con «Publicado: sí» hecha entre migrar y desplegar deja sus productos en borrador;
- el mantenimiento retoma su corrida 3 veces, cada 15 min o más; si el código nuevo no ha llegado, queda fallida con el motivo (§11.2);
- con el código nuevo, `scripts/ops/ventana/03-retomar-publicaciones.sql` la recupera.

Todo eso está probado en `tests/integration/window-publish-contingency.test.ts`.

**Quién y con qué.**

- Una persona técnica con acceso de dueño al editor SQL de Supabase (`pruva-staging`), con `psql` hacia la misma base (para el paso 9b) y con permiso de push a la rama que despliega Vercel (`claude/ecommerce-regulated-platform-41vu1e`).
- Cada paso necesita la autorización del propietario: respaldo, migraciones, despliegue, la comprobación de aislamiento (escribe y revierte) y, si hace falta, la contingencia.
- Anotar la hora UTC de cada paso y la decisión de cada fila en falso.

### 11.1 Categorías de los criterios (H4-A)

Cada comprobación tiene **una** categoría. `01-antes.sql`, `02-despues.sql` y `04-aislamiento.sql` la traen en su columna `categoria`; los pasos sin guion la tienen en la tabla de §11.6.

| Categoría                                           | Cuándo                         | Qué pasa si sale en falso                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bloqueante** (`bloqueante`)                       | Antes de empezar (pasos 1 a 4) | La ventana no empieza. No se aplica nada                                                                                                                                     |
| **Detener la ventana** (`detener`)                  | Del paso 6 en adelante         | No se avanza al paso siguiente. Se sigue la contingencia (§11.4). La ventana no se da por buena                                                                              |
| **Solo con autorización** (`requiere_autorizacion`) | Paso 9                         | Se acepta únicamente si el propietario lo autoriza por escrito en la bitácora, con el motivo. Hoy aplica a «trabajos listos sin tomar hace más de 10 min» con el cron diario |
| **Impide reabrir** (`impide_reabrir`)               | Pasos 9 a 11                   | La ventana puede cerrarse, pero las importaciones no se reabren a los comercios hasta resolverla                                                                             |

**Nada se salta en silencio.** Cada fila en falso se anota con su categoría y la decisión tomada. Una fila sin categoría cuenta como «detener».

**Con el cron diario** (configuración versionada hoy, `operacion-de-colas.md` §1): un trabajo encolado después del cron de las 12:00 UTC espera hasta el día siguiente si nadie abre el panel. La fila «trabajos listos sin tomar hace más de 10 min» saldrá en falso casi siempre: es la categoría «solo con autorización». **No** se cambia el criterio para que pase.

### 11.2 Tiempos: objetivo, límite y qué pasa al pasarlo (H4-D)

Todas las horas se cuentan desde el paso indicado. Sustituyen a las cifras sueltas de la versión anterior (15, 45 y 10 min).

| Tramo                                            | Objetivo                                                | Límite       | Al pasar el límite                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Paso 3: esperar a que no haya trabajos corriendo | 0 min                                                   | 30 min       | **Bloqueante:** no empezar; reprogramar                                                                                          |
| Paso 6: aplicar las 10                           | 1 min [MEDIDO local: 2.6 s las 10, con 2,000 productos] | Un error     | Se revierte sola. **Detener**                                                                                                    |
| Paso 6 → despliegue READY (paso 7)               | 5 min                                                   | 10 min       | **Detener:** se cierra la ventana con el código anterior sirviendo (funciona con la base nueva) y se reprograma el despliegue    |
| Paso 7 → `02-despues.sql` en verde (paso 9)      | a los 5 min                                             | a los 15 min | Según la categoría de cada fila (§11.1)                                                                                          |
| Paso 10: prueba funcional, con la página abierta | 2 min                                                   | 10 min       | **Impide reabrir**                                                                                                               |
| Ventana completa (paso 5 → paso 12)              | 30 min                                                  | 45 min       | Revisar `publish_runs` de la ventana: si alguna quedó fallida, correr `03-retomar-publicaciones.sql` (escribe; con autorización) |

- **Por qué 45 min.** Una publicación pedida entre migrar y desplegar se retoma a los ≥ 15, ≥ 30 y ≥ 45 min y queda fallida a partir de ≥ 60 min. Cerrar antes de 45 min deja margen.
- **«≥» porque depende del disparador.** El mantenimiento que la retoma corre con el runner. Con el cron diario y la página cerrada, los 15 min pueden ser horas [ESTIMADO a partir de §1 de `operacion-de-colas.md`].

### 11.3 Pausa: avisar no es impedir (H4-C)

**No existe un modo de mantenimiento.** El panel muestra «mantenimiento» solo cuando la base va **detrás** del código. Durante la ventana la base va **delante**, así que el panel sigue abierto. Por eso la pausa no está garantizada técnicamente.

| Acción                     | Qué existe hoy                                                                                                                             | ¿Garantizado?                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Avisar al propietario      | Un mensaje del técnico antes del paso 3 y al cerrar                                                                                        | Solo la comunicación                       |
| Impedir operaciones nuevas | Nada. Cualquier persona con acceso al panel puede importar durante la ventana                                                              | **No**                                     |
| Detener trabajos en curso  | No se pueden detener. Se espera a que terminen: `01-antes.sql` exige 0 trabajos corriendo y 0 importaciones a medias                       | Comprobado **antes** de migrar, no durante |
| Drenar trabajos pendientes | No se drenan. Siguen en la cola y los toma el código que esté desplegado. `01-antes.sql` exige que el código nuevo conozca todos sus tipos | Comprobado antes de migrar                 |

- **Mitigación hoy:** staging solo tiene tiendas de prueba y la tienda `demo`; la ventana es corta (§11.2). Si alguien importa con «Publicado: sí» en la ventana, la contingencia lo recupera (03).
- **Requisito antes de operar con comercios reales:** un mecanismo de mantenimiento que cierre las importaciones y las acciones que encolan trabajos. [PROPUESTA: un interruptor en `feature_flags` revisado por el layout del panel y por esas acciones; necesita su ADR y su migración. No se hizo en este mensaje.]

### 11.4 Contingencia

- **El despliegue falla o no llega a READY en 10 min:** el código anterior sigue sirviendo con la base nueva (17/17 E2E). **No se toca la base.**
  - Se corrige el despliegue y se repite el paso 7 en otra ventana.
  - Mientras tanto, nadie importa con «Publicado: sí» (aviso; no hay bloqueo técnico, §11.3).
  - Después del paso 9 en verde: si hay corridas fallidas de la ventana, `03-retomar-publicaciones.sql` con `:INICIO_VENTANA` (escribe; con autorización).
- **Fila en falso de `02-despues.sql` a los 15 min:**
  - _Tipos desconocidos_ (`detener`): sigue sirviendo el código anterior. Revisar qué despliegue sirve Vercel.
  - _Trabajos listos de más de 10 min_ (`requiere_autorizacion`): el disparador de la cola no corre a tiempo. Con el cron diario es lo esperado: se acepta solo con autorización escrita. Si `pg_cron` ya estuviera activo, diagnosticar con `operacion-de-colas.md` §9.
  - _Publicaciones sin trabajo vivo_ (`impide_reabrir`): `03-retomar-publicaciones.sql`.
  - _Importaciones aplicándose hace más de 30 min_ (`impide_reabrir`): esperar al mantenimiento, que las marca fallidas sin cambios; revisar los logs del runner.
- **Fila en falso de `04-aislamiento.sql`** (`detener`): **no se reabre nada.** Es una posible fuga entre tiendas: guardar la salida y escalar al propietario. Su transacción ya se revirtió.
- **La prueba funcional falla** (`impide_reabrir`): no se reabren las importaciones. Se reúnen los logs del runner y la corrida (`publish_runs`) para un diagnóstico.
- **Daño mayor en datos:** restaurar el respaldo del paso 2 (`respaldos.md`). Se pierde lo escrito desde entonces.
- **No hay reversa automática.** La reversa de la 10 pierde datos y exige otro código desplegado antes (§9.1 a §9.4).

### 11.5 Tiendas de prueba (H4-E)

- **Cuáles:** dos tiendas con handle **`pruva-ventana-a`** y **`pruva-ventana-b`**, cada una en **su propia organización** y cada una con un dueño (`org_owner`).
- **Quién y cuándo:** el técnico las crea **antes** de la ventana desde la Consola de plataforma (Organizaciones → Nueva y Tienda nueva), con cuentas de correo de pruebas que él controle.
- **Cómo se identifican:** solo por su handle. Ningún guion lleva ids escritos.
- **Comprobación:** `01-antes.sql` tiene la fila bloqueante «tiendas de prueba…» (deben ser 2 organizaciones con dueño). Si faltan, `04-aislamiento.sql` también se detiene con `ventana_sin_tiendas_de_prueba`.
- **Uso:** la prueba funcional (paso 10) se hace **solo** en `pruva-ventana-a`. No se usa la tienda `demo` ni ninguna otra.

### 11.6 Pasos

| Paso | Qué se hace                                    | Cómo                                                                                                                                          | Resultado esperado                                                                                                  | Categoría si falla |
| ---- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1    | Fijar el commit                                | `git ls-remote origin refs/heads/producto/orden-10`; el commit aprobado. Anotar el hash completo                                              | `git merge-base --is-ancestor origin/claude/ecommerce-regulated-platform-41vu1e <hash>` responde 0 (avance rápido)  | Bloqueante         |
| 2    | Respaldo y restauración                        | `docs/runbooks/respaldos.md`: `scripts/ops/backup-export.sh` contra staging y `scripts/ops/restore-check.sh` en local                         | Restauración sin errores; metatests de seguridad en verde sobre la copia                                            | Bloqueante         |
| 3    | Aviso y comprobación previa                    | Avisar al propietario (§11.3). Correr `scripts/ops/ventana/01-antes.sql` en el editor SQL                                                     | Las 7 filas con `ok = true` (incluye las tiendas de prueba). Si hay trabajos corriendo, repetir cada 5 min hasta 30 | Bloqueante         |
| 4    | Sumas de los 10 archivos                       | Descargar del commit del paso 1 con `net.http_get` y comparar con la tabla 2 y los anexos A y B (sección 5, paso 1)                           | Las 10 sumas coinciden                                                                                              | Bloqueante         |
| 5    | Inicio de la ventana                           | Anotar la hora UTC: es `:INICIO_VENTANA`                                                                                                      | —                                                                                                                   | —                  |
| 6    | Aplicar las 10 en orden                        | Sección 5, paso 2: un bloque, archivo por archivo, registro en `supabase_migrations.schema_migrations`; luego `notify pgrst, 'reload schema'` | `select public.app_schema_version()` = `20261113000400`                                                             | Detener            |
| 7    | Desplegar enseguida                            | `git push origin <hash>:claude/ecommerce-regulated-platform-41vu1e` (avance rápido, sin forzar). Esperar READY en Vercel                      | READY dentro del límite de §11.2                                                                                    | Detener            |
| 8    | Salud                                          | `/api/health` y Consola → Salud                                                                                                               | `ok`; el panel abre sin «Faltan migraciones»                                                                        | Detener            |
| 9    | Comprobación posterior                         | `scripts/ops/ventana/02-despues.sql` a los 5 y a los 15 min del paso 7                                                                        | Las 7 filas en verde a los 15 min, o cada fila en falso resuelta según su categoría                                 | La de cada fila    |
| 9b   | Aislamiento entre tiendas (escribe y revierte) | `psql -X -v ON_ERROR_STOP=1 -At -F '\|' -f scripts/ops/ventana/04-aislamiento.sql`                                                            | Las 36 filas con `ok = true`; después, ninguna fila nueva en las tiendas de prueba                                  | Detener            |
| 10   | Prueba funcional                               | En `pruva-ventana-a`, importar una hoja de 3 filas con «Publicado: sí» (una con precio 0). Abrir la importación                               | «2 publicados. 1 pendiente: 1 con precio inválido.» dentro de los tiempos de §11.2                                  | Impide reabrir     |
| 11   | La cola sigue                                  | `02-despues.sql` otra vez; Consola → Trabajos                                                                                                 | Sin muertos por tipo desconocido después del paso 7                                                                 | La de cada fila    |
| 12   | Cierre                                         | Avisar al propietario; anotar horas, hash, cada fila en falso con su decisión. Luego volver a guardar las tarifas de `demo` (D1)              | —                                                                                                                   | —                  |

**Qué comprueba el paso 9b.** No basta con «RLS activado». Como el dueño de cada tienda, en los dos sentidos, crea datos de prueba y comprueba:

- que ve sus lotes, importaciones, publicaciones, partidas, revisiones de fotos y productos;
- que no ve ninguno de los de la otra (0 filas);
- que no puede cancelar el lote, aplicar la importación ni publicar los productos de la otra, ni editar sus productos, ni correr una publicación (rechazo `42501`);
- que sin sesión (`anon`) no lee lotes ni publicaciones.

Termina con `ROLLBACK`. Probado en `tests/integration/window-isolation.test.ts`, incluida una fuga a propósito (una política `using (true)`, dentro de la misma transacción) que el guion sí detecta. También corre en el ensayo (`migration-rehearsal.sh`).

### 11.7 Repositorio público (H4-F, riesgo R-08)

- **Hecho:** la segunda auditoría reportó que el repositorio es público [NO VERIFICADO hoy; no se consultó GitHub en este mensaje].
- **Riesgo:** todo lo que se suba queda expuesto: código, runbooks, nombres de proyectos y rutas de staging. Un secreto subido por error quedaría público al instante.
- **Hoy:** ningún archivo versionado contiene secretos (las plantillas leen del Vault o del entorno). El paso 4 de esta ventana **depende** de que sea público (`net.http_get` de los archivos).
- **Requisito:** resolverlo **antes** de operar con credenciales de producción, datos de comercios reales o datos personales. Al volverlo privado, el paso 4 cambia: subir los 10 archivos por otro canal y comparar las mismas sumas (sección 8).
- **Decide el propietario.** No se cambió nada en GitHub.

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
  - **10 (corrección M1, Orden 10, mensaje 5):** la 10 **no es reversible sin pérdida**.
    - **Recuperación preferida (hacia adelante, sin pérdida):** una migración correctiva que vuelva a crear `imports_commit`, `imports_accept_categories` y `fail_stuck_imports` como estaban, y que haga que las funciones `imports_batch_*` e `imports_create_part` respondan «no disponible». Los lotes y su historia se quedan.
    - **Reversa completa:** `scripts/ops/reversa/20261113000400_import_batches.reversa.sql`. Solo con autorización, con un respaldo verificado tomado justo antes, y si la recuperación hacia adelante no alcanza.
    - **Se pierde para siempre:** la tabla `import_batches` (archivo, partes, huellas, estado, motivo y categorías aceptadas de cada lote), qué importación era qué parte (`batch_id`, `part_number`, `part_fingerprint`) y `publish_runs.resumes`.
    - **Se conserva:** productos, variantes, existencias, categorías y movimientos aplicados; cada importación como importación suelta, con sus filas; las corridas de publicación.
    - **Antes de la reversa (mensaje 7, H2):** desplegar una app compatible con 0300 y pasar el candado. Orden, candado y conciliación en §9.2 a §9.5. El guion cancela las partes sin aplicar, para que no se puedan confirmar sueltas.
    - **Qué demuestra el verificador:** `bash scripts/ops/reversa/comprobar-0400.sh` (solo local) comprueba la app compatible, el candado (3 rechazos que cubren sus 6 motivos), la conciliación y que el **esquema** queda idéntico al de `20261113000300` (24,576 líneas con permisos, 2026-11-14). Eso prueba el esquema y las condiciones; no recupera los datos de arriba.
    - **Corrección:** el informe del mensaje 4 decía «ensayada»; ese ensayo usó un guion que no estaba en el repositorio. El encabezado de la migración describe la reversa sin la advertencia de pérdida: manda este runbook.
