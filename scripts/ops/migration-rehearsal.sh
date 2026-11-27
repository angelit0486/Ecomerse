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
#   6. pgTAP de seguridad y de las 11 migraciones sobre la base actualizada.
#
# Orden 10, mensaje 4 (D7): de 6 a 10 migraciones (las 4 de 20261113).
# 2026-11-17 (PR #12): de 10 a 11 (20261116000100, Inicio como centro de control).
#   6. pgTAP de seguridad y de las migraciones del manifiesto sobre la base actualizada.
# 2026-11-17 (issue #18): + 20261117000100 (importación más rápida).
# 2026-11-17 (issue #18, ADR-067): + 20261117000200 (partes de 2,500 filas, hasta 20).
# 2026-11-17 (auditoría de autorización, hallazgo 1): + 20261117000300 (límite del 2FA).
# 2026-11-17 (retiro en tienda en el correo): + 20261117000400 (anexo F).
# 2026-11-17 (issue #18): + 20261117000500 (cuota de arranque, ADR-068).
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
  # 7.ª a 10.ª (Orden 10, mensaje 4): fotos con límites persistentes, categorías
  # al importar (ADR-065), publicación por candidatos e importación por partes (ADR-064).
  "20261113000100_photo_checks_and_alerts_flag.sql f3b4b5d2e6a452609afc1bea7bae3017996aa5b95addf5afa2b1c486b48be9d8"
  "20261113000200_import_new_categories.sql 31b44ed75cea0d1bfba1a998e201d0967e5d79aacdde9a019e84dd1b9d4f9579"
  "20261113000300_publish_runs.sql 8c8fc176daf8ff7e3685847a23dc44d0e8a32affb51ed3723defe5c3901022de"
  "20261113000400_import_batches.sql 3f0eb416a75d8ca5d0c70c153ff868c38cd6bdae950838212b3c713303fe55a5"
  # 11.ª (PR #12): Inicio como centro de control (2 lecturas y un índice).
  "20261116000100_home_control_center.sql 8f13e8fbc5efb3be6d611ab4d5a4d0716e4e958d5a39f4a45ca3c46e7fee2258"
  # Issue #18: aplicar una importación más rápido (sin tablas ni datos nuevos).
  "20261117000100_import_commit_speed.sql 909acaf5f2c6242c0890974f35eab6a550a6193d6bbe3b1e8de33469cdf21926"
  "20261117000200_import_parts_2500.sql 7079f730ea139f192816c7d0a6b3a80096ac139e6503a7a62509f653f824f6d9"
  # Auditoría de autorización 2026-11-17, hallazgo 1: límite de intentos del 2FA (sin tablas nuevas).
  "20261117000300_staff_mfa_attempts.sql 423e0f549af7faf6c5562e91ce1838431b6d5e7853dd6b35d722e3ae7f4f2c75"
  # 2026-11-17: retiro en tienda en los correos del pedido (solo reemplaza una función).
  "20261117000400_order_email_pickup.sql 2248f9ee81a5da34d1e2c395c32ffbd55a9726867d2a889a6bb293a0a520ce28"
  # Issue #18 (ADR-068, precios aprobados): cuota única de arranque por plan.
  "20261117000500_plan_setup_fee.sql 8a63f47013e4d9120f8d3078b9b1ef18c60cad1d1ebd2d7181e9b11a00b9e8d3"
  # Integración del issue #18 (D-INT-02): transferencia aparta 24 horas (solo redefine place_order).
  "20261117000600_manual_payment_hold.sql 094f824cc2e3a066a27dd056524035c67f1952ade194dee042d08e41f1bc9cbc"
  # D-INT-04: ficha del pedido por WhatsApp al confirmar (solo agrega la bandera, apagada).
  "20261119000100_order_whatsapp_handoff_flag.sql 08e17f7d0a79485d5d46aa3bd3a4f4ec5484f39dd9bb0eb5d19c804448f1e895"
  # Consola «Mis clientes»: una lectura por tienda para el semáforo (solo una función nueva).
  "20261126000100_platform_store_overview.sql 1a6a1624cea9cff498ffdc7392272c56481dd000bcc35c73da861b4a1b538981"
  # Visitantes de la tienda: conteo diario sin cookies (tabla nueva con RLS forzado).
  "20261126000200_store_visits.sql 2977e3d73204595e84d9026f901e53f0115e56de7a3674555fc0effa75b458a1"
  # «Mis clientes» más rápido: la misma función, agregada por tabla (sin tablas nuevas).
  "20261127000100_platform_overview_set_based.sql c518e220726a6901e8e2b8b690d60b140475441deb0eefcc31b6035be352a99b"
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
# Las dos tiendas de prueba de la ventana (runbook §11.5), como se crearían desde la Consola.
q > /dev/null <<'SQL'
insert into public.plans (key, name) values ('ventana_qa', 'ventana_qa') on conflict (key) do nothing;
insert into public.plan_entitlements (plan_id, key, value_int)
  select id, k, 10 from public.plans, unnest(array['max_stores', 'max_staff', 'max_products']) k where key = 'ventana_qa'
  on conflict (plan_id, key) do nothing;
