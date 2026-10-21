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

| #    | Severidad | Pantalla                                                             | Pasos                                                                                              | Causa                                                                                                                                                                                              | Estado                                                                                                                                                                                           |
| ---- | --------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-1  | Media     | Contenido → Páginas → editar (dueña y Diseño)                        | Abrir cualquier página a 375 px                                                                    | La vista previa de Google está en una cuadrícula cuyas columnas no se encogen (`min-width: auto`); la URL en una sola línea la ensancha. La pantalla se desplaza de lado 33–60 px.                 | **Corregido.** `min-w-0` en las columnas y títulos que parten palabra. E2E `panel-mobile`.                                                                                                       |
| D-2  | Media     | Consola de plataforma (todas sus pantallas)                          | Abrir `/platform` a 375 px                                                                         | La navegación no se envuelve: 111 px de desborde. Enlaces de 20 px de alto.                                                                                                                        | **Corregido.** Se envuelve; enlaces de 44 px en el celular. E2E `platform`.                                                                                                                      |
| D-3  | Baja      | Contenido → Páginas → editar                                         | axe a cualquier ancho                                                                              | «Así se vería» era `h3` justo después del `h1` (`heading-order`, moderada).                                                                                                                        | **Corregido.** El título toma el nivel según dónde se muestra. E2E `panel-mobile` con axe moderado.                                                                                              |
| D-4  | Baja      | Ajustes → Actividad                                                  | Filtros por área a 375 px                                                                          | Filtros de 30 px de alto.                                                                                                                                                                          | **Corregido.** 44 px en el celular, 36 px en escritorio.                                                                                                                                         |
| D-5  | Baja      | Pedidos                                                              | Filtros por estado a 1280 px                                                                       | `md:min-h-0` dejaba los filtros en 20 px en escritorio.                                                                                                                                            | **Corregido.** 36 px en escritorio, como el resto.                                                                                                                                               |
| D-6  | Baja      | Consola → Cumplimiento y Soporte                                     | Casillas de «Dónde se muestra» a 375 px                                                            | La consola no tenía `data-panel`, así que sus casillas no tomaban los 24 px del celular.                                                                                                           | **Corregido.**                                                                                                                                                                                   |
| D-7  | Alta      | 27 acciones destructivas en 20 pantallas (lista abajo)               | Pulsar «Solicitar reembolso», «Quitar» dominio, «Desactivar Mercado Pago», «Eliminar página», etc. | Se ejecutaban con un solo clic, sin confirmación. Un toque accidental en el celular reembolsaba, dejaba la tienda sin cobro o borraba contenido.                                                   | **Corregido.** `ConfirmButton`: pregunta en la página, «Sí, …» o «No»/Escape; 4 pruebas unitarias; E2E de 7 archivos ajustadas; suite E2E 80/80.                                                 |
| D-8  | Media     | Ajustes → Equipo                                                     | Doble clic en Suspender, Quitar, Restablecer 2FA o Revocar                                         | Los botones no se deshabilitaban mientras corría la acción.                                                                                                                                        | **Corregido.** Mientras una acción corre, todas se deshabilitan.                                                                                                                                 |
| D-9  | Alta      | Cualquier formulario del panel                                       | Guardar sin conexión                                                                               | La acción rechazaba y la pantalla se cambiaba por «Algo falló al cargar esta pantalla… No se perdió nada de lo que guardaste»: el formulario se desmontaba con lo escrito y el texto era engañoso. | **Corregido.** `useSafeActionState` en los 40 archivos del panel y la consola: aviso que no promete que no se guardó (evita un segundo reembolso) y devuelve lo enviado. E2E `panel-resilience`. |
| D-10 | Media     | Cualquier formulario del panel                                       | Guardar con la sesión vencida                                                                      | «Necesitas iniciar sesión.» sin decir cómo, y lo escrito se perdía.                                                                                                                                | **Corregido.** «Tu sesión terminó. Inicia sesión de nuevo en otra pestaña y vuelve a guardar aquí.» y lo escrito se conserva (sin contraseñas ni códigos). E2E `panel-resilience`.               |
| D-11 | Media     | Categorías, marcas, impuestos, ajuste de existencias y precio rápido | Cualquier error al guardar                                                                         | Sus campos no se rellenaban con lo enviado: React 19 reinicia el formulario y se vaciaban.                                                                                                         | **Corregido.** Cada campo prefiere `state.values`. E2E `panel-resilience` (categoría).                                                                                                           |

No son hallazgos: los `<select>` de 1×1 px (el `<select>` oculto del componente de selección, que se toca por su botón) y las casillas de 13 px en escritorio (decisión de la misión panel, F4: 24 px solo en el celular).

### D-7: dónde se pide confirmación ahora

Envíos (zona, tarifa) · productos de ejemplo · categoría · marca · oferta · eliminar producto · archivar o eliminar en bloque · foto · desvincular proveedor · rechazar o retirar opinión · restaurar versión del diseño · solicitar reembolso · quitar dominio · revocar invitación · desactivar tarjeta y Mercado Pago · redirección · eliminar página · descartar bloques · archivar cupón · retirar regla (consola).

Sin confirmación, a propósito, porque se deshacen con un clic: archivar un producto, desactivar un cupón, suspender a un miembro, quitar la programación, quitar el logo del borrador y revocar el acceso de soporte (es una medida de seguridad y no conviene frenarla).

## Interacciones probadas

- **Doble clic:** los botones de guardar se deshabilitan mientras corre la acción (primitiva `Button` con `loading`); en Equipo faltaba (D-8).
- **Confirmación en acciones destructivas:** D-7.
- **Sin conexión, sesión vencida y datos que no se pierden:** D-9 a D-11.
- **Rol sin permisos:** el recorrido de los cuatro roles no mostró secciones ajenas; las URL directas de otras secciones dan 404 (E2E `team`, `redirects-designer`).

Fuera de alcance, sin cambio: la tienda (carrito y pago) tiene su propio manejo de errores y no se tocó en este paso.
