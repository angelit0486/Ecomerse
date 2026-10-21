# Auditoría de detalles del panel (Pulido, Paso 1)

**Fecha:** 2026-10-21 · **Base:** `de5d6f8` · **Método:** recorrido automático de todas las pantallas enlazadas desde el panel con datos reales sembrados (categoría, producto publicado con existencias, borrador sin precio, zona de envío, pago de prueba y un pedido hecho desde la tienda).

## Alcance del recorrido

| Quién                            | Ancho      | Pantallas |
| -------------------------------- | ---------- | --------- |
| Dueña con datos                  | 375 y 1280 | 68 + 68   |
| Dueña con tienda vacía           | 375        | 60        |
| Rol Pedidos (`order_manager`)    | 375        | 28        |
| Rol Solo lectura (`viewer`)      | 375        | 27        |
| Rol Catálogo (`catalog_manager`) | 375        | 26        |
| Rol Diseño (`designer`)          | 375        | 25        |
| Consola de plataforma            | 375 y 1280 | 4 + 4     |
| **Total**                        |            | **310**   |

En cada pantalla se midió: código HTTP y página de error, desborde horizontal y el elemento que lo causa, objetivos táctiles chicos, palabras en inglés a la vista, axe (todas las severidades) y errores de consola o peticiones fallidas.

**Sin hallazgos:** 0 errores 4xx/5xx o páginas de error, 0 textos en inglés, 0 errores de consola o de red (fuera del `<select>` de terceros ya conocido). Los roles solo ven sus secciones.

## Hallazgos

| #   | Severidad | Pantalla                                      | Pasos                                   | Causa                                                                                                                                                                              | Estado                                                                                              |
| --- | --------- | --------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| D-1 | Media     | Contenido → Páginas → editar (dueña y Diseño) | Abrir cualquier página a 375 px         | La vista previa de Google está en una cuadrícula cuyas columnas no se encogen (`min-width: auto`); la URL en una sola línea la ensancha. La pantalla se desplaza de lado 33–60 px. | **Corregido.** `min-w-0` en las columnas y títulos que parten palabra. E2E `panel-mobile`.          |
| D-2 | Media     | Consola de plataforma (todas sus pantallas)   | Abrir `/platform` a 375 px              | La navegación no se envuelve: 111 px de desborde. Enlaces de 20 px de alto.                                                                                                        | **Corregido.** Se envuelve; enlaces de 44 px en el celular. E2E `platform`.                         |
| D-3 | Baja      | Contenido → Páginas → editar                  | axe a cualquier ancho                   | «Así se vería» era `h3` justo después del `h1` (`heading-order`, moderada).                                                                                                        | **Corregido.** El título toma el nivel según dónde se muestra. E2E `panel-mobile` con axe moderado. |
| D-4 | Baja      | Ajustes → Actividad                           | Filtros por área a 375 px               | Filtros de 30 px de alto.                                                                                                                                                          | **Corregido.** 44 px en el celular, 36 px en escritorio.                                            |
| D-5 | Baja      | Pedidos                                       | Filtros por estado a 1280 px            | `md:min-h-0` dejaba los filtros en 20 px en escritorio.                                                                                                                            | **Corregido.** 36 px en escritorio, como el resto.                                                  |
| D-6 | Baja      | Consola → Cumplimiento y Soporte              | Casillas de «Dónde se muestra» a 375 px | La consola no tenía `data-panel`, así que sus casillas no tomaban los 24 px del celular.                                                                                           | **Corregido.**                                                                                      |

No son hallazgos: los `<select>` de 1×1 px (el `<select>` oculto del componente de selección, que se toca por su botón) y las casillas de 13 px en escritorio (decisión de la misión panel, F4: 24 px solo en el celular).

## Pendiente de este paso

- Pruebas de interacción: doble clic en guardar y publicar, conexión perdida a mitad de un formulario, sesión vencida, confirmación en acciones destructivas y formularios que no pierden lo escrito.
