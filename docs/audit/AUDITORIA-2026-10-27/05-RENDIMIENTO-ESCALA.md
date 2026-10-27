# 05 · Rendimiento y escalabilidad — Auditoría 2026-10-27

Auditor: rendimiento y escala (solo lectura). Prefijo de hallazgos: **REN-**.
Base: HEAD `be5541d`, build de producción en `.next/` (08:58 UTC), mediciones Lighthouse del 2026-10-27 en el entorno local.

> **Términos.** _LCP_ (Largest Contentful Paint): cuánto tarda en verse el elemento principal. _CLS_ (Cumulative Layout Shift): cuánto "brinca" el contenido mientras carga (bueno ≤ 0.1). _TBT_ (Total Blocking Time): tiempo en que el navegador no responde por JavaScript. _FCP_: primer contenido visible. _TTFB_: tiempo hasta el primer byte del servidor. _RSC prefetch_: petición que Next.js hace en segundo plano para precargar la página de un enlace visible. _Egress_: datos que salen del proveedor hacia el visitante (se cobran). _Invocación_: cada vez que se ejecuta una función del servidor en Vercel.

> **Advertencia sobre el entorno.** Todo lo medido es local (Lighthouse móvil simulado: 4× CPU, 150 ms RTT, ~1.6 Mbps), con imágenes de demostración muy ligeras (8–30 KB) y sin tráfico real. No representa producción. Al terminar el análisis el servidor local (`:3000`) y Postgres local (`:5432`) ya no respondían (`curl` código 7, puertos sin escuchar); por regla no se reinició nada, así que **no se hizo la prueba de carga** ni mediciones Lighthouse nuevas.

---

## 1. Resumen

El código está bien encaminado en lo estructural (caché de datos por tienda, paginación por cursor, índices de búsqueda, límites de sharp, cola con `SKIP LOCKED` y presupuesto de tiempo). Los riesgos de escala del primer año no están en la base de datos sino en **tres decisiones operativas**:

1. **Imágenes servidas en su tamaño original** (hasta 2,400 px tras el aligerado del navegador; hasta 4,096 px del lado del servidor) en tarjetas de ~162 px, sin `srcset` ni variantes. Con fotos reales esto hará caer el LCP en móvil y disparará el egress de Supabase. Los puntajes de Lighthouse de 91–99 están inflados por las imágenes de demostración.
2. **La cola de trabajos en segundo plano depende de un cron por minuto (Vercel Pro).** En Hobby es diario, y ni el webhook de pago ni el checkout disparan la cola. Mientras tanto, los correos de pedido y pago, la liberación de stock reservado y la conciliación de pagos pueden esperar hasta 24 h.
3. **Cada página vista genera de 18 a 24 peticiones dinámicas de prefetch.** Las páginas no se pueden cachear en CDN por el nonce de CSP, así que cada una es una invocación. Eso multiplica invocaciones y peticiones por ~20×.

Con los supuestos de §6, la combinación **Vercel Pro + Supabase Pro (Micro) + PITR** cubre hasta ~1,000 pedidos/día por **~US$ 150–600/mes** según se resuelva REN-01. Sin resolver REN-01, el egress de imágenes es el primer límite pagado que se rompe (~25 pedidos/día).

---

## 2. Mediciones Core Web Vitals (Lighthouse 12.8.2, móvil, local) [VERIFICADO]

Fuente: `scratchpad/q1/lh/*.json` (extraídas con script; `finalDisplayedUrl`, `audits.*.numericValue`, `network-requests`).

### Tiendas

| Reporte | Página                             | Perf   | FCP ms | LCP ms   | TBT ms   | CLS   | TTFB ms | Peso KB | Peticiones | JS KB | Img KB | JS sin usar KB |
| ------- | ---------------------------------- | ------ | ------ | -------- | -------- | ----- | ------- | ------- | ---------- | ----- | ------ | -------------- |
| demo-1  | `/` (portada)                      | **69** | 1155   | 2736     | **1749** | 0.000 | 48      | 386     | 41         | 147   | 85     | 27             |
| demo-2  | `/productos`                       | 83     | 1538   | **3202** | 408      | 0.003 | 45      | 393     | 50         | 146   | 85     | 27             |
| demo-3  | ficha                              | 94     | 1539   | 3002     | 44       | 0.006 | 38      | 336     | 41         | 150   | 32     | 26             |
| demo-4  | `/carrito`                         | 96     | 1384   | 2643     | 42       | 0.010 | 23      | 295     | 36         | 147   | 0      | 27             |
| demo-5  | "checkout" → terminó en `/carrito` | 93     | 1828   | 2984     | 46       | 0.010 | 21      | 294     | 37         | 147   | 0      | 27             |
| demo2-1 | `/`                                | 96     | 1398   | 2722     | 51       | 0.006 | 71      | 336     | 38         | 147   | 80     | 27             |
| demo2-2 | `/productos`                       | 93     | 1386   | 3128     | 40       | 0.009 | 46      | 353     | 49         | 146   | 81     | 27             |
| demo2-3 | ficha                              | 96     | 1388   | 2636     | 80       | 0.007 | 57      | 301     | 40         | 150   | 33     | 27             |
| demo2-4 | `/carrito`                         | 99     | 1223   | 1823     | 81       | 0.010 | 18      | 256     | 35         | 147   | 0      | 27             |
| demo2-5 | "checkout" → `/carrito`            | 96     | 1687   | 2679     | 49       | 0.010 | 20      | 258     | 36         | 147   | 0      | 27             |

