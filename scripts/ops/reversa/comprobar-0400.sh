#!/usr/bin/env bash
# =============================================================================
# Comprueba la reversa de la migración 0400, SOLO en PostgreSQL local:
#   1. La app compatible con 0300 (a730989) espera 20261113000300 y no usa nada
#      de 0400; la app actual sí lo usa (por eso no sirve sobre 0300).
#   2. El candado de la reversa rechaza, sin cambiar nada, cada caso de trabajo
#      en curso: parte aplicándose, lote detenido a medias por la app vieja,
#      publicación en curso.
#   3. La conciliación documentada (app.import_batch_advance) destraba el lote.
#   4. Con la base drenada la reversa corre, cancela las partes sin aplicar y deja
#      el esquema idéntico (pg_dump -s) al de una base hasta 20261113000300.
#   5. Correrla otra vez, o sobre otra versión, se rechaza.
#   6. La sentencia que la app actual ejecuta en cada importación falla sobre 0300.
# Prueba el esquema y las condiciones; no recupera los datos que la reversa borra.
# Uso: bash scripts/ops/reversa/comprobar-0400.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PGHOST=${PGHOST:-localhost} PGUSER=${PGUSER:-postgres} PGPASSWORD=${PGPASSWORD:-postgres}
case "$PGHOST" in localhost|127.0.0.1|/*) ;; *) echo "✗ Solo contra PostgreSQL local" >&2; exit 1 ;; esac
REV=scripts/ops/reversa/20261113000400_import_batches.reversa.sql
OLD_APP=a730989
A=pruva_rev_hasta_0300; B=pruva_rev_con_reversa
WORK=$(mktemp -d); trap 'rm -rf "$WORK"; dropdb --if-exists "$A" 2>/dev/null; dropdb --if-exists "$B" 2>/dev/null' EXIT
p() { psql -X -q -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }
q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$B" -c "$1"; }
fail() { echo "✗ $*" >&2; exit 1; }

# --- 1. Compatibilidad de la app (git, sin red) -------------------------------
git cat-file -e "$OLD_APP^{commit}" 2>/dev/null || fail "No está el commit $OLD_APP (¿clon superficial?)"
git show "$OLD_APP:src/server/db/schema-version.ts" | grep -q 'EXPECTED_SCHEMA_VERSION = "20261113000300"' \
  || fail "$OLD_APP no espera 20261113000300"
OBJS=(import_batches import_batch_after_part imports_batch_create imports_create_part imports_batch_commit
      imports_batch_cancel imports_batch_new_categories imports_batch_accept_categories resume_stuck_publish_runs
      batch_id part_number part_fingerprint resumes)
for o in "${OBJS[@]}"; do
  if git grep -q -w -e "$o" "$OLD_APP" -- src; then fail "$OLD_APP usa $o (objeto de 0400)"; fi
done
git grep -q -w -e import_batch_after_part HEAD -- src/server/imports/handlers.ts \
  || fail "Se esperaba que la app actual llame a import_batch_after_part"
echo "✓ App: $OLD_APP espera 20261113000300 y no usa ninguno de los ${#OBJS[@]} objetos de 0400; la actual sí los usa"

# --- Bases: A hasta 0300; B con las 10 migraciones ----------------------------
for db in "$A" "$B"; do
  dropdb --if-exists "$db"; createdb "$db"
  for f in scripts/db/supabase-shim.sql scripts/db/supabase-shim-auth.sql scripts/db/supabase-shim-storage.sql scripts/db/supabase-shim-storage-grants.sql; do p "$db" -f "$f" > /dev/null; done
done
for f in supabase/migrations/*.sql; do
  case "$f" in *20261113000400_*) ;; *) p "$A" -1 -f "$f" > /dev/null ;; esac
  p "$B" -1 -f "$f" > /dev/null
done

# Datos sintéticos: una tienda, un lote de 1 parte aplicándose (con su trabajo),
# un lote detenido con una parte validada sin aplicar y una publicación en cola.
p "$B" > /dev/null <<'SQL'
insert into public.plans (key, name) values ('rev_plan', 'rev_plan') on conflict (key) do nothing;
insert into public.plan_entitlements (plan_id, key, value_int)
  select id, k, 10 from public.plans, unnest(array['max_stores', 'max_staff', 'max_products']) k where key = 'rev_plan'
  on conflict (plan_id, key) do nothing;
insert into public.organizations (id, name, slug, country)
  values ('00000000-0000-7000-8000-00000000a001', 'Reversa', 'org-reversa', 'MX');
insert into public.subscriptions (organization_id, plan_id, status)
  select '00000000-0000-7000-8000-00000000a001', id, 'active' from public.plans where key = 'rev_plan';
insert into public.stores (id, organization_id, name, handle, currency, country, timezone)
  values ('00000000-0000-7000-8000-00000000a002', '00000000-0000-7000-8000-00000000a001', 'Reversa', 'reversa',
          'MXN', 'MX', 'America/Mexico_City');
insert into auth.users (id, email) values ('00000000-0000-7000-8000-00000000a003', 'owner@reversa.test');
insert into public.organization_members (organization_id, user_id, role)
  values ('00000000-0000-7000-8000-00000000a001', '00000000-0000-7000-8000-00000000a003', 'org_owner');
insert into public.import_batches (id, store_id, file_name, mode, total_rows, parts_count, part_rows,
                                   part_fingerprints, file_fingerprint, status, requested_by, commit_requested_by)
values ('00000000-0000-7000-8000-00000000b001', '00000000-0000-7000-8000-00000000a002', 'uno.csv', 'create_only',
        1, 1, '{1}', array[repeat('a', 64)], repeat('a', 64), 'running',
        '00000000-0000-7000-8000-00000000a003', '00000000-0000-7000-8000-00000000a003'),
       ('00000000-0000-7000-8000-00000000b002', '00000000-0000-7000-8000-00000000a002', 'dos.csv', 'create_only',
        1, 1, '{1}', array[repeat('b', 64)], repeat('b', 64), 'stopped',
        '00000000-0000-7000-8000-00000000a003', '00000000-0000-7000-8000-00000000a003');
insert into public.import_jobs (id, store_id, type, mode, status, file_name, requested_by, commit_requested_by,
                                commit_requested_at, columns, needs, totals, batch_id, part_number, part_fingerprint)
values ('00000000-0000-7000-8000-00000000c001', '00000000-0000-7000-8000-00000000a002', 'products', 'create_only',
        'committing', 'uno.csv', '00000000-0000-7000-8000-00000000a003', '00000000-0000-7000-8000-00000000a003', now(),
        array['handle', 'title'], array['imports.run'], '{"rows": 1, "errors": 0}',
        '00000000-0000-7000-8000-00000000b001', 1, repeat('a', 64)),
       ('00000000-0000-7000-8000-00000000c002', '00000000-0000-7000-8000-00000000a002', 'products', 'create_only',
        'validated', 'dos.csv', '00000000-0000-7000-8000-00000000a003', null, null,
        array['handle', 'title'], array['imports.run'], '{"rows": 1, "errors": 0}',
        '00000000-0000-7000-8000-00000000b002', 1, repeat('b', 64));
select app.enqueue_job('import.commit', '{"import_job_id": "00000000-0000-7000-8000-00000000c001"}',
                       '00000000-0000-7000-8000-00000000a002', 'import.commit:00000000-0000-7000-8000-00000000c001',
                       now(), 3);
insert into public.publish_runs (id, store_id, import_job_id, requested_by, status)
  values ('00000000-0000-7000-8000-00000000d001', '00000000-0000-7000-8000-00000000a002',
          '00000000-0000-7000-8000-00000000c002', '00000000-0000-7000-8000-00000000a003', 'queued');
select app.enqueue_job('catalog.publish_run', '{"run_id": "00000000-0000-7000-8000-00000000d001"}',
                       '00000000-0000-7000-8000-00000000a002', 'catalog.publish_run:00000000-0000-7000-8000-00000000d001',
                       now(), 5);
SQL

# Corre la reversa como lo indica el runbook; debe rechazarse con cada motivo y
# dejar la base intacta (versión 0400, tabla de lotes, datos sin tocar).
fingerprint() { q "select md5(string_agg(t, '|' order by t)) from (
  select format('%s:%s:%s', id, status, batch_id) t from public.import_jobs
  union all select format('%s:%s', id, status) from public.import_batches
  union all select format('%s:%s', id, status) from public.publish_runs
  union all select format('%s:%s', id, status) from system.jobs) s"; }
expect_blocked() {
  local label=$1; shift
  local before; before=$(fingerprint)
  local out
  if out=$(psql -X -q -1 -v ON_ERROR_STOP=1 -d "$B" -f "$REV" 2>&1); then fail "$label: la reversa corrió"; fi
  grep -q 'reversa_bloqueada' <<<"$out" || { echo "$out" >&2; fail "$label: falló por otra causa"; }
  for want in "$@"; do grep -q -- "$want" <<<"$out" || { echo "$out" >&2; fail "$label: falta el motivo «$want»"; }; done
  [ "$(q 'select public.app_schema_version()')" = 20261113000400 ] || fail "$label: cambió la versión"
  [ -n "$(q "select to_regclass('public.import_batches')")" ] || fail "$label: borró import_batches"
  [ "$(fingerprint)" = "$before" ] || fail "$label: cambió datos"
  echo "✓ Candado: $label → rechazada sin cambios"
}

# --- 2. El candado -------------------------------------------------------------
expect_blocked "parte aplicándose con su trabajo en cola" \
  "1 lote(s) aplicándose" "1 parte(s) de lote validándose o aplicándose" \
  "1 trabajo(s) import.commit de partes" "1 publicación(es) en curso" "1 trabajo(s) catalog.publish_run"

# La publicación termina (drenada con la app 0400).
q "update public.publish_runs set status = 'completed' where id = '00000000-0000-7000-8000-00000000d001';
   update system.jobs set status = 'succeeded', finished_at = now() where type = 'catalog.publish_run'" > /dev/null
# La app vieja (a730989) aplica la parte, pero no avanza el lote: queda «running».
q "update public.import_jobs set status = 'completed' where id = '00000000-0000-7000-8000-00000000c001';
   update system.jobs set status = 'succeeded', finished_at = now() where type = 'import.commit'" > /dev/null
expect_blocked "lote a medias tras aplicar una parte con la app vieja" "1 lote(s) aplicándose"

# --- 3. Conciliación documentada (runbook §9.4) -------------------------------
[ "$(q "select app.import_batch_advance('00000000-0000-7000-8000-00000000b001')")" = completed ] \
  || fail "La conciliación no completó el lote"
echo "✓ Conciliación: app.import_batch_advance completa el lote cuya única parte ya estaba aplicada"

# --- 4. Reversa con la base drenada -------------------------------------------
psql -X -q -1 -v ON_ERROR_STOP=1 -d "$B" -f "$REV" > /dev/null
[ "$(q 'select public.app_schema_version()')" = 20261113000300 ] || fail "La versión no quedó en 0300"
[ "$(q "select status from public.import_jobs where id = '00000000-0000-7000-8000-00000000c002'")" = cancelled ] \
  || fail "La parte validada sin aplicar no quedó cancelada"
[ "$(q "select status from public.import_jobs where id = '00000000-0000-7000-8000-00000000c001'")" = completed ] \
  || fail "La parte aplicada cambió de estado"
echo "✓ Reversa drenada: versión 20261113000300; parte sin aplicar cancelada; la aplicada sigue aplicada"

dump() { pg_dump -s --no-owner -d "$1" | grep -vE '^--|^$|^\\(un)?restrict ' | sort; }
dump "$A" > "$WORK/a.sql"; dump "$B" > "$WORK/b.sql"
if diff -q "$WORK/a.sql" "$WORK/b.sql" > /dev/null; then
  echo "✓ Tras la reversa, el esquema es idéntico al de 20261113000300 ($(wc -l < "$WORK/a.sql") líneas, con permisos)"
else
  diff "$WORK/a.sql" "$WORK/b.sql" | head -30; fail "El esquema difiere"
fi

# --- 5. Repetirla se rechaza ---------------------------------------------------
out=$(psql -X -q -1 -v ON_ERROR_STOP=1 -d "$B" -f "$REV" 2>&1) && fail "La reversa corrió dos veces"
grep -q 'La base está en 20261113000300' <<<"$out" || { echo "$out" >&2; fail "Segunda corrida: motivo inesperado"; }
echo "✓ Candado: segunda corrida sobre 0300 → rechazada"

# --- 6. La app actual no sirve sobre 0300 --------------------------------------
out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$B" -c "select system.import_batch_after_part(gen_random_uuid())" 2>&1) \
  && fail "import_batch_after_part sigue existiendo"
grep -q 'does not exist' <<<"$out" || { echo "$out" >&2; fail "Error inesperado"; }
echo "✓ Sobre 0300 falla system.import_batch_after_part, que la app actual ejecuta en cada importación"
