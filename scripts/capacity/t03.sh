#!/usr/bin/env bash
# T03: una tienda con N productos en una base local desechable; genera, mide
# tamaños y corre las consultas del panel y de la tienda. SOLO LOCAL.
# Uso: bash scripts/capacity/t03.sh [productos=10000] [base=pruva_cap]
set -euo pipefail
cd "$(dirname "$0")/../.."
N=${1:-10000}; DB=${2:-pruva_cap}
export PGHOST=${PGHOST:-localhost} PGUSER=${PGUSER:-postgres} PGPASSWORD=${PGPASSWORD:-postgres}
bash scripts/capacity/build.sh "$DB"
q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
t0=$(date +%s.%N)
q -c "select capgen.store(1, $N)" > /dev/null
t1=$(date +%s.%N)
q -c "select capgen.orders(1, $((N / 5)))" > /dev/null
q -c "vacuum analyze"
echo "generar|$N productos|$(echo "$t1 - $t0" | bc) s"
q -c "select 'filas|' || relname || '|' || n_live_tup || '|' || pg_size_pretty(pg_total_relation_size(relid))
        from pg_stat_user_tables where schemaname = 'public' and n_live_tup > 0 order by pg_total_relation_size(relid) desc limit 12"
q -c "select 'base|' || pg_size_pretty(pg_database_size(current_database()))"
q -c "select 'huella|' || capgen.fingerprint(capgen.id('pruva:1:store'))"
q -v idx=1 -v n="$N" -f scripts/capacity/t03-queries.sql | grep -v '^$'