- Elemento LCP: portada = banner `<img … width=1600 height=900 fetchpriority=high>` (`…/banner/…/original.webp`, 30 KB); listado y ficha = foto de producto `width=800 height=800` (`original.webp`, 8–10 KB).
- Recursos más pesados en todas las páginas: chunk `0rebeqrd3-4an.js` (react-dom, 71 KB transferidos; 27–28 KB sin usar), fuentes Inter (47 KB) y Montserrat (37 KB), chunk `2gtsjhcqmmx6s.js` (36 KB). **Las dos fuentes pesan más que todas las imágenes del listado de demostración.**
- `uses-responsive-images` estima un ahorro de 48–73 KiB y `image-delivery-insight` de 74–79 KiB, **aun con imágenes de 8–30 KB** (ver REN-01).
- `demo-1` (portada, 1.ª corrida) tuvo TBT de 1,749 ms y "main-thread" de 5.1 s. Las demás corridas de portada (demo2-1) dan 51 ms: probablemente fue una corrida en frío y es un valor atípico, pero no se pudo repetir (servidor caído).
- **Ninguna corrida midió el checkout real**: con el carrito vacío, `demo-5` y `demo2-5` terminaron en `/carrito` (REN-12).
- LCP de 2.6–3.2 s en listado y ficha: en el límite de "bueno" (≤ 2.5 s) bajo la red simulada, con imágenes de 8–10 KB.

### Panel

| Reporte            | Página         | Perf    | LCP ms      | TBT ms   | CLS               | TTFB ms   | JS KB         | JS sin usar KB |
| ------------------ | -------------- | ------- | ----------- | -------- | ----------------- | --------- | ------------- | -------------- |
| panel-1 / panelb-1 | Inicio         | 88 / 86 | 2492 / 2594 | 59 / 121 | **0.198 / 0.198** | 353 / 234 | 145           | 26             |
| panel-2 / panelb-2 | Productos      | 98 / 99 | 2285 / 1841 | 46 / 65  | 0.001             | 231 / 244 | 151           | 26             |
| panel-3 / panelb-3 | Pedidos        | 99 / 99 | 1985 / 2004 | 50 / 78  | 0.001 / 0.000     | 240 / 272 | 147           | 26             |
| panel-4 / panelb-4 | Apariencia     | 96 / 94 | 1697 / 2783 | 205 / 55 | 0.000 / 0.080     | 235 / 232 | **240 / 210** | **89 / 70**    |
| panel-5 / panelb-5 | Ajustes tienda | 97 / 99 | 1968 / 1846 | 163 / 59 | 0.059             | 267 / 236 | 178 / 148     | 45 / 26        |
| panelb-6           | Equipo         | 98      | 2221        | 92       | 0.003             | 228       | 171           | 24             |
| panelb-7           | Configuración  | 98      | 2144        | 65       | 0.000             | 276       | 164           | 26             |

- CLS de 0.198 en Inicio, causado por la sección "Por atender". Lighthouse lo atribuye a `Web font loaded: inter_latin_wght_normal…woff2` (REN-06).
- El TTFB del panel (~230–350 ms) es mayor que el de la tienda (~20–70 ms): son lecturas por usuario sin caché (correcto por la regla 7).

### Datos de campo (CrUX)

**[NO VERIFICADO].** Las tiendas en línea son `*.vercel.app` de demostración, sin tráfico ni pedidos (0 pedidos en staging). CrUX solo publica orígenes con tráfico suficiente. La consulta a PageSpeed Insights vía fetch web respondió `CRAWL_HTTP_429`, y el contenedor no alcanza `*.vercel.app` ni googleapis directamente.

---

## 3. Bundles (`.next/static`) [VERIFICADO]

- `.next/static` = 2.0 MB, 66 chunks JS.
- Mayores (bruto / gzip): `0rebeqrd3-4an.js` 230 KB / 72 KB (react-dom, en todas las rutas); `18jh6l_5rk_ks.js` 159 KB / 45 KB (**zod**, solo en `admin/[storeHandle]/apariencia` y `contenido/paginas/[pageId]`, según los `client-reference-manifest`); `2gtsjhcqmmx6s.js` 136 KB / 37 KB; `0cz1d0mv5g_q7.js` 113 KB / 39 KB; `42y8r1-7ue-gw.js` 62 KB / 18 KB.
- Dependencias de cliente: React 19, radix-ui y zod (solo en 2 pantallas del panel). No hay librerías pesadas (gráficas, editores, lodash) en la tienda. `sharp`, `postgres` y `sanitize-html` son solo de servidor.
- La tienda carga ~146–151 KB de JS transferido en todas las páginas. Es la base del runtime de Next/React; no hay JS de terceros.

---

## 4. Hallazgos

