#!/usr/bin/env bash
# RM-10 (Orden 09): cuánto tarda la cola en procesar las fotos. SOLO LOCAL.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST=${PGHOST:-localhost} PGPORT=${PGPORT:-5432} PGUSER=${PGUSER:-postgres} PGPASSWORD=${PGPASSWORD:-postgres}
DB=pruva_cap_media
bash scripts/capacity/build.sh "$DB"
export TEST_ADMIN_DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}"
export TEST_WORKER_DATABASE_URL="postgres://system_worker:system_worker_dev_password@${PGHOST}:${PGPORT}/${DB}"
pnpm exec vitest run --project capacity tests/capacity/media-throughput.test.ts --reporter=verbose
