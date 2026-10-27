# 01 · Estado real (línea base) — 2026-10-27

Auditoría de solo lectura. Etiquetas:
- **[VERIFICADO]**: comprobado ejecutando o consultando hoy.
- **[INFERIDO]**: deducido del código.
- **[NO VERIFICADO]**: requiere un servicio real o un acceso que no tenemos.

Prefijo de los hallazgos: `EST-`.

## 1. Pruebas (cada suite al menos 2 veces hoy)

| Suite | Corrida 1 | Corrida 2 | Etiqueta | Nota |
|---|---|---|---|---|
| `pnpm verify` (lint 0 avisos, formato, tipos, unit, build) | 941 unit ✅ (`f503304`) | 945 unit ✅ (`1c69d45`, 2 pruebas nuevas) | [VERIFICADO] | Además pasó en `8120444` (943) |
| pgTAP (`pnpm db:test`) | 2,348 en 101 archivos ✅ | 2,348 ✅ | [VERIFICADO] | Base nueva en cada corrida (`scripts/db/test.sh:26-27`, `dropdb` + `createdb`) |
| Integración (`pnpm db:test`) | 355 ✅ | 355 ✅ | [VERIFICADO] | |
| E2E Playwright (98 pruebas) | 98/98 ✅ (14.8 min, `8120444`) | 97/98 (17.6 min, `be5541d`) | [VERIFICADO] | La falla fue `brands.spec.ts:59`, con los revisores usando el servidor al mismo tiempo. Sola pasó 3 de 3 (14 s, 31 s y 32 s). Ver EST-07 |
| CI GitHub Actions (`.github/workflows/ci.yml`) | Corre en cada push: verify, database, stack con `test:stack` y E2E, y escaneo de secretos | — | [VERIFICADO] | Ejecuciones 86 a 89 en verde; la 89 es para `c155254` |

En rojo hoy: nada en el flujo oficial.

Precondición documentada: 6 suites pgTAP (06, 13, 14, 29, 31, 46) cuentan filas de toda la base y fallan si se repiten sobre una base ya usada. Ver `docs/plan/ESTADO-CALIDAD-2026-10-27.md`.

## 2. Git

- Rama local `claude/carga-imagenes-lote`, publicada como `claude/ecommerce-regulated-platform-41vu1e` en el remoto `ecomerse` (`github.com/angelit0486/Ecomerse`). [VERIFICADO]
- Último commit `be5541d` (2026-10-27 08:59 UTC). 0 commits sin subir. El push funciona. [VERIFICADO]
- El remoto `origin` (`angelii33/pruva`) responde 403. Es el repositorio que nombra la configuración de la sesión, pero el trabajo vive en `ecomerse`. [VERIFICADO]

## 3. Staging (Supabase `epgiglysldwoiulnwamf`) y Vercel

| Punto | Resultado | Etiqueta |
|---|---|---|
| Migraciones aplicadas vs. repositorio | 120 de 120; última `20261025000100_org_create_store`. **Faltantes: ninguna** | [VERIFICADO] (`list_migrations` comparado con `supabase/migrations/`) |
| `MIGRATION_DATABASE_URL` en Vercel | Desconocido | [NO VERIFICADO]: el conector de Vercel responde 403 para el equipo `angelit0486s-projects` |
| Último despliegue, estado y logs de errores | Desconocido | [NO VERIFICADO] (403) |
| Dominios por tienda (tabla `store_domains`) | demo → `pruva-tienda-demo.vercel.app` (primario) + 3 alias `*.vercel.app`; demo2 → `pruva-tienda-demo2.vercel.app` | [VERIFICADO] (SELECT) |
| Pago simulado | `platform_settings.payments.allow_fake = {"enabled": true}` | [VERIFICADO] |
| Pedidos | 0 en las dos tiendas | [VERIFICADO] |
| Perfil de cumplimiento MX (suplementos) | `active` v2, `reviewed_by = "Demostración (sin revisión real)"`, nota «SOLO STAGING… SIN revisión del asesor regulatorio. Volver a pending antes de vender» | [VERIFICADO] |
| Tablas auxiliares que quedaron en `supabase_migrations` | `pruva_fetch` (86 filas), `pruva_pending_migration` (6), `pruva_pending_chunk` (0) y `pruva_seed_ticket` (0). Sin permisos para `anon`, `authenticated`, `public` ni `service_role` | [VERIFICADO] |
| Advisors de seguridad | 40 tablas con RLS y sin políticas, por diseño: se niega todo y el acceso es por funciones. `pg_net` en `public`. 163 funciones `SECURITY DEFINER` ejecutables por `authenticated`. Protección contra contraseñas filtradas apagada | [VERIFICADO] |
| Advisors de rendimiento | 74 FKs sin índice; 105 índices sin uso; 2 políticas permisivas múltiples en `customers`; `system.auth_login_intents` sin PK | [VERIFICADO] |

## 4. Lighthouse móvil y axe

Medido en local con el mismo código, porque el contenedor no alcanza `*.vercel.app`. La versión en línea queda [NO VERIFICADO]. Detalle en `docs/plan/ESTADO-CALIDAD-2026-10-27.md` y en `05-RENDIMIENTO-ESCALA.md`.