### REN-01 · Alta · Imágenes del catálogo sin variantes ni `srcset`: se sirve el original a tarjetas de ~162 px

- **Evidencia [VERIFICADO]:**
  - `src/server/media/image.ts:18,96-104`: el worker re-codifica a un solo archivo, de hasta `MAX_IMAGE_SIDE = 4096`.
  - `src/server/media/storage.ts:31`: la única ruta válida es `…/original.(jpg|png|webp|avif)`, sin variantes.
  - `docs/DECISIONS.md` D-LOTE-02: el navegador reduce a 2,400 px en WebP 0.86 antes de subir.
  - `src/server/storefront/catalog.ts:834`: `mediaUrl()` devuelve la URL pública del original en Supabase Storage. No se usa `next/image` en ningún sitio (`grep`). El único `srcSet` es el del banner móvil (`home-sections.tsx:157`).
  - Lighthouse: `uses-responsive-images` y `image-delivery-insight` marcan ahorros de 48–79 KiB **con imágenes de demostración de 8–30 KB** (800×800 en tarjetas de 162 px).
  - La magnitud con fotos reales es **[INFERIDO]**: una foto de producto de 2,400×2,400 en WebP suele pesar del orden de 150–400 KB (supuesto, no medido). Un listado de 10–24 tarjetas pasaría de ~85 KB a ~2–6 MB.
- **Impacto:** LCP del listado y la ficha por encima de 2.5 s en 4G real (conversión). El egress de Storage crece ~10–30× (ver §6: con fotos reales sin variantes, los 250 GB de egress cacheado de Supabase Pro se agotan cerca de ~25 pedidos/día).
- **Recomendación (tarea):** en el worker de medios (`media.process`), generar con sharp las variantes 160/320/640/1280 px en WebP (y opcionalmente AVIF) junto al original. Exponer `srcset` + `sizes` en tarjeta, ficha y banner, con `loading="lazy"` fuera del primer pliegue (ya existe). Es un cambio del contrato de rutas de medios (`MEDIA_PATH_RE`), así que requiere un ADR.
  - Alternativas: Supabase Image Transformations (US$ 5 por 1,000 imágenes origen después de 100, solo Pro) o Vercel Image Optimization (requiere ajustar la CSP `img-src` y `next.config` `images.remotePatterns`). Con catálogos grandes, las variantes propias tienen costo marginal ~0.
  - Re-medir con fotos reales (2,400 px) antes del lanzamiento.

### REN-02 · Alta · La cola de jobs depende del cron por minuto; en Vercel Hobby los correos de pedido, la expiración de reservas y la conciliación esperan hasta 24 h

- **Evidencia:**
  - [VERIFICADO] `vercel.json`: `"schedule": "0 12 * * *"` (diario). `docs/runbooks/database-roles.md:93` y `DECISIONS.md` N-4/D-F9-17 lo reconocen; no hay `cron.schedule` de pg_cron en ninguna migración (`grep`).
  - [VERIFICADO] `processQueueSoon` solo se llama desde acciones del panel (productos, importar, dominio). Los webhooks `src/app/api/webhooks/payments/{mercadopago,stripe}/route.ts` y el checkout de la tienda **no** lo llaman.
  - Por lo tanto `order.created`, `order.paid`, `payment.failed`, `orders.expire` (libera stock reservado de pedidos no pagados), `payments.reconcile` (respaldo si el webhook falla), `catalog.apply_sales` y `catalog.publish_scheduled` corren solo cuando pasa el cron.
  - `system.enqueue_maintenance()` también se ejecuta solo desde `/api/jobs/run` (`route.ts`), no desde `processQueueSoon`.
  - [VERIFICADO, fuente web] La documentación de Vercel dice que Hobby limita los crons a una vez al día con precisión de ±59 min, y que **"the Hobby plan restricts users to non-commercial, personal use only"**.
- **Impacto:** en producción con Hobby, el cliente no recibe la confirmación del pago, el stock queda apartado hasta 24 h y un pago con webhook perdido no se concilia en el día. Además, Hobby no está permitido para uso comercial.
- **Recomendación:** condición de salida a producción: Vercel Pro con `* * * * *` (ya documentado), **o** pg_cron + pg_net llamando a `/api/jobs/run` con HMAC (el runner ya lo soporta). Además, llamar `processQueueSoon("payment_webhook")` tras procesar un webhook verificado y tras crear el pedido, para que el correo salga en segundos sin depender del cron (no cambia el contrato de jobs; el reclamo es atómico). Añadir una alerta si el job `queued` más antiguo tiene más de 5 min.

### REN-03 · Media · 18–24 prefetch RSC dinámicos por página vista multiplican invocaciones y peticiones (~20×)

- **Evidencia [VERIFICADO]:**
  - En `network-requests`: portada 18 peticiones `?_rsc=` (31 KB), listado 24 (40 KB), ficha 21 (34 KB). Todas responden 200 desde el servidor, en 17–64 ms cada una (p. ej. `/cuenta?_rsc=…`, `/carrito?_rsc=…`, `/productos?objetivo=energia&_rsc=…`).
  - Las páginas de la tienda son dinámicas por el nonce de CSP (D-F5-04), así que cada prefetch pasa por el proxy y por una función. 27 archivos de la tienda usan `next/link`; ninguno fija `prefetch` (`grep prefetch` = 0).
