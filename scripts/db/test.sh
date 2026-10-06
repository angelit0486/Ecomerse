#!/usr/bin/env bash
# =============================================================================
# Pruebas de base de datos sobre PostgreSQL estándar (local y CI):
#   1. Crea una base de datos desechable.
#   2. Aplica el shim de Supabase (solo pruebas) y TODAS las migraciones, cada una
#      en su propia transacción (como la CLI de Supabase).
#   3. Ejecuta las pruebas pgTAP de supabase/tests/database.
#   4. Ejecuta las pruebas de integración (Vitest) contra esa base.
#
# Variables (con valores por defecto para desarrollo local):
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, TEST_DB_NAME
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
DB="${TEST_DB_NAME:-pruva_test}"

psql_db() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

echo "▸ Recreando base de datos de prueba: $DB"
dropdb --if-exists "$DB"
createdb "$DB"

echo "▸ Aplicando shim de Supabase (solo pruebas)"
psql_db -f scripts/db/supabase-shim.sql
psql_db -f scripts/db/supabase-shim-auth.sql
psql_db -f scripts/db/supabase-shim-storage.sql
psql_db -f scripts/db/supabase-shim-storage-grants.sql

shopt -s nullglob
migrations=(supabase/migrations/*.sql)
if [ ${#migrations[@]} -eq 0 ]; then
  echo "✗ No hay migraciones" >&2
  exit 1
fi
for f in "${migrations[@]}"; do
  echo "▸ Migración: $f"
  psql_db -1 -f "$f"
done

echo "▸ Habilitando login de roles de mínimo privilegio (solo local/CI)"
psql_db -f scripts/db/local-roles.sql

echo "▸ Pruebas pgTAP"
pg_prove --failures --dbname "$DB" supabase/tests/database/*.test.sql

echo "▸ Pruebas de integración (Vitest)"
export TEST_ADMIN_DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}"
export TEST_WORKER_DATABASE_URL="postgres://system_worker:system_worker_dev_password@${PGHOST}:${PGPORT}/${DB}"
pnpm exec vitest run --project integration

echo "✓ Base de datos: todas las pruebas pasaron"
