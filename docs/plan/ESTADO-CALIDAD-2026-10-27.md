# Estado de calidad — 2026-10-27 (Paso 0 de la misión de calidad)

Medido sobre la rama `claude/ecommerce-regulated-platform-41vu1e` (remoto `ecomerse`).
Línea base: `f503304`. Estado al cierre del Paso 0: `1c69d45`.
Todo lo de este documento se midió en esta sesión; lo que no se pudo medir dice **NO VERIFICADO**.

## Semáforo por área

| Área                                 | Antes                                                          | Después                 | Evidencia                                                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lint, formato y tipos                | 🟢 0 avisos                                                    | 🟢 0 avisos             | `pnpm verify` (eslint `--max-warnings=0`, prettier, `tsc`)                                                                                                               |
| Pruebas unitarias                    | 🟢 941                                                         | 🟢 945                  | `pnpm verify`                                                                                                                                                            |
| pgTAP                                | 🟢 2,348 en 101 archivos                                       | 🟢 2,348                | `pnpm db:test` (base nueva cada vez: `dropdb` + `createdb`)                                                                                                              |
| Integración                          | 🟢 355                                                         | 🟢 355                  | `pnpm db:test`                                                                                                                                                           |
| E2E (Playwright)                     | 🟢 98/98                                                       | 🟢 98/98                | corrida completa limpia con next 16.4.1 (14.8 min); las 5 suites tocadas por el selector nativo se repitieron después                                                    |
| Pruebas inestables                   | 🟡 pgTAP 29 y 20 fallaban al repetirse sobre una base usada    | 🟢 corregidas           | 29: `f503304` (3/3). 20: `c155254` (de más de 16 min a menos de 1 s)                                                                                                     |
| Dependencias (`pnpm audit`)          | 🔴 2 críticas, 4 altas, 7 moderadas, 1 baja                    | 🟢 0                    | `8120444`: next 16.4.1, zod 4.6.6, sanitize-html 2.18.1; vitest, vite y jsdom solo en desarrollo                                                                         |
| Secretos en el historial             | 🟢 0                                                           | 🟢 0                    | barrido de todo el historial: solo `.env.example`                                                                                                                        |
| `.env.example`                       | 🔴 copiarlo tal cual rompía el arranque y faltaban 3 variables | 🟢                      | `0faf60b`: una opcional vacía cuenta como ausente; prueba nueva                                                                                                          |
| Código muerto                        | 🟡 `SECTION_KEYS` sin uso                                      | 🟢                      | `c7002a5`: ahora una prueba comprueba que cada pestaña guarda solo lo suyo. El resto que marca knip son exportaciones que se usan dentro de su archivo, no código muerto |
| CI en cada push                      | 🟢                                                             | 🟢                      | GitHub Actions corre en cada push; ejecuciones 87 y 88 en verde                                                                                                          |
| Migraciones en staging               | 🟢 al día (`20261025000100`)                                   | 🟢                      | `list_migrations`, comprobado por huella                                                                                                                                 |
| Versión de esquema                   | 🟢                                                             | 🟢                      | `app_schema_version()` = `EXPECTED_SCHEMA_VERSION`; aviso en el panel si no coinciden                                                                                    |
| Accesibilidad de las tiendas (axe)   | 🟢 0                                                           | 🟢 0                    | demo y demo2 a 375 y 1280 px: inicio, listado, producto, carrito, pago y búsqueda vacía (24 pantallas)                                                                   |
| Lighthouse de las tiendas (móvil)    | 🟡                                                             | 🟡                      | ver tabla. Rendimiento entre 91 y 99; la meta de 95 no se cumple en la portada y el listado de demo                                                                      |
| Lighthouse del panel (móvil)         | 🔴 errores de consola por CSP (Buenas prácticas 93)            | 🟢 Buenas prácticas 100 | `1c69d45`: selector nativo en lugar del Select de Radix                                                                                                                  |
| Rendimiento de la portada del panel  | 🟡 86–88                                                       | 🟡 86–88                | por debajo de la meta de 90; queda para el Paso 4                                                                                                                        |
| Advisors de Supabase                 | 🟡                                                             | 🟡                      | ver más abajo; sin cambios en el Paso 0 (no son contratos que se puedan tocar sin revisar)                                                                               |
| Logs de Vercel en producción         | ⚪ NO VERIFICADO                                               | ⚪                      | el conector de Vercel responde 403 (falta acceso al equipo)                                                                                                              |
| Lighthouse y axe en staging (Vercel) | ⚪ NO VERIFICADO                                               | ⚪                      | este contenedor no alcanza `*.vercel.app`; todo se midió en local con el mismo código                                                                                    |

## Lighthouse en móvil, local

Columnas: Rendimiento, Accesibilidad, Buenas prácticas, SEO.