- **Impacto [INFERIDO]:** con ~4 páginas por visita, ~80 invocaciones y ~100 peticiones al CDN por visita. Con los supuestos de §6, el millón de invocaciones/mes incluido (Hobby y Pro) se agota hacia **~6 pedidos/día**. En Pro, el costo extra es moderado (US$ 0.60 por millón de invocaciones, US$ 2 por millón de peticiones CDN, ~US$ 10–30/mes a 100 pedidos/día), pero también suma CPU y conexiones a la base en picos o con bots.
- **Recomendación:** `prefetch={false}` en enlaces masivos (rejilla de productos, pie de página, menús de filtros, `/cuenta`, `/carrito`) y dejar el prefetch solo para la navegación principal. Medir antes y después el número de peticiones por visita. Evaluar `loading.tsx` para que el prefetch se corte en el límite de carga.

### REN-04 · Media · `system.jobs` crece sin límite: la función de purga existe pero nadie la llama

- **Evidencia [VERIFICADO por lectura]:**
  - `supabase/migrations/20261005000300_foundation_jobs_and_settings.sql:250` define `system.purge_finished_jobs(interval, interval)`. No hay llamadas en `src/` ni en otras migraciones (`grep`), y no está en `enqueue_maintenance()` (`20261018003000_scheduled_sale_prices.sql`).
  - Con el cron por minuto, `enqueue_maintenance` crea `orders.expire`, `catalog.publish_scheduled` y `catalog.apply_sales` **cada minuto** (clave `YYYY-MM-DDTHH24:MI`), más `payments.reconcile` cada 10 min y 3 diarios: ~4,470 jobs/día, **~1.6 millones de filas/año** solo de mantenimiento, más los de correo y medios.
  - Tampoco se encontró purga de `carts` (`grep "delete from … carts"` = 0) [INFERIDO: carritos abandonados se acumulan].
- **Impacto:** crecimiento de tabla e índices (`jobs_finished_idx`, `jobs_store_idx`, unicidad de `dedup_key` si aplica) y de respaldos y PITR. No rompe el reclamo (índice parcial `jobs_ready_idx`), pero sí consume la cuota de disco (8 GB en Pro) y vuelve más lentos los conteos y el panel de salud.
- **Recomendación:** añadir `system.purge_finished_jobs('7 days','30 days')` a `enqueue_maintenance` (diario, con clave por día), y una purga de carritos expirados. Esto requiere migración forward-only y pgTAP.

### REN-05 · Media · Caché de datos con claves no acotadas (búsqueda libre y combinaciones de filtros)

- **Evidencia [INFERIDO]:** `catalog.ts:302,333`. `list_products` y `list_facets` pasan por `cachedRead` con `filters` como argumento, y `unstable_cache` añade los argumentos serializados a la clave, así que cada texto de búsqueda (`q`) y cada combinación de filtros u orden crea una entrada distinta durante 60 s.
- **Impacto:** cachear búsquedas que casi no se repiten aporta poco y, en Vercel, cada entrada nueva cuenta como escritura de Data Cache/ISR (Pro: "starting at $4 per 1M" escrituras; Hobby: 200 k/mes incluidas) [costo exacto de `unstable_cache` en Next 16 en Vercel: NO VERIFICADO]. Un bot que recorra filtros genera escrituras sin límite.
- **Recomendación:** no cachear cuando hay `q` libre (o normalizar y recortar a N caracteres), cachear solo filtros de la lista blanca, y limitar por IP la búsqueda (ya existe una tabla de rate limits).

### REN-06 · Media · CLS de 0.198 en Inicio del panel por la carga tardía de la fuente

- **Evidencia [VERIFICADO]:** `panel-1`/`panelb-1`: CLS 0.198 (umbral "bueno" ≤ 0.1), con causa `Web font loaded` en `section[aria-labelledby=pendientes]`. `src/app/layout.tsx:24-30`: Inter con `display: "swap"` y `preload: false` (a propósito, para que la tienda no la descargue).
- **Impacto:** salto visible en la pantalla que la dueña abre más veces (riesgo de tocar el enlace equivocado en el celular). No afecta a la tienda (CLS ≤ 0.010).
- **Recomendación:** declarar la fuente con `preload: true` en el layout de `/admin` (y en la consola) en lugar del layout raíz, o reservar la altura de la sección.

### REN-07 · Media · Presupuesto e infraestructura de producción sin cerrar; staging en Free/Hobby no sirve para validar escala ni cron

- **Evidencia [VERIFICADO]:**
  - `DECISIONS.md` D-F9-17: staging = Supabase plan gratuito + Vercel Hobby.
  - N-4 y Q-B5 asumen Pro + PITR "a confirmar".
  - Supabase Free pausa el proyecto tras 1 semana de inactividad e incluye 500 MB de base, 5 GB de egress y 1 GB de Storage.
  - "Leaked password protection" requiere Pro (pendiente conocido).
