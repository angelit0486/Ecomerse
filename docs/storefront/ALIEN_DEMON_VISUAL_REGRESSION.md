# Alien Demon Exotics — Regresión visual

Capturas fuera del repositorio (no se suben): `/workspace/alien-demon-capturas/`.

| Carpeta         | Código                          | Tema            | Qué demuestra                                                            |
| --------------- | ------------------------------- | --------------- | ------------------------------------------------------------------------ |
| `antes/`        | `producto/orden-10` @ `1c12b6f` | base            | Estado actual                                                            |
| `despues/`      | esta rama                       | `nocturno`      | El rediseño                                                              |
| `despues-base/` | esta rama                       | `base`          | Que las demás tiendas no cambian                                         |
| `comparativas/` | —                               | —               | Antes/después lado a lado (inicio 1440 y 390, catálogo 1440, ficha 1440) |
| `lighthouse/`   | esta rama                       | base y nocturno | Informes JSON                                                            |

Cada carpeta: inicio, catálogo, categoría (Accesorios) y ficha a 360/390/430/768/1024/1440 px (página completa; inicio también «pantalla»), menú móvil 390, tarjeta en hover 1440, foco de teclado 1440 y `reporte.json` (desbordamiento, consola, imágenes rotas, axe).

## Tiendas sin Nocturno: comparación píxel a píxel `antes/` vs `despues-base/`

33 capturas comparadas:

- **21 idénticas al píxel** (0 diferencias): categoría en los 6 anchos, catálogo 1024 y 1440, ficha 360/430/768/1440, las 6 capturas «pantalla» del inicio, menú móvil, hover de tarjeta y foco de teclado.
- **12 con diferencias**, todas dentro de recuadros de **fotos de producto o de la historia**: en la corrida `antes/` algunas imágenes diferidas (`loading="lazy"`) aún no se habían pintado y salieron como recuadro gris; en `despues-base/` sí cargaron. Se revisaron los recortes lado a lado (inicio 1440, catálogo 360 y 768, ficha 1024): mismo texto, mismas posiciones, mismos botones; solo cambia foto cargada vs. recuadro vacío.
- Mismo tamaño de página en las 33 (ningún cambio de altura ni de diseño).

Conclusión: sin `theme_key='nocturno'`, el código nuevo pinta la tienda igual que antes. Además, el E2E `storefront-look.spec.ts` lo comprueba en cada ejecución (tienda `base` sin `data-look` y fondo blanco).

## Con Nocturno (`despues/`)

24/24 combinaciones: 0 px de desbordamiento, 0 errores de consola, 0 imágenes rotas, 0 violaciones axe (390 y 1440).

Mejores capturas para revisar:

1. `comparativas/home-1440-antes-despues.png` — primera pantalla del inicio.
2. `comparativas/home-390-antes-despues.png` — inicio en celular.
3. `comparativas/catalogo-1440-antes-despues.png` — catálogo y tarjetas.
4. `comparativas/ficha-1440-antes-despues.png` — ficha de producto.
