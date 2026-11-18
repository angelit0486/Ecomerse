# Alien Demon Exotics — Informe de QA del rediseño «Nocturno»

Fecha: 2026-11-18 (hora de Hermosillo). Todo se midió en la caja de trabajo, contra un **stack local** (Postgres embebido + GoTrue + PostgREST + Storage + Mailpit, `scripts/dev/stack.sh`), con la app compilada (`next build` + `next start`). Ninguna prueba tocó tiendas reales ni demo en la nube.

## Datos de prueba

Base local `pruva_capturas_ad`. La tienda local «demo» se renombró a «Alien Demon Exotics (DEMO)» con 10 productos ficticios no regulados (estuche, encendedor, playera, gorra, figura, stickers, charola, taza, póster, mochila), todos marcados «(DEMO)», arte SVG generado y textos marcadores. Precios, ofertas y existencias de esas capturas son **datos inventados del entorno local**, no de la tienda real, y no están en el código. Para preparar esa base se ejecutó una vez `node scripts/dev/demo-seed.mjs` **solo contra la base local** (el script verifica que sea local) y luego los ajustes DEMO propios. Los scripts de datos viven en `.stack/fixtures/` (ignorado por git; no se suben).

## Resultados

| Verificación                                   | Resultado                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` (eslint, 0 advertencias)           | ✅ 0 errores                                                                                                                                                                                                                                                                                 |
| `pnpm format:check` (prettier)                 | ✅ todo formateado                                                                                                                                                                                                                                                                           |
| `pnpm typecheck` (tsc)                         | ✅ 0 errores                                                                                                                                                                                                                                                                                 |
| `pnpm test` (Vitest)                           | ✅ 195 archivos, **1692 pruebas** (1669 previas + 23 nuevas de `looks.test.ts`)                                                                                                                                                                                                              |
| `next build`                                   | ✅ compila (registro: `build-despues.log`)                                                                                                                                                                                                                                                   |
| Playwright E2E (14 archivos de tienda pública) | ✅ **35/35** en 2.1 min: `storefront-look` (8, nuevo), `storefront` (4), `product-page` (3), `navigation` (5), `nav-bar` (4), `checkout` (2), `mobile-inputs` (2), `home`, `home-hero-v3`, `theme-colors`, `theme-personality`, `photo-blend`, `supplement-categories`, `two-stores` (1 c/u) |
| Desbordamiento horizontal                      | ✅ 0 px en 4 páginas × 6 anchos (360/390/430/768/1024/1440), con y sin Nocturno                                                                                                                                                                                                              |
| Errores de consola                             | ✅ 0 en las 24 combinaciones                                                                                                                                                                                                                                                                 |
| Imágenes rotas                                 | ✅ 0                                                                                                                                                                                                                                                                                         |
| axe-core (WCAG 2.0/2.1/2.2 A+AA)               | ✅ 0 violaciones en inicio, catálogo, categoría y ficha a 390 y 1440 px                                                                                                                                                                                                                      |

Las pruebas `pnpm db:test` (pgTAP) y `pnpm test:stack` del CI no se ejecutaron localmente: el cambio no toca base de datos, migraciones ni API. El CI del PR las corre.

## Lighthouse 12 (Chromium sin interfaz, `next start` local)

Puntuaciones medidas (Rendimiento / Accesibilidad / Buenas prácticas / SEO) y métricas. «Base» = mismo código nuevo con `theme_key='base'` (lo que ven todas las demás tiendas).

| Página   | Perfil     | Base                                               | Nocturno                                               |
| -------- | ---------- | -------------------------------------------------- | ------------------------------------------------------ |
| Inicio   | Móvil      | 93 / 100 / 100 / 100 — LCP 3.2 s, CLS 0, TBT 50 ms | **97** / 100 / 100 / 100 — LCP 2.6 s, CLS 0, TBT 30 ms |
| Inicio   | Escritorio | 100 / 100 / 100 / 100 — LCP 0.8 s, CLS 0.001       | 100 / 100 / 100 / 100 — LCP 0.6 s, CLS 0.016           |
| Catálogo | Móvil      | 96 / 100 / 100 / 100 — LCP 2.6 s, CLS 0, TBT 30 ms | 96 / 100 / 100 / 100 — LCP 2.6 s, CLS 0, TBT 30 ms     |
| Catálogo | Escritorio | 100 / 100 / 100 / 100 — LCP 0.7 s, CLS 0           | 100 / 100 / 100 / 100 — LCP 0.7 s, CLS 0               |
| Ficha    | Móvil      | 95 / 100 / 100 / 100 — LCP 2.9 s, CLS 0, TBT 30 ms | **98** / 100 / 100 / 100 — LCP 2.3 s, CLS 0, TBT 40 ms |
| Ficha    | Escritorio | 100 / 100 / 100 / 100 — LCP 0.6 s, CLS 0.001       | 100 / 100 / 100 / 100 — LCP 0.6 s, CLS 0.001           |

Notas: una sola corrida por página (hay variación normal de ±2–3 puntos entre corridas); entorno local, no producción; las fotos son SVG ligeros, con fotos reales el LCP móvil puede subir. Informes JSON: `/workspace/alien-demon-capturas/lighthouse/{base,nocturno}/`.

## Hallazgos y correcciones durante el trabajo

- **768 px:** el carrito y la cuenta bajaban a una segunda fila del encabezado. Ya pasa **también en la versión actual** (no lo causó el rediseño). Con Nocturno se corrigió limitando el ancho del nombre entre 640 y 1023 px. Para las demás tiendas queda como recomendación (no se cambió para no alterarlas).
- **Ficha a 390 px en captura de página completa:** la barra fija de compra aparece encima del título. Es un efecto de la captura de página completa (la barra es `fixed` abajo de la pantalla); ocurre igual en la versión actual. En uso real no tapa nada.
- Ajustes de diseño: separación hero/franja de confianza, precios alineados en tarjetas (altura mínima del título), «Comprar ahora» en contorno, galería sin doble marco.

## No verificado / pendiente

- CI del PR en GitHub (ver el PR en borrador).
- Navegadores distintos de Chromium (Safari iOS, Firefox) no se probaron.
- Con fotos reales de fondo blanco: se verán como mosaicos claros sobre negro (decisión de contenido, ver informe).
