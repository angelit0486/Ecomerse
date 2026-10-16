# Evidencia del Gate F9 (medición preliminar, 2026-10-15)

Tiendas de demostración del stack local (`pnpm demo:seed` y `pnpm demo:seed:neutral`, D-F9-15):
`demo.localhost` con el estilo «Deportivo» y `demo2.localhost` con el estilo «Neutral». Los
productos son ejemplos; nada es real. La medición final se repite después de las revisiones
adversariales y queda en `docs/phases/PHASE-09-REPORT.md`.

## Lighthouse móvil

Lighthouse 12.8.2 (`pnpm dlx`, no es dependencia del proyecto), configuración móvil por defecto
(red y CPU simuladas, multiplicador 4×; índice de CPU del equipo 2 000–2 650, dentro del rango
de referencia). App compilada (`pnpm build && pnpm start`). **5 corridas por página; se reporta la
mediana** (recomendación de Lighthouse) y la peor corrida. Una corrida de cada listado falló al
grabar la traza (`NO_NAVSTART`, error de la herramienta) y no se cuenta.

| Tienda | Página  | Rendimiento (mediana / peor) | Accesibilidad | Buenas prácticas | SEO | LCP (mediana) | CLS   |
| ------ | ------- | ---------------------------- | ------------- | ---------------- | --- | ------------- | ----- |
| demo   | Portada | 99 / 96                      | 100           | 100              | 100 | 1.98 s        | 0.014 |
| demo   | Listado | 97.5 / 94                    | 100           | 100              | 100 | 2.32 s        | 0.001 |
| demo   | Ficha   | 99 / 93                      | 100           | 100              | 100 | 2.13 s        | 0     |
| demo2  | Portada | 98 / 97                      | 100           | 100              | 100 | 2.12 s        | 0     |
| demo2  | Listado | 97 / 95                      | 100           | 100              | 100 | 2.45 s        | 0.001 |
| demo2  | Ficha   | 97 / 96                      | 100           | 100              | 100 | 2.56 s        | 0     |

**Verificado:** las 4 categorías ≥ 95 en la mediana de las 6 páginas. **No verificado:** que
ninguna corrida suelta baje de 95 (hubo corridas de 93 y 94 por ruido de CPU compartida); en
producción (red y CDN reales) los números serán otros.

Correcciones que salieron de esta medición:

- Listado: CLS 0.168 → 0.001. Los filtros plegables de móvil se cerraban con JavaScript tras
  pintar; ahora es un `<details>` solo para móvil y un bloque fijo para escritorio.
- Portada: rendimiento 93 → 99. Los títulos del pie con peso 500 descargaban el archivo 400 de
  Barlow Condensed (21 KB con prioridad máxima, compitiendo con la imagen del LCP); ahora todos
  los títulos usan 600–700.

## axe

axe-core (todas las reglas) en portada, listado, ficha, carrito y checkout de las dos tiendas, a
375 y 1280 px (20 combinaciones): **0 violaciones de cualquier nivel**. La única que apareció
(`region`, moderada: la barra de anuncio fuera de un landmark) se corrigió con
`<aside aria-label="Aviso de la tienda">`.

Además, a 375 px ninguna de las 5 páginas tiene scroll horizontal (`scrollWidth ≤ 375`).

## Capturas

`demo/` y `demo2/`: portada, listado, ficha, carrito y checkout a 375 px (móvil) y 1280 px
(escritorio), página completa, después de la revisión de conversión y el pulido visual (2026-10-16).

`competencia/`: portada de GNC (`gnc.com.mx`), de la tienda oficial de Birdman en Mercado Libre
(`birdman.mx` no tiene una tienda funcional: certificado inválido y página vacía) y de B Life
(`blife.mx`), a 375×812 y 1280×800, tomadas el 2026-10-16 con Chromium 141 desde un entorno en la nube
con salida a internet (el contenedor de trabajo no alcanza esos dominios), tras cerrar las ventanas
emergentes que se dejan cerrar. La comparación está en `docs/phases/PHASE-09-REPORT.md` §5.3. La
medición final (Lighthouse y axe) también está en ese informe.
