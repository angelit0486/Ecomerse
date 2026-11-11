# Respaldos y restauración

Misión vendible F1.7. Contrato: GATE0 §36. Fuentes: documentación de Supabase «Database Backups» y «Point-in-Time Recovery» (consultada el 2026-10-28).

## Situación real hoy

| Qué                                  | Estado                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Plan de la organización de Supabase  | **Free** (`angelii33's Org`, proyecto `pruva-staging`, PostgreSQL 17) [VERIFICADO con el conector de Supabase]                            |
| Respaldos automáticos diarios        | **No hay**: Supabase solo los hace en Pro, Team y Enterprise. En Free recomienda exportar con `supabase db dump` y guardar la copia fuera |
| PITR (recuperar a cualquier segundo) | No disponible en Free. Es un complemento de Pro y requiere cómputo Small o mayor                                                          |
| Fotos (Storage)                      | Los respaldos de la base **no** incluyen los archivos de Storage, solo sus metadatos                                                      |
| Simulacro de restauración local      | **Correcto** el 2026-10-28 (detalle abajo) [VERIFICADO en local]                                                                          |
| Restauración en Supabase real        | [NO VERIFICADO]: requiere plan de pago o un proyecto aparte                                                                               |

Mientras staging solo tenga datos de demostración, Free es aceptable. **Antes del primer comercio real** hay que pasar a Pro (decisión y costo del propietario).

## Objetivos (RPO = datos que se pueden perder; RTO = tiempo para volver)

| Escenario                       | Con Free (hoy)                                    | Con Pro                                                        | Con Pro + PITR 7 días        |
| ------------------------------- | ------------------------------------------------- | -------------------------------------------------------------- | ---------------------------- |
| Base dañada o borrada por error | RPO = desde la última exportación manual          | RPO ≤ 24 h, 7 días de copias                                   | RPO ≤ 2 min (según Supabase) |
| RTO de la base                  | Minutos a horas (restaurar la exportación a mano) | Según tamaño; el proyecto queda sin servicio mientras restaura | Igual que Pro                |

Meta del contrato (GATE0 §36.2): RPO ≤ 5 min y RTO ≤ 4 h con clientes de pago → **requiere Pro + PITR**. Costo publicado por Supabase el 2026-10-28: Pro 25 USD/mes + cómputo; PITR de 7 días ≈ 100 USD/mes. Confirmar en la página de precios antes de decidir.

## Simulacro local (`scripts/ops/restore-drill.sh`)

Respalda una base con `pg_dump`, la restaura en una base nueva y comprueba que la copia sirve. Nunca escribe en el origen.

```bash
bash scripts/ops/restore-drill.sh                   # origen pruva_dev → copia pruva_restore_drill
SOURCE_DB=otra DRILL_DB=copia bash scripts/ops/restore-drill.sh
```

Comprueba: versión de esquema, conteo de filas de cada tabla propia y de `auth.users`, suma de totales de pedidos y pagos (centavos) y los metatests de seguridad (`00_schema_security`: RLS forzado, grants, SECURITY DEFINER) sobre la copia.

Resultado del 2026-10-28 sobre `pruva_dev` (datos de demostración y de pruebas):

- Respaldo de 13 MB; 111 tablas y 147,865 filas idénticas; totales iguales; metatests 14/14.
- Tiempo total: **8 s** (respaldo ≈ 2 s, restauración ≈ 5.5 s). La primera corrida tardó 48 s por caché fría.
- **Hallazgo:** `pg_dump` no copia los ajustes de la base (`search_path` con `extensions`). Sin ellos, las funciones de extensiones no se encuentran. El script los copia; en una restauración manual hay que aplicarlos a mano (`alter database … set search_path = "$user", public, extensions`).

## Qué hacer después de restaurar (cualquier método)