insert into public.organizations (name, slug, country)
values ('Ventana QA a', 'org-pruva-ventana-a', 'MX'), ('Ventana QA b', 'org-pruva-ventana-b', 'MX');
insert into public.subscriptions (organization_id, plan_id, status)
select o.id, p.id, 'active' from public.organizations o, public.plans p
 where o.slug like 'org-pruva-ventana-%' and p.key = 'ventana_qa';
insert into public.stores (organization_id, name, handle, currency, country, timezone)
select o.id, 'Ventana QA', replace(o.slug, 'org-', ''), 'MXN', 'MX', 'America/Mexico_City'
  from public.organizations o where o.slug like 'org-pruva-ventana-%';
insert into auth.users (id, email)
select gen_random_uuid(), replace(o.slug, 'org-', '') || '@ventana.test'
  from public.organizations o where o.slug like 'org-pruva-ventana-%';
insert into public.organization_members (organization_id, user_id, role)
select o.id, u.id, 'org_owner' from public.organizations o
  join auth.users u on u.email = replace(o.slug, 'org-', '') || '@ventana.test'
 where o.slug like 'org-pruva-ventana-%';
SQL
ok "tiendas de prueba pruva-ventana-a y pruva-ventana-b"

echo "▸ 2. Verificación previa"
for entry in "${MANIFEST[@]}"; do
  set -- $entry
  [ "$(q -c "select to_regclass('public.order_item_costs') is null or '$1' <> '20261110000300_profit_report.sql'")" = t ] \
    || fail "$1 parece ya aplicada"
