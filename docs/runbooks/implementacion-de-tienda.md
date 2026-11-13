# Implementar una tienda en cinco días hábiles (guion)

Guion para quien implementa. Cubre los giros iniciales: ropa, calzado y accesorios; hogar, belleza y regalos; abarrotes; suplementos.

**Estado del guion (2026-11-13):** ensayado de punta a punta en local con cuatro tiendas **sintéticas** (Orden 10, O10-01; resultados al final). Ninguna es una entrega comercial y todavía no se ha seguido con un comercio real: los tiempos de persona son [ESTIMADO] y se corrigen con el primer piloto. Los tiempos de máquina son [MEDIDO] en local.

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
3. Configuración → elegir la **plantilla del giro**. Trae categorías, páginas y menús de inicio, y **4 o 5 productos de ejemplo**: quitarlos con «Quitar los N productos de ejemplo» antes de importar.
4. Subir el logo; ajustar colores y portada en Apariencia.
5. Ajustes → Funciones: encender Ayuda, Devoluciones, Salud de tu tienda y Notas de empaque.
6. **Suplementos:** Ajustes → Cumplimiento → declarar «Suplemento alimenticio». Sin esa declaración la tienda deja publicar productos sin ficha sanitaria (el ensayo lo confirmó); con ella, cada producto la exige.

## Día 2 — Catálogo (2 a 6 horas, según el orden del archivo)

1. Revisar las categorías. Desde la Orden 10, mensaje 4, las 4 plantillas traen las categorías de su giro (Calzado; Belleza y Regalos; Lácteos y Cuidado personal; Aminoácidos).
   - Si la hoja usa una que no existe, la vista previa la lista con cuántos productos la usan. Se puede marcar «Crear las categorías que falten», elegir cuáles y confirmar (ADR-065). Se crean al aplicar la importación; si la importación falla, no se crea ninguna.
   - Revisar los nombres: una categoría mal escrita se crearía tal cual. Las que se parecen a una existente salen con aviso.
2. Productos → Importar → pegar las filas o subir el archivo.
3. Leer la vista previa: errores por columna y por fila. Descargar el CSV de errores, corregir y volver a subir. Si urge, «Importar solo los productos sin errores».
4. Confirmar. 5,000 filas tardan menos de un minuto.
5. **Publicar.** Escribir «sí» en la columna «Publicado» de la hoja (ya viene en las hojas por giro).
   - Al terminar la importación, el sistema publica los que cumplen las reglas y muestra cuántos se publicaron y por qué quedaron pendientes los demás: ficha de cumplimiento, precio, presentación.
   - Los pendientes siguen en borrador. Se corrigen y se publican desde Productos (en bloque, 100 por acción).
   - Nada se publica saltándose las reglas.
6. **Más de 5,000 filas** (cada talla o color es una fila; hasta 50,000): subir el archivo completo en el paso 3. La pantalla lo parte sola en partes de hasta 5,000 filas, sin separar un producto, y abre la página del lote.
   - Ahí se ve cada parte, se eligen las categorías nuevas una sola vez y se pulsa «Aplicar el lote».
   - Si una parte falla, las anteriores ya quedaron y la pantalla lo dice. Se corrige el archivo, se vuelve a elegir en la misma página (solo sube la parte que cambió) y se pulsa «Continuar».
   - Si se corta la subida, volver a elegir el mismo archivo la retoma.
   - Cada parte cuenta en el tope de 30 importaciones por hora.
   - Con la página del lote abierta, el lote avanza solo. Cerrada, espera a la siguiente pasada de la cola (en staging, una vez al día).

Errores frecuentes y su arreglo:

| Mensaje                                    | Arreglo                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| «no existe la categoría…»                  | Corregir el nombre, o marcar «Crear las categorías que falten» en la vista previa |
| «sku: repetido»                            | Cada talla o color lleva su propio SKU                                            |
| «la misma combinación ya está en la fila…» | Talla y color repetidos en el mismo producto                                      |
| «falta el valor de Talla»                  | Una fila del producto no tiene talla y las demás sí                               |
| «escribe un importe como 199.50»           | Precio con texto o símbolos                                                       |
| «ya existe un producto con ese handle»     | Usar el modo «Crear los nuevos y actualizar los existentes»                       |

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

1. Envíos → zonas y tarifas. Comprobar que la tarifa diga **Activa**: hasta el commit `65ee7a0` (Orden 10) toda tarifa guardada desde el panel quedaba inactiva y la tienda no se podía publicar. Staging conserva ese error hasta el próximo despliegue autorizado.
2. Ajustes → Pagos → conectar Mercado Pago (lo hace el comercio con su cuenta) o capturar los datos de transferencia.
3. Contenido → Páginas: completar privacidad, términos, devoluciones y envíos con los datos del comercio. **Sin texto propio en privacidad, términos y devoluciones la tienda no se publica** (el checklist lo exige): pedir esos textos en el día 0.
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

## Ensayo sintético de la Orden 10 (O10-01, 2026-11-12/13)

