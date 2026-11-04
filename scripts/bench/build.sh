#!/usr/bin/env bash
# Banco de escalabilidad (docs/audit/escalabilidad-2026-11.md). SOLO LOCAL.
# Crea la base pruva_bench con todas las migraciones, los ayudantes de prueba y
# datos sintéticos: una tienda con 200 000 pedidos y 50 tiendas de ruido.
# Uso: bash scripts/bench/build.sh && bash scripts/bench/panel.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST=localhost PGUSER=postgres PGPASSWORD=${PGPASSWORD:-postgres}
DB=pruva_bench
p() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
dropdb --if-exists "$DB"; createdb "$DB"
for f in scripts/db/supabase-shim.sql scripts/db/supabase-shim-auth.sql scripts/db/supabase-shim-storage.sql scripts/db/supabase-shim-storage-grants.sql; do p -f "$f" >/dev/null; done
for f in supabase/migrations/*.sql; do p -1 -f "$f" >/dev/null; done
p -f scripts/db/local-roles.sql >/dev/null
p -f supabase/tests/database/000_test_helpers.test.sql >/dev/null 2>&1
p -f scripts/bench/seed.sql
p -f scripts/bench/load-setup.sql
