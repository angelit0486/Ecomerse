#!/usr/bin/env bash
# =============================================================================
# Simulacro de restauración (GATE0 §36; misión vendible F1.7).
#   1. Respalda la base de origen con pg_dump (formato custom, como un respaldo
#      lógico de Supabase).
#   2. La restaura en una base NUEVA y desechable.
#   3. Comprueba que la copia sirve: misma versión de esquema, mismos conteos en
#      cada tabla propia y en auth.users, mismos totales de pedidos y pagos, y los
#      metatests de seguridad (RLS forzado, grants) en verde sobre la copia.
#   4. Mide cuánto tardó cada paso (RTO de la base, sin DNS ni despliegue).
#
# Nunca escribe en la base de origen. Por defecto: origen pruva_dev, destino
# pruva_restore_drill (se borra y se vuelve a crear).
#
# Variables: PGHOST, PGPORT, PGUSER, PGPASSWORD, SOURCE_DB, DRILL_DB, DUMP_FILE
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
SOURCE="${SOURCE_DB:-pruva_dev}"
DRILL="${DRILL_DB:-pruva_restore_drill}"
DUMP="${DUMP_FILE:-$(mktemp -d)/respaldo.dump}"

if [ "$SOURCE" = "$DRILL" ]; then
  echo "✗ El destino no puede ser la base de origen" >&2
  exit 1
fi

now_ms() { date +%s%3N; }
q() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$1" -c "$2"; }

# Conteos de todas las tablas propias y de auth.users, uno por renglón.
# Con FORCE RLS, el superusuario sigue viendo todo (los superusuarios ignoran RLS).
counts() {
  q "$1" "
    select string_agg(t || '=' || n, E'\n' order by t) from (
      select format('%I.%I', schemaname, relname) as t,
             (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname),
                                                  false, true, '')))[1]::text::bigint as n
        from pg_stat_user_tables
       where schemaname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
          or (schemaname = 'auth' and relname = 'users')
    ) s"
}

money() {
  q "$1" "select coalesce(sum(total), 0) || '/' || (select coalesce(sum(amount), 0) from public.payments)
            from public.orders"
}

echo "▸ Origen: $SOURCE · copia: $DRILL"
t0=$(now_ms)
pg_dump -Fc -d "$SOURCE" -f "$DUMP"
t1=$(now_ms)
size=$(du -h "$DUMP" | cut -f1)
echo "  Respaldo: $size en $(( (t1 - t0) )) ms"

before_counts=$(counts "$SOURCE")
before_money=$(money "$SOURCE")
before_version=$(q "$SOURCE" "select public.app_schema_version()")

dropdb --if-exists "$DRILL"
createdb "$DRILL"
t2=$(now_ms)
# Sin --exit-on-error: los avisos de objetos del sistema que ya existen en el
# clúster (extensiones, esquemas) no impiden la restauración; se cuentan abajo.
pg_restore -d "$DRILL" --no-owner --role="$PGUSER" "$DUMP" 2> "$DUMP.restore.log" || true
t3=$(now_ms)
echo "  Restauración: $(( t3 - t2 )) ms"
if grep -q "error:" "$DUMP.restore.log"; then
  echo "  Mensajes de pg_restore (revisar):"
  grep "error:" "$DUMP.restore.log" | head -20 | sed 's/^/    /'
fi

# pg_dump no copia los ajustes de la base (ALTER DATABASE … SET), como el
# search_path con `extensions`: sin él, pgTAP y otras extensiones no se encuentran.
# Se copian del origen; en Supabase los pone la plataforma al crear el proyecto.
settings=$(q "$SOURCE" "
  select string_agg(c, E'\n') from pg_db_role_setting s
    join pg_database d on d.oid = s.setdatabase, unnest(s.setconfig) c
   where d.datname = current_database() and s.setrole = 0")
while IFS= read -r setting; do
  [ -z "$setting" ] && continue
  name="${setting%%=*}"
  q postgres "alter database \"$DRILL\" set $name = ${setting#*=}" > /dev/null
  echo "  Ajuste de la base copiado: $name"
done <<< "$settings"

fail=0
after_version=$(q "$DRILL" "select public.app_schema_version()")
if [ "$before_version" = "$after_version" ]; then
  echo "  ✓ Versión de esquema: $after_version"
else
  echo "  ✗ Versión de esquema: origen $before_version, copia $after_version"; fail=1
fi

after_counts=$(counts "$DRILL")
if [ "$before_counts" = "$after_counts" ]; then
  echo "  ✓ Conteos idénticos en $(echo "$after_counts" | wc -l) tablas ($(echo "$after_counts" | awk -F= '{s+=$2} END {print s}') filas)"
else
  echo "  ✗ Conteos distintos:"; diff <(echo "$before_counts") <(echo "$after_counts") | head -20; fail=1
fi

after_money=$(money "$DRILL")
if [ "$before_money" = "$after_money" ]; then
  echo "  ✓ Totales de pedidos/pagos (centavos): $after_money"
else
  echo "  ✗ Totales: origen $before_money, copia $after_money"; fail=1
fi

echo "▸ Metatests de seguridad sobre la copia"
if pg_prove --failures --dbname "$DRILL" supabase/tests/database/00_schema_security.test.sql; then
  echo "  ✓ RLS forzado, grants y funciones SECURITY DEFINER como en el origen"
else
  fail=1
fi
t4=$(now_ms)

echo "▸ Tiempo total de recuperación de la base: $(( (t4 - t0) / 1000 )) s"
[ "$fail" -eq 0 ] && echo "✓ Simulacro correcto" || { echo "✗ Simulacro con fallas"; exit 1; }
