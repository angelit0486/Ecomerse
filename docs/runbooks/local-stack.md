# Stack local sin Docker

Entorno de desarrollo con los mismos servidores que Supabase: **Supabase Auth (GoTrue)**, **PostgREST**, **Supabase Storage** y **Mailpit** para leer los correos. Todo escucha solo en `127.0.0.1` y usa claves públicas de desarrollo. Decisiones: `DECISIONS.md` D-F2-13 (spike S-6) y D-F3-05 (spike S-3, Storage).

## Requisitos

- Linux x86_64. En macOS o Windows usa `supabase start` (Docker).
- PostgreSQL ≥ 15 con pgTAP en `localhost:5432` (`postgres:postgres` por defecto; se cambia con `PGHOST`, `PGPORT`, `PGUSER` y `PGPASSWORD`).
- Node 22 para la app. Storage necesita Node 24: `install` lo descarga (sha256 fijado) en `.stack/bin/node24`, sin tocar el Node del sistema.
- `git` y acceso a GitHub y npm la primera vez: Storage se compila desde el código fuente de un commit fijado (`npm ci` con su lockfile).

## Uso

```bash
pnpm stack install   # descarga los binarios fijados (sha256) y compila Storage en .stack/bin
pnpm stack up        # crea la base pruva_dev, migra y levanta los servicios
pnpm stack env       # variables para .env.local (URL y claves de desarrollo)
pnpm test:stack      # prueba de extremo a extremo contra el stack
pnpm stack status | down | reset
```

| Servicio                | Dirección                                                        |
| ----------------------- | ---------------------------------------------------------------- |
| API (como Supabase)     | `http://127.0.0.1:54321` (`/auth/v1`, `/rest/v1`, `/storage/v1`) |
| Correos (Mailpit)       | `http://127.0.0.1:8025`                                          |
| Supabase Auth (directo) | `http://127.0.0.1:9999`                                          |
| PostgREST (directo)     | `http://127.0.0.1:3001`                                          |
| Storage (directo)       | `http://127.0.0.1:5000`                                          |

Logs y pids: `.stack/run/`.

## Qué hace `up`

1. Si la base `pruva_dev` no existe, la crea y aplica solo `scripts/db/supabase-shim.sql` (roles y privilegios). Crea el rol `supabase_auth_admin` y el esquema `auth`.
2. Levanta Mailpit y la puerta de enlace, que también sirve `supabase/templates/` porque GoTrue descarga las plantillas por URL.
3. Levanta Supabase Auth, que ejecuta sus propias migraciones del esquema `auth`.
4. Levanta Supabase Storage (backend de archivos en `.stack/run/storage-data`), que crea y migra el esquema `storage`; `up` espera a que termine.
5. Solo si la base es nueva, aplica `scripts/db/supabase-shim-storage-grants.sql` (los privilegios que Supabase concede en `storage`), `supabase/migrations/*` y `scripts/db/local-roles.sql`. Las migraciones crean los buckets `store-uploads` (privado) y `store-media` (público).
6. Levanta PostgREST con el rol `authenticator`, que expone solo el esquema `public`.

Una migración nueva sobre una base ya creada: `pnpm stack reset` (borra la base de desarrollo), o aplícala a mano con `psql -1 -f` y recarga PostgREST con `notify pgrst, 'reload schema'`.

## Login de prueba

1. Pide el código: `POST /auth/v1/otp` con `{ "email": "...", "create_user": true }`.
2. Lee el código de 6 dígitos en Mailpit.
3. Envíalo a `POST /auth/v1/verify`.
4. Para staff, el panel exige AAL2: registra un factor TOTP con `POST /auth/v1/factors`, luego `challenge` y `verify`. `tests/stack/auth-rls.test.ts` muestra el flujo completo.

## App contra el stack

```bash
pnpm stack env >> .env.local     # una vez; completa también APP_HOSTNAME y PREVIEW_HMAC_SECRET (ver .env.example)
pnpm dev                         # o: pnpm build && pnpm start -H localhost -p 3000
```

- Panel: `http://localhost:3000` (el host de `APP_HOSTNAME`).
- Tiendas: `http://{handle}.tiendas.localhost:3000`. El navegador resuelve cualquier `*.localhost` a 127.0.0.1. `stack.sh` configura `platform_settings.storefront.root_domain = {"domain": "tiendas.localhost"}`, así el alta asistida crea ese subdominio. El dominio raíz debe tener al menos un punto.
- Arranca siempre con `-H localhost`, nunca con `-H 127.0.0.1`. Next normaliza 127.0.0.1 a `localhost` en `request.nextUrl`, y entonces las reescrituras del proxy se tratan como proxy externo.
- `tests/stack/storefront-routing.test.ts` necesita la app levantada y el mismo `PREVIEW_HMAC_SECRET`: `set -a; . ./.env.local; set +a; pnpm test:stack`.