Cuatro tiendas **inventadas** recorrieron el guion completo por la interfaz, en local, con un navegador automático: alta en la consola de plataforma, invitación y verificación en dos pasos de la dueña, plantilla, logo, colores, funciones, hoja del giro con errores de captura puestos a propósito, corrección, importación, fotos en lote por SKU, envíos, cobro por transferencia, políticas, publicación en bloque, publicación de la tienda y una compra de prueba que aparece en el panel. Ninguna es una entrega comercial. Se repite con:

```bash
ENSAYO_GIROS=ropa,hogar,abarrotes,suplementos pnpm exec playwright test -c playwright.ensayo.config.ts
```

Tiempos de máquina [MEDIDO], en segundos (local, sin red real; el navegador sigue el guion sin dudar, así que **no son tiempos de persona**):

| Giro        | Productos / filas | Día 1 alta | Día 1 diseño | Día 2 catálogo | Día 3 fotos | Día 4 | Día 5 | Total |
| ----------- | ----------------- | ---------- | ------------ | -------------- | ----------- | ----- | ----- | ----- |
| Ropa        | 30 / 162          | 5.3        | 8.0          | 8.9            | 11.1 (30)   | 15.0  | 7.0   | 55    |
| Hogar       | 70 / 100          | 5.5        | 8.5          | 9.5            | 23.6 (70)   | 15.0  | 7.7   | 70    |
| Abarrotes   | 160 / 214         | 5.4        | 8.3          | 10.3           | 52.0 (160)  | 15.4  | 10.3  | 102   |
| Suplementos | 40 / 136          | 5.1        | 8.9          | 8.9            | 14.3 (40)   | 15.3  | 6.9   | 60    |

Las cuatro terminaron con todos sus productos publicados, 0 fotos rechazadas y la compra de prueba registrada. La capacitación no se puede medir con tiendas sintéticas.

Qué encontró el ensayo y qué cambió:

| Hallazgo                                                                                                     | Tipo              | Qué se hizo                                                  |
| ------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------ |
| Toda tarifa guardada desde el panel quedaba inactiva; la tienda no se podía publicar                         | Error (corregido) | `65ee7a0` + prueba `tests/e2e/shipping-rates.spec.ts`        |
| Ninguna plantilla de giro trae todas las categorías de su giro                                               | Paso manual       | **Resuelto** en el mensaje 4 (D-O10-08 y ADR-065)            |
| La importación deja todo en borrador; publicar en bloque va de 100 en 100                                    | Paso no escrito   | **Resuelto** en el mensaje 4: columna «Publicado» (D-O10-12) |
| Las plantillas traen productos de ejemplo                                                                    | Paso no escrito   | Día 1, paso 3                                                |
| Sin declarar suplementos en Cumplimiento se publican sin ficha                                               | Riesgo            | Día 1, paso 6                                                |
| Sin políticas propias no se publica                                                                          | Requisito         | Día 4, paso 3 (pedirlas en el día 0)                         |
| Los errores de captura (precio con texto, existencias con letras, SKU repetido, sabor vacío, costo negativo) | Funciona bien     | Cada uno con su mensaje por columna y fila                   |

### Repetición tras el mensaje 4 de la Orden 10 (2026-11-13)

Mismas 4 tiendas sintéticas y mismo comando. Las hojas ya traen «Publicado: sí» y las plantillas, sus categorías.

| Giro        | Día 1 alta | Día 1 diseño | Día 2 catálogo | Día 3 fotos | Día 4 | Día 5 | Total | Publicados al importar |
| ----------- | ---------- | ------------ | -------------- | ----------- | ----- | ----- | ----- | ---------------------- |
| Ropa        | 7.3        | 8.9          | 10.1           | 12.7        | 15.5  | 6.0   | 60    | 30 de 30               |
| Hogar       | 6.0        | 9.0          | 7.9            | 26.5        | 16.0  | 4.4   | 70    | 70 de 70               |
| Abarrotes   | 6.0        | 8.2          | 7.8            | 57.1        | 15.3  | 4.4   | 99    | 160 de 160             |
| Suplementos | 6.5        | 8.7          | 7.5            | 14.9        | 15.2  | 4.3   | 57    | 40 de 40               |

- 4 de 4, **sin hallazgos**.
- No hubo que crear categorías a mano.
- Al terminar cada importación ya estaban publicados todos los productos: el Día 5 ya no publica en bloque (0 borradores).
- **Arranque en frío:** la primera corrida, justo después de reiniciar el stack local, falló en 2 tiendas. Ropa falló en la verificación en dos pasos (Auth en frío). En Hogar, la primera subida del logo no llegó al almacenamiento en frío.
- **Error real encontrado y corregido (D-O10-15):** el trabajo del logo de otra tienda se marcó fallido por la invalidación de la caché y se repitió 1 minuto después.
- Resultado guardado en `test-results/ensayo/` (o en `ENSAYO_OUT`).

Pendiente: repetir con un comercio real (piloto) para medir horas de persona y preguntas de soporte.