done
ok "ninguna de las ${#MANIFEST[@]} está aplicada"
[ "$(q -c "select count(*) from pg_locks where locktype = 'advisory'")" = 0 ] && ok "sin candados de aviso retenidos"
# Orden 10, mensaje 5 (A2): las mismas comprobaciones que se correrán en staging.
ventana() {
  local out; out=$(psql -X -q -At -F '|' -v ON_ERROR_STOP=1 -d "$UP" -f "scripts/ops/ventana/$1")
  if echo "$out" | awk -F'|' '$4 != "t"' | grep -q .; then echo "$out" | awk -F'|' '$4 != "t"' >&2; fail "$1 con filas en falso"; fi
  ok "$1: $(echo "$out" | wc -l) comprobaciones en verde"
}
ventana 01-antes.sql

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
check "versión final" "select public.app_schema_version()" "20261127000100"
check "1117-0600 (transferencia): place_order aparta 24 horas con pago manual" "select prosrc ~ 'when v_provider = ''manual'' then 24 \* 60' from pg_proc where oid = 'storefront.place_order(uuid, text, jsonb, bigint, text, bytea)'::regprocedure" "t"
check "1117-0600 (transferencia): place_order sigue solo para storefront_gateway" "select has_function_privilege('storefront_gateway', 'storefront.place_order(uuid, text, jsonb, bigint, text, bytea)', 'execute') and not has_function_privilege('anon', 'storefront.place_order(uuid, text, jsonb, bigint, text, bytea)', 'execute') and not has_function_privilege('authenticated', 'storefront.place_order(uuid, text, jsonb, bigint, text, bytea)', 'execute')" "t"
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
check "0100 (fotos): import_photo_checks con RLS forzado" "select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.import_photo_checks'::regclass" "t"
check "0100 (fotos): revisar enlaces solo para authenticated" "select has_function_privilege('authenticated', 'public.imports_photo_check_begin(uuid, uuid, boolean)', 'execute') and not has_function_privilege('anon', 'public.imports_photo_check_begin(uuid, uuid, boolean)', 'execute')" "t"
check "0100 (fotos): la limpieza de retención borra las revisiones vencidas" "select prosrc ~ 'import_photo_checks' from pg_proc where oid = 'system.purge_retention(integer)'::regprocedure" "t"
check "0100 (D6): store_alerts respeta el interruptor en la base" "select prosrc ~ 'flag_enabled' from pg_proc where oid = 'public.store_alerts(uuid)'::regprocedure" "t"
check "0200 (ADR-065): columna new_categories" "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'import_jobs' and column_name = 'new_categories'" "1"
check "0200 (ADR-065): crear categorías no expuesto" "select has_function_privilege('authenticated', 'app.import_ensure_category(uuid, text)', 'execute')" "f"
check "0300 (publicación): tablas con RLS forzado" "select count(*) from pg_class where oid in ('public.publish_runs'::regclass, 'public.publish_run_items'::regclass) and relrowsecurity and relforcerowsecurity" "2"
check "0300 (publicación): el paso solo para system_worker" "select has_function_privilege('system_worker', 'system.publish_run_step(uuid, integer)', 'execute') and not has_function_privilege('authenticated', 'system.publish_run_step(uuid, integer)', 'execute')" "t"
check "0400 (ADR-064): import_batches con RLS forzado" "select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.import_batches'::regclass" "t"
check "0400 (ADR-064): una importación viva por parte" "select count(*) from pg_indexes where indexname = 'import_jobs_batch_part_live_uq'" "1"
check "0400 (ADR-064): una parte no se aplica suelta" "select prosrc ~ 'batch_part' from pg_proc where oid = 'public.imports_commit(uuid, uuid, boolean)'::regprocedure" "t"
check "0400 (ADR-064): una parte atascada detiene su lote" "select prosrc ~ 'import_batch_after_part' from pg_proc where oid = 'system.fail_stuck_imports()'::regprocedure" "t"
check "0400: publicación sin trabajo se retoma" "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'publish_runs' and column_name = 'resumes'" "1"
check "0400: importaciones existentes intactas (ninguna queda en un lote)" "select count(*) from public.import_jobs where batch_id is not null" "0"
check "0100 (Inicio): índice de carritos recuperables" "select count(*) from pg_indexes where indexname = 'carts_store_recoverable_idx'" "1"
check "0100 (Inicio): lecturas solo para authenticated" "select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')) from unnest(array['public.dashboard_recoverable_carts(uuid)', 'public.dashboard_customer_mix(uuid, date, date)']::regprocedure[]) f" "t"
check "0100 (Inicio): security definer con search_path vacío" "select count(*) from pg_proc where oid in ('public.dashboard_recoverable_carts(uuid)'::regprocedure, 'public.dashboard_customer_mix(uuid, date, date)'::regprocedure) and prosecdef and proconfig = array['search_path=\"\"']" "2"
check "1117 (importación): products_derive deja el texto de búsqueda solo con la marca de su txid" "select prosrc ~ 'import_defer_search' and prosrc ~ 'txid_current' from pg_proc where oid = 'app.products_derive()'::regprocedure" "t"
check "1117 (importación): import_commit recalcula el texto al final y apaga la marca" "select prosrc ~ 'v_touched' and prosrc ~ 'import_defer_search' from pg_proc where oid = 'system.import_commit(uuid)'::regprocedure" "t"
check "1117 (importación): import_commit solo para system_worker" "select has_function_privilege('system_worker', 'system.import_commit(uuid)', 'execute') and not has_function_privilege('authenticated', 'system.import_commit(uuid)', 'execute') and not has_function_privilege('anon', 'system.import_commit(uuid)', 'execute')" "t"
check "1117 (ADR-067): lotes de hasta 20 partes" "select pg_get_constraintdef(oid) ~ 'parts_count <= 20' from pg_constraint where conname = 'import_batches_parts_count_check'" "t"
check "1117 (ADR-067): parte número hasta 20" "select pg_get_constraintdef(oid) ~ 'part_number <= 20' from pg_constraint where conname = 'import_jobs_part_number_check'" "t"
check "1117 (ADR-067): imports_batch_create topa en 20 partes de 2,500 filas" "select prosrc ~ 'between 1 and 20' and prosrc ~ 'between 1 and 2500' from pg_proc where oid = 'public.imports_batch_create(uuid,text,text,integer[],text[],text)'::regprocedure" "t"
check "1117 (2FA): take_staff_mfa_attempt solo para system_worker" "select has_function_privilege('system_worker', 'system.take_staff_mfa_attempt(uuid, uuid, text)', 'execute') and not has_function_privilege('authenticated', 'system.take_staff_mfa_attempt(uuid, uuid, text)', 'execute') and not has_function_privilege('anon', 'system.take_staff_mfa_attempt(uuid, uuid, text)', 'execute')" "t"
check "1117 (2FA): take_staff_mfa_attempt SECURITY DEFINER con search_path vacío" "select prosecdef::text || proconfig::text from pg_proc where oid = 'system.take_staff_mfa_attempt(uuid, uuid, text)'::regprocedure" 'true{"search_path=\"\""}'
check "1117 (2FA): límites por IP, usuario y factor" "select prosrc ~ 'staff_mfa:ip:' and prosrc ~ 'staff_mfa:user:' and prosrc ~ 'staff_mfa:factor:' from pg_proc where oid = 'system.take_staff_mfa_attempt(uuid, uuid, text)'::regprocedure" "t"
check "1117 (retiro): order_notification solo para system_worker" "select has_function_privilege('system_worker', 'system.order_notification(uuid,uuid,uuid)', 'execute') and not has_function_privilege('authenticated', 'system.order_notification(uuid,uuid,uuid)', 'execute') and not has_function_privilege('anon', 'system.order_notification(uuid,uuid,uuid)', 'execute')" "t"
check "1117 (retiro): order_notification SECURITY DEFINER con search_path vacío" "select prosecdef::text || proconfig::text from pg_proc where oid = 'system.order_notification(uuid,uuid,uuid)'::regprocedure" 'true{"search_path=\"\""}'
check "1117 (retiro): el correo lleva tipo de envío y dónde recoger" "select prosrc ~ 'shipping_type' and prosrc ~ '''pickup''' and prosrc ~ 'contact' from pg_proc where oid = 'system.order_notification(uuid,uuid,uuid)'::regprocedure" "t"
check "1117 (arranque): ningún plan queda con cuota ni organización saldada" "select (select count(*) from public.plans where setup_fee is not null) + (select count(*) from public.organizations where setup_fee_settled_at is not null)" "0"
check "1117 (arranque): precios de 4 y de 5 argumentos" "select count(*) from pg_proc where proname = 'platform_set_plan_pricing' and pronamespace = 'public'::regnamespace" "2"
check "1117 (arranque): marcar la cuota solo con sesión (no anon)" "select has_function_privilege('authenticated', 'public.platform_set_setup_fee_settled(uuid, boolean, text)', 'execute') and not has_function_privilege('anon', 'public.platform_set_setup_fee_settled(uuid, boolean, text)', 'execute') and not has_function_privilege('authenticated', 'app.org_setup_fee_due(uuid)', 'execute')" "t"
ventana 02-despues.sql
# H4-B (mensaje 7): aislamiento entre las dos tiendas de prueba; escribe y revierte.
ventana 04-aislamiento.sql
check "04-aislamiento no dejó datos" "select count(*) from public.import_batches b join public.stores s on s.id = b.store_id where s.handle like 'pruva-ventana-%'" "0"
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
  supabase/tests/database/143_store_alerts.test.sql \
  supabase/tests/database/118_keys_and_fk_indexes.test.sql supabase/tests/database/42_imports.test.sql \
  supabase/tests/database/144_photo_checks.test.sql supabase/tests/database/145_import_new_categories.test.sql \
  supabase/tests/database/146_publish_runs.test.sql supabase/tests/database/147_import_batches.test.sql \
  supabase/tests/database/148_home_control_center.test.sql \
  supabase/tests/database/149_import_commit_speed.test.sql \
  supabase/tests/database/150_import_parts_2500.test.sql \
  supabase/tests/database/151_staff_mfa_attempts.test.sql \
  supabase/tests/database/152_order_email_pickup.test.sql \
  supabase/tests/database/153_plan_setup_fee.test.sql \
  supabase/tests/database/154_manual_payment_hold.test.sql \
  2>&1 | grep -E "^(All tests|Files=|Result|Failed)|not ok"

dropdb "$FRESH"
echo "✓ Ensayo completo. Base actualizada: $UP"