- **Impacto:** las cifras de costo de §6 dependen de pasar a Pro antes de cobrar. Sin presupuesto aprobado no hay PITR (RPO de 24 h en lugar de ≤ 5 min).
- **Recomendación:** decisión del propietario: Vercel Pro (US$ 20/mes por asiento) + Supabase Pro (US$ 25 + cómputo) + PITR (US$ 100/mes por 7 días). Activar spend caps y alertas de uso en ambos.

### REN-08 · Baja · Fuentes de la tienda (~84 KB) en la ruta crítica, más que las imágenes

- **Evidencia [VERIFICADO]:** Inter 47 KB + Montserrat 37 KB transferidas en la portada, el listado y la ficha de `demo`. Las fuentes se cargan con `next/font/local` (`_components/fonts.ts`), lo cual es correcto (autoalojadas, CSP `font-src 'self'`).
- **Recomendación:** limitar a una familia variable por tema, o subconjunto latino básico (`unicode-range`), y medir el efecto en el LCP.

### REN-09 · Baja · Conexiones a Postgres en picos: 6 por instancia contra 200 clientes del pooler Micro

- **Evidencia:** [VERIFICADO] `src/server/db/role-clients.ts:24-31`: postgres.js con `max: 3` por rol (worker y gateway) vía Supavisor en modo transacción. [VERIFICADO, web] Supabase Micro: 60 conexiones directas, **200 de pooler**; Small 400; Medium 600. [INFERIDO] Unas 33 instancias simultáneas con ambos roles abiertos agotan el pooler Micro. El panel usa PostgREST (HTTP) y no consume este pool.
- **Impacto:** solo en picos (venta flash, bots). Con Fluid compute (concurrencia dentro de la instancia) es poco probable en el primer año.
- **Recomendación:** prueba de carga en staging Pro antes del lanzamiento. Vigilar "Pooler client connections" en Supabase y subir a Small (US$ 15/mes) si superan el 60 %.

### REN-10 · Baja · Rendimiento del runner: secuencial, 1 job por reclamo, 45 s por pasada

- **Evidencia [VERIFICADO]:** `src/server/jobs/run-now.ts:17-29` (`batchSize: 1`, `deadlineMs: 45_000`, `hardDeadlineMs: 55_000`); `route.ts` `maxDuration = 60`; sharp con `timeout 15 s`.
- **[INFERIDO, supuestos]:**
  - Correos (~0.3–0.5 s por llamada a Resend, no medido): ~90–150 jobs por pasada.
  - Fotos remotas (~2–5 s de descarga + sharp): 9–20 por pasada. Un lote de 500 fotos tarda ~25–55 pasadas (≈ 25–55 min con cron por minuto, menos si hay pantallas abiertas con `resumeQueue`).
  - Una venta flash de 500 pedidos en 10 min (~1,500 correos) deja una cola de ~10–15 min.
- **Recomendación:** registrar la duración por tipo de job (ya hay logs) y medirla con Resend real. Si hace falta, permitir varias pasadas en paralelo (el reclamo ya es atómico) o separar una cola prioritaria para correos de pago.

### REN-11 · Baja · Páginas de la tienda 100 % dinámicas (sin caché de HTML en CDN)

- **Evidencia [VERIFICADO]:** `cache.ts:7-10` y D-F5-04: se cachean datos, no HTML, por el nonce de CSP. TTFB local de 20–70 ms con la caché de datos caliente.
- **Impacto:** cada vista es una invocación y CPU (ver REN-03). Es un costo aceptado a cambio de una CSP estricta. Reevaluar con datos reales (TTFB en Vercel desde México: NO VERIFICADO).
- **Recomendación:** medir TTFB p75 real con Speed Insights tras el lanzamiento. Si supera ~600 ms, evaluar PPR o hashes de CSP (ADR).

### REN-12 · Baja · El checkout nunca se midió con Lighthouse

- **Evidencia [VERIFICADO]:** `demo-5.json` y `demo2-5.json` tienen `finalDisplayedUrl = …/carrito`: con el carrito vacío, `/checkout` redirige.
- **Recomendación:** medir el checkout con un carrito sembrado (script Playwright que agregue un producto y luego corra Lighthouse con la cookie).

---

## 5. Caché por tags y regla 7 — controles verificados [VERIFICADO]

- **Clave por tienda y argumentos.** `cachedRead` (`cache.ts:19-29`) usa la clave `["storefront", name, storeId]`, a la que `unstable_cache` añade los argumentos, con tag `store:{id}` y TTL de 60 s. Una tienda no puede recibir datos de otra.
- **Qué se cachea:** solo lecturas públicas `storefront.*` (tienda pública, listado, facetas, marcas, ficha, ficha regulatoria [+ tag `storefront:compliance`], categorías, páginas, reseñas, calificaciones y promociones). Hay 21 lecturas en `catalog.ts` y `store-public.ts`.
- **Qué NO se cachea:**
  - lecturas de vista previa (`preview-reads.ts:9-14`, con prueba);
  - carrito, checkout, cuenta y leyendas del carrito (D-R-03);
  - todo el panel (sesión del usuario con RLS, `revalidatePath` en lugar de caché compartida).

  No se encontró ninguna lectura que dependa de la autorización dentro de `unstable_cache`. **Regla 7 cumplida.**

