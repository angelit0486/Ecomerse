# Alien Demon Exotics — Sistema de diseño «Nocturno»

> Estado: rama `feature/alien-demon-trust-storefront` (sobre la propuesta de Grok `feature/alien-demon-storefront-redesign`). El propietario pidió desplegarlo en staging para verlo (2026-11-18). Paleta ajustada a la colorimetría de la marca (§2).

## 1. Qué es y cómo se enciende

«Nocturno» es un **tema de presentación** de la tienda pública: solo CSS, sin cambiar datos, precios, inventario, checkout ni panel.

- Código: `src/lib/theme/looks.ts` (paleta, fuentes, CSS) y `src/lib/theme/looks.test.ts` (26 pruebas).
- Se enciende **solo** cuando la tienda tiene `store_themes.theme_key = 'nocturno'`. Esa columna ya existía (valor por omisión `'base'`, sin uso en el código) y ya llega a la tienda pública como `store.theme.key` por `storefront.get_store_public`. **No hay migración nueva.**
- Con cualquier otra clave (todas las tiendas hoy tienen `'base'`), la tienda se ve exactamente igual que antes (ver `ALIEN_DEMON_VISUAL_REGRESSION.md`).
- Todo el CSS va bajo `.sf-root[data-look='nocturno']`, en la misma etiqueta `<style nonce>` que ya genera el tema (CSP intacta, sin archivos nuevos que descargar).
- Con Nocturno encendido, los colores de Apariencia y los colores por elemento se ignoran (la paleta es fija, pero toma los dos colores de la marca: verde `#00A303` y morado `#B200FF`); logo, textos, menú, secciones de inicio, productos y fotos siguen saliendo de la tienda.
- Cambio de clave: tarda hasta 60 s en verse (caché pública `STOREFRONT_TTL_SECONDS`).

## 2. Paleta (tokens)

| Token                            | Hex                               | Uso                                                                        |
| -------------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `void`                           | `#09090D`                         | Fondo general (profundidad)                                                |
| `deep`                           | `#12121A`                         | Superficies: paneles, pie, franja de confianza                             |
| `graphite`                       | `#20202A`                         | Superficie elevada, bordes marcados                                        |
| `silver`                         | `#C8CAD3`                         | Texto secundario fuerte                                                    |
| `alien`                          | `#00A303`                         | Verde de la marca: acción principal (texto negro)                          |
| `alienHi`                        | `#2FC433`                         | Verde al pasar el cursor                                                   |
| `frost`                          | `#F4F5F8`                         | Texto principal, botón al pasar el cursor                                  |
| `mist`                           | `#9A9CAA`                         | Texto terciario (marca, notas, «alt» de fotos)                             |
| `violet`                         | `#B200FF`                         | Morado de la marca: relleno con texto blanco (ofertas, carrito, selección) |
| `glow`                           | `#C45CFF`                         | Morado legible sobre negro: rótulos, foco, precio de oferta                |
| `white`                          | `#FFFFFF`                         | Texto sobre el morado de la marca                                          |
| `danger` / `success` / `warning` | `#FCA5A5` / `#86EFAC` / `#FCD34D` | Estados legibles sobre negro                                               |