- **Tiendas:**
  - Rendimiento entre 91 y 99, más 69 en la primera carga en frío de la portada de demo.
  - Accesibilidad 100 y Buenas prácticas 100.
  - SEO 100, salvo carrito y pago: 54 por `noindex`, que es intencional.
- **axe:** 0 violaciones en 24 pantallas: demo y demo2, a 375 y 1280 px, en inicio, listado, ficha, carrito, pago y búsqueda vacía. [VERIFICADO]
- **Panel:** rendimiento 86 a 99; Accesibilidad 100; Buenas prácticas 100 tras `1c69d45` (antes 93 por errores de CSP). [VERIFICADO]

## 5. Lo prometido en PROGRESS.md contra lo que hay

| # | PROGRESS dice | Realidad | Etiqueta |
|---|---|---|---|
| D1 | «Bloqueo P0: `git push` devuelve 403… el CI nunca ha corrido» (`docs/plan/PROGRESS.md`, tabla Bloqueos) | El push funciona al remoto `ecomerse` y el CI tiene más de 89 ejecuciones | [VERIFICADO]: la tabla está **desactualizada** |
| D2 | «Commits sin subir: todos desde `7549db7`… bundle de respaldo» | 0 commits sin subir | [VERIFICADO]: desactualizado |
| D3 | «Verificaciones pendientes: CI de GitHub Actions (primer run)» | Ya corre en cada push | [VERIFICADO]: desactualizado |
| D4 | «R0: el perfil nace `pending` y bloquea; ningún suplemento se publica hasta revisarlo» | En staging el perfil está `active` como demostración autorizada, con la nota de volver a `pending` antes de vender. Correcto para la demo, pero es un **paso manual que se puede olvidar** | [VERIFICADO] |
| D5 | Las tiendas de staging se describen como demos de suplementos (Fase A: «los 20 suplementos de demo y demo2») | La tienda **demo** cambió de nombre a «𝓐𝓛𝓘𝓔𝓝 𝓓𝓔𝓜𝓞𝓝 𝓔𝓧𝓞𝓣𝓘𝓒𝓢 \|». Muestra 19 productos activos cuyos nombres corresponden a productos comúnmente asociados con concentrados o vapeadores de THC: categorías «Plumas», «2g con preroll» y «3.5 gramos»; marcas como Muha Meds, ELFTHC, Melt y Fryd; precios de $1,399 a $1,650. Se ven en línea en `pruva-tienda-demo.vercel.app/productos`. Ver EST-01 | [VERIFICADO] (SELECT y lectura web). El contenido real de los productos es [INFERIDO] por los nombres |
| D6 | Varias tareas del tablero siguen «en curso» (Pulido Pasos 2–3, Portada Paso 3) | PROGRESS registra trabajo posterior terminado; la lista de tareas no refleja el estado | [INFERIDO]: higiene |
| D7 | PROGRESS (línea 82) dice que quedaron tablas auxiliares en staging que se borrarían | Siguen ahí, con datos (ver §3) | [VERIFICADO] |

## 6. Hallazgos de esta sección

| ID | Severidad | Hallazgo | Evidencia | Etiqueta |
|---|---|---|---|---|
| EST-01 | **Crítica** | La tienda «demo», del propietario, publica productos cuyos nombres corresponden a concentrados o vapeadores de THC, en una plataforma que se presenta como de suplementos | SELECT en `public.products` (tienda `demo`, 19 activos); página `https://pruva-tienda-demo.vercel.app/productos` leída hoy. `robots.txt` = `Disallow: /` (no se indexa). 0 pedidos y solo pago simulado | [VERIFICADO]; el contenido real es [INFERIDO]. Análisis legal en `09`, dependencia de proveedores en `10` |
| EST-02 | Alta | El cumplimiento solo se aplica si la tienda **declara** una categoría regulada. «demo» no declara ninguna, así que nada revisa lo que publica. No hay moderación de contenido de los inquilinos | `store_regulated_categories` solo tiene a demo2; ver `02` y `09` | [VERIFICADO] |
| EST-03 | Alta | El perfil MX de suplementos está activo **sin revisión real**. Pasar a ventas reales exige regresarlo a `pending` a mano | Fila de `compliance_profiles` (§3) | [VERIFICADO] |
| EST-04 | Media | Sin acceso a Vercel: no se pueden ver despliegues, logs, dominios ni si existe `MIGRATION_DATABASE_URL` | 403 del conector en `list_deployments`, `list_project_domains` y `filter_project_envs` | [VERIFICADO] |
| EST-05 | Media | PROGRESS.md tiene bloqueos y estados desactualizados (D1–D3, D6). Quien retome el proyecto puede creer que no hay CI ni push | Tabla §5 | [VERIFICADO] |
| EST-06 | Baja | Tablas auxiliares de carga de migraciones con datos en staging (`supabase_migrations.pruva_*`) | §3 | [VERIFICADO] |
| EST-07 | Media | `brands.spec.ts` depende del tiempo de procesamiento de jobs. Falla con el servidor cargado y tarda entre 14 y 32 s sola | Corrida 2 de E2E; 3 repeticiones aisladas en verde | [VERIFICADO] |
| EST-08 | Media | El nombre de la tienda demo usa letras Unicode decorativas: los lectores de pantalla y los buscadores no lo leen como texto normal. Ver `07` | Nombre en `public.stores` | [VERIFICADO] |
