# Fase B (lanzamiento) — Catálogo real por CSV · Informe del gate

Fecha: 2026-10-16 · Decisiones D-B-01 a D-B-04 (`docs/DECISIONS.md` §15) · Guía: `docs/catalogo/GUIA-CATALOGO.md`.

## Qué quedó listo

| Requisito del brief                                 | Estado                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Variantes por sabor y tamaño                        | Ya soportado (hasta 3 opciones por producto, una fila por variante)                                      |
| SKU y código de barras únicos                       | Ya soportado (índices únicos por tienda; errores por fila en la vista previa)                            |
| Costo (`variant_costs`)                             | **Nuevo:** columna `cost` en importación y exportación, con permiso `products.cost.read`                 |
| Precio y peso de envío                              | Ya soportado (`price`, `compare_at_price`, `weight_g`)                                                   |
| Atributos filtrables: objetivo, tipo, sabor, tamaño | Ya soportado (Productos → Atributos + columna `attributes`); marca por `brand`                           |
| Imágenes provisionales                              | Propuesta de 5 fotos libres de Unsplash (envases sin marca), con alt «Imagen provisional: …»             |
| Plantilla                                           | **Nueva:** «Descargar plantilla» con todas las columnas; copia en `docs/catalogo/` con prueba de paridad |

## Verificación

| Prueba                                   | Resultado                                                                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`                            | ✅ 549 unit                                                                                                                                                                 |
| pgTAP                                    | ✅ 1664 (nuevo `60_catalog_csv_cost`: 13 — importar, borrar con celda vacía, columna ausente no toca, costo inválido, rol sin `products.cost.read` no importa ni ve costos) |
| Integración                              | ✅ 233                                                                                                                                                                      |
| E2E importación y exportación            | ✅ 2/2                                                                                                                                                                      |
| Vista previa: migración `20261018000300` | ✅ aplicada con sha256 verificado                                                                                                                                           |
| Vista previa: roles                      | ✅ usuario ajeno: `forbidden` al exportar, 0 filas en `variant_costs`; dueña de `demo`: exporta con la columna de costo                                                     |

## Pendiente (no se inventa)

- La carga del catálogo real necesita **tu lista de productos** (nombres, sabores, tamaños, SKU, códigos de barras, costos, precios, pesos y la ficha de cada etiqueta) y **tu tienda creada** con una cuenta de dueña que pueda entrar al panel.
- Las imágenes provisionales se suben cuando exista cada producto.