- **Invalidación:**
  - `invalidateStore` en las acciones del panel (catálogo, inventario, pedidos con reabasto, apariencia, contenido, pagos, cumplimiento, envíos, impuestos, proveedores, opiniones, atributos y medios) y en el worker de medios (`registry.ts`, `onPublished: invalidateStore`).
  - `invalidateCompliance` en la consola de plataforma.
  - Las importaciones y los cambios hechos por jobs (`catalog.apply_sales`, `publish_scheduled`) dependen del TTL de 60 s [INFERIDO; aceptable].
- **Host → tienda:** caché por instancia de 60 s (10 s para hosts desconocidos) en `resolve-host.ts`.
- **Medios:**
  - re-codificación con sharp, `limitInputPixels` de 40 M, `timeout` de 15 s y `sharp.cache(false)`;
  - aligerado en el navegador a 2,400 px WebP y 4 subidas en paralelo;
  - en Storage, `cacheControl: "31536000"` (`storage-admin.ts:48`) con rutas inmutables (UUID por medio), así que el caché largo es seguro.
- **HTML de imágenes:** atributos `width`/`height` en todas las imágenes (CLS de la tienda ≤ 0.010); las 4 primeras sin lazy y `fetchpriority=high` en el elemento LCP.
- **Base de datos:**
  - paginación por cursor con `limit 24`;
  - búsqueda con `websearch_to_tsquery` + GIN `(store_id, search_vector)` + trigram `(store_id, title)`;
  - cola con índice parcial `jobs_ready_idx` y reclamo `SKIP LOCKED`;
  - Supavisor en modo transacción (`prepare: false`).
- **Runner:**
  - márgenes de tiempo (45/55 s con `maxDuration` de 60);
  - `DeferJobError` devuelve el lote sin gastar intentos;
  - fallos redactados;
  - mantenimiento idempotente por clave de tiempo.
- **Bundles:** zod solo en 2 pantallas del panel; sin JS de terceros en la tienda; recursos `_next/static` con caché larga (`uses-long-cache-ttl` sin hallazgos).
- Observación (ya en la línea base, de otro auditor): los advisors de Supabase reportan 74 FKs sin índice y 105 índices sin uso. No se pudo hacer EXPLAIN porque Postgres local no respondía.

---

## 6. Límites y costos de Supabase y Vercel

### 6.1 Precios oficiales vigentes (consultados el 2026-10-27)

Fuentes:

- Supabase Pricing, <https://supabase.com/pricing>;
- Vercel Pricing, <https://vercel.com/pricing>;
- Vercel Hobby Plan, <https://vercel.com/docs/plans/hobby>;
- Vercel Cron Jobs — Usage & Pricing, <https://vercel.com/docs/cron-jobs/usage-and-pricing>.

Las páginas se leyeron con la herramienta de fetch web el 2026-10-27 (el contenedor no tiene acceso directo).

| Concepto                                 | Supabase Free     | Supabase Pro                                                                                                                                               | Vercel Hobby                         | Vercel Pro                                  |
| ---------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------- |
| Precio base                              | US$ 0             | US$ 25/mes (incluye US$ 10 de cómputo = Micro)                                                                                                             | US$ 0 (solo uso no comercial)        | US$ 20/mes                                  |
| Base de datos / disco                    | 500 MB            | 8 GB, luego US$ 0.125/GB                                                                                                                                   | —                                    | —                                           |
| Egress (sin caché)                       | 5 GB              | 250 GB, luego US$ 0.09/GB                                                                                                                                  | —                                    | —                                           |
| Egress cacheado (CDN de Storage)         | 5 GB              | 250 GB, luego US$ 0.03/GB                                                                                                                                  | —                                    | —                                           |
| Storage                                  | 1 GB              | 100 GB, luego US$ 0.0213/GB                                                                                                                                | —                                    | —                                           |
| Image Transformations                    | No incluido       | 100 imágenes origen, luego US$ 5 por 1,000                                                                                                                 | 5 k transformaciones                 | "starting at" US$ 0.05 por 1 k              |
| MAU de Auth                              | 50,000            | 100,000, luego US$ 0.00325                                                                                                                                 | —                                    | —                                           |
| Pausa por inactividad                    | tras 1 semana     | nunca                                                                                                                                                      | —                                    | —                                           |
| PITR                                     | No                | US$ 100/mes por 7 días de retención                                                                                                                        | —                                    | —                                           |
| Cómputo                                  | compartido 500 MB | Micro US$ 10 (1 GB, 60 directas / 200 pooler); Small US$ 15 (2 GB, 90/400); Medium US$ 60 (4 GB, 120/600); Large US$ 110 (2 vCPU dedicadas, 8 GB, 160/800) | —                                    | —                                           |
| Fast Data Transfer                       | —                 | —                                                                                                                                                          | 100 GB                               | 1 TB, luego desde US$ 0.15/GB               |
| Peticiones CDN                           | —                 | —                                                                                                                                                          | 1 M                                  | 10 M, luego desde US$ 2 por 1 M             |
| Invocaciones de función                  | —                 | —                                                                                                                                                          | 1 M                                  | 1 M, luego desde US$ 0.60 por 1 M           |
| CPU activa (Fluid)                       | —                 | —                                                                                                                                                          | 4 h                                  | desde US$ 0.128/h                           |
| Memoria aprovisionada                    | —                 | —                                                                                                                                                          | 360 GB-h                             | desde US$ 0.0106/GB-h                       |
| Fast Origin Transfer                     | —                 | —                                                                                                                                                          | 10 GB                                | desde US$ 0.06/GB                           |
| ISR / Data Cache (lecturas / escrituras) | —                 | —                                                                                                                                                          | 1 M / 200 k                          | desde US$ 0.40 / US$ 4 por 1 M              |
| Cron                                     | —                 | —                                                                                                                                                          | diario, ±59 min                      | cada minuto                                 |
| Duración máxima de función               | —                 | —                                                                                                                                                          | 300 s                                | 300 s por defecto, configurable hasta 800 s |
| Si se excede                             | —                 | spend cap activo por defecto                                                                                                                               | se suspende la función hasta 30 días | se cobra el excedente                       |

