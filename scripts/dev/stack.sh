#!/usr/bin/env bash
# =============================================================================
# SOLO DESARROLLO LOCAL. Stack tipo Supabase SIN Docker (spike S-6, decisión A-03):
#   PostgreSQL local (≥ 15) + Supabase Auth (GoTrue) + PostgREST + Mailpit
#   + una puerta de enlace Node que expone /auth/v1 y /rest/v1 en :54321.
#
#   bash scripts/dev/stack.sh install   # descarga binarios fijados y verifica sha256
#   bash scripts/dev/stack.sh up        # crea la base, migra y levanta servicios
#   bash scripts/dev/stack.sh down      # detiene servicios
#   bash scripts/dev/stack.sh reset     # down + borra la base + up
#   bash scripts/dev/stack.sh status
#   bash scripts/dev/stack.sh env       # variables para .env.local
#
# Variables: PGHOST, PGPORT, PGUSER, PGPASSWORD, DEV_DB_NAME, PRUVA_STACK_DIR,
#            STACK_EMAIL_HOOK_SECRET (opcional: Send Email Hook hacia la app).
# Todas las contraseñas y claves de aquí son públicas y solo valen en 127.0.0.1.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
DB="${DEV_DB_NAME:-pruva_dev}"

STACK_DIR="${PRUVA_STACK_DIR:-$ROOT/.stack}"
BIN="$STACK_DIR/bin"
RUN="$STACK_DIR/run"

GATEWAY_PORT=54321
AUTH_PORT=9999
REST_PORT=3001
SMTP_PORT=1025
STORAGE_PORT=5000
MAIL_UI_PORT=8025

AUTH_ADMIN_PASSWORD="supabase_auth_admin_dev_password"
AUTHENTICATOR_PASSWORD="authenticator_dev_password"
JWT_SECRET="$(node -e 'import("./scripts/dev/keys.mjs").then(m=>process.stdout.write(m.DEV_JWT_SECRET))')"

# Versiones fijadas (GitHub Releases) y sha256 verificados.
AUTH_VERSION="v2.197.0"
AUTH_URL="https://github.com/supabase/auth/releases/download/${AUTH_VERSION}/auth-${AUTH_VERSION}-x86.tar.gz"
AUTH_SHA="9daff5d1939c3142a1586e435e6e2a7a2f71534ec40ff1b196b59b83ad5678f3" # gitleaks:allow (sha256 público del release)
POSTGREST_VERSION="v13.0.8"
POSTGREST_URL="https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-linux-static-x86-64.tar.xz"
POSTGREST_SHA="eb4471a7b8112a54e103539f2348c4d7f1c5b9b390649700ad62836e9211e279" # gitleaks:allow (sha256 público del release)
MAILPIT_VERSION="v1.31.4"
MAILPIT_URL="https://github.com/axllent/mailpit/releases/download/${MAILPIT_VERSION}/mailpit-linux-amd64.tar.gz"
MAILPIT_SHA="30942c4605c2ca8b9f759b1bb4e3ab6a12bdfdf66e5c94644ec2c75ac41e88e7" # gitleaks:allow (sha256 público del release)
# Supabase Storage no publica binarios: se compila desde el tag (commit fijado) con Node 24.
NODE24_URL="https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz"
NODE24_SHA="fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6" # gitleaks:allow (sha256 público del release)
STORAGE_TAG="v1.79.33"
STORAGE_COMMIT="2379ad5493f06bcf3bb5f044b844e292b98df4a0" # gitleaks:allow (commit del tag)

