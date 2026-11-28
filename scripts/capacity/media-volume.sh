#!/usr/bin/env bash
# RM-10 (2026-11-28): 1,000 y 10,000 fotos por la cola real, en pasadas de 45 s. SOLO LOCAL.
# Tarda cerca de una hora. Criterios y resultados: docs/audit/RM-10-medicion-fotos.md
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST=${PGHOST:-localhost} PGPORT=${PGPORT:-5432} PGUSER=${PGUSER:-postgres} PGPASSWORD=${PGPASSWORD:-postgres}
DB=pruva_cap_media_volume
bash scripts/capacity/build.sh "$DB"
export TEST_ADMIN_DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}"
export TEST_WORKER_DATABASE_URL="postgres://system_worker:system_worker_dev_password@${PGHOST}:${PGPORT}/${DB}"
pnpm exec vitest run --project capacity tests/capacity/media-volume.test.ts --reporter=verbose
