#!/usr/bin/env bash
# Tiempos de las consultas del panel como la dueña (RLS activo), segunda corrida.
set -euo pipefail
cd "$(dirname "$0")"
OUT=$(mktemp -d)
for i in 1 2; do
  PGPASSWORD=${PGPASSWORD:-postgres} psql -X -A -t -h localhost -U postgres -d pruva_bench -f queries.sql > "$OUT/$i.txt" 2>&1
done
# Tras cada etiqueta, el primer «Time» es el de la etiqueta y el segundo el de la consulta.
awk '/^== /{label=$0; skip=1; next} /^Time:/{ if (label!="") { if (skip) {skip=0} else {print label ": " $2 " ms"; label=""} } } /ERROR/{print "ERROR: " $0}' "$OUT/2.txt"
