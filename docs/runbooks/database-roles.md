# Runbook — Roles de base de datos y runner de jobs

Contrato: GATE0 §11.4 (ADR-016), §11.5, §28.4, §36.2 (rotación).

> Las migraciones crean `storefront_gateway` y `system_worker` **sin LOGIN**. Las contraseñas nunca se versionan: se habilitan por entorno con estos pasos.

## 1. Habilitar el login de los roles (por entorno)

Ejecutar como `postgres` en el SQL Editor del proyecto Supabase (o con `psql`):

```sql
-- Contraseñas generadas con: openssl rand -base64 36
alter role system_worker      with login password '<CONTRASEÑA_DEL_GESTOR_DE_SECRETOS>';
alter role storefront_gateway with login password '<CONTRASEÑA_DEL_GESTOR_DE_SECRETOS>';
```

Guarda las contraseñas solo en el gestor de secretos y en las variables de entorno de Vercel.

## 2. Cadena de conexión (Supavisor, modo transacción)

```
WORKER_DATABASE_URL=postgres://system_worker.<project_ref>:<contraseña>@<region>.pooler.supabase.com:6543/postgres
```

- Puerto **6543** = modo transacción (obligatorio para serverless). El cliente usa `prepare: false`.
- **Spike S-1 (pendiente):** confirmar que Supavisor acepta estos roles personalizados. Prueba mínima:
  ```bash
  psql "$WORKER_DATABASE_URL" -c "select system.health_check();"   # debe responder {"db": true, ...}
  psql "$WORKER_DATABASE_URL" -c "select * from system.jobs;"      # debe fallar: permission denied
  ```
  Si falla la conexión: plan B de ADR-016 (JWT firmado por el servidor con rol personalizado para la Data API).

## 3. Verificaciones obligatorias tras crear el proyecto

1. **Esquemas expuestos** (Dashboard → Settings → API → Exposed schemas): solo `public` y `graphql_public`. Nunca `app`, `audit`, `private`, `storefront` ni `system`.
2. **Pruebas contra Supabase real** (D-F1-11): `supabase link` + `supabase db push` + `supabase test db`. Deben pasar las mismas pruebas pgTAP que en CI.
3. **Advisors** (Dashboard → Advisors): sin hallazgos de seguridad.
4. **PITR** activado (Q-B5) antes del primer cliente de pago.

## 4. Rotación de contraseñas (≤ 2 h, §36.2)

1. `alter role system_worker with password '<nueva>';`
2. Actualizar `WORKER_DATABASE_URL` en Vercel (Production y Preview) y volver a desplegar.
3. Verificar `GET /api/health/ready` → `200 {"status":"ok"}`.
4. Las conexiones abiertas con la contraseña anterior siguen vivas hasta cerrarse. Para cortarlas de inmediato:
   `select pg_terminate_backend(pid) from pg_stat_activity where usename = 'system_worker';`

## 5. Disparo del runner de jobs

**Primario (D-F1-05): Vercel Cron.** `vercel.json` programa `GET /api/jobs/run` cada minuto. Vercel envía `Authorization: Bearer $CRON_SECRET`. Requiere el plan Pro (nota N-4).

**Alternativo: pg_cron + pg_net (firmado con HMAC). NO VERIFICADO TODAVÍA.** Se activa cuando exista el proyecto Supabase y se haya verificado:

- La firma es `HMAC-SHA256(JOBS_HMAC_SECRET, "<timestamp>.<cuerpo exacto>")` en hexadecimal, en las cabeceras `x-jobs-timestamp` y `x-jobs-signature`, con tolerancia de ±60 s (implementado y probado en `src/server/jobs/authorize.ts`).
- Los secretos (`jobs_runner_url`, `jobs_hmac_secret`) se guardan en Supabase Vault, nunca en SQL versionado.
- Antes de activarlo hay que confirmar que el cuerpo que envía `net.http_post` es byte a byte el que se firma.

## 6. Limpieza de la cola

`system.purge_finished_jobs()` elimina los `succeeded` de más de 7 días y los `dead` de más de 30. Se programará como job periódico en la Fase 2. Mientras tanto se puede ejecutar a mano como `system_worker`.
