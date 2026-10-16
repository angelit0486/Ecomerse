# Revisión del catálogo de investigación (`catalogo_suplementos_mexico.json`, 2026-10-16)

Recibido del propietario: 24 productos de fuentes públicas (Amazon.mx, Mercado Libre y tiendas mexicanas). Resultado: [`borrador-catalogo-investigacion.csv`](borrador-catalogo-investigacion.csv), con **19 productos y 63 variantes**, todo en **borrador** y con las **variantes inactivas** (nada se puede comprar hasta confirmarlo). Una prueba unitaria y otra de integración lo importan con las mismas piezas del panel.

## Qué se usó

- Nombre, marca, sabores y presentaciones → producto con las opciones «Sabor» y «Tamaño».
- Categoría y subcategoría, estado de verificación, precio observado y disponibilidad en México → columnas `ref_*`. La importación las **ignora** y las avisa; sirven de referencia al llenar la hoja.

## Qué no se usó, y por qué

| Dato                                                                                                                  | Motivo                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5 productos: #10 «RAW Nutrition / similar», #15 «Genérica / Varias», #16 «Varias (con Creapure®)», #23 y #24 «Varias» | No identifican un producto concreto que se pueda vender.                                                                                                                                                                                                                           |
| Precio observado                                                                                                      | Es el precio de otra tienda, no el tuyo. La importación **exige** tu precio de venta en cada variante (lo comprueba la prueba de integración).                                                                                                                                     |
| Ingredientes, advertencias y alérgenos                                                                                | Listas resumidas, en parte en inglés, y algunas «advertencias» no lo son («Gluten free», «No es medicamento»). La ficha sanitaria debe copiarse **de la etiqueta**.                                                                                                                |
| Descripciones                                                                                                         | 13 traen afirmaciones de efecto que debe revisar tu asesor antes de publicarlas: energía, enfoque, bombeo, absorción, liberación, pureza, rendimiento, vasodilatación, «subir de peso», definición.                                                                                |
| «Popularidad» (más vendidos, miles de reseñas, #1)                                                                    | No se muestra: no son datos de tu tienda.                                                                                                                                                                                                                                          |
| Imágenes                                                                                                              | Las rutas `/workspace/...` no llegaron con el archivo. Las de `imagine_images` (#12 BSN No-Xplode, #21 Gatorade, entre otras) son **generadas**: nunca deben usarse como foto de un producto real de marca. Las fotos del fabricante necesitan su permiso o el de tu distribuidor. |

## Pendiente antes de importar

1. **Combinaciones de sabor × tamaño:** el archivo da sabores y tamaños por separado. En 6 productos con varios de ambos (ON Gold Standard Whey, Isopure Zero Carb, Dymatize ISO 100, Birdman Falcon, Dymatize Super Mass Gainer, C4 Original) el borrador trae todas las combinaciones. Borra las que tu proveedor no surte.
2. **Por variante:** SKU real (los `PRV-…` son provisionales), código de barras, precio de venta, costo (`cost`) y peso con empaque (`weight_g`).
3. **Por producto:** ficha sanitaria de la etiqueta, descripción revisada y categorías (se crean antes en Productos → Categorías: Proteínas, Pre-entrenos y energía, Creatina, Rendimiento e hidratación).
4. **Contenido neto:** hoy es un dato del producto. En productos con varios tamaños, la presentación ya está en la opción «Tamaño». Propuesta para la siguiente fase: tomar el contenido neto de la variante cuando el producto tenga tamaños.
