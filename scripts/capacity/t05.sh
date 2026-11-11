#!/usr/bin/env bash
# T05: diez tiendas desiguales (una grande, nueve chicas) trabajando a la vez.
# Uso: bash scripts/capacity/t05.sh [productos de la grande=10000] [segundos por fase=20]
set -euo pipefail
cd "$(dirname "$0")/../.."
N=${1:-10000}; SECS=${2:-20}; DB=pruva_cap_t05
export PGHOST=${PGHOST:-localhost} PGUSER=${PGUSER:-postgres} PGPASSWORD=${PGPASSWORD:-postgres}
bash scripts/capacity/build.sh "$DB"
q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
q -c "select capgen.store(1, $N)" -c "select capgen.orders(1, $((N / 5)))" > /dev/null
q -c "select count(capgen.store(g, 200)) from generate_series(2, 10) g" -c "select count(capgen.orders(g, 60)) from generate_series(2, 10) g" > /dev/null
q -c "vacuum analyze"
node scripts/capacity/t05.mjs "$DB" "$SECS"
