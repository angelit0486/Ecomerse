# Línea base de PRUVA — 2026-11-28

> Protocolo de mejora continua (propietario, 2026-11-28): auditoría → línea base →
> plan con criterios de aceptación → implementación aislada → auditoría posterior →
> verificación repetida. Este informe es la **línea base**: no cambia código.
> Horas en America/Hermosillo (UTC-7) salvo que se indique.

## 1. Rama de trabajo y por qué

| Rama                                                                | Commit    | Fecha            | Relación                                                                       |
| ------------------------------------------------------------------- | --------- | ---------------- | ------------------------------------------------------------------------------ |
| `claude/ecommerce-regulated-platform-41vu1e` (despliegue / staging) | `9fd3e34` | 2026-11-26 18:52 | **idéntica** a `producto/orden-10` (0 / 0)                                     |
| `producto/orden-10`                                                 | `9fd3e34` | 2026-11-26 18:52 | incluye el trabajo del 26-nov (métricas de visitantes, PERF-02 «Mis clientes») |
| `main`                                                              | `ea0176f` | 2026-10-16       | 398 commits detrás de la de despliegue, 0 delante                              |
| `audit/hardening-capacity-2026-11`                                  | `dd85fbc` | 2026-11-11       | 143 commits detrás, 0 delante (ya contenida)                                   |

**Base elegida: `9fd3e34`** (la rama de despliegue, que hoy es el mismo commit que
`producto/orden-10`). Contiene todo lo de orden-10 y es lo que corre en staging, así
que una mejora medida aquí es comparable con lo desplegado. Las ramas de mejora salen
de este commit.

PR abiertos nuestros (todos 15 commits detrás de la base; nada se une sin OK):

| PR                                          | Rama                              | Estado                                                                                                             |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| #37 Promociones y mayoreo                   | `feat/promociones-mayoreo`        | **no está marcado como borrador** en GitHub (el título dice «BORRADOR»); espera migraciones de staging (issue #18) |
| #38 Checkout sin cuelgue (F-08)             | `fix/checkout-validacion-rapida`  | borrador                                                                                                           |
| #39 Vistas previas no migran staging (T-10) | `fix/migraciones-solo-produccion` | borrador                                                                                                           |

## 2. Controles obligatorios sobre `9fd3e34`

Local = esta máquina (8 CPU, 15 GB, Node 24.22.1, pnpm 10.28.0, PostgreSQL 17.7 local
desechable). CI = GitHub Actions, ejecuciones #484 (rama de despliegue) y #483
(orden-10), ambas sobre `9fd3e34`, 2026-11-27 00:41.

| Control                                            | Local                                                  | CI #484                          | CI #483                                              |
| -------------------------------------------------- | ------------------------------------------------------ | -------------------------------- | ---------------------------------------------------- |
| ESLint (`--max-warnings=0`)                        | ✅ 20.7 s                                              | ✅                               | ✅                                                   |
| Prettier                                           | ✅ 13.1 s                                              | ✅                               | ✅                                                   |
| TypeScript                                         | ✅ 17.7 s                                              | ✅                               | ✅                                                   |
| Unitarias (Vitest)                                 | ✅ 209 archivos · **1,796 pruebas** · 7.7 s            | ✅ 209 archivos                  | ✅                                                   |
| Build (`next build`, variables ficticias de CI)    | ✅ 26 s en total; compilación 6.4 s, TypeScript 16.3 s | ✅ compilación 10.2 s, TS 18.3 s | ✅                                                   |
| Migraciones (183) + pgTAP                          | ✅ 160 archivos · **3,330 pruebas** · 29 s             | ✅ 160 · 3,330 · 33 s            | ✅                                                   |
| Integración (Vitest contra PostgreSQL)             | ✅ 43 archivos · **468 pruebas**                       | ✅ 43 archivos                   | ✅                                                   |
| `db:test` completo (migrar + pgTAP + integración)  | ✅ 230 s                                               | ✅ 4 min 33 s (job)              | ✅ 3 min 59 s                                        |
| Stack (Auth/Storage/PostgREST reales) `test:stack` | ⛔ no se puede aquí (ver §6)                           | ✅ 4 archivos · 29 pruebas       | ✅ 29                                                |
| E2E Playwright (100 specs)                         | ⛔ no se puede aquí                                    | ✅ **198 pasaron** (17.4 min)    | ❌ **1 falló**, 192 pasaron, 5 sin correr (21.7 min) |
| Escaneo de secretos                                | —                                                      | ✅                               | ✅                                                   |