log() { printf '▸ %s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }
psql_q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

fetch() { # url sha dest
  local url="$1" sha="$2" dest="$3"
  if [ ! -f "$dest" ]; then
    log "Descargando $(basename "$dest")"
    curl -fsSL --retry 3 -o "$dest.part" "$url"
    mv "$dest.part" "$dest"
  fi
  echo "$sha  $dest" | sha256sum -c --quiet - || { rm -f "$dest"; die "sha256 no coincide: $dest"; }
}

cmd_install() {
  [ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || die "Solo Linux x86_64 (en otros sistemas usa 'supabase start' con Docker)"
  mkdir -p "$BIN" "$STACK_DIR/downloads"
  local dl="$STACK_DIR/downloads"
  fetch "$AUTH_URL" "$AUTH_SHA" "$dl/auth.tar.gz"
  fetch "$POSTGREST_URL" "$POSTGREST_SHA" "$dl/postgrest.tar.xz"
  fetch "$MAILPIT_URL" "$MAILPIT_SHA" "$dl/mailpit.tar.gz"
  rm -rf "$BIN/auth-dist" && mkdir -p "$BIN/auth-dist"
  tar -xzf "$dl/auth.tar.gz" -C "$BIN/auth-dist"
  tar -xJf "$dl/postgrest.tar.xz" -C "$BIN"
  tar -xzf "$dl/mailpit.tar.gz" -C "$BIN" mailpit
  install_storage
  log "Binarios listos en $BIN"
}

install_storage() {
  local dl="$STACK_DIR/downloads"
  fetch "$NODE24_URL" "$NODE24_SHA" "$dl/node24.tar.xz"
  rm -rf "$BIN/node24" && mkdir -p "$BIN/node24"
  tar -xJf "$dl/node24.tar.xz" -C "$BIN/node24" --strip-components=1
  if [ ! -d "$BIN/storage/.git" ]; then
    rm -rf "$BIN/storage"
    git clone -q --depth 1 --branch "$STORAGE_TAG" https://github.com/supabase/storage "$BIN/storage"
  fi
  [ "$(git -C "$BIN/storage" rev-parse HEAD)" = "$STORAGE_COMMIT" ] || die "commit de Storage inesperado"
  log "Compilando Supabase Storage $STORAGE_TAG"
  (cd "$BIN/storage" && PATH="$BIN/node24/bin:$PATH" npm ci --no-audit --no-fund --ignore-scripts >/dev/null \
    && PATH="$BIN/node24/bin:$PATH" npm rebuild fs-xattr >/dev/null \
    && PATH="$BIN/node24/bin:$PATH" npm run build >/dev/null)
}

ensure_installed() {
  [ -x "$BIN/auth-dist/auth" ] && [ -x "$BIN/postgrest" ] && [ -x "$BIN/mailpit" ] || cmd_install
  [ -f "$BIN/storage/dist/start/server.js" ] && [ -x "$BIN/node24/bin/node" ] || install_storage
}

is_running() { [ -f "$RUN/$1.pid" ] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }

start() { # name, workdir, command...
  local name="$1" dir="$2"; shift 2
  if is_running "$name"; then log "$name ya está corriendo"; return; fi
  # Comando simple en segundo plano: $! es el proceso real y no hereda la tubería.
  (cd "$dir" || exit 1; nohup "$@" </dev/null >"$RUN/$name.log" 2>&1 & echo $! >"$RUN/$name.pid")
}

wait_http() { # name url
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null "$2" 2>/dev/null && return 0
    is_running "$1" || { tail -n 30 "$RUN/$1.log" >&2; die "$1 terminó al arrancar"; }
    sleep 0.5
  done
  tail -n 30 "$RUN/$1.log" >&2
  die "$1 no respondió en $2"
}

prepare_database() {
  if psql_q -d postgres -tAc "select 1 from pg_database where datname = '$DB'" | grep -q 1; then
    log "Base $DB ya existe"
    return
  fi
  log "Creando base $DB"
  createdb "$DB"
  # Solo roles y privilegios: el esquema auth lo crea GoTrue, no el shim de pruebas.
  psql_q -d "$DB" -f scripts/db/supabase-shim.sql
  psql_q -d "$DB" <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole;
  end if;
end \$\$;
alter role supabase_auth_admin with login password '${AUTH_ADMIN_PASSWORD}';
alter role supabase_auth_admin set search_path = auth;
create schema if not exists auth authorization supabase_auth_admin;
grant create on database "${DB}" to supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;
alter role authenticator with login password '${AUTHENTICATOR_PASSWORD}';
SQL
  NEW_DB=1
}

apply_migrations() {
  log "Aplicando migraciones"
  shopt -s nullglob
  for f in supabase/migrations/*.sql; do
    psql_q -d "$DB" -1 -f "$f"
  done
  psql_q -d "$DB" -f scripts/db/local-roles.sql
  # Solo desarrollo: las tiendas viven en {handle}.tiendas.localhost (runbook local-stack).
  psql_q -d "$DB" -c "insert into public.platform_settings (key, value)
    values ('storefront.root_domain', '{\"domain\": \"tiendas.localhost\"}') on conflict (key) do nothing"
  # Solo desarrollo: el proveedor de pago simulado (D-F6-06). Nunca en producción.
  psql_q -d "$DB" -c "insert into public.platform_settings (key, value)
    values ('payments.allow_fake', '{\"enabled\": true}') on conflict (key) do nothing"
}

cmd_up() {
  ensure_installed
  mkdir -p "$RUN"
  NEW_DB=0
  prepare_database

  log "Mailpit (SMTP :$SMTP_PORT, UI http://127.0.0.1:$MAIL_UI_PORT)"
  start mailpit "$RUN" "$BIN/mailpit" --smtp "127.0.0.1:$SMTP_PORT" --listen "127.0.0.1:$MAIL_UI_PORT" \
    --database "$RUN/mailpit.db" --disable-version-check
  wait_http mailpit "http://127.0.0.1:$MAIL_UI_PORT/api/v1/info"

  log "Puerta de enlace (:$GATEWAY_PORT)"
  GATEWAY_PORT=$GATEWAY_PORT AUTH_PORT=$AUTH_PORT REST_PORT=$REST_PORT STORAGE_PORT=$STORAGE_PORT \
    start gateway "$ROOT" node scripts/dev/gateway.mjs
  wait_http gateway "http://127.0.0.1:$GATEWAY_PORT/health"

  log "Supabase Auth (:$AUTH_PORT) — ejecuta sus propias migraciones del esquema auth"
  local tpl="http://127.0.0.1:$GATEWAY_PORT/templates"
  # Opcional (F7-T04b): con STACK_EMAIL_HOOK_SECRET, Auth delega sus emails en la app
  # (http://localhost:3000/api/auth/email-hook), que debe estar levantada con el
  # mismo valor en SEND_EMAIL_HOOK_SECRET. Sin él, Auth envía por SMTP a Mailpit.
  local hook=()
  if [ -n "${STACK_EMAIL_HOOK_SECRET:-}" ]; then
    hook=(GOTRUE_HOOK_SEND_EMAIL_ENABLED=true
          GOTRUE_HOOK_SEND_EMAIL_URI="${STACK_EMAIL_HOOK_URI:-http://localhost:3000/api/auth/email-hook}"
          GOTRUE_HOOK_SEND_EMAIL_SECRETS="$STACK_EMAIL_HOOK_SECRET")
  fi
  start auth "$BIN/auth-dist" env -i PATH="$PATH" HOME="$HOME" ${hook[@]+"${hook[@]}"} \
    GOTRUE_API_HOST=127.0.0.1 PORT=$AUTH_PORT \
    API_EXTERNAL_URL="http://127.0.0.1:$GATEWAY_PORT/auth/v1" \
    GOTRUE_DB_DRIVER=postgres \
    GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:${AUTH_ADMIN_PASSWORD}@${PGHOST}:${PGPORT}/${DB}?search_path=auth&sslmode=disable" \
    GOTRUE_DB_MIGRATIONS_PATH="$BIN/auth-dist/migrations" \
    GOTRUE_DB_NAMESPACE=auth \
    GOTRUE_SITE_URL="http://127.0.0.1:3000" \
    GOTRUE_URI_ALLOW_LIST="http://127.0.0.1:3000/**,http://localhost:3000/**" \
    GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
    GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
    GOTRUE_DISABLE_SIGNUP=false GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_EXTERNAL_PHONE_ENABLED=false \
    GOTRUE_MAILER_AUTOCONFIRM=false GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED=true \
    GOTRUE_MAILER_OTP_EXP=600 GOTRUE_MAILER_OTP_LENGTH=6 \
    GOTRUE_MAILER_SUBJECTS_MAGIC_LINK="Tu código de acceso" \
    GOTRUE_MAILER_SUBJECTS_CONFIRMATION="Tu código de acceso" \
    GOTRUE_MAILER_TEMPLATES_MAGIC_LINK="$tpl/magic_link.html" \
    GOTRUE_MAILER_TEMPLATES_CONFIRMATION="$tpl/confirmation.html" \
    GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT=$SMTP_PORT GOTRUE_SMTP_ADMIN_EMAIL="no-reply@pruva.local" \
    GOTRUE_SMTP_SENDER_NAME="Pruva (local)" GOTRUE_SMTP_MAX_FREQUENCY=1s \
    GOTRUE_PASSWORD_MIN_LENGTH=12 \
    GOTRUE_MFA_TOTP_ENROLL_ENABLED=true GOTRUE_MFA_TOTP_VERIFY_ENABLED=true GOTRUE_MFA_MAX_ENROLLED_FACTORS=10 \
    GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_RATE_LIMIT_VERIFY=1000 GOTRUE_RATE_LIMIT_TOKEN_REFRESH=1000 \
    GOTRUE_RATE_LIMIT_OTP=1000 GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true \
    GOTRUE_LOG_LEVEL=info \
    ./auth
  wait_http auth "http://127.0.0.1:$AUTH_PORT/health"

  log "Supabase Storage (:$STORAGE_PORT) — ejecuta sus propias migraciones del esquema storage"
  mkdir -p "$RUN/storage-data"
  start storage "$BIN/storage" env -i PATH="$BIN/node24/bin:/usr/bin:/bin" HOME="$HOME" NODE_ENV=production \
    SERVER_HOST=127.0.0.1 SERVER_PORT=$STORAGE_PORT SERVER_ADMIN_PORT=$((STORAGE_PORT + 1)) \
    AUTH_JWT_SECRET="$JWT_SECRET" AUTH_JWT_ALGORITHM=HS256 \
    ANON_KEY="$(node scripts/dev/keys.mjs | sed -n 's/^NEXT_PUBLIC_SUPABASE_ANON_KEY=//p')" \
    SERVICE_KEY="$(node scripts/dev/keys.mjs | sed -n 's/^SUPABASE_SERVICE_ROLE_KEY=//p')" \
    DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}" DB_INSTALL_ROLES=false \
    DB_MIGRATIONS_STRATEGY=full_fleet STORAGE_BACKEND=file STORAGE_FILE_BACKEND_PATH="$RUN/storage-data" \
    TENANT_ID=local REGION=local GLOBAL_S3_BUCKET=local IMAGE_TRANSFORMATION_ENABLED=false PG_QUEUE_ENABLE=false \
    RATE_LIMITER_ENABLED=false OTEL_METRICS_ENABLED=false PROMETHEUS_METRICS_ENABLED=false LOG_LEVEL=warn \
    UPLOAD_SIGNED_URL_EXPIRATION_TIME=600 \
    node dist/start/server.js
  wait_http storage "http://127.0.0.1:$STORAGE_PORT/status"
  # Storage migra su esquema en segundo plano tras arrancar: se espera a que termine.
  for _ in $(seq 1 120); do
    local pending
    pending=$(psql_q -d "$DB" -tAc "select case when to_regclass('storage.objects') is null then 1
      else (select count(*) from storage.migrations where executed_at > now() - interval '3 seconds') end" 2>/dev/null || echo 1)
    [ "$pending" = "0" ] && break
    sleep 1
  done

  if [ "$NEW_DB" = 1 ]; then
    # Privilegios que Supabase concede en el esquema storage a los roles de la API.
    psql_q -d "$DB" -f scripts/db/supabase-shim-storage-grants.sql
    apply_migrations
  fi

  log "PostgREST (:$REST_PORT)"
  cat >"$RUN/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:${AUTHENTICATOR_PASSWORD}@${PGHOST}:${PGPORT}/${DB}"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
jwt-secret = "${JWT_SECRET}"
jwt-aud = "authenticated"
server-host = "127.0.0.1"
server-port = ${REST_PORT}
db-max-rows = 1000
log-level = "error"
CONF
  start postgrest "$RUN" "$BIN/postgrest" "$RUN/postgrest.conf"
  wait_http postgrest "http://127.0.0.1:$REST_PORT/"

  log "Stack listo: API http://127.0.0.1:$GATEWAY_PORT · correo http://127.0.0.1:$MAIL_UI_PORT"
  log "Variables para .env.local: bash scripts/dev/stack.sh env"
}

cmd_down() {
  for name in postgrest storage auth gateway mailpit; do
    if is_running "$name"; then
      local pid
      pid="$(cat "$RUN/$name.pid")"
      kill "$pid" 2>/dev/null || true
      # Espera a que libere el puerto; si no termina en 10 s, se fuerza.
      for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      kill -9 "$pid" 2>/dev/null || true
      log "$name detenido"
    fi
    rm -f "$RUN/$name.pid"
  done
}

cmd_status() {
  for name in mailpit gateway auth storage postgrest; do
    if is_running "$name"; then echo "✓ $name"; else echo "✗ $name"; fi
  done
}

cmd_reset() {
  cmd_down
  sleep 1
  log "Borrando base $DB"
  dropdb --if-exists --force "$DB"
  rm -f "$RUN/mailpit.db"
  cmd_up
}

case "${1:-}" in
  install) cmd_install ;;
  up) cmd_up ;;
  down) cmd_down ;;
  reset) cmd_reset ;;
  status) cmd_status ;;
  env) node scripts/dev/keys.mjs ;;
  *) die "Uso: $0 {install|up|down|reset|status|env}" ;;
esac
