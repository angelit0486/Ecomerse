# Alien Demon Exotics — Inventario de componentes (tienda pública)

Cambios hechos en la rama `feature/alien-demon-storefront-redesign`. Regla: los componentes solo recibieron **clases «gancho»** (`sf-*`) sin estilos propios; los estilos viven en `looks.ts` y solo aplican con `data-look="nocturno"`. Sin el tema, el HTML gana clases inertes y la vista es idéntica.

## Archivos tocados

Rutas relativas a `src/app/%5Fstore/[storeId]/` salvo que se indique otra.

| Archivo                                     | Uso                 | Cambio                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/theme/looks.ts` (nuevo)            | Solo tienda pública | Paleta, fuentes y CSS de Nocturno; `storeLook(key)` lista blanca (`["nocturno"]`)                                                                                                                                                                                   |
| `src/lib/theme/looks.test.ts` (nuevo)       | Prueba              | 23 pruebas: lista blanca, formato de la clave igual al `check` de la base, fuentes curadas, contrastes, CSS confinado a `.sf-root[data-look]`, sin `url()`/`@import`/`<script>`, todo hex de la paleta, movimiento solo con `prefers-reduced-motion: no-preference` |
| `tests/e2e/storefront-look.spec.ts` (nuevo) | Prueba E2E          | Dos tiendas: `base` intacta, `nocturno` oscura; sin desbordamiento en 360–1440; axe en 390 y 1440; «reducir movimiento» = 0 animaciones                                                                                                                             |
| `src/app/%5Fstore/[storeId]/layout.tsx`     | Tienda pública      | Lee `store.theme.key`, añade fuentes del tema, `data-look` y el CSS del tema; con tema, omite `elementCss` (colores por elemento)                                                                                                                                   |
| `_components/header.tsx`                    | Tienda pública      | `sf-wordmark` (2 encabezados), `sf-footer`, `sf-footer-name`                                                                                                                                                                                                        |
| `_components/home-sections.tsx`             | Tienda pública      | Hero (`sf-hero*`, `sf-hero-group`), títulos (`sf-section-*`, `sf-view-all`), categorías (`sf-cat-*`), historia (`sf-story*`)                                                                                                                                        |
| `_components/home-blocks.tsx`               | Tienda pública      | `sf-section-title` en títulos; `sf-benefits` en beneficios                                                                                                                                                                                                          |
| `_components/product-card.tsx`              | Tienda pública      | `sf-card-title`, `sf-card-price`, `sf-card-choose`                                                                                                                                                                                                                  |
| `_components/trust-bar.tsx`                 | Tienda pública      | `sf-trust`                                                                                                                                                                                                                                                          |
| `_components/supplement-info.tsx`           | Tienda pública      | `sf-regulatory` (panel de información regulatoria)                                                                                                                                                                                                                  |
| `productos/[slug]/page.tsx`                 | Tienda pública      | `sf-pdp-grid`, `-gallery`, `-brand`, `-title`, `-price`, `-facts`, `-desc`                                                                                                                                                                                          |

## Componentes y estados con Nocturno

| Componente                       | Estados cubiertos                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Barra de anuncio                 | normal                                                                                                                                     |
| Encabezado / nombre              | normal; 640–1023 px el nombre se limita a 9.5 rem para que búsqueda y carrito quepan en una fila                                           |
| Navegación                       | normal, hover (subrayado animado `glow`), foco, menú móvil                                                                                 |
| Carrito (icono)                  | contador en `glow`                                                                                                                         |
| Botones                          | normal, hover, activo, foco, deshabilitado (heredado) ; «Comprar ahora» en contorno                                                        |
| Hero (fondo y dividido)          | con imagen, velo, CTA                                                                                                                      |
| Franja de confianza / beneficios | normal                                                                                                                                     |
| Categorías                       | mosaicos 4:5; flujo en columna con menos de 7                                                                                              |
| Tarjeta de producto              | normal, hover, foco, cargando (brillo 3×), oferta, «Últimas piezas», agotado, sin foto (texto alternativo en `mist`)                       |
| Historia de la marca             | dividido texto / imagen                                                                                                                    |
| Ficha de producto                | galería, marca, título, precio/oferta, cantidad, agregar, comprar ahora, barra fija de compra (existente), panel regulatorio, relacionados |
| Pie                              | nombre, enlaces, formas de pago, aviso legal                                                                                               |

## Componentes compartidos NO tocados (y por qué)

- `image-carousel.tsx`: lo importa también el editor de inicio del panel (`admin home-editor`). Por la regla del brief no se modificó; el carrusel hereda colores por variables `--sf-*`.
- Presets de tema, `resolveTheme`, `themeCss`, banderas (`get_store_flags`), Apariencia del panel: sin cambios. Agregar el tema como preset o bandera habría exigido tocar panel o migraciones.
- Sin `loading.tsx` de ruta ni `onError` en imágenes: afectaría a todas las tiendas.