`mist` (#9A9CAA) se agregó a la paleta del brief porque #C8CAD3 no alcanza para un tercer nivel de texto distinguible; los estados se aclararon porque los de la plataforma están pensados para fondo blanco.

### Contraste medido (WCAG 2.2, fórmula de luminancia relativa)

| Par                           | Contraste | Mínimo |
| ----------------------------- | --------- | ------ |
| frost / void                  | 18.23:1   | 4.5    |
| frost / deep                  | 17.09:1   | 4.5    |
| frost / graphite              | 14.80:1   | 4.5    |
| silver / void                 | 12.16:1   | 4.5    |
| silver / deep                 | 11.40:1   | 4.5    |
| mist / void                   | 7.30:1    | 4.5    |
| mist / deep                   | 6.84:1    | 4.5    |
| mist / graphite               | 5.92:1    | 4.5    |
| void sobre alien (botón)      | 5.91:1    | 4.5    |
| void sobre alienHi (al pasar) | 8.58:1    | 4.5    |
| void sobre frost (secundario) | 18.23:1   | 4.5    |
| glow / void (oferta, foco)    | 5.98:1    | 4.5    |
| glow / deep                   | 5.61:1    | 4.5    |
| glow / graphite               | 4.86:1    | 4.5    |
| white sobre violet (insignia) | 4.84:1    | 4.5    |
| alien / void (ícono)          | 5.91:1    | 3      |
| danger / deep                 | 9.82:1    | 4.5    |
| success / deep                | 13.27:1   | 4.5    |
| warning / deep                | 12.92:1   | 4.5    |

El morado original `#B200FF` mide 4.11:1 sobre `void`: se usa solo como relleno (con texto blanco), nunca como texto; para texto se usa `glow`. El verde original `#00A303` sí alcanza 5.91:1 con texto negro y se usa tal cual. Los pares están en `NOCTURNO_PAIRS` y la prueba unitaria falla si alguno baja del mínimo.

## 3. Tipografía

- Títulos: **Space Grotesk** 600 (autoalojada con `next/font/local`, ya estaba en la lista curada `FONT_KEYS`).
- Texto: **Inter** (ídem).
- Escala fluida: título del hero `clamp(2.5rem, 1.3rem + 5.2vw, 5.5rem)`; títulos de sección con `clamp`; nombre de la tienda en encabezado en mayúsculas con espaciado amplio.
- Contador editorial «01, 02…» antes de cada título de sección (`::before` con texto alternativo vacío: los lectores de pantalla no lo leen).

## 4. Forma, espacio, profundidad

- Radios: 4 / 6 / 12 px (más técnico que la píldora actual).
- Separación entre secciones: 4 rem (móvil) / 7 rem (≥1024 px).
- Profundidad con capas de superficie y filetes de 1 px, sin sombras pesadas.

## 5. Componentes (resumen; detalle en el inventario)

- **Botón principal:** verde de la marca con texto negro; al pasar, verde claro; al presionar, escala 0.98. «Comprar ahora» pasa a contorno para no competir con «Agregar al carrito».
- **Tarjeta de producto:** sin caja; foto con filete; marca como «eyebrow»; título de 2 líneas con altura mínima (precios alineados); «Agregar» en contorno; brillo de carga; agotado en opacidad reducida.
- **Hero:** alto `clamp(32rem, 74svh, 46rem)`, velo degradado para legibilidad, CTA verde con flecha, a sangre en móvil.
- **Categorías:** mosaicos editoriales 4:5.
- **Ficha de producto:** rejilla 7/5, galería sin doble marco, título con `clamp`, panel regulatorio (`.sf-regulatory`) con filete `glow` a la izquierda.
- **Pie:** nombre grande en mayúsculas, chips de pago en contorno.
- **Buscador:** contorno fino gris (`mist`, 7.3:1) que se enciende en verde al escribir; sin la caja verde de 2 px de la plataforma.

## 6. Movimiento

- Solo CSS: entrada del hero (`ad-in`) y aparición al desplazarse (`ad-rise`, `animation-timeline: view()` donde el navegador lo soporta; si no, no se anima y el contenido se ve normal).
- **Todo** el movimiento está dentro de `@media (prefers-reduced-motion: no-preference)`. La prueba unitaria y el E2E lo verifican (con «reducir movimiento», 0 elementos animados).
- Sin bibliotecas de animación nuevas.

## 7. Accesibilidad

- Anillo de foco `glow` de 2 px con 3 px de separación (7.30:1 sobre el fondo; WCAG 2.4.13 pide 3:1).
- Contrastes de la tabla 2. axe 0 violaciones (WCAG 2.0/2.1/2.2 A y AA) en 390 y 1440 px; Lighthouse Accesibilidad 100 (ver QA).
