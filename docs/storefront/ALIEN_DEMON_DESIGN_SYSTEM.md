# Alien Demon Exotics — Sistema de diseño «Nocturno»

> Estado: **propuesta en rama** (`feature/alien-demon-storefront-redesign`), pendiente de aprobación del propietario. No está en producción ni encendido en ninguna tienda real.

## 1. Qué es y cómo se enciende

«Nocturno» es un **tema de presentación** de la tienda pública: solo CSS, sin cambiar datos, precios, inventario, checkout ni panel.

- Código: `src/lib/theme/looks.ts` (paleta, fuentes, CSS) y `src/lib/theme/looks.test.ts` (23 pruebas).
- Se enciende **solo** cuando la tienda tiene `store_themes.theme_key = 'nocturno'`. Esa columna ya existía (valor por omisión `'base'`, sin uso en el código) y ya llega a la tienda pública como `store.theme.key` por `storefront.get_store_public`. **No hay migración nueva.**
- Con cualquier otra clave (todas las tiendas hoy tienen `'base'`), la tienda se ve exactamente igual que antes (ver `ALIEN_DEMON_VISUAL_REGRESSION.md`).
- Todo el CSS va bajo `.sf-root[data-look='nocturno']`, en la misma etiqueta `<style nonce>` que ya genera el tema (CSP intacta, sin archivos nuevos que descargar).
- Con Nocturno encendido, los colores de Apariencia y los colores por elemento se ignoran (la paleta es fija); logo, textos, menú, secciones de inicio, productos y fotos siguen saliendo de la tienda.
- Cambio de clave: tarda hasta 60 s en verse (caché pública `STOREFRONT_TTL_SECONDS`).

## 2. Paleta (tokens)

| Token                            | Hex                               | Uso                                                     |
| -------------------------------- | --------------------------------- | ------------------------------------------------------- |
| `void`                           | `#09090D`                         | Fondo general (profundidad)                             |
| `deep`                           | `#12121A`                         | Superficies: paneles, pie, franja de confianza          |
| `graphite`                       | `#20202A`                         | Superficie elevada, bordes marcados                     |
| `silver`                         | `#C8CAD3`                         | Acción principal (botón plata), texto secundario fuerte |
| `frost`                          | `#F4F5F8`                         | Texto principal, botón al pasar el cursor               |
| `mist`                           | `#9A9CAA`                         | Texto terciario (marca, notas, «alt» de fotos)          |
| `violet`                         | `#8B5CF6`                         | Acento de relleno (selección, filetes)                  |
| `glow`                           | `#A78BFA`                         | Acento como texto o línea: foco, ofertas, insignias     |
| `danger` / `success` / `warning` | `#FCA5A5` / `#86EFAC` / `#FCD34D` | Estados legibles sobre negro                            |

`mist` (#9A9CAA) se agregó a la paleta del brief porque #C8CAD3 no alcanza para un tercer nivel de texto distinguible; los estados se aclararon porque los de la plataforma están pensados para fondo blanco.

### Contraste medido (WCAG 2.2, fórmula de luminancia relativa)

| Par                            | Contraste | Mínimo |
| ------------------------------ | --------- | ------ |
| frost / void                   | 18.23:1   | 4.5    |
| frost / deep                   | 17.09:1   | 4.5    |
| frost / graphite               | 14.80:1   | 4.5    |
| silver / void                  | 12.16:1   | 4.5    |
| silver / deep                  | 11.40:1   | 4.5    |
| mist / void                    | 7.30:1    | 4.5    |
| mist / deep                    | 6.84:1    | 4.5    |
| mist / graphite                | 5.92:1    | 4.5    |
| void sobre silver (botón)      | 12.16:1   | 4.5    |
| void sobre frost (botón hover) | 18.23:1   | 4.5    |
| glow / void (oferta, foco)     | 7.30:1    | 4.5    |
| glow / deep                    | 6.85:1    | 4.5    |
| void sobre glow (insignia)     | 7.30:1    | 4.5    |
| danger / deep                  | 9.82:1    | 4.5    |
| success / deep                 | 13.27:1   | 4.5    |
| warning / deep                 | 12.92:1   | 4.5    |

`violet` (#8B5CF6) mide 4.69:1 sobre `void`: se usa solo como relleno o filete, nunca como texto pequeño. Los pares están en `NOCTURNO_PAIRS` y la prueba unitaria falla si alguno baja del mínimo.

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

- **Botón principal:** plata con texto negro; al pasar, blanco frío; al presionar, escala 0.98. «Comprar ahora» pasa a contorno para no competir con «Agregar al carrito».
- **Tarjeta de producto:** sin caja; foto con filete; marca como «eyebrow»; título de 2 líneas con altura mínima (precios alineados); «Agregar» en contorno; brillo de carga; agotado en opacidad reducida.
- **Hero:** alto `clamp(32rem, 74svh, 46rem)`, velo degradado para legibilidad, CTA plata con flecha, a sangre en móvil.
- **Categorías:** mosaicos editoriales 4:5.
- **Ficha de producto:** rejilla 7/5, galería sin doble marco, título con `clamp`, panel regulatorio (`.sf-regulatory`) con filete `glow` a la izquierda.
- **Pie:** nombre grande en mayúsculas, chips de pago en contorno.

## 6. Movimiento

- Solo CSS: entrada del hero (`ad-in`) y aparición al desplazarse (`ad-rise`, `animation-timeline: view()` donde el navegador lo soporta; si no, no se anima y el contenido se ve normal).
- **Todo** el movimiento está dentro de `@media (prefers-reduced-motion: no-preference)`. La prueba unitaria y el E2E lo verifican (con «reducir movimiento», 0 elementos animados).
- Sin bibliotecas de animación nuevas.

## 7. Accesibilidad

- Anillo de foco `glow` de 2 px con 3 px de separación (7.30:1 sobre el fondo; WCAG 2.4.13 pide 3:1).
- Contrastes de la tabla 2. axe 0 violaciones (WCAG 2.0/2.1/2.2 A y AA) en 390 y 1440 px; Lighthouse Accesibilidad 100 (ver QA).
