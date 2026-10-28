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

## Respaldo manual mientras staging esté en Free

Desde una computadora con la CLI de Supabase (no desde el celular):

```bash
supabase db dump --db-url "$MIGRATION_DATABASE_URL" -f respaldo-esquema.sql
supabase db dump --db-url "$MIGRATION_DATABASE_URL" --data-only -f respaldo-datos.sql
```

Guardar ambos archivos fuera de Supabase (p. ej., en una carpeta privada). Nunca subirlos al repositorio: contienen datos de clientes.
