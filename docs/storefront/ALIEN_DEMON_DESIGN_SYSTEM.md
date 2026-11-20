# Alien Demon Exotics — Sistema de diseño «Nocturno»

> Estado: rama `feature/alien-demon-trust-storefront` (sobre la propuesta de Grok `feature/alien-demon-storefront-redesign`). El propietario pidió desplegarlo en staging para verlo (2026-11-18). Paleta ajustada a la colorimetría de la marca (§2).

## 1. Qué es y cómo se enciende

«Nocturno» es un **tema de presentación** de la tienda pública: solo CSS, sin cambiar datos, precios, inventario, checkout ni panel.

- Código: `src/lib/theme/looks.ts` (paleta, fuentes, CSS) y `src/lib/theme/looks.test.ts` (32 pruebas).
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

## 3. Tipografía (v2, 2026-11-18)

- Títulos, nombre de la tienda, precios y rótulos: **Barlow Condensed** 700 en mayúsculas, como etiqueta de producto o cartel de lanzamiento. Ya estaba en la lista curada `FONT_KEYS`.
- Texto: **Manrope** (ídem), en lugar de Inter.
- Escala: título del hero `clamp(3.25rem, 1.6rem + 7vw, 7.5rem)` en el verde neón de la portada original (`#AFFF6E`); títulos de sección `clamp(2.25rem, 1.5rem + 2.6vw, 3.5rem)`; nombre en el pie hasta 8.5rem.
- **Nombre de la tienda:** las letras decorativas de Unicode (𝓐𝓛𝓘𝓔𝓝…) se dibujan como letras normales solo con este look (`lookStoreName`, NFKC). Así no cambia de fuente a media palabra y el lector de pantalla no lo deletrea como símbolos. El nombre guardado no cambia.
- **Se quitó** lo que hacía ver la tienda «de plantilla»: la numeración 01/02 de las secciones, las flechas «→» en enlaces y botones, los rótulos con espaciado exagerado y la entrada animada de cada sección al desplazarse.

## 4. Forma, espacio, profundidad

- Radios: botones en píldora (como la tienda original), controles 10 px, tarjetas 14 px, paneles 22 px.
- Separación entre secciones: 4 rem (móvil) / 7 rem (≥1024 px).
- Profundidad con capas de superficie y filetes de 1 px, sin sombras pesadas.

## 5. Componentes (resumen; detalle en el inventario)

- **Botón principal:** verde de la marca con texto negro; al pasar, verde claro; al presionar, escala 0.98. «Comprar ahora» pasa a contorno para no competir con «Agregar al carrito».
- **Tarjeta de producto:** sin caja; foto con filete; marca como «eyebrow»; título de 2 líneas con altura mínima (precios alineados); «Agregar» en contorno; brillo de carga; agotado en opacidad reducida.
- **Hero:** alto `clamp(32rem, 74svh, 46rem)`, velo degradado para legibilidad, CTA verde con flecha, a sangre en móvil.
- **Categorías:** círculos con un anillo en degradado verde → morado de la marca y un aro negro alrededor de la foto; al pasar el cursor, el anillo gira media vuelta y brilla (sin movimiento con «reducir movimiento»).
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

## 8. «De otro mundo» (v17, 2026-11-19)

Un solo concepto tomado de la marca (alien, OVNI, portal), solo CSS y sin imágenes nuevas:

- **Cielo:** dos capas de estrellas en mosaico (gradientes radiales de 1–1.6 px en `frost` translúcido) sobre toda la tienda. Con mouse, la capa lejana queda fija y la cercana se mueve con la página (paralaje sin JavaScript); en celular, ambas se desplazan normal.
- **Rayo de abducción:** el `::after` del portal del hero es un haz verde en trapecio que baja sobre el título y el botón; en la primera portada, una franja neón lo recorre una vez al cargar (`ad-beam`, 2.2 s).
- **Cartas coleccionables:** con mouse, la foto del producto se inclina en 3D y se eleva al pasar el cursor.
- **Planetas:** con mouse o teclado (`:focus-visible`), un anillo orbital inclinado rodea el círculo de la categoría (unidades de contenedor `cqi`, arco inferior visible).
- Los efectos de mouse viven en `@media (hover:hover) and (pointer:fine)` (no se quedan «pegados» en pantallas táctiles) y todo el movimiento sigue dentro de «reducir movimiento». Prueba unitaria: `looks.test.ts` («de otro mundo…»).
- Sin contadores falsos, reseñas inventadas ni escasez simulada: la urgencia real es la hora de corte (§ cuenta regresiva).

## 9. Pulido de páginas y estabilidad (v19, 2026-11-20)

- **La página ya no salta al cargar.** La franja «Llega … si pides y pagas en …» se dibujaba primero con la regla fija (dos renglones en el celular) y el navegador la cambiaba por la cuenta regresiva (uno): todo bajaba 16 px. Ahora el servidor la dibuja con su hora (`serverNow`) y el primer texto ya es el definitivo. Medido en local, celular de 390 px con el procesador 4× más lento: CLS de inicio 0.23 → 0.02; catálogo 0.13 → 0.001; ficha 0.13 → 0.003 (bueno: menos de 0.1). Prueba E2E «la franja de la hora de corte no mueve la página al cargar (CLS)»: falla sin el arreglo (0.14) y pasa con él.
- **Nombre en letras normales en toda la tienda** (`withLookName` en `getStorefront`): título de la pestaña, Mi cuenta, mensajes de WhatsApp; antes solo el encabezado, el pie y el inicio.
- **Mi cuenta** (entrar con código) en un panel centrado; botón a todo el ancho.
- **WhatsApp del pie legible:** «+52 662 123 4567» en lugar de «+526621234567» (todas las tiendas).
- **Textos neutros** en el carrito vacío y la búsqueda sin resultados («explora el catálogo» en lugar de «por objetivo», que era de suplementos; todas las tiendas).
- En la página del pedido con la ficha por WhatsApp, la burbuja flotante se oculta en el celular (repetía el mismo WhatsApp y tapaba el panel de pago).

## 10. Más rápida (v20, 2026-11-20)

- **Desplazamiento fluido en computadora.** La capa lejana del cielo usaba `background-attachment: fixed`, que obliga a repintar todo el fondo en cada movimiento. Ahora vive en una capa fija propia (`.sf-root::before`, `position: fixed`) que la tarjeta de video mueve sin repintar; la cercana sigue desplazándose con la página (mismo paralaje). Medido en local (1440 px, CPU 4×, 3 rondas): cuadro promedio 74–78 ms (~13 fps) → 18–23 ms (~50 fps); cuadros lentos (>50 ms) 86–89 de 94 → 0–1 de 94.
- **Fotos chicas, archivos chicos** (todas las tiendas con copias de sus fotos):
  - logo del encabezado con `srcset` y `sizes` según el ancho real (~84 px): en Alien Demon, 68 KB → 7 KB en cada página;
  - miniaturas del menú y foto redonda de la categoría con la copia de 320 px: 729 KB → 199 KB las 5 de Alien Demon;
  - logos de marcas y fotos de objetivos con `srcset`.
    Se comprobó en el almacenamiento de staging que las copias existen (logo: 320, 640 y 960 px; categorías: 320 y 640 px).
- Encabezado fijo con vidrio al 96 %: el texto grande de atrás ya no se transparenta al desplazarse.
- WhatsApp con espacios también en la franja de confianza y en la página del pedido.
