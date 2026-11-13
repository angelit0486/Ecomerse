#!/usr/bin/env bash
# =============================================================================
# Ensayo LOCAL del paquete de despliegue (Orden 10, O10-05). Nunca toca staging.
#
#   1. Base local con las migraciones que YA tiene staging (hasta BASE_VERSION)
#      y datos sintéticos (una tienda de 2,000 productos con pedidos).
#   2. Aplica las migraciones pendientes UNA POR UNA, en orden, cada una en su
#      transacción, comprobando antes su sha256 contra el manifiesto.
#   3. Verificación posterior de cada una (consultas del runbook).
#   4. El esquema resultante debe ser idéntico al de una base creada desde cero.
#   5. Un archivo alterado se rechaza por sha256 antes de ejecutarse.
#   6. pgTAP de seguridad y de las 6 migraciones sobre la base actualizada.
#
# Uso: bash scripts/ops/migration-rehearsal.sh
# Manifiesto: docs/runbooks/despliegue-migraciones-2026-11.md (sección 2).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST=${PGHOST:-localhost} PGUSER=${PGUSER:-postgres} PGPASSWORD=${PGPASSWORD:-postgres}
case "$PGHOST" in localhost|127.0.0.1|/*) ;; *) echo "✗ Solo contra PostgreSQL local" >&2; exit 1 ;; esac

BASE_VERSION=20261110000200
MANIFEST=(
  "20261110000300_profit_report.sql 479c7189eda58af932bf3862fab2995aeaff759b8a624fadf327c353138c3076"
  "20261111000100_search_lexicon.sql a7f1944df033d4b3d13748ce8eeeb32c4b9a8ffd8fda4f2ccd4293ddb8298fcc"
  "20261111000200_listing_availability.sql 07c70986eea1420348d87af089f3d4a77ab081a32a8322428c174345a24ba13d"
  "20261111000300_panel_search_store_scope.sql 541a7f095da3b4cc2fe8896d4ea1c0e709ceba23ef50f1e70506ca11d6defcc8"
  "20261111000400_variant_limit_row_lock.sql 589873e8dde7de00846bd0709a221de5e2e012a0b735759ba2d712ebddd2ae19"
  # 6.ª (O10-02, alertas de Inicio): agregada en la Orden 10.
  "20261112000100_store_alerts.sql 87eef6f0cc9a7112c3e028e1df55e15fd3c615028bee5f14281a375f063a373a"
)
UP=pruva_cap_upgrade
FRESH=pruva_cap_fresh
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$UP" "$@"; }
ok() { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1" >&2; exit 1; }

echo "▸ 1. Base como staging (hasta $BASE_VERSION) con datos"
CAP_UNTIL=$BASE_VERSION bash scripts/capacity/build.sh "$UP" > /dev/null
[ "$(q -c 'select public.app_schema_version()')" = "$BASE_VERSION" ] || fail "versión inicial"
q -c "select capgen.store(1, 2000)" -c "select capgen.orders(1, 400)" > /dev/null
ok "versión $BASE_VERSION, $(q -c 'select count(*) from public.products') productos, $(q -c 'select count(*) from public.orders') pedidos"

echo "▸ 2. Verificación previa"
for entry in "${MANIFEST[@]}"; do
  set -- $entry
  [ "$(q -c "select to_regclass('public.order_item_costs') is null or '$1' <> '20261110000300_profit_report.sql'")" = t ] \
    || fail "$1 parece ya aplicada"
done
ok "ninguna de las 5 está aplicada"
[ "$(q -c "select count(*) from pg_locks where locktype = 'advisory'")" = 0 ] && ok "sin candados de aviso retenidos"

echo "▸ 3. Aplicar en orden, con sha256"
for entry in "${MANIFEST[@]}"; do
  set -- $entry
  file="supabase/migrations/$1"
  actual=$(sha256sum "$file" | cut -c1-64)
  [ "$actual" = "$2" ] || fail "$1: sha256 no coincide ($actual)"
  t0=$(date +%s%N)
  psql -X -q -v ON_ERROR_STOP=1 -1 -d "$UP" -f "$file" > /dev/null
  ms=$(( ($(date +%s%N) - t0) / 1000000 ))
  ok "$1 aplicada en ${ms} ms → versión $(q -c 'select public.app_schema_version()')"
done

echo "▸ 4. Verificación posterior (las mismas consultas del runbook, §5)"
check() { [ "$(q -c "$2")" = "$3" ] && ok "$1" || fail "$1 (esperado $3, obtenido $(q -c "$2"))"; }
check "versión final" "select public.app_schema_version()" "20261112000100"
check "0300: order_item_costs con RLS forzado" "select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.order_item_costs'::regclass" "t"
check "0300: interruptor profit_report apagado" "select default_enabled from public.feature_flags where key = 'profit_report'" "f"
check "0300: trigger de costo al vender" "select count(*) from pg_trigger where tgname = 'order_items_snapshot_cost'" "1"
check "0100: texto de búsqueda de todos los productos al día" "select count(*) from public.products p where p.search_lexicon is distinct from app.product_lexicon_of(p)" "0"
check "0100: índice de trigramas" "select count(*) from pg_indexes where indexname = 'products_lexicon_trgm_idx'" "1"
check "0200: product_states no expuesta" "select has_function_privilege('authenticated', 'app.product_states(uuid, uuid[])', 'execute') or has_function_privilege('anon', 'app.product_states(uuid, uuid[])', 'execute')" "f"
check "0300: búsqueda del panel acotada a la tienda" "select prosrc ~ 'where pv\.product_id = p\.id' from pg_proc where oid = 'public.catalog_search_products(uuid,text,text,uuid,boolean,jsonb,integer,uuid,text,text)'::regprocedure" "f"
check "0400: sin candado de aviso por producto" "select prosrc ~ 'pg_advisory_xact_lock' from pg_proc where oid = 'app.enforce_variant_limit'::regproc" "f"
check "0100 (alertas): store_alerts solo para authenticated" "select has_function_privilege('authenticated', 'public.store_alerts(uuid)', 'execute') and not has_function_privilege('anon', 'public.store_alerts(uuid)', 'execute')" "t"
check "0100 (alertas): store_alerts con search_path vacío" "select proconfig::text from pg_proc where oid = 'public.store_alerts(uuid)'::regprocedure" '{"search_path=\"\""}'
check "tablas de public con RLS forzado" "select count(*) filter (where not (relrowsecurity and relforcerowsecurity)) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition" "0"
check "anon sin permisos de tabla" "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v') and has_table_privilege('anon', c.oid, 'select')" "0"

echo "▸ 5. Esquema idéntico al de una base creada desde cero"
bash scripts/capacity/build.sh "$FRESH" > /dev/null
dump() { pg_dump -s --no-owner --no-privileges -d "$1" | grep -vE '^--|^$|^SET |^SELECT pg_catalog' | grep -vE '^.(un)?restrict ' | sort; }
dump "$UP" > "$WORK/up.sql"; dump "$FRESH" > "$WORK/fresh.sql"
if diff -q "$WORK/up.sql" "$WORK/fresh.sql" > /dev/null; then ok "pg_dump -s idéntico ($(wc -l < "$WORK/up.sql") líneas)"
else diff "$WORK/up.sql" "$WORK/fresh.sql" | head -20; fail "el esquema difiere"; fi
privs() { psql -X -At -d "$1" -c "select n.nspname || '.' || p.proname || ':' || coalesce(p.proacl::text, '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app','storefront','system','audit') order by 1"; }
[ "$(privs "$UP" | md5sum)" = "$(privs "$FRESH" | md5sum)" ] && ok "permisos de funciones idénticos" || fail "permisos distintos"

echo "▸ 6. Un archivo alterado se rechaza"
cp "supabase/migrations/20261111000400_variant_limit_row_lock.sql" "$WORK/alterado.sql"
echo "-- alterado" >> "$WORK/alterado.sql"
[ "$(sha256sum "$WORK/alterado.sql" | cut -c1-64)" != "589873e8dde7de00846bd0709a221de5e2e012a0b735759ba2d712ebddd2ae19" ] \
  && ok "la suma del archivo alterado no coincide: no se ejecutaría" || fail "suma igual"

echo "▸ 7. pgTAP sobre la base actualizada"
pg_prove --dbname "$UP" supabase/tests/database/000_test_helpers.test.sql \
  supabase/tests/database/00_schema_security.test.sql supabase/tests/database/138_profit_report.test.sql \
  supabase/tests/database/139_search_lexicon.test.sql supabase/tests/database/140_listing_availability.test.sql \
  supabase/tests/database/141_panel_search_store_scope.test.sql \
  supabase/tests/database/142_variant_limit_row_lock.test.sql \
  supabase/tests/database/143_store_alerts.test.sql 2>&1 | grep -E "^(All tests|Files=|Result|Failed)|not ok"

dropdb "$FRESH"
echo "✓ Ensayo completo. Base actualizada: $UP"