No se encontró en la página de Vercel Pro cuánto de cada recurso cubre exactamente el crédito mensual incluido ("Included Pro usage is now credit-based"): **[NO VERIFICADO]**. Las cifras "incluido" de Pro de la tabla son las que muestra la página de precios.

### 6.2 Supuestos explícitos (no medidos; ajustar con datos reales)

| Supuesto                                          | Valor                                                                                              | Base                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Conversión                                        | 1.5 % → **67 visitas por pedido**                                                                  | supuesto de e-commerce; no medido                               |
| Páginas por visita                                | 4                                                                                                  | supuesto                                                        |
| Peticiones al dominio de la app por visita        | ~100 (1.ª página ~40 + 3 × ~22: documento + ~20 prefetch)                                          | Lighthouse (REN-03)                                             |
| Invocaciones de función por visita                | ~80 (4 × (1 + ~20 prefetch))                                                                       | Lighthouse (REN-03); sin contar Routing Middleware              |
| Transferencia de Vercel por visita                | ~0.55 MB (1.ª página 0.3 MB sin imágenes + 3 × ~55 KB)                                             | Lighthouse                                                      |
| Imágenes (egress cacheado de Supabase) por visita | **demo: 0.2 MB · fotos reales sin variantes: ~5 MB · con variantes (REN-01): ~0.4 MB**             | Lighthouse (demo) + supuesto de 150–400 KB por foto de 2,400 px |
| CPU activa por visita                             | ~0.5 s (render ~20 ms × 4 + prefetch ~5 ms × 80)                                                   | supuesto, no medido                                             |
| Disco por pedido                                  | ~75 KB (≈ 25 filas: pedido, ~3 partidas, pago, eventos, movimientos, auditoría, jobs, con índices) | supuesto, no medido (Postgres local caído)                      |
| Jobs de mantenimiento                             | ~4,470/día (REN-04)                                                                                | código                                                          |
| Storage por producto                              | 5 fotos × ~250 KB = 1.25 MB                                                                        | supuesto                                                        |

### 6.3 Escenarios (mensual, una sola organización/proyecto, 30 días)

| Métrica                                            | 10 pedidos/día (20 k visitas)            | 100 pedidos/día (201 k visitas) | 1,000 pedidos/día (2.0 M visitas) | Límite que se rompe primero                                               |
| -------------------------------------------------- | ---------------------------------------- | ------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| Invocaciones Vercel                                | 1.6 M                                    | 16 M                            | 160 M                             | **Hobby y Pro (1 M incluido) a ~6 pedidos/día**                           |
| Peticiones CDN Vercel                              | 2 M                                      | 20 M                            | 200 M                             | Hobby (1 M) a ~5 pedidos/día; Pro (10 M) a ~50 pedidos/día                |
| Fast Data Transfer                                 | 11 GB                                    | 110 GB                          | 1.1 TB                            | Hobby (100 GB) a ~90 pedidos/día; Pro (1 TB) a ~900 pedidos/día           |
| CPU activa                                         | ~3 h                                     | ~28 h                           | ~280 h                            | Hobby (4 h) a ~14 pedidos/día                                             |
| Egress de imágenes, demo                           | 4 GB                                     | 40 GB                           | 400 GB                            | Supabase Free (5 GB) a ~12 pedidos/día; Pro (250 GB) a ~600 pedidos/día   |
| **Egress de imágenes, fotos reales sin variantes** | **100 GB**                               | **1 TB**                        | **10 TB**                         | **Free de inmediato; Pro (250 GB) a ~25 pedidos/día**                     |
| Egress de imágenes, con variantes                  | 8 GB                                     | 80 GB                           | 800 GB                            | Pro a ~300 pedidos/día                                                    |
| Crecimiento de base por pedidos                    | 23 MB/mes                                | 225 MB/mes                      | 2.25 GB/mes                       | Free (500 MB) en ~2 meses a 100/día; Pro (8 GB) en ~3.5 meses a 1,000/día |
| Jobs sin purga (REN-04)                            | ~134 k filas/mes en todos los escenarios | —                               | —                                 | —                                                                         |
| Conexiones del pooler                              | bajo                                     | bajo                            | picos posibles                    | Micro: 200 clientes (REN-09)                                              |

