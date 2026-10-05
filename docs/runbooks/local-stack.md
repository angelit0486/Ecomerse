# Stack local sin Docker

Entorno de desarrollo con los mismos servidores que Supabase: **Supabase Auth (GoTrue)**, **PostgREST** y **Mailpit** para leer los correos. Todo escucha solo en `127.0.0.1` y usa claves públicas de desarrollo. Decisión: `DECISIONS.md` D-F2-13 (spike S-6).

## Requisitos

- Linux x86_64. En macOS o Windows usa `supabase start` (Docker).
- PostgreSQL ≥ 15 con pgTAP en `localhost:5432` (`postgres:postgres` por defecto; se cambia con `PGHOST`, `PGPORT`, `PGUSER` y `PGPASSWORD`).
- Node 22.

## Uso

```bash
pnpm stack install   # descarga los binarios fijados en .stack/bin y verifica sha256
pnpm stack up        # crea la base pruva_dev, migra y levanta los servicios
pnpm stack env       # variables para .env.local (URL y claves de desarrollo)
pnpm test:stack      # prueba de extremo a extremo contra el stack
pnpm stack status | down | reset
```

| Servicio                | Dirección                                         |
| ----------------------- | ------------------------------------------------- |
| API (como Supabase)     | `http://127.0.0.1:54321` (`/auth/v1`, `/rest/v1`) |
| Correos (Mailpit)       | `http://127.0.0.1:8025`                           |
| Supabase Auth (directo) | `http://127.0.0.1:9999`                           |
| PostgREST (directo)     | `http://127.0.0.1:3001`                           |

Logs y pids: `.stack/run/`.

## Qué hace `up`

1. Si la base `pruva_dev` no existe, la crea y aplica solo `scripts/db/supabase-shim.sql` (roles y privilegios). Crea el rol `supabase_auth_admin` y el esquema `auth`.
2. Levanta Mailpit y la puerta de enlace, que también sirve `supabase/templates/` porque GoTrue descarga las plantillas por URL.
3. Levanta Supabase Auth, que ejecuta sus propias migraciones del esquema `auth`.
4. Solo si la base es nueva, aplica `supabase/migrations/*` y `scripts/db/local-roles.sql`.
5. Levanta PostgREST con el rol `authenticator`, que expone solo el esquema `public`.

Una migración nueva sobre una base ya creada: `pnpm stack reset`. Esto borra la base de desarrollo.

## Login de prueba

1. Pide el código: `POST /auth/v1/otp` con `{ "email": "...", "create_user": true }`.
2. Lee el código de 6 dígitos en Mailpit.
3. Envíalo a `POST /auth/v1/verify`.
4. Para staff, el panel exige AAL2: registra un factor TOTP con `POST /auth/v1/factors`, luego `challenge` y `verify`. `tests/stack/auth-rls.test.ts` muestra el flujo completo.