| Tienda | Página   | Rend.              | Acc. | BP  | SEO  | LCP simulado |
| ------ | -------- | ------------------ | ---- | --- | ---- | ------------ |
| demo   | inicio   | 91–92 (69 en frío) | 100  | 100 | 100  | 3.3 s        |
| demo   | listado  | 93–95              | 100  | 100 | 100  | 2.8–3.2 s    |
| demo   | producto | 94                 | 100  | 100 | 100  | 3.0 s        |
| demo   | carrito  | 96                 | 100  | 100 | 54 * | 2.6 s        |
| demo   | pago     | 93                 | 100  | 100 | 54 * | 3.0 s        |
| demo2  | inicio   | 96                 | 100  | 100 | 100  | 2.7 s        |
| demo2  | listado  | 93                 | 100  | 100 | 100  | 3.1 s        |
| demo2  | producto | 96                 | 100  | 100 | 100  | 2.6 s        |
| demo2  | carrito  | 99                 | 100  | 100 | 54 * | 1.8 s        |
| demo2  | pago     | 96                 | 100  | 100 | 54 * | 2.7 s        |

\* Carrito y pago llevan `noindex` a propósito: no deben aparecer en buscadores, y Lighthouse lo cuenta como falla de SEO.

La foto más grande de la portada (LCP) se descarga a 800×800 y se muestra a 162 px. En condiciones reales el LCP medido fue de unos 270 ms; los 3 s salen de la simulación de un celular lento. El arreglo son fotos en varios tamaños (`srcset`/`sizes`), que corresponde al Paso 3.

| Panel              | Rend. | Acc. | BP             |
| ------------------ | ----- | ---- | -------------- |
| Inicio             | 86–88 | 100  | 100            |
| Productos          | 98–99 | 100  | 100            |
| Pedidos            | 99    | 100  | 100            |
| Apariencia         | 94–96 | 100  | 100 (antes 93) |
| Datos de la tienda | 97–99 | 100  | 100 (antes 93) |
| Equipo             | 98    | 100  | 100            |
| Configuración      | 98    | 100  | 100            |

## Advisors de Supabase (staging)

- **Seguridad:**
  - 40 tablas con RLS y sin políticas. Es a propósito: se niega todo y el acceso es solo por funciones.
  - `pg_net` vive en el esquema `public`.
  - 163 funciones `SECURITY DEFINER` llamables por `authenticated`. Es a propósito: cada una revisa permisos por dentro.
  - La protección contra contraseñas filtradas está apagada. Es un ajuste del propietario en el dashboard.
- **Rendimiento:**
  - 74 llaves foráneas sin índice.
  - 105 índices sin uso: staging tiene poco tráfico, así que esta cifra no es concluyente.
  - 2 políticas permisivas múltiples en `customers`.
  - `system.auth_login_intents` sin llave primaria.
  - Se revisan en el Paso 2, con `EXPLAIN`. Agregar índices es seguro; quitar cualquiera requiere evidencia.

## Hallazgos del Paso 0 y su arreglo

1. **Dependencias con vulnerabilidades críticas** (RCE en Next.js) → actualizadas (`8120444`).
   - Efecto lateral de zod 4.6.6: al pasarse del límite de una lista deja de validar lo demás. Se documentó en la prueba.
2. **Copiar `.env.example` rompía el arranque** → `0faf60b`, con prueba.
3. **pgTAP 20 tardaba más de 16 min sobre una base usada**: un ayudante `volatile` se evaluaba por fila y buscaba la variante en todas las tiendas → `c155254`.
4. **Errores de consola por CSP en 4 pantallas del panel** (Select de Radix) → `1c69d45`, con prueba unitaria y guarda en E2E.
5. **Otras 6 suites pgTAP** (06, 13, 14, 29, 31 y 46) cuentan filas globales y fallan si se repiten sobre una base ya usada por E2E.
   - En el flujo oficial no pasa, porque `pnpm db:test` crea la base desde cero.
   - Queda como condición documentada, no como prueba inestable.

## Pendientes del propietario, ordenados por impacto

1. Credenciales reales de **Mercado Pago**: sin ellas no se cobra.
2. **Resend** con dominio propio: sin ellas no salen los correos de pedido ni los de acceso.
3. **Dominio propio** de la tienda.
4. **Asesor regulatorio** que apruebe las reglas de cumplimiento.
5. **Fotos y catálogo reales.**
6. **Revisión legal** de las políticas.
7. Activar en Supabase Auth la **protección contra contraseñas filtradas** (1 minuto).
8. Acceso al **equipo de Vercel** para leer los logs de producción.

## Siguiente paso exacto

Paso 1, que se ejecuta y documenta en su propia sección de `docs/plan/PROGRESS.md`:

- cobertura de las rutas críticas;
- revisar si conviene medir cobertura con `@vitest/coverage-v8`, justificado como dependencia nueva;
- limpiar las exportaciones que solo se usan dentro de su archivo.

Después, el Paso 2: índices de las 74 llaves foráneas con `EXPLAIN` y revisión adversarial.