Evidencia: registros locales y de CI guardados fuera del repo (máquina del agente, `/workspace/pruva-linea-base/`).

### Historial de CI en la base (orden-10 y despliegue)

16 ejecuciones del 26 al 27 de noviembre: 5 verdes y 11 rojas. Todas las rojas se
explican por tres causas, ninguna nueva:

- **E2E de Nocturno** (`storefront-look.spec.ts`), en 10 de las 11.
- **Prettier** en `docs/audit/AUDITORIA-PANEL-2026-11-26.md`, en #474 y #475; ya corregido.
- **Integración `import-5k.test.ts`** «la vista previa de 5,000 actualizaciones…», en #462 y
  #469: tope de tiempo de 5 s, medido 6.8 s en el runner. También es inestable por tiempo.

**El mismo commit `9fd3e34` pasó en #484 y falló en #483**: la prueba de Nocturno es
inestable, no un fallo determinista.

- `storefront-look.spec.ts` «nocturno: la franja de la hora de corte no mueve la página
  al cargar (CLS)»: CLS medido **0.257** contra un tope de 0.05 (#483). En #463 falló otra
  de Nocturno: «la nave sobre el título… no mueve la página».
- Viene del trabajo de apariencia Nocturno (otra sesión). No se toca en esta tanda:
  queda **registrado como regresión conocida de la base**. Una mejora nueva no se
  considera culpable si solo falla esta prueba, pero tampoco se declara «todo verde».

## 3. Los dos E2E de la ejecución #270 (commit `4eecd2f`, 2026-11-17)

**Ya no fallan.** En #483 y #484 (`9fd3e34`) pasan los dos:
`category-media.spec.ts` (3.9 s) e `import-batch.spec.ts` «18,000 filas…» (1.0 min;
en #270 tardó 5.9 min antes de fallar).

### 3.1 `category-media.spec.ts` — causa: la prueba (carrera), no Storage ni el flujo

- Falla en #270: `expect(media.every(… status === "ready")).toBe(true)` → `false`.
- La subida dispara una pasada inmediata de la cola. La prueba llamaba a `runJobs()` y
  leía `media.status` al instante, pero `runJobs()` **no toma un trabajo que ya está en
  proceso**: si la pasada inmediata seguía optimizando la foto, el estado aún era
  `processing`. El flujo de medios termina bien; la aserción llegaba antes.
- Arreglo ya en la base: `f55a681` (17-nov) espera con `expect.poll` (30 s) a que las
  dos fotos estén `ready`, usando `runJobs()` como respaldo idempotente. Sin cambios en
  código de producción. La ejecución completa queda verde desde #273 (`af03fa5`).

### 3.2 `import-batch.spec.ts` — causa: tiempo de aplicación de una parte de ~5,000 filas

- Falla en #270: tras «Aplicar el lote», no aparece «La parte 3 no se pudo aplicar:
  Fila 14995…». La parte 3 debía fallar por un SKU ya ocupado; en cambio la aplicación de
  partes de 4,998 filas rozaba el `statement_timeout` del worker (30 s en local/CI, 55 s
  alojado) y agotaba sus reintentos por tiempo: el lote no llegaba al mensaje esperado
  dentro del tiempo de la prueba.
- Evidencia: medición de ADR-067 (una parte de 4,998 filas en base sin estadísticas:
  **29.5 s antes → 12.1 s** con la migración `20261117000100`), y la duración de la prueba
  (5.9 min en #270 → 1.0 min en #484). El registro de #270 solo guarda las últimas 100
  líneas del stack, así que la línea del tiempo agotado no quedó: la causa se sostiene en
  la medición y no en ese registro.
- Arreglo ya en la base: `af03fa5` (aplicación más rápida, migración `20261117000100`) y
  `7be16ad` (partes de 2,500 filas, hasta 20 por lote, ADR-067). **Ojo:** ADR-067 dice
  «propuesto» en `docs/DECISIONS.md` y sus migraciones van en la ventana de staging aún
  pendiente: en CI pasa, en staging todavía no está aplicado.

### 3.3 Los «objetos de Storage inexistentes» del registro — causa: datos de prueba

- 28 respuestas `NoSuchKey` en #270. Son rutas como `store-media/e2e/<run>/frente.webp`,
  `banner.webp`, `chocolate.webp`, `proteina-*.webp`: filas de `public.media` que las
  pruebas insertan directo en la base **sin subir el archivo** (`panel-mobile`,
  `product-management`, `photo-blend`, `storefront-look`). El navegador pide la imagen y
  Storage responde 404. Las de `display.webp` / `original.jpg` de productos son fotos
  pedidas antes de terminar de procesarse.
- No causan ninguno de los dos fallos. Solo se ven cuando un job falla porque el paso
  «Logs del stack» solo corre con `if: failure()` (por eso #484 muestra 0).

## 4. Tamaños del build (`.next/static`, build local)

| Medida                  | Valor                                      |
| ----------------------- | ------------------------------------------ |
| Archivos JS del cliente | 81                                         |
| JS total                | 1,560 KiB sin comprimir · **514 KiB gzip** |
| CSS total               | 74 KiB                                     |
| Fragmento más grande    | 224 KiB (70 KiB gzip)                      |
| `.next` completo        | 181 MB                                     |

Next 16 ya no imprime «First Load JS» por ruta; estas cifras son la referencia para
comparar después (mismo cálculo en cada rama).

## 5. Tiempos de respuesta medibles

**Desde esta máquina** (GET públicos de solo lectura, 10 muestras, 2026-11-28 ~06:20):

| URL                                          | Mediana TTFB | p90    |
| -------------------------------------------- | ------------ | ------ |
| `pruva-tienda-demo2.vercel.app/`             | 346 ms       | 411 ms |
| `…/productos`                                | 322 ms       | 352 ms |
| `…/productos/creatina-monohidratada-ejemplo` | 333 ms       | 364 ms |
| `pruva-panel-demo.vercel.app/`               | 286 ms       | 295 ms |
| `alien-demon-market.vercel.app/`             | 329 ms       | 354 ms |

`pruva-tienda-demo.vercel.app` redirige (301) a `alien-demon-market.vercel.app`.
Incluye la red de esta máquina a Vercel; sirve para comparar contra sí misma, no como
tiempo del servidor. No se confirmó qué commit sirve cada dominio.

**Lighthouse móvil** (auditoría de ventas, 2026-11-26 02:42):

| Página       | Rendimiento | TTFB  | FCP    | LCP    | TBT    | CLS |
| ------------ | ----------- | ----- | ------ | ------ | ------ | --- |
| Inicio demo2 | 99          | 58 ms | 1.16 s | 1.96 s | 44 ms  | 0   |
| Catálogo     | 97          | 51 ms | 1.13 s | 2.55 s | 32 ms  | 0   |
| Producto     | 92          | 42 ms | 1.20 s | 2.88 s | 204 ms | 0   |
| Alien Demon  | 98          | 81 ms | 1.32 s | 2.13 s | 58 ms  | 0   |

**Capacidad local** (cola real, PostgreSQL local, almacenamiento en memoria), RM-10
existente re-ejecutado hoy (`scripts/capacity/media.sh`, 213 s, 4/4 pruebas):

| Foto                       | Pasadas a la vez | ms por foto   |
| -------------------------- | ---------------- | ------------- |
| catálogo 1200 px (73 KB)   | 1 / 2 / 4        | 187 / 96 / 46 |
| celular 4000×3000 (438 KB) | 1 / 4            | 753 / 209     |
| PNG 1600 px (205 KB)       | 1                | 308           |

## 6. Lo que no se puede correr en esta máquina

- Solo sale HTTPS: no hay acceso a la base de staging ni de producción.
- Sin Docker ni stack local de Supabase (Auth, Storage, PostgREST): **el job «Stack» y
  los E2E solo corren en CI**. Cada rama de mejora se empuja para que CI los ejecute.
- Build local hecho solo con las variables ficticias de CI (sin `.env`, sin secretos,
  sin `MIGRATION_DATABASE_URL`: no migra nada).

## 7. Criterio de «sin regresión» para las siguientes fases

Una rama de mejora pasa si, frente a esta línea base:

1. Lint, formato, tipos, unitarias y build verdes, con **≥ 1,796** unitarias.
2. `db:test` verde con **≥ 3,330** pgTAP y **≥ 468** de integración.
3. CI: «Stack» con ≥ 29 pruebas verdes y E2E sin fallos nuevos. Las únicas excepciones
   aceptadas son las dos pruebas inestables del §2 (Nocturno CLS e `import-5k` por
   tiempo), y deben decirse cuando aparezcan.
4. Tamaño JS del cliente sin crecer más de 2 % sin justificación.
5. Ninguna prueba desactivada, saltada ni debilitada.
