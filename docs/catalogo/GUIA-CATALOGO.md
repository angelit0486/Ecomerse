# Guía para cargar el catálogo real (Fase B)

Plantilla: [`plantilla-catalogo-suplementos.csv`](plantilla-catalogo-suplementos.csv). Es la misma que se descarga en **Productos → Importar → Descargar plantilla**. Ábrela en Excel, Google Sheets o Numbers y guárdala como CSV (UTF-8).

> Ningún dato de esta guía es real. Los textos entre `<…>` los escribes tú con la información de tus productos, sus etiquetas y tu asesor regulatorio. La plataforma nunca inventa ingredientes, dosis ni beneficios.

## 1. Antes de importar (una sola vez, en el panel)

1. **Ajustes → Cumplimiento:** declara «Suplemento alimenticio» y aprueba la leyenda de tu tienda con tu asesor.
2. **Productos → Categorías:** crea las categorías de tu tienda (por ejemplo, las secciones de tu menú).
3. **Productos → Atributos:** crea los filtros y sus valores. Sugeridos para suplementos:

| Atributo | Para qué sirve              | Ejemplos de valores (los defines tú)                           |
| -------- | --------------------------- | -------------------------------------------------------------- |
| Objetivo | Menú «Objetivos» y filtro   | `<p. ej. Energía, Rendimiento>`, sin promesas médicas (ver §4) |
| Tipo     | Filtro por tipo de producto | `<p. ej. Proteína, Creatina, Vitaminas>`                       |
| Sabor    | Filtro por sabor            | `<p. ej. Vainilla, Chocolate, Sin sabor>`                      |
| Tamaño   | Filtro por presentación     | `<p. ej. 1 kg, 2 lb, 60 cápsulas>`                             |

La **marca** no es un atributo: va en la columna `brand` y la tienda ya trae su filtro.

## 2. Una fila por variante

Cada **variante** (sabor × tamaño) es una fila. Las filas del mismo producto comparten `handle`; los datos del producto (título, descripción, ficha sanitaria, atributos) van en la primera.

| handle       | title                   | option1_name | option1_value | option2_name | option2_value | sku           | barcode              | price      | cost      | weight_g             |
| ------------ | ----------------------- | ------------ | ------------- | ------------ | ------------- | ------------- | -------------------- | ---------- | --------- | -------------------- |
| `<producto>` | `<Nombre del producto>` | Sabor        | `<sabor 1>`   | Tamaño       | `<tamaño 1>`  | `<SKU único>` | `<código de barras>` | `<precio>` | `<costo>` | `<peso con empaque>` |
| `<producto>` |                         | Sabor        | `<sabor 2>`   | Tamaño       | `<tamaño 1>`  | `<SKU único>` | `<código de barras>` | `<precio>` | `<costo>` | `<peso con empaque>` |

- `sku`: único en la tienda; se guarda en mayúsculas. `barcode`: único (EAN/UPC de la etiqueta).
- `price`, `compare_at_price` y `cost` en pesos: `899.00` o `899,00`. `cost` es tu costo unitario. Solo lo importan y exportan los roles que pueden ver costos y nunca se muestra en la tienda. Sirve para el margen y el valor del inventario.
- `weight_g`: peso de envío en gramos, con empaque (lo usan las tarifas de envío).
- `inventory_quantity`: existencias físicas en la ubicación principal. Vacía, no se tocan. Lote y caducidad llegan en la Fase C.
- `status`: `draft` para revisar primero; `active` publica solo si el producto cumple todo (§3).

## 3. Ficha sanitaria (obligatoria para publicar)

`regulatory_category` = `dietary_supplement`. Campos que hoy piden las reglas **propuestas** (pendientes de tu asesor):

| Columna                                                                           | Qué va                                                 | Obligatorio hoy   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------- |
| `regulatory_ingredients`                                                          | Ingredientes, tal como en la etiqueta                  | Sí                |
| `regulatory_usage`                                                                | Modo de uso de la etiqueta                             | Sí                |
| `regulatory_warnings`                                                             | Advertencias de la etiqueta                            | Sí                |
| `regulatory_net_content`                                                          | Contenido neto (p. ej. `<907 g>`)                      | Sí                |
| `regulatory_form`, `regulatory_serving_size`, `regulatory_servings_per_container` | Presentación, porción y porciones por envase           | No                |
| `regulatory_nutrition`                                                            | Tabla nutrimental: `nombre\|cantidad\|unidad\|%VNR; …` | No                |
| `regulatory_storage`, `regulatory_allergens`                                      | Conservación y alérgenos                               | No                |
| `regulatory_sanitary_notice`                                                      | Aviso o registro sanitario, si aplica                  | No (configurable) |

`attributes`: claves de atributo y de valor, p. ej. `objetivo:<clave>|<clave>; sabor:<clave>`. Las claves están en Productos → Atributos.

## 4. Lo que bloquea la publicación

- Falta un campo obligatorio o la leyenda de la tienda no está aprobada.
- Un **término prohibido** en el título, la descripción, la ficha, las etiquetas, las opciones, la marca, los atributos o el texto alternativo de las imágenes: curar, cura, curativo/a, tratar, prevenir, previene, prevención, milagro, milagroso/a, «resultados garantizados», «sin efectos secundarios». Lista propuesta, pendiente de tu asesor.
- Ajustes → Cumplimiento muestra **qué productos no se pueden publicar y por qué**.

## 5. Imágenes provisionales

Mientras llegan tus fotos, cada producto puede llevar una imagen genérica **marcada como provisional** en su texto alternativo («Imagen provisional»). Propuesta de fotos libres de Unsplash (licencia Unsplash: uso comercial gratuito; se da crédito al autor), frascos y envases sin marca:

| Uso                 | Foto                                    | Autor                     |
| ------------------- | --------------------------------------- | ------------------------- |
| Proteína / polvos   | https://unsplash.com/photos/eB1cb9e1wCU | Supliful                  |
| Proteína / polvos   | https://unsplash.com/photos/3OQejbTxeTY | Supliful                  |
| Cápsulas / tabletas | https://unsplash.com/photos/EUlDhZSyMpg | Supliful                  |
| Cápsulas / tabletas | https://unsplash.com/photos/E-hOpSZONa0 | Supliful                  |
| Cápsulas            | https://unsplash.com/photos/yYZthq7bucQ | NutraSeller Manufacturing |

Se suben por el panel (Productos → producto → Imágenes) o las subo yo cuando exista el producto, siempre con el alt «Imagen provisional: `<nombre>`». Reemplázalas por fotos reales antes del lanzamiento: una foto genérica nunca debe hacer pensar que es el producto exacto.
