# Implementar una tienda en cinco días hábiles (guion)

Guion para quien implementa. Cubre los giros iniciales: ropa, calzado y accesorios; hogar, belleza y regalos; abarrotes; suplementos.

**Estado del guion (2026-11-12):** ensayado solo en local con datos de prueba. Todavía no se ha seguido con un comercio real: los tiempos de persona son [ESTIMADO] y se corrigen con el primer piloto. Los tiempos de máquina son [MEDIDO] en local.

**No prometer el plazo sin la lista del día 0 completa.** Los cinco días empiezan cuando el comercio entregó todo lo de esa lista.

## Requisitos de la plataforma (antes de vender)

No se puede entregar una tienda que cobre hasta cerrar esto (`docs/audit/PRUVA_PRODUCTIZATION_BOARD.md`, fase E):

- producción separada, con respaldos;
- correo real funcionando;
- Mercado Pago probado con una compra real;
- cola de trabajos cada minuto.

## Día 0 — Lo que entrega el comercio

| Qué                | Formato                                                                                                         | Para qué                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Catálogo           | Excel, Google Sheets o CSV. Lo ideal: la hoja de su giro (Productos → Importar → «Descarga la hoja de tu giro») | Productos, precios y existencias |
| Fotos              | Enlaces en la columna «Fotos», o una carpeta por producto con el SKU o el nombre                                | Fotos del catálogo               |
| Logo y colores     | PNG o JPG (no SVG)                                                                                              | Identidad                        |
| Datos del negocio  | Nombre comercial, razón social, domicilio, teléfono, correo, horario                                            | Contacto y textos legales        |
| Políticas          | Cambios y devoluciones, envíos                                                                                  | Páginas legales                  |
| Envíos             | Zonas y tarifas (o «solo recoger en tienda»)                                                                    | Checkout                         |
| Cobro              | Cuenta de Mercado Pago del comercio, o CLABE para transferencia                                                 | Pagos                            |
| Dominio (opcional) | Acceso a su DNS                                                                                                 | Dominio propio                   |
| Suplementos        | Registros y leyendas sanitarias                                                                                 | Ficha regulatoria                |

Columnas de la hoja por giro:

| Giro                       | Columnas propias                                                                |
| -------------------------- | ------------------------------------------------------------------------------- |
| Ropa, calzado y accesorios | Talla, Color: **una fila por talla y color**, repitiendo el nombre del producto |
| Hogar, belleza y regalos   | Presentación (si hay tamaños), Peso (g)                                         |
| Abarrotes                  | Presentación, Costo, Código de barras                                           |
| Suplementos                | Sabor, Tamaño, Costo                                                            |

Todas llevan: Producto, Precio, Precio anterior, Existencias, SKU, Código de barras, Marca, Categoría, Descripción y Fotos.

## Día 1 — Alta y diseño (2 a 3 horas)

1. Consola de plataforma → crear la organización y la tienda con el plan contratado.
2. Dar acceso a la dueña (contraseña y verificación en dos pasos).
3. Configuración → elegir la **plantilla del giro**. Trae categorías, páginas y menús de inicio.
4. Subir el logo; ajustar colores y portada en Apariencia.
5. Ajustes → Funciones: encender Ayuda, Devoluciones, Salud de tu tienda y Notas de empaque.

## Día 2 — Catálogo (2 a 6 horas, según el orden del archivo)

1. Revisar las categorías: **la importación no crea categorías**. Las que use la hoja deben existir (Productos → Categorías).
2. Productos → Importar → pegar las filas o subir el archivo.
3. Leer la vista previa: errores por columna y por fila. Descargar el CSV de errores, corregir y volver a subir. Si urge, «Importar solo los productos sin errores».
4. Confirmar. 5,000 filas tardan menos de un minuto.
5. Más de 5,000 filas (cada talla o color es una fila): partir el archivo sin separar las filas de un mismo producto y subir cada parte. Hay un tope de 30 importaciones por hora.

Errores frecuentes y su arreglo:

| Mensaje                                    | Arreglo                                                     |
| ------------------------------------------ | ----------------------------------------------------------- |
| «no existe la categoría…»                  | Crear la categoría o corregir el nombre                     |
| «sku: repetido»                            | Cada talla o color lleva su propio SKU                      |
| «la misma combinación ya está en la fila…» | Talla y color repetidos en el mismo producto                |
| «falta el valor de Talla»                  | Una fila del producto no tiene talla y las demás sí         |
| «escribe un importe como 199.50»           | Precio con texto o símbolos                                 |
| «ya existe un producto con ese handle»     | Usar el modo «Crear los nuevos y actualizar los existentes» |

## Día 3 — Fotos (1 a 4 horas de persona; la máquina trabaja sola)

1. Si la hoja traía enlaces, las fotos se descargan solas al confirmar.
2. Si no: Productos → Importar → «Subir imágenes en lote», con una carpeta por producto.
3. Abrir **Productos → Importar → Fotos en proceso** y dejar la página abierta: muestra el avance y las fotos que no se pudieron usar, con su motivo.
4. Resolver las rechazadas (enlace roto, archivo dañado, demasiado grande) desde cada producto.

Tiempos de máquina [MEDIDO en local, sin la red del almacenamiento]:

| Fotos  | De catálogo (~1200 px) | De celular (4000×3000) |
| ------ | ---------------------- | ---------------------- |
| 1,000  | ~4 minutos             | ~17 minutos            |
| 10,000 | ~42 minutos            | ~2 h 50 min            |

En producción será más lento por la red y por el tamaño del servidor. Con el cron cada minuto debe caber en una noche; con el cron diario solo avanza mientras «Fotos en proceso» esté abierta.

## Día 4 — Envíos, cobro y textos (2 a 3 horas)

1. Envíos → zonas y tarifas.
2. Ajustes → Pagos → conectar Mercado Pago (lo hace el comercio con su cuenta) o capturar los datos de transferencia.
3. Contenido → Páginas: completar privacidad, términos, devoluciones y envíos con los datos del comercio.
4. Dominio propio, si aplica: Ajustes → Dominio (verificación TXT).
5. Suplementos: llenar la ficha de cada producto; sin ella no se publican.

## Día 5 — Pruebas y entrega (2 a 3 horas)

Checklist de entrega:

- [ ] Inicio del panel: «Estado del sistema» sin pendientes y 0 fotos en proceso.
- [ ] Productos → Revisión: sin productos sin foto, sin precio o sin categoría.
- [ ] La tienda abre en celular y en computadora; búsqueda y filtros devuelven productos.
- [ ] Compra de prueba completa: carrito, envío, pago y correo de confirmación.
- [ ] El pedido aparece en el panel; se surte, se marca enviado y el comprador recibe el aviso.
- [ ] Reembolso de la compra de prueba.
- [ ] La dueña entra sola al panel, cambia un precio y ve el cambio en la tienda.
- [ ] La dueña sabe dónde está Ayuda y a quién escribir.
- [ ] Configuración → lanzar la tienda.
- [ ] Respaldo confirmado y fecha de entrega anotada.

Capacitación (30 a 60 minutos): pedidos del día, cambiar precios y existencias, crear una oferta, ver Inicio.

## Qué medir en cada implementación

Anotar para mejorar el guion y calcular costos:

- horas de persona por día del guion;
- filas del archivo, filas con error en la primera subida y número de vueltas de corrección;
- fotos totales, rechazadas y tiempo hasta 0 en proceso;
- días desde la lista del día 0 completa hasta el lanzamiento;
- preguntas de soporte en los primeros 30 días.
