# Marca PRUVA

Versión 1 (fase 3, 2026-10-19). Aprobada como dirección por el propietario; el
logo final en alta resolución puede reemplazar estos archivos sin tocar el código.

## Conceptos evaluados

Tres símbolos con el mismo logotipo, en fondo claro, azul marino y a 16 y 32 px:

| Concepto                                 | Resultado                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| A · P de dos piezas (asta + panza curva) | **Elegido.** Repite las curvas de la P y la R del logotipo y se lee a 16 px             |
| B · P sólida con flecha calada           | Descartado: el calado se cierra en tamaños chicos y la forma recuerda a marcas de pagos |
| A2 · Asta + panza facetada               | Descartado: las facetas chocan con las letras redondeadas                               |
| C · Barras de progresión                 | Descartado en la primera ronda: se leía como una «F»                                    |

## Qué es cada pieza

| Pieza                           | Archivo                                            | Uso                                |
| ------------------------------- | -------------------------------------------------- | ---------------------------------- |
| Horizontal (símbolo + logotipo) | `pruva/pruva-horizontal-*.svg` / `.png`            | Encabezados, panel, documentos     |
| Símbolo (versión compacta)      | `pruva/pruva-simbolo-*.svg` / `.png`               | Espacios cuadrados, redes, avatar  |
| Logotipo (solo letras)          | `pruva/pruva-logotipo-*.svg`                       | Cuando el símbolo ya aparece cerca |
| Ícono de app                    | `pruva/pruva-icono-app.svg`, `pruva-icono-512.png` | Favicon y pantalla de inicio       |

En el código, `src/ui/brand/pruva-logo.tsx` (`PruvaLogo`, `PruvaSymbol`,
`PruvaWordmark`) dibuja la misma geometría con `currentColor`. La prueba
`pruva-logo.test.tsx` falla si los archivos de esta carpeta y el componente
dejan de coincidir.

## Construcción

- Letras propias de trazo 22 sobre una altura de 100, inclinadas 12°. No dependen
  de ninguna fuente instalada.
- Símbolo: asta y panza separadas por un espacio de 8; la separación es el «paso
  hacia adelante». Mismas curvas que la P y la R del logotipo.
- Versión horizontal: el logotipo mide el 72 % de la altura del símbolo y la
  separación entre ambos es el 40 % de esa altura.

## Color

| Fondo                        | Marca                       | Contraste         |
| ---------------------------- | --------------------------- | ----------------- |
| Blanco frío #F6F8FB o blanco | Azul marino #0B2D5B         | 12.81:1 / 13.63:1 |
| Azul marino #0B2D5B          | Blanco frío #F6F8FB         | 12.81:1           |
| Impresión de una tinta       | Negro #000000 o azul marino | —                 |

Sin degradados, sombras, contornos ni imágenes detrás. El azul grisáceo y el
acero no se usan para la marca: no alcanzan contraste suficiente a tamaños chicos.

## Tamaño y área de protección

- Horizontal: mínimo 24 px de alto en pantalla (12 mm impreso).
- Símbolo: mínimo 16 px (favicon); por debajo se pierde la separación.
- Área de protección: alrededor de la marca, un espacio libre igual al ancho del
  asta del símbolo (24 % de su altura). Nada de texto ni bordes dentro.

## No hacer

- Cambiar la inclinación, deformar, rotar o separar el símbolo del logotipo en la
  versión horizontal.
- Ponerla sobre fotos con zonas claras y oscuras a la vez, o sobre el azul grisáceo.
- Agregar lemas pegados al logotipo. «Nutrición de alto rendimiento» va como texto
  aparte, con la tipografía de títulos de la tienda.

## Cómo se usa en la plataforma

- **Panel, consola y acceso:** la marca de la plataforma está en el código (encabezado
  e íconos en `public/brand/`).
- **Tienda PRUVA:** es una tienda más del sistema multi-tienda. Su logo se sube en
  Apariencia → Logo con `pruva/pruva-horizontal-marino.png` (o la versión blanca si
  el encabezado es oscuro). Ninguna otra tienda muestra la marca PRUVA.
- **Favicon de la tienda:** hoy es el monograma automático (inicial «P» sobre el color
  primario). Usar el ícono de app como favicon de la tienda requiere que Apariencia
  acepte un ícono propio; queda pendiente.