1. Las contraseñas de los roles propios **no** vienen en los respaldos de Supabase: volver a fijar las de `storefront_gateway` y `system_worker` (`docs/runbooks/database-roles.md`) y actualizar las variables en Vercel.
2. Comprobar `select public.app_schema_version();` contra `EXPECTED_SCHEMA_VERSION`.
3. Abrir Consola → **Salud**: la cola debe avanzar y no debe haber pagos con error.
4. Correr la reconciliación de pagos (se encola sola cada 10 min) para recuperar pagos confirmados por Mercado Pago después del punto restaurado.
5. Fotos: si se borraron archivos después del respaldo, no vuelven con la base.

## Respaldo de la base en un comando (desde la computadora del propietario)

Orden de trabajo 05. El respaldo nunca sale de tu computadora y la contraseña no
va en ningún comando: cada herramienta la pide al conectarse (3 veces).

Requisitos: macOS o Linux (en Windows, WSL), cliente de PostgreSQL 17 (`pg_dump`,
`pg_restore`, `psql`) y el host y usuario del **Session pooler** (Supabase →
proyecto → Connect). El puerto 6543 (modo transacción) no sirve.

```bash
export PGHOST='<host del session pooler>' PGUSER='<usuario del pooler>'
export PGPORT=5432 PGDATABASE=postgres PGSSLMODE=require
bash scripts/ops/backup-export.sh ~/pruva-respaldos/$(date +%F)
```

Qué hace y qué deja en la carpeta:

| Archivo                     | Contenido                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pruva-propio-*.dump`       | Los 7 esquemas de PRUVA: estructura, datos, permisos, RLS                                                                                                         |
| `pruva-auth-storage-*.dump` | Solo datos: usuarios, identidades, buckets y catálogo de objetos                                                                                                  |
| `pruva-extras-*.sql`        | El trigger de alta de perfil en `auth.users` y la política de subidas de `storage.objects`: viven en tablas de Supabase y un respaldo por esquemas no los incluye |
| `pruva-conteos-*.txt`       | Filas por tabla y conteos del catálogo al exportar, para comparar al restaurar                                                                                    |
| `evidencia-*.txt`           | Resumen **sin secretos** para compartir: versiones, tamaños, SHA-256, lectura completa, conteos y su comparación con el catálogo                                  |

El script se niega si `PGPASSWORD` está definida, si la carpeta está dentro de un
repositorio de Git, si el cliente es menor que 17 o si el puerto es 6543.

## Restauración de prueba

En una base **vacía** (un proyecto Supabase de simulacro, nunca staging):

```bash
DESTINO_CONFIRMADO="$PGHOST/$PGDATABASE" bash scripts/ops/restore-check.sh ~/pruva-respaldos/<fecha>
```

Orden que aplica: usuarios y buckets → PRUVA → permisos exactos → extras. Compara
versión de esquema, tablas, funciones, triggers, políticas, RLS forzado, llaves
foráneas, los extras, los permisos del público y las filas de cada tabla. Se niega
si el destino tiene tablas o si el host es el de `pruva-staging`.

Probado el 2026-11-11 contra una base local con la estructura de un proyecto
Supabase nuevo: 0 errores, 119 tablas y 208,011 filas idénticas, 8 s, y los
metatests de seguridad (`00_schema_security`, 17/17) en verde sobre la copia.

### Dos trampas que encontró esa prueba (no las repitas a mano)

1. **Usuarios primero.** 21 llaves foráneas de PRUVA apuntan a `auth.users`
   (verificado en staging el 2026-11-11). Si los usuarios se restauran después,
   esas llaves no se crean y la copia queda sin integridad referencial.
2. **Permisos abiertos.** Supabase concede por defecto permisos a `anon`,
   `authenticated` y `service_role` sobre todo objeto nuevo en `public`.
   `pg_restore` aplica los permisos del respaldo pero **no retira** esos: una
   restauración ingenua deja tablas y funciones de PRUVA al alcance del público.
   El script los retira y vuelve a aplicar exactamente los del respaldo.

Tras una restauración real, además: fijar contraseñas nuevas de
`storefront_gateway` y `system_worker`, reponer las fotos desde la copia de
imágenes y seguir «Qué hacer después de restaurar».
