#!/usr/bin/env bash
# Programa de capacidad (Orden 06). SOLO LOCAL: crea una base desechable con
# todas las migraciones, los roles de mínimo privilegio y el generador sintético.
# Uso: bash scripts/capacity/build.sh [base]        (por defecto pruva_cap)
#      CAP_UNTIL=20261110000300 bash scripts/capacity/build.sh pruva_cap_antes   (migraciones hasta esa versión,
#      para medir «antes y después» de una corrección)
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST=${PGHOST:-localhost} PGUSER=${PGUSER:-postgres} PGPASSWORD=${PGPASSWORD:-postgres}
case "$PGHOST" in localhost|127.0.0.1|/*) ;; *) echo "✗ Solo contra PostgreSQL local (PGHOST=$PGHOST)" >&2; exit 1 ;; esac
DB=${1:-pruva_cap}
case "$DB" in pruva_cap*) ;; *) echo "✗ La base debe llamarse pruva_cap…" >&2; exit 1 ;; esac
p() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
dropdb --if-exists "$DB"; createdb "$DB"
for f in scripts/db/supabase-shim.sql scripts/db/supabase-shim-auth.sql scripts/db/supabase-shim-storage.sql scripts/db/supabase-shim-storage-grants.sql; do p -f "$f" > /dev/null; done
for f in supabase/migrations/*.sql; do
  v=$(basename "$f"); v=${v%%_*}
  if [ -n "${CAP_UNTIL:-}" ] && [ "$v" \> "$CAP_UNTIL" ]; then continue; fi
  p -1 -f "$f" > /dev/null
done
p -f scripts/db/local-roles.sql > /dev/null
p -f scripts/capacity/generator.sql > /dev/null
echo "✓ $DB lista (esquema $(p -Atc 'select public.app_schema_version()'))"
