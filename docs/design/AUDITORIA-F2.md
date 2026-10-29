# Fase 2 · Auditoría visual de las plantillas (2026-10-29)

Capturas de la vista previa de una tienda nueva con cada plantilla, a 375 y 1280 px (local, después de aplicar la plantilla desde «Configura tu tienda»). Antes: `docs/design/f2/antes-*.png`.

## Qué está bien

- Estructura completa en un clic: anuncio, encabezado, buscador, barra de categorías, hero, categorías, productos, beneficios, preguntas y pie.
- Cada giro tiene su paleta y tipografía, con contraste validado.
- Los ejemplos están marcados («Ejemplo · …», «Sin publicar») y bloquean el lanzamiento.

## Qué impide que se vea premium

| #   | Hallazgo                                                                                                                                                        | Dónde                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| V1  | El hero sin foto es un bloque de color plano: lo primero que se ve no dice nada del giro                                                                        | Todas las plantillas         |
| V2  | Las categorías sin foto muestran solo su inicial («P P S A» en Ropa: dos «P» seguidas)                                                                          | Compra por categoría         |
| V3  | Cada producto sin foto es una caja gris con «Sin imagen»: la tienda nueva parece rota                                                                           | Tarjetas y ficha             |
| V4  | A 1280 px, los beneficios quedan en 3 cajas pegadas a la izquierda con media fila vacía                                                                         | Bloque de beneficios         |
| V5  | El buscador dice «¿Qué estás buscando?» en todas las tiendas, sin la marca                                                                                      | Encabezado                   |
| V6  | El hero «EJEMPLO» de la demo de staging es una imagen generada por el semillado con esa palabra; se reemplaza desde Apariencia → Portada → bloque Hero → imagen | Solo staging (no plantillas) |
| V7  | Barra de vista previa: una línea de 40 px en el celular y una de 44 px en escritorio. Correcta; se deja                                                         | —                            |

Las capturas de Suplementos fallaron al iniciar sesión en la primera corrida (arranque en frío) y se repiten en la ronda de «después».

## Plan de diseño: «Anaquel ilustrado»

**Idea:** una tienda nueva no tiene fotos el primer día. En lugar de cajas grises, cada giro trae sus objetos dibujados (playera, gorra, labial, frasco, taza, plato de croquetas…) en un solo trazo, con los colores de la plantilla. No son fotos ni imágenes subidas: son íconos dibujados en el código, sin SVG del comerciante (regla 13).

- **Un solo lugar audaz — el hero sin foto:** los objetos del giro, grandes y en trazo del color de contraste a baja opacidad, alineados como mercancía en un anaquel a lo largo del borde inferior del hero. El texto queda arriba, intacto. Con foto, nada cambia.
- **Silencioso en lo demás:**
  - categoría sin foto → su objeto, en el color de enlace, en lugar de la inicial;
  - producto sin foto → el objeto que corresponde a su nombre, tenue sobre la superficie, sin «Sin imagen».
- **Selección del objeto:** por palabras clave del nombre de la categoría o del producto (p. ej. «playera», «proteína», «labial»), con un objeto genérico de respaldo. Probado con unitarias.
- **Beneficios:** la rejilla reparte el ancho completo según cuántos haya.
- **Buscador:** «Buscar en {nombre de la tienda}».
- **Seis giros:** Suplementos, Ropa, Belleza, Abarrotes y dos nuevos, **Hogar y decoración** y **Mascotas**, además de Genérica y En blanco.

**Revisión contra lo genérico:** se descartó un patrón de degradados y círculos difuminados (el «kit SaaS») y también fotos de banco (el comerciante las tendría que reemplazar y serían iguales en todas las tiendas). El trazo único con los objetos reales del giro solo encaja con un anaquel de tienda.

## Resultado (después)

| #   | Estado | Qué cambió                                                                                                                                                            |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | ✅     | Hero sin foto: los objetos del giro sobre una repisa, en el color de contraste del hero (trazo al 35 %). Con foto no aparecen                                         |
| V2  | ✅     | Categoría sin foto: su objeto dibujado («Playeras» → playera, «Velas y aromas» → vela)                                                                                |
| V3  | ✅     | Producto sin foto, en tarjeta y ficha: el objeto según su nombre, tenue; ya no dice «Sin imagen»                                                                      |
| V4  | ✅     | Beneficios: las columnas siguen al número de beneficios; en el celular, uno impar ocupa el ancho                                                                      |
| V5  | ✅     | Buscador: «Buscar en {nombre de la tienda}»                                                                                                                           |
| V8  | ✅     | Encontrado al revisar la ficha a 375 px: con una ruta de navegación de dos líneas, la foto tapaba la segunda. Corregido; la prueba falla sin el arreglo y pasa con él |
| —   | ✅     | Dos giros nuevos: **Hogar y decoración** y **Mascotas** (paleta con contraste AA probado, categorías, productos de ejemplo marcados)                                  |

**Pruebas:** `tests/e2e/store-templates-design.spec.ts` aplica cada una de las 6 plantillas por giro y revisa la portada a 360, 375, 768, 1280 y 1920 px (sin desborde, anaquel visible, buscador con la marca, axe sin problemas graves) y la ficha de un ejemplo a 375 px. Unitarias del selector de objetos: `src/lib/storefront/goods.test.ts` (27 casos, incluidas trampas como «botanas» vs. «botas» y «maceta con plato»).

**Crítica propia durante el trabajo:**

- La gorra se veía como una charola de comida a tamaño chico: se redibujó de perfil con su costura.
- En Mascotas, el collar parecía una paleta, la pelota de voleibol y la cama una caja: se redibujaron.
- «Maceta de barro con plato» mostraba el plato de mascota: se quitó «plato» de las palabras clave.
- La transparencia del anaquel creaba un rectángulo apenas visible detrás de los objetos: ahora es transparencia del trazo, no del grupo.

Capturas: `docs/design/f2/despues-*.png`.
