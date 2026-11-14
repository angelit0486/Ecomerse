#!/usr/bin/env bash
# =============================================================================
# Comprueba, SOLO en PostgreSQL local, que la reversa de la migración 0400 deja el
# esquema igual al de una base con las migraciones hasta 20261113000300.
# Prueba el esquema; no recupera los datos que la reversa borra (ver el .sql).
# Uso: bash scripts/ops/reversa/comprobar-0400.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PGHOST=${PGHOST:-localhost} PGUSER=${PGUSER:-postgres} PGPASSWORD=${PGPASSWORD:-postgres}
case "$PGHOST" in localhost|127.0.0.1|/*) ;; *) echo "✗ Solo contra PostgreSQL local" >&2; exit 1 ;; esac
A=pruva_rev_hasta_0300; B=pruva_rev_con_reversa
WORK=$(mktemp -d); trap 'rm -rf "$WORK"; dropdb --if-exists "$A" 2>/dev/null; dropdb --if-exists "$B" 2>/dev/null' EXIT
p() { psql -X -q -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }
for db in "$A" "$B"; do
  dropdb --if-exists "$db"; createdb "$db"
  for f in scripts/db/supabase-shim.sql scripts/db/supabase-shim-auth.sql scripts/db/supabase-shim-storage.sql scripts/db/supabase-shim-storage-grants.sql; do p "$db" -f "$f" > /dev/null; done
done
for f in supabase/migrations/*.sql; do
  case "$f" in *20261113000400_*) ;; *) p "$A" -1 -f "$f" > /dev/null ;; esac
  p "$B" -1 -f "$f" > /dev/null
done
p "$B" -1 -f scripts/ops/reversa/20261113000400_import_batches.reversa.sql > /dev/null
dump() { pg_dump -s --no-owner -d "$1" | grep -vE '^--|^$|^\\(un)?restrict ' | sort; }
dump "$A" > "$WORK/a.sql"; dump "$B" > "$WORK/b.sql"
if diff -q "$WORK/a.sql" "$WORK/b.sql" > /dev/null; then
  echo "✓ Tras la reversa, el esquema es idéntico al de 20261113000300 ($(wc -l < "$WORK/a.sql") líneas, con permisos)"
else
  diff "$WORK/a.sql" "$WORK/b.sql" | head -30; echo "✗ El esquema difiere" >&2; exit 1
fi
