# Capturas de referencia y línea base (misión de mejoras, 2026-11-03)

Punto de partida: commit `255fa7f` (rama de respaldo `respaldo/pre-mejoras`; la etiqueta `respaldo-pre-mejoras` existe en local, pero este entorno no permite subir etiquetas).

## Suites, dos corridas cada una [VERIFICADO]

| Suite                        | Corrida 1            | Corrida 2            |
| ---------------------------- | -------------------- | -------------------- |
| `pnpm verify` (unitarias)    | 1058/1058            | 1058/1058            |
| pgTAP (`pnpm db:test`)       | 2630 en 122 archivos | 2630 en 122 archivos |
| Integración (`pnpm db:test`) | 388/388              | 388/388              |
| E2E (Playwright)             | 120/120              | 120/120              |

Ninguna prueba inestable entre corridas.

## Capturas

Tienda de demostración (`pnpm demo:seed`, `demo.localhost`) y panel de una tienda nueva, a 375 y 1280 px, página completa:

- `portada`, `listado`, `ficha`, `carrito`, `checkout` y `panel`, cada una en `-375.png` y `-1280.png`.

Se regeneran con:

```bash
VISUAL_OUT=docs/audit/referencia pnpm exec playwright test -c playwright.visual.config.ts
```

Para comparar después de un cambio, usar otro `VISUAL_OUT` y revisar las diferencias. El panel usa una tienda nueva en cada corrida, así que su nombre cambia (diferencia esperada).

Observado en la línea base, sin cambiar nada:

- varias fotos de producto de la demostración aparecen vacías;
- los círculos de «Compra por categoría» no tienen foto (se trata en el lote 4).
