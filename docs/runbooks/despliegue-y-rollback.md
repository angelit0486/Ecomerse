# Despliegue, promoción y reversión (2026-10-29)

Cómo pasa un cambio del código a la vista previa (staging) y, cuando exista, a producción, y cómo se deshace. Contrato de migraciones: forward-only (CLAUDE.md, regla 17).

## 1. Los tres entornos

Cada entorno tiene su propia base, sus propias claves y su propio proyecto. **Nunca** se comparte una clave ni una base entre entornos.

| Entorno    | Dónde corre                                                                                 | Base de datos                                                    | Correo                               | Pagos                                                    | Estado                |
| ---------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------- | --------------------- |
| Local      | La computadora del desarrollador o el contenedor del agente: `pnpm stack up` + `pnpm start` | PostgreSQL local, base `pruva_dev` (y `pruva_test` para pruebas) | Mailpit (no sale nada a internet)    | Proveedor `fake` y Stripe simulado en `127.0.0.1:4599`   | Funciona              |
| Staging    | Vercel, proyecto `ecomerse` (cuenta `angelit0486`), `APP_ENV=preview`                       | Supabase `pruva-staging` (`epgiglysldwoiulnwamf`)                | `fake` hoy; Resend cuando esté listo | Modo prueba (Stripe `sk_test_…`, Mercado Pago de prueba) | Funciona, sin correos |
| Producción | Vercel, **proyecto nuevo** (p. ej. `pruva-prod`), `APP_ENV=production`                      | Supabase, **proyecto nuevo** de plan Pro con PITR                | Resend con dominio verificado        | Claves `live`                                            | **No existe todavía** |

Reglas de separación:

- **Claves distintas por entorno:** `CRON_SECRET`, `JOBS_HMAC_SECRET`, `PREVIEW_HMAC_SECRET`, `ORDER_LINK_SECRET` y `PAYMENT_CREDENTIALS_KEY` se generan de nuevo para cada entorno (32 bytes aleatorios). Lo mismo con las contraseñas de `storefront_gateway` y `system_worker`.
- **Llaves de pago:** staging solo usa llaves de prueba. La app rechaza un webhook de modo prueba cuando corre en producción (Stripe Billing, `requireLivemode`).
- **Datos:** producción nunca se copia a staging. Para probar con datos parecidos se usa la siembra de demostración (`database-roles.md` §7).
- **Variables por entorno en Vercel:** cada variable se da de alta solo en el entorno que le corresponde (Production o Preview), nunca en «All Environments».

## 2. Cómo llega un cambio a staging

1. Commit y push a la rama de trabajo (`claude/ecommerce-regulated-platform-41vu1e` en `angelit0486/Ecomerse`).
2. GitHub Actions (`.github/workflows/ci.yml`) corre en cada push y pull request:
   - lint, formato, tipos, pruebas unitarias y build;
   - migraciones desde cero, pgTAP e integración;
   - stack local con Auth y Storage reales, y E2E con Playwright y axe;
   - escaneo de secretos (gitleaks) sobre todo el historial.
3. Vercel despliega solo cada push de la rama.
4. **Migraciones:** si la rama trae migraciones nuevas, se aplican a `pruva-staging` con uno de estos métodos:
   - **Automático (recomendado):** con `MIGRATION_DATABASE_URL` en Vercel (solo en el entorno de staging), `pnpm build` corre `scripts/deploy/migrate.mjs` antes de compilar. Aplica en orden lo que falte, cada archivo en su transacción, y se detiene si un archivo ya aplicado cambió (comparación por sha256).
   - **Manual (lo que se usa hoy):** la base baja los archivos del repositorio en un commit fijo con `pg_net`, compara el sha256 de cada uno con el del repositorio y los aplica en una sola transacción, registrándolos en `supabase_migrations.schema_migrations` con su huella (`database-roles.md` §7). Se usó el 2026-10-29 para las 16 migraciones `20261025000100…20261029000800`.
5. **Comprobación:** `select public.app_schema_version()` debe dar la misma versión que `EXPECTED_SCHEMA_VERSION` (`src/server/db/schema-version.ts`). Si la base va atrasada:
   - el panel y la consola muestran «Faltan migraciones de la base de datos»;
   - la tienda muestra «Tienda en mantenimiento» en lugar de una pantalla rota.

**Orden seguro:** primero las migraciones, luego el código. Las migraciones son aditivas (expand → migrate → contract), así que el código anterior sigue funcionando con la base nueva. Al revés no: código nuevo con base vieja muestra el aviso de mantenimiento.

## 3. Cómo se promueve de staging a producción (cuando exista)

1. El cambio lleva al menos un día en staging sin errores:
   - Consola → Salud en verde;
   - Vercel → Logs sin errores nuevos;
   - Supabase → Advisors sin avisos nuevos de seguridad.
2. CI verde en el commit exacto que se va a promover.
3. **Respaldo:** en producción, confirmar que PITR está activo y anotar la hora («punto de regreso») antes de migrar.
4. **Migraciones primero:** aplicar a producción las migraciones pendientes con el método automático (`MIGRATION_DATABASE_URL` del entorno Production) o con `migrate.mjs` desde una máquina de confianza. Comprobar `app_schema_version()`.
5. **Código después:** en Vercel (proyecto de producción) → Deployments → el despliegue de ese commit → **Promote to Production**.
6. Prueba de humo, de 10 minutos:
   - entrar al panel;
   - abrir una tienda;
   - agregar al carrito;
   - pagar con una tarjeta real de bajo monto y reembolsarla;
   - revisar que llegue el correo.

## 4. Cómo se revierte

### Código (lo más común)

- Vercel → Deployments → el último despliegue bueno → **Instant Rollback** (o «Promote to Production»). Tarda segundos y no toca la base.
- Funciona porque las migraciones son aditivas: el código anterior sigue funcionando con la base nueva.

### Base de datos

- **Nunca** se edita ni se borra una migración ya aplicada; `migrate.mjs` se detiene si el archivo cambió.
- **Error lógico en una migración** (una función con un error): se corrige con una **migración nueva** que la reemplaza (`create or replace`), con su prueba que falle antes y pase después.
- **Daño a datos** (algo borró o cambió datos de más): restaurar con PITR al punto de regreso del paso 3.3. Solo en producción (requiere plan Pro); staging en plan Free **no tiene respaldos automáticos** (`respaldos.md`). Restaurar reemplaza toda la base: se decide con el propietario y se avisa a los comercios.
- **Migración fallida a la mitad:** cada archivo corre en su transacción, así que no queda a medias. El error dice cuál falló; se corrige con una migración nueva.

### Claves comprometidas

- Ver `rotacion-de-claves.md`.

## 5. Lista rápida antes de cada despliegue

- [ ] CI verde en GitHub para ese commit.
- [ ] `pnpm verify`, `pnpm db:test` y E2E completos en verde en local.
- [ ] Migraciones nuevas probadas desde cero (pgTAP) y con su prueba de aislamiento entre tiendas.
- [ ] `EXPECTED_SCHEMA_VERSION` igual a la versión de la última migración.
- [ ] Sin variables nuevas, o dadas de alta en Vercel **antes** de desplegar (`.env.example` las lista).
- [ ] PROGRESS.md actualizado.