**Costo mensual estimado (US$, sin impuestos)** con Vercel Pro (1 asiento) + Supabase Pro (Micro) + PITR de 7 días (US$ 100):

| Escenario                                          | Fijo (20 + 25 + 100) | Vercel variable                                                     | Supabase variable (imágenes sin variantes) | Supabase variable (con variantes) | **Total sin / con REN-01**             |
| -------------------------------------------------- | -------------------- | ------------------------------------------------------------------- | ------------------------------------------ | --------------------------------- | -------------------------------------- |
| 10 pedidos/día                                     | 145                  | ~0–1 (0.6 M invocaciones extra ≈ 0.4)                               | 0                                          | 0                                 | **~145 / ~145**                        |
| 100 pedidos/día                                    | 145                  | ~33 (15 M invocaciones ≈ 9; 10 M CDN ≈ 20; CPU ≈ 4)                 | ~23 (750 GB × 0.03)                        | 0                                 | **~200 / ~178**                        |
| 1,000 pedidos/día                                  | 145 + Small 15       | ~470 (159 M invocaciones ≈ 95; 190 M CDN ≈ 380; FDT ≈ 15; CPU ≈ 36) | ~293 (9.75 TB × 0.03) + disco ≈ 3          | ~17                               | **~925 / ~650**                        |
| 1,000 pedidos/día + REN-03 resuelto (prefetch ÷ 5) | 160                  | ~120                                                                | —                                          | ~17                               | **~300 con REN-01 y REN-03 resueltos** |

**Por número de tiendas (Storage, 1.25 MB/producto):** 10 tiendas × 500 productos = 6 GB; 100 tiendas × 500 productos = 62 GB (dentro de los 100 GB de Pro); el límite de 100 GB de Storage se cruza hacia **~160 tiendas de 500 productos**, y luego cuesta solo US$ 0.0213/GB. El tráfico (no el número de tiendas) es lo que manda en el costo. Con Supabase Image Transformations en vez de variantes propias, 10 tiendas × 500 productos × 3 fotos = 15 k imágenes origen ≈ **US$ 74/mes**; 100 tiendas ≈ **US$ 750/mes** (por eso se recomienda generar las variantes propias).

> Lectura: el primer límite pagado relevante es el **egress de imágenes** (REN-01); el segundo, las **peticiones e invocaciones por prefetch** (REN-03). La base de datos y el cómputo no son el cuello de botella del primer año con estos supuestos.

---

## 7. Tareas propuestas (priorizadas)

1. **[REN-02]** Antes de cobrar: Vercel Pro con cron `* * * * *` (o pg_cron + pg_net firmado con HMAC); `processQueueSoon` tras un webhook verificado y tras crear el pedido; alerta de antigüedad de la cola (> 5 min).
2. **[REN-01]** ADR + implementación de variantes de imagen (160/320/640/1280 WebP) en `media.process`, `srcset`/`sizes` en tarjeta, ficha y banner; re-medir Lighthouse con fotos reales de 2,400 px.
3. **[REN-03]** `prefetch={false}` en rejillas, pie y enlaces secundarios; medir peticiones por visita antes y después.
4. **[REN-04]** Migración: purga diaria de jobs terminados (7/30 días) y de carritos expirados dentro de `enqueue_maintenance`, con pgTAP.
5. **[REN-05]** No cachear búsquedas libres; normalizar filtros; limitar la búsqueda por IP.
6. **[REN-07]** Decisión del propietario sobre el presupuesto (§6.3) y activar spend caps y alertas de uso en Vercel y Supabase.
7. **[REN-06]** Precargar Inter en el layout del panel y la consola.
8. **[REN-09, REN-10, REN-11, REN-12]** Prueba de carga en staging Pro (k6 o autocannon, ≤ 50 usuarios virtuales) para medir TTFB p50/p95, conexiones del pooler y duración por tipo de job; Lighthouse del checkout con carrito sembrado; Speed Insights o CrUX tras el lanzamiento.
9. **[REN-08]** Una familia tipográfica por tema y subconjunto latino.

---

## 8. No verificado y por qué

- **Prueba de carga local (p50/p95):** el servidor `:3000` dejó de responder durante la auditoría (conexión rechazada). Por regla no se reinició.
- **Lighthouse adicional y del checkout:** misma causa.
- **EXPLAIN y tamaño real por pedido:** Postgres local (`:5432`) no estaba escuchando. Los KB por pedido son un supuesto.
- **CrUX y PageSpeed de los sitios en línea:** sin tráfico real; PageSpeed respondió 429; el contenedor no alcanza `*.vercel.app`.
- **Vercel** (uso real, región de funciones, TTFB en producción, cómo se factura `unstable_cache`, reparto del crédito de Pro): conector con 403.
- **Peso real de las fotos de 2,400 px y latencia de Resend:** sin catálogo real ni credenciales; son supuestos marcados.
