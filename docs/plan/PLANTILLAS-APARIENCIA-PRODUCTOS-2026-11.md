# Más plantillas, Apariencia avanzada y carga rápida de productos (2026-11-05)

Pedido del propietario: muchas más plantillas modernas, cada tienda con su propia esencia, una sección de Apariencia mucho más avanzada y mucha más eficiencia para llenar cada tienda de productos.

Etiquetas: **[VERIFICADO]** = lo comprobé en el código o en la base; **[PROPUESTA]** = idea mía, aún sin construir.

## 1. Qué hay hoy [VERIFICADO]

| Área        | Lo que existe                                                                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plantillas  | 8: suplementos, ropa, belleza, abarrotes, hogar, mascotas, genérica y en blanco. Cada una trae colores, tipografías, forma, portada, categorías (hasta 12) y productos de ejemplo (hasta 24).                                                                                  |
| Estilos     | 5: PRUVA, Anaquel, Deportivo, Neutral y Grafito.                                                                                                                                                                                                                               |
| Opciones    | 10 tipografías, 4 radios de esquina, 2 estilos de botón, 3 sombras, 3 densidades, logo a la izquierda o al centro, hasta 4 accesos rápidos, barra de categorías (texto, píldoras o fotos), galería de ficha, columnas del listado y 15 tipos de bloque de portada.             |
| Apariencia  | Diseño de la portada por bloques, Colores (con aviso de contraste), Encabezado y pie, Redes y contacto, SEO, vista previa privada, publicar con confirmación y deshacer.                                                                                                       |
| Productos   | Alta rápida, editor con variantes, CSV (con fotos, costos, ficha sanitaria y atributos), archivo de Shopify, fotos por lote según el SKU, fotos desde un enlace, duplicar, acciones en bloque (archivar, marca, precios), ofertas programadas y proveedores con su propio CSV. |
| Límite fijo | Sin CSS ni JavaScript libre de la tienda (regla 13): la personalidad sale de opciones curadas, no de código.                                                                                                                                                                   |

## 2. Fases

### A. Plantillas y estilos nuevos · sin ADR (solo datos)

Se arman con las opciones que ya existen: no cambian la base de datos ni el esquema del tema, y las tiendas actuales no cambian.

- **Primera tanda (6 plantillas): hecha el 2026-11-05 (D-MEJ-19):** joyería y accesorios, electrónica y gadgets, café y gourmet, juguetes y bebés, papelería y libros, regalos y flores, con 15 dibujos nuevos para el primer día sin fotos.
- **Segunda tanda (6 más):** deportes y outdoor, muebles, farmacia natural sin promesas de salud, fotografía y arte, restaurante y comida preparada, servicios con anticipo. [PROPUESTA]
- **Estilos nuevos:** uno por personalidad (editorial, atrevido, cálido, minimalista, nocturno, fresco).
- **Reglas de calidad:** contraste AA comprobado por una prueba para cada paleta, textos que no prometen efectos, tope de 12 categorías y 24 productos, y captura de pantalla de cada una a 360, 768 y 1280 px.

### B. Apariencia avanzada · requiere ADR-063 (contrato del tema)

**ADR-063 aprobado el 2026-11-05. B-1 hecha (D-MEJ-21):** tarjeta de producto, títulos y movimiento sutil, en Apariencia → «Personalidad» (interruptor `theme_personality`), y las 12 plantillas de giro con personalidad propia. Siguen B-2 (encabezado, portada y secciones) y B-3 (6 familias nuevas y modo oscuro).

La base valida el tema campo por campo (`app.theme_settings_valid`) y el esquema es un contrato crítico (GATE0 §43), así que cada opción nueva necesita ADR, migración aditiva, pruebas y su versión.

Opciones propuestas, todas con valores fijos (nunca texto libre):

- **Tarjeta de producto:** estilo (limpia, con borde, elevada), proporción de la foto (1:1, 4:5, 3:4), efecto al pasar el cursor (ninguno, acercar, segunda foto) y forma de las etiquetas.
- **Encabezado:** clásico, centrado, mínimo o con búsqueda grande.
- **Portada:** variantes del bloque principal (a pantalla completa, editorial, color sólido con texto).
- **Secciones:** fondo (normal, tenue, color de la marca) y separador (sin, línea, curva).
- **Tipografía:** escala (compacta, normal, grande), mayúsculas en títulos, espaciado de letras y 6 familias nuevas.
- **Modo:** claro u oscuro, con contraste validado.
- **Movimiento:** ninguno o sutil, que respeta la preferencia «reducir movimiento» del visitante.
- **Todo detrás de un interruptor por tienda** y con un valor por defecto igual a lo que se ve hoy.

Costos y riesgos: las 6 familias nuevas se agregan como paquetes `@fontsource-variable/*` (dependencia nueva, regla 16: propósito, alternativas y tamaño se justifican en el ADR). Cada opción nueva suma superficie de pruebas.

### C. Llenar la tienda más rápido · sin ADR salvo que toque un contrato

Reutiliza el importador actual (misma validación y vista previa), así que no abre caminos nuevos hacia la base.

- **Hecho el 2026-11-05 (D-MEJ-20): pegar filas desde Excel o Google Sheets.** Se copian las celdas y se pegan en el panel; entiende encabezados en español («Producto», «Precio», «Existencias», «Categoría», «Fotos»…), crea solo el nombre corto de cada producto y muestra los errores por fila antes de confirmar. También sirve para subir una hoja simple como archivo.
- **Ya existía (lo comprobé en el código, así que no se construye):** acciones en bloque para publicar, pausar, archivar, marca, categorías, etiquetas, precios en porcentaje, ofertas y eliminar; duplicar; fotos por lote según el SKU y fotos desde un enlace.
- **Siguiente [PROPUESTA]: crear las categorías que no existan al importar.** Hoy una categoría escrita que no existe da error en su fila. Requiere cambiar `imports_create` y `system.import_commit` (migración aditiva con pgTAP).
- **Después [PROPUESTA]: asistente «Llena tu tienda»:** pasos cortos (categorías, primeros productos, fotos, precios, publicar) con avance visible.
- **Después [PROPUESTA]: catálogo inicial por giro:** categorías y atributos listos para cada giro (sin datos de marcas reales).

## 3. Decisión del propietario

- **ADR-063 (fase B):** aprobado el 2026-11-05; se hace por partes (B-1 hecha). Ver DECISIONS.
- La fase A y la C no necesitan decisión; empiezo por la A.
