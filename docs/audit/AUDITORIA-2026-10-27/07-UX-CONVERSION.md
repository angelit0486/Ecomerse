# 07 · UX y conversión (tiendas y panel)

Auditoría de solo lectura, 2026-10-27. Prefijo de IDs: **UX-**.
Auditor: área de UX y conversión. Las capturas de pantalla viven fuera del repo, en
`/tmp/claude-0/-home-user/6527ba7e-e531-5909-98d5-ea4f6280f816/scratchpad/au/ux/` (en este documento se citan solo por nombre de archivo).

**Etiquetas:** [VERIFICADO] = lo comprobé ejecutando o leyendo código/datos; [INFERIDO] = deducido sin ejecutarlo;
[NO VERIFICADO] = requiere un servicio real o un dato que no tengo.
**Severidad:** Alta = impide comprar u operar, o probablemente causa mucho abandono; Media = fricción notable; Baja = pulido.

---

## 1. Qué se hizo (método)

- **Tiendas locales** `http://demo.localhost:3000` y `http://demo2.localhost:3000`, con scripts de Playwright (la herramienta que maneja un navegador Chromium automáticamente)
  a **360, 375, 768, 1280 y 1920 px** de ancho. Se recorrieron 13 pantallas por tienda: portada, listado, listado con filtros
  (`?objetivo=fuerza&orden=price_asc`), categoría, ofertas, marcas, búsqueda con resultados (`creatina`), búsqueda sin resultados,
  ficha, carrito vacío, cuenta y dos 404. En total **130 combinaciones de pantalla y ancho**.
  En cada una se midió: desborde horizontal (`scrollWidth > innerWidth`), objetivos táctiles chicos, textos cortados, imágenes rotas,
  errores de consola, CLS (cambio acumulado de diseño: cuánto “brinca” la página al cargar) y **axe** (motor automático de accesibilidad, reglas WCAG 2.1 AA y buenas prácticas).
- **Compra completa como invitado** hasta el pago simulado y la página del pedido: demo a 375 px (pedido #1002) y demo2 a 1280 px (pedido #1001).
  Además: “Comprar ahora”, validación con formulario vacío, escritura tecla por tecla contra autocompletado, y recorrido con teclado (Tab).
- **Panel** (`http://localhost:3000/admin/...`) con la sesión guardada `lh-session.json` (tienda de prueba `tlh0e4ce993`). Para revisar pedidos reales
  le di a ese usuario de prueba, por unos minutos, el rol `org_admin` en la organización demo de la base **local** de desarrollo (`pruva_dev`), y después lo quité.
  Se recorrieron 15 pantallas a 375 y 1280 px (con axe), y se midieron tareas: crear y publicar un producto, importar un CSV (con errores y sin errores),
  cambiar la portada y publicarla, logos de marcas y fotos de categorías, procesar un pedido (registrar envío) y ajustes.
- **Staging** (Supabase `epgiglysldwoiulnwamf`): una sola consulta `SELECT` sobre el nombre, las páginas publicadas, el menú del pie y el contacto de demo y demo2.
- **Páginas en línea**: `WebFetch` no resolvió el dominio (ENOTFOUND). Con Exa se pudo leer parcialmente `pruva-tienda-demo2.vercel.app`; `pruva-tienda-demo.vercel.app` dio _timeout_.

Datos de prueba creados **solo en la base local** `pruva_dev`: pedidos #1001 y #1002 en demo, #1001 en demo2 (pagados con el simulador, y #1002 de demo quedó como enviado);
el producto “Creatina auditoría UX”, dos productos importados (“Proteína UX” y “Magnesio UX”), una imagen de banner en estado `pending` y dos trabajos de importación en la tienda `tlh0e4ce993`.
La membresía temporal ya se quitó.

---

## 2. Resumen de mediciones automáticas (tiendas) [VERIFICADO]

| Métrica                                               | Resultado (130 combinaciones)                                                                                                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desborde horizontal de página                         | **0**: `scrollWidth == innerWidth` en todas                                                                                                                                                                            |
| Violaciones de axe (WCAG 2.1 AA + buenas prácticas)   | **0**                                                                                                                                                                                                                  |
| Errores de consola                                    | 0, salvo el registro esperado del 404 (“Failed to load resource … 404”) en las dos rutas 404                                                                                                                           |
| Imágenes rotas                                        | 0                                                                                                                                                                                                                      |
| CLS máximo                                            | 0.012 (404 a 1280 px); en la mayoría, 0.000–0.003                                                                                                                                                                      |
| Foco visible con Tab (portada, primeros 14 elementos) | Contorno de 2 px en todos. El buscador usa `focus-within` en su contenedor (search-box.tsx:122)                                                                                                                        |
| Barra de categorías en móvil                          | Se desplaza de lado (a 360 px: `scrollWidth` 1211 contra 360 visibles). Tiene **máscara de desvanecido** a la derecha (nav-bar.tsx:82), que avisa que hay más. El corte visible (“Re…”) es intencional, no es un error |
| Objetivos táctiles menores de 44 px                   | Enlaces del pie de 17 px de alto, “Ver todos” de 24 px, migas “Inicio” de 34×20, casillas de filtro de 20×20. Ver UX-11                                                                                                |

Capturas: `shot-<tienda>-<pantalla>-<ancho>.png` (p. ej. `shot-demo-home-375.png`, `shot-demo2-ficha-1280.png`); datos crudos en `crawl.json`.

---

## 3. Clics por tarea clave [VERIFICADO]

| Tarea                                                                       | Dónde                 | Clics                                                                                                                         | Campos                                      | Notas                                                                                                                                     |
| --------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Comprar como invitado (ficha → carrito → checkout → pago → gracias)         | Tienda, 375 y 1280 px | 6 (con “Comprar ahora”: 4)                                                                                                    | 8 obligatorios + 2 opcionales               | Sin cuenta obligatoria. Con llenado sin salir de cada campo (simula autocompletado) hacen falta **2 clics** en “Confirmar pedido” (UX-04) |
| Crear y publicar un producto simple con foto                                | Panel 1280 px         | 5 (Agregar → foto → Crear → Publicar, más el tipo)                                                                            | 3 (nombre, precio, existencias) + 1 archivo | Siempre nace como borrador; publicar es otro clic (UX-14)                                                                                 |
| Importar catálogo CSV                                                       | Panel 375 px          | 3 (archivo → Validar → Confirmar)                                                                                             | 0                                           | Muestra la vista previa con errores por fila. Todo o nada (UX-10)                                                                         |
| Cambiar la imagen y el título de la portada y publicar (tienda sin portada) | Panel 1280 px         | ≈ 11 (pestaña, tipo de bloque, Agregar, archivo, Subir, esperar o recargar, elegir imagen, Guardar, Publicar, “Sí, publicar”) | 2–3 (título, texto alternativo, botón)      | La imagen se sube aparte y tarda en aparecer (UX-09)                                                                                      |
| Registrar el envío de un pedido pagado                                      | Panel 375 px          | 2 (abrir pedido → Registrar envío)                                                                                            | 0–3 opcionales (paquetería, guía, enlace)   | Confirma con “Envío registrado. Avisamos al cliente por email.”                                                                           |
| Logos de marcas o fotos de categorías                                       | Panel                 | 2 (arrastrar varios → Subir N)                                                                                                | 0                                           | Se asignan por nombre de archivo (muy buena idea)                                                                                         |
| Configurar la tienda nueva                                                  | Panel                 | Lista de 9 pasos con avance (“2 de 9 pasos listos”)                                                                           | —                                           | Cada paso lleva a su pantalla                                                                                                             |

---

## 4. Hallazgos

### UX-01 · Alta · Las políticas (privacidad, términos, devoluciones y envíos) no aparecen en la tienda ni en el checkout

- **Evidencia [VERIFICADO]:**
  - En la base local, demo y demo2 tienen sus 4 políticas en `store_pages` con `is_published = false`, y el menú `footer` tiene **0** elementos (consulta en `pruva_dev`).
  - En staging (SELECT de hoy): demo tiene **0 páginas publicadas**, 1 elemento en el menú del pie y email de contacto, pero no teléfono. Demo2 tiene 0 páginas, 0 elementos en el pie y no tiene contacto.
  - El pie de la tienda solo muestra políticas si la dueña las agrega a mano al menú `footer`: `src/app/%5Fstore/[storeId]/_components/header.tsx:217` (`const help = menu.flatMap(...)`). Publicar una política no la agrega al menú (no encontré ningún código que lo haga en `admin/.../contenido/actions.ts`).
  - El checkout no enlaza ninguna política. No hay referencias a `paginas/`, privacidad ni términos en `src/app/%5Fstore/[storeId]/checkout/`. El texto del checkout tomado en la prueba no tiene ningún enlace legal (`flow-demo-375-04-checkout.png`).
  - **Control que sí existe:** para lanzar una tienda nueva hay que publicar las políticas (`supabase/migrations/20261014000400_store_launch.sql:63-66`, y el paso “Políticas” en `configuracion/page.tsx:207`). Las demos se sembraron ya activas y no pasaron por ese candado.
- **Impacto:** el 13 % de quienes abandonan lo hacen porque la política de devoluciones no los convenció (Baymard, ver fuentes). El aviso de privacidad debería estar a la vista **en el momento de pedir los datos**. _Orientación informativa; validar con abogado o asesor regulatorio_ (LFPDPPP y Profeco). Aunque la tienda publique sus políticas, el comprador no las encuentra si nadie las agrega al pie.
- **Recomendación:** (a) al publicar una política, agregarla sola a una sección fija “Ayuda / Legal” del pie, sin depender del menú; (b) en el checkout, un texto junto a “Confirmar pedido”: “Al confirmar aceptas los Términos y el Aviso de privacidad”, con enlaces; (c) enlace a “Envíos y devoluciones” en la ficha y el carrito; (d) en staging, publicar las políticas de la demo, aunque sean de ejemplo.

### UX-02 · Media · El nombre de la tienda demo en staging usa letras Unicode decorativas (“𝓐𝓛𝓘𝓔𝓝 𝓓𝓔𝓜𝓞𝓝 𝓔𝓧𝓞𝓣𝓘𝓒𝓢 |”)

- **Evidencia:**
  - [VERIFICADO] Staging: `stores.name` = “𝓐𝓛𝓘𝓔𝓝 𝓓𝓔𝓜𝓞𝓝 𝓔𝓧𝓞𝓣𝓘𝓒𝓢 |” (21 caracteres Unicode, 38 unidades UTF-16 y 72 bytes). Su forma normalizada NFKC (la normalización que convierte esas letras “de adorno” en letras comunes) es “ALIEN DEMON EXOTICS |”.
  - [VERIFICADO] El panel acepta el nombre sin normalizarlo ni avisar: `src/app/admin/[storeHandle]/configuracion/actions.ts:68`, que solo valida de 2 a 80 caracteres.
  - [VERIFICADO] En una página de prueba local, la búsqueda de texto “alien” **no encuentra** el nombre, el árbol de accesibilidad de Chromium entrega los caracteres “matemáticos” tal cual, y la fuente cae a una cursiva del sistema distinta del tema (`unicode-nombre-375.png`).
  - [INFERIDO] El nombre aparece en el `<title>` de cada página (`layout.tsx:65`, plantilla `%s · nombre`), en el encabezado, en el pie, en los correos y en los datos estructurados.
- **Impacto:**
  - **Lectores de pantalla:** según el lector, cada letra se anuncia como “mathematical bold script capital A…” o se omite. La marca se vuelve ininteligible [INFERIDO; no probé NVDA ni VoiceOver].
  - **SEO:** quien busque “alien demon exotics” probablemente no coincida con el título indexado, y el “|” final parece un separador roto (“Productos · 𝓐𝓛𝓘𝓔𝓝… |”) [INFERIDO].
  - **Confianza:** en algunos Android o clientes de correo sin esas fuentes se verían cuadros vacíos. Además, en una tienda de suplementos regulados, palabras como “Demon/Exotics” pueden parecer de dudosa procedencia ante compradores o ante la revisión de riesgo de un procesador de pagos [INFERIDO, opinión].
- **Recomendación:** volver la demo a un nombre legible. En el panel, avisar (sin bloquear) cuando el nombre cambia al normalizarlo con NFKC (“Tu nombre usa letras decorativas; algunos teléfonos y lectores de pantalla no las muestran”) y ofrecer la versión normal. Quitar separadores sueltos al inicio o al final.

### UX-03 · Media · En el checkout, los errores de validación no se borran cuando el comprador corrige el dato

- **Evidencia [VERIFICADO]:** si se envía el formulario vacío y luego se escribe un email válido tecla por tecla y se sale del campo, siguen visibles “Escribe un email válido.” y el resumen “Faltan 8 datos. Revisa los campos marcados.” (`stale.mjs` → `stale-errores-375.png`; con todos los campos llenos: `flow-demo-375-06-checkout-lleno.png`, donde cada campo correcto sigue en rojo).
- **Impacto:** el comprador ve en rojo datos que ya están bien y no sabe qué falta. Es la fricción clásica de “validación tardía” que Baymard documenta (ver fuentes). En móvil, el formulario ocupa varias pantallas y el resumen “Faltan 8” engaña.
- **Recomendación:** volver a validar cada campo al salir de él (blur) cuando ya tiene error, y quitar el error en cuanto el valor sea válido. Recalcular el resumen o quitarlo cuando ya no haya errores.

### UX-04 · Media · Con llenado automático, el primer clic en “Confirmar pedido” no confirma: elige el envío y el total sube

- **Evidencia [VERIFICADO con `fill()` de Playwright, que llena sin salir del campo como hace el autocompletado; el autocompletado real del navegador está NO VERIFICADO]:**
  - Con todos los campos llenos, la sección “Forma de envío” sigue diciendo “Escribe tu dirección completa para ver las formas de envío.”, y el botón dice “Confirmar pedido · **$499.00**”.
  - El primer clic responde “Elegimos «Envío estándar» para tu dirección. Revisa el total y confirma tu pedido.”, y el total pasa a **$598.00**. Hace falta un segundo clic (`flow-demo-375-06b-confirm0.png` y `flow-demo-375-06b-confirm1.png`; lo mismo en demo2 a 1280 px).
  - Si se escribe tecla por tecla y se sale de cada campo, el envío sí aparece antes y el botón muestra $598.00 (`ship.mjs` → `ship-375-lleno.png`).
- **Impacto:** el autocompletado es justo lo que usan los compradores más rápidos. Ven un total menor en el botón, dan clic, la página no avanza y el total cambia. Es la sorpresa de costo que causa el 39–40 % de los abandonos (Baymard). La red de seguridad (no cobrar sin mostrar el envío) está bien hecha; el problema es que el envío se calcule tarde.
- **Recomendación:** calcular las formas de envío también con el evento `input` o `change` del código postal y el estado, con una pequeña espera (_debounce_), y no solo al salir del campo. Mientras no haya envío, el botón debería decir “Calcular envío” o mostrar “Total: $499 + envío”, no un total que parece definitivo.

### UX-05 · Media · El carrito oculta un costo de envío que ya se conoce (“Se calcula con tu dirección”)

- **Evidencia [VERIFICADO]:** carrito de demo con un producto de $499: “Envío: Se calcula con tu dirección / Total: $499.00”. La tienda tiene una sola zona (MX) con tarifa plana de $99, gratis desde $999, y ella misma lo anuncia en la barra de confianza y la ficha (“Envío gratis en compras desde $999.00. Si no, $99.00.”). El total real fue $598 (`flow-demo-375-03-carrito.png`). Un buen detalle que sí está: “Te faltan $500.00 para el envío gratis.”
- **Impacto:** el 12 % abandona por no poder ver el costo total desde antes (Baymard, ver fuentes). Además, el “Total” del carrito no coincide con lo que se cobra.
- **Recomendación:** si todas las zonas aplicables dan la misma tarifa (o hay una sola zona), mostrar “Envío: $99.00 (gratis desde $999)” y el total estimado. Si no, mostrar “desde $X”.

### UX-06 · Media · La tienda promete “Visa, Mastercard, OXXO”, pero el checkout solo ofrece “Tarjeta (prueba)”

- **Evidencia [VERIFICADO local]:** barra de confianza, ficha (“Paga con Visa, Mastercard, OXXO.”) y pie (insignias Visa / Mastercard / OXXO). En el checkout, la única forma de pago es “Tarjeta (prueba)” (`flow-demo-375-04-checkout.png`). Las insignias son texto que configura la dueña (`settings.footer.payment_methods`, header.tsx:215) y no salen de los métodos realmente activos. Con Mercado Pago Checkout Pro real, OXXO aparecería dentro de la pasarela [NO VERIFICADO: sin credenciales].
- **Impacto:** quien llega por OXXO (muy común en México para quien no usa tarjeta) no ve esa opción y abandona. Al 9 % le faltan métodos de pago (Baymard). Tampoco se avisa que se le enviará a otro sitio para pagar.
- **Recomendación:** generar las insignias a partir de los métodos de pago activos, o avisar en el panel cuando no coincidan. En el checkout, nombrar la opción con lo que el comprador reconoce (“Tarjeta, OXXO o saldo Mercado Pago · te llevamos a Mercado Pago para pagar”).

### UX-07 · Media · “Estado” es texto libre y las zonas de envío por estado comparan texto exacto (acentos y abreviaturas no coinciden)

- **Evidencia [VERIFICADO por lectura de código; efecto INFERIDO]:**
  - El checkout pide “Estado” como texto libre (`autocomplete=address-level1`, sin lista).
  - Las zonas guardan `regions` como texto libre separado por comas (`admin/[storeHandle]/envios/forms.tsx:69-70`).
  - La comparación es `lower(btrim(region)) in (lower(x) ...)` (`supabase/migrations/20261013000200_calculate_cart.sql:200`): sin quitar acentos ni reconocer abreviaturas.
  - Si una tienda limita una zona a “Nuevo León”, quien escriba “Nuevo Leon”, “NL” o “CDMX” en lugar de “Ciudad de México” no tendrá formas de envío.
  - Las demos no lo sufren porque su zona “México” tiene `regions = NULL` (consulta local).
- **Impacto:** “no hay formas de envío” con dirección válida bloquea la compra (Alta para esa tienda cuando ocurra). Lo marco Media porque depende de cómo configure sus zonas cada tienda.
- **Recomendación:** lista desplegable con los 32 estados para MX, tanto en el checkout como en el editor de zonas (los mismos valores), o normalizar quitando acentos y con una tabla de alias. Ideal: escribir primero el código postal y autocompletar estado, municipio y colonias.

### UX-08 · Media · El 404 de la tienda muestra la marca de la plataforma en la pestaña (“Tienda de demostración · PRUVA”)

- **Evidencia [VERIFICADO]:** `<title>` de `/no-existe-esta-pagina` y de `/productos/no-existe` en demo y demo2 = “Tienda de demostración · PRUVA” (`crawl.json`). La plantilla raíz es `"%s · PRUVA"` (`src/app/layout.tsx:11`). El comentario de ese archivo dice que la tienda nunca debe mostrar PRUVA (white-label: la plataforma no muestra su propia marca dentro de la tienda del comerciante).
- **Impacto:** rompe la promesa white-label justo en una página que los buscadores y los enlaces viejos sí ven. Puede confundir al comprador.
- **Recomendación:** dar a `src/app/%5Fstore/[storeId]/not-found.tsx` su propio título con el nombre de la tienda (“Página no encontrada · {tienda}”), o que el título de la tienda no herede la plantilla raíz. Agregar una prueba E2E que revise que el `<title>` de las rutas de tienda nunca contiene “PRUVA”.

### UX-09 · Media · Editor de portada: la imagen se sube aparte del bloque y tarda en aparecer sin aviso; ≈ 11 clics para cambiar el hero

- **Evidencia [VERIFICADO local]:**
  - En “Apariencia → Portada”, el bloque “Portada principal” dice “Imagen (opcional) · Sube una imagen abajo para usarla aquí · Sin imagen”. El cargador está al final de la página. Al subir aparece “Imagen subida. En unos segundos aparece para elegirla.”, pero la imagen no apareció como opción (`portada-1280-02-bloque.png`).
  - En la base local la imagen quedó en `media.status = 'pending'` y su trabajo `media.process` en `queued` (en la base local no hay pg_cron, así que nadie procesa la cola en automático). En producción depende del runner programado [NO VERIFICADO].
  - La foto de producto, en cambio, quedó `ready` en un segundo.
  - Nota [INFERIDO]: un bloque recién agregado (“se guardan solos en unos segundos”) no quedó guardado al cerrar el navegador justo después.
- **Impacto:** la tarea más visible para una dueña (cambiar la portada) se siente rota: sube la imagen y no la puede elegir. Probables tickets de soporte.
- **Recomendación:** botón “Subir imagen” **dentro** del bloque, que asigne la imagen al terminar. Mientras se procesa, mostrar una miniatura con “Procesando…” y actualizar sola. Avisar con `beforeunload` si hay cambios sin guardar.

### UX-10 · Baja · Importación “todo o nada” y nombres de columna en inglés

- **Evidencia [VERIFICADO]:**
  - CSV con 2 filas, una con precio “abc”: “Filas con error 1”, sin opción de importar solo las buenas (`imp-375-02-preview.png`; “Al confirmar se aplica todo junto”, `importar/[jobId]/page.tsx:269`).
  - La columna `stock` se ignoró con el aviso “Se ignoraron columnas que no son de la plantilla: stock.”
  - Lo bueno: errores por fila en español (“Precio (columna price): escribe un importe como 199.50”), descarga de las filas con error, 3 clics de punta a punta y enlace directo a “Subir las fotos de todos los productos” (`imp-375-03-confirmado.png`).
- **Impacto:** con catálogos de cientos de filas, un error bloquea todo. Quien escriba “existencias” o “stock” pierde el inventario sin darse cuenta.
- **Recomendación:** permitir “Importar las N filas válidas y descargar las demás”. Aceptar alias en español (existencias, precio, nombre, sku) y avisar más fuerte cuando se ignore una columna que parece importante.

### UX-11 · Baja · Objetivos táctiles por debajo de 44 px en la tienda

- **Evidencia [VERIFICADO]:** enlaces del pie de 49–160 × 17 px, “Ver todos” de 67×24, migas de 34×20 y casillas de filtro de 20×20 (`crawl.json`, campo `small`). Por la separación entre ellos cumplen WCAG 2.2 criterio 2.5.8 (mínimo de 24 px o espacio equivalente, nivel AA), y axe no marca nada. No llegan a los 44 px del criterio 2.5.5 (nivel AAA) ni de las guías de Apple.
- **Recomendación:** `min-h-11` (44 px) en los enlaces del pie y en “Ver todos”. Que toda la fila de cada filtro sea el área táctil (si ya lo es por el `<label>`, basta con documentarlo).

### UX-12 · Baja · El checkout conserva todas las salidas de la tienda (buscador, barra de categorías y pie completo)

- **Evidencia [VERIFICADO]:** `flow-demo-375-04-checkout.png`: encabezado con buscador, barra de categorías y el pie con enlaces de compra.
- **Impacto:** las distracciones en el checkout aumentan el abandono (Baymard, “Distractions and interruptions”).
- **Recomendación:** encabezado mínimo en `/checkout` (logo, “Compra segura” y regresar al carrito) y pie solo con políticas y contacto.

### UX-13 · Baja · La página de “Gracias” no dice si llegó un correo de confirmación

- **Evidencia [VERIFICADO]:** texto “Guarda esta página: el enlace es tu acceso al pedido.” y nada sobre el email (`flow-demo-375-08-gracias.png`). Existe el trabajo `order.created`; el envío real del correo está [NO VERIFICADO: sin Resend].
- **Recomendación:** “Te enviamos la confirmación a a***@example.test” (con el email enmascarado). Agregar un botón “Ver mis pedidos” que lleve a `/cuenta`.

### UX-14 · Baja · Crear producto: siempre nace en borrador y el mensaje se contradice

- **Evidencia [VERIFICADO]:** el formulario ya dice “Tiene lo necesario para publicarse”, pero después de crearlo aparece “Producto creado como borrador. **Agrega imágenes** y publícalo cuando esté listo.”, aunque ya tiene foto y el estado dice “Tiene todo lo necesario: ya puedes publicarlo.” (`crear-1280-03-creado.png`).
- **Recomendación:** botón principal “Crear y publicar” cuando ya está completo (con “Guardar como borrador” al lado) y mensaje que dependa de lo que falta.

### UX-15 · Baja · Detalle del pedido: los formularios de reembolso y cancelación siempre están abiertos

- **Evidencia [VERIFICADO]:** en un pedido pagado se ven completos “Reembolsar” (con el total ya escrito, $598.00) y “Cancelar pedido” (`ped-1280-02-detalle.png`). **Control verificado:** el reembolso pide confirmación con el monto (`ConfirmButton`, `pedidos/order-forms.tsx:356-366`) y la cancelación pide marcar “Entiendo que…”.
- **Recomendación:** dejar visible solo la siguiente acción (“Registrar envío”) y esconder reembolso y cancelación tras “Más acciones”.

### UX-16 · Baja · El checkout ofrece 7 países aunque solo se envía a México

- **Evidencia [VERIFICADO lista; efecto INFERIDO]:** el selector “País” ofrece México, Estados Unidos, Colombia, Argentina, Chile, Perú y España. Las zonas de demo y demo2 son solo `{MX}`.
- **Recomendación:** listar solo los países de las zonas activas. Si hay uno solo, mostrarlo como texto.

### UX-17 · Baja · En la ficha a 375 px, el título y el precio quedan bajo el pliegue

- **Evidencia [VERIFICADO]:** aviso, encabezado, buscador, barra y migas ocupan ≈ 300 px, y el nombre del producto aparece hacia los 720 px de 800 (`flow-demo-375-01-ficha.png`). Lo mitiga la barra fija inferior con nombre, precio y “Comprar ahora”.
- **Recomendación:** en la ficha móvil, ocultar la barra de categorías o compactar el buscador en un ícono.

### UX-18 · Baja · El panel usa “PRUVA” como nombre de formato y de estilo

- **Evidencia [VERIFICADO]:** “Lo pasamos al formato de PRUVA”, “Archivo CSV de PRUVA” (`productos/importar/page.tsx:111,173`) y “Usar el estilo PRUVA” en Apariencia. Mezcla la marca de la plataforma con la de la primera tienda.
- **Recomendación:** “formato de la plantilla” y un nombre neutro para el estilo (p. ej. “Marino deportivo”).

### UX-19 · Baja · Inicio del panel: la gráfica de ventas vacía deja un hueco en blanco

- **Evidencia [VERIFICADO]:** “Ventas por día (antes de reembolsos)” muestra ≈ 150 px en blanco cuando no hay ventas (`panel_inicio-375.png`).
- **Recomendación:** estado vacío: “Aún no hay ventas en este periodo. Comparte tu tienda: [copiar enlace]”.

### UX-20 · Baja · Zonas horarias mezcladas en el editor de portada

- **Evidencia [VERIFICADO]:** en los bloques de portada, “Mostrar desde / hasta” dice “Las fechas usan la hora de este dispositivo”. En productos y ofertas, “Hora de la tienda: Mexico City”.
- **Recomendación:** usar siempre la hora de la tienda y mostrarla.

---

## 5. Fricción del checkout frente a buenas prácticas

| Punto                                  | Estado en Pruva                                                                                                                                                                                  | Buena práctica                                                                      | Juicio    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | --------- |
| Cuenta obligatoria                     | **No**: invitado por defecto; la cuenta es por código al email, sin contraseña, y recupera pedidos hechos como invitado                                                                          | Baymard: el 18–19 % abandona si se obliga a crear cuenta                            | Bien      |
| Número de campos                       | 10 campos + 1 casilla + 1 radio (12 elementos)                                                                                                                                                   | Baymard: lo ideal son 12–14 elementos (7–8 campos); el promedio en EE. UU. es 23.48 | Bien      |
| Atributos `autocomplete` e `inputmode` | Correctos (email, name, tel, address-line1/2, address-level1/2, postal-code con `inputmode=numeric`), campos de 44 px                                                                            | —                                                                                   | Bien      |
| Costo de envío                         | Visible desde la portada y la ficha (“gratis desde $999, si no $99”), con barra de avance hacia el envío gratis. **No** se suma en el carrito (UX-05) y con autocompletado aparece tarde (UX-04) | El 39–40 % abandona por costos extra; el 12 % por no ver el total antes             | Mejorable |
| Tiempo de entrega                      | “Llega en 2–5 días” en la portada y la ficha; fecha estimada en el pedido (“Llega entre el 29 de octubre y el 1 de noviembre”)                                                                   | El 20 % abandona por entrega lenta                                                  | Bien      |
| Métodos de pago visibles               | Se anuncian Visa, Mastercard y OXXO; en el checkout solo “Tarjeta (prueba)” (UX-06)                                                                                                              | 9 %: no hay suficientes métodos                                                     | Mejorable |
| Políticas y confianza                  | Sin políticas visibles ni enlazadas (UX-01); sin contacto en el pie de la demo local                                                                                                             | 13 %: política de devoluciones; 19 %: no confía en el sitio con su tarjeta          | **Débil** |
| Validación en línea                    | Mensajes claros y foco al primer error, pero no se limpian al corregir (UX-03)                                                                                                                   | Baymard: validación en línea                                                        | Mejorable |
| Pasarela                               | Simulada localmente; en producción, redirección a Mercado Pago [NO VERIFICADO]                                                                                                                   | Avisar de la redirección (“sin redirecciones sorpresa”)                             | Pendiente |

---

## 6. Páginas en línea frente a la local

- `pruva-tienda-demo2.vercel.app` (Exa, lectura parcial): mismo título (“Tienda de demostración 2”), misma barra de confianza (“Envío gratis desde $999.00 Si no, $99.00 · Llega en 2–5 días · Visa, Mastercard, OXXO”) y mismos productos de ejemplo. H1 en línea: “Suplementos para tu entrenamiento y tu día a día”. Coincide en estructura con la local. Detalle visual, formularios y checkout: [NO VERIFICADO].
- `pruva-tienda-demo.vercel.app`: [NO VERIFICADO] (WebFetch: ENOTFOUND; Exa: CRAWL_TIMEOUT). Su nombre en staging se analiza en UX-02.

---

## 7. Lo que está bien

- **Responsivo de verdad:** 0 desbordes horizontales en 130 combinaciones de pantalla y ancho (360–1920 px), 0 violaciones de axe en tiendas y en 30 vistas del panel, 0 errores de consola, 0 imágenes rotas, CLS ≤ 0.012.
- **Navegación móvil:** la barra de categorías se desplaza con máscara de desvanecido; barra fija “Comprar ahora” con nombre y precio en la ficha; “Saltar al contenido”; foco visible de 2 px en todo lo probado.
- **Búsqueda:** ignora acentos y mayúsculas (“PROTEÍNA” = “proteina”), tolera errores (“creatna” encuentra creatinas), acepta prefijos (“prote”). El estado vacío sugiere objetivos y productos.
- **Conversión:** precio por porción, ahorro en pesos y porcentaje, insignias “Últimas piezas”, compra por objetivo, “Completa tu envío gratis” con productos sugeridos en el carrito, y “Comprar ahora” directo al checkout.
- **Checkout:** invitado, pocos campos, botón con el total, resumen plegable en móvil, fecha estimada de entrega, mensajes en español claro, y la red de seguridad que no confirma sin mostrar el envío.
- **Panel:** alta rápida de producto (3 campos y foto), checklist de 9 pasos con avance, candado de lanzamiento que exige políticas, importación con vista previa y errores por fila, logos y fotos en lote por nombre de archivo, registrar envío en 2 clics, confirmaciones en acciones destructivas, buen uso a 375 px (menú en píldoras y accesos rápidos).

---

## 8. Tareas propuestas (no implementadas)

1. **(UX-01, Alta)** Sección legal automática en el pie (las políticas publicadas) y aviso con enlaces junto a “Confirmar pedido”. Publicar las políticas de las demos en staging.
2. **(UX-04 + UX-05)** Calcular el envío al cambiar el código postal o el estado (con _debounce_); mostrar la tarifa plana o “desde $X” en el carrito; no mostrar un total que parezca definitivo mientras falte el envío.
3. **(UX-03)** Volver a validar al salir del campo y limpiar los errores al corregir; recalcular el resumen de errores.
4. **(UX-07)** Lista de estados de MX (checkout y zonas) y autocompletado por código postal; normalizar acentos en la comparación de regiones.
5. **(UX-06)** Insignias de pago calculadas a partir de los métodos activos, y el texto de la opción de pago con “te llevamos a Mercado Pago”.
6. **(UX-08)** Título propio en el 404 de la tienda, más una prueba E2E: ningún `<title>` de tienda contiene “PRUVA”.
7. **(UX-09)** Subida de imagen dentro del bloque de portada, con estado “Procesando…” que se actualice solo; aviso de cambios sin guardar.
8. **(UX-02)** Aviso de normalización NFKC en el nombre de la tienda; volver la demo a un nombre legible.
9. **(UX-10)** Importar solo las filas válidas y aceptar alias de columnas en español.
10. **Pulido (UX-11 a UX-20):** objetivos táctiles de 44 px, checkout con encabezado mínimo, correo de confirmación mencionado en “Gracias”, “Crear y publicar”, acciones secundarias plegadas en el pedido, países según las zonas, ficha móvil más compacta, nombres neutros en el panel, estado vacío de la gráfica, hora de la tienda en el editor de portada.

---

## 9. Fuentes externas (consultadas el 2026-10-27)

- Baymard Institute, “50 Cart Abandonment Rate Statistics 2026”, https://baymard.com/lists/cart-abandonment-rate (publicado el 2025-09-22): tasa promedio de abandono del 70.22 %; motivos (sin contar “solo estaba viendo”): costos extra 40 %, entrega lenta 20 %, desconfianza con la tarjeta 19 %, cuenta obligatoria 18 %, proceso largo 17 %, política de devoluciones 13 %, no ver el total antes 12 %, pocos métodos de pago 9 %; checkout ideal de 12–14 elementos y promedio en EE. UU. de 23.48.
- Baymard Institute, “How to Reduce Cart Abandonment (Data-Backed UX Strategies)”, https://baymard.com/blog/reduce-cart-abandonment (publicado el 2026-05-19): el 39 % abandona por costos adicionales; mostrar el costo total en el carrito; las distracciones en el checkout.
- Baymard Institute, “Payment UX: Research-Backed Standards for Ecommerce Checkouts”, https://baymard.com/blog/payment-ux (publicado el 2026-06-01): mostrar el total final antes de pedir el pago; sin redirecciones sorpresa.
- Baymard Institute, “Usability Testing of Inline Form Validation”, https://baymard.com/blog/inline-form-validation (publicado el 2024-01-09): validación en línea (solo se leyó el título y la fecha; el contenido no se pudo extraer).
- W3C, WCAG 2.2, criterios 2.5.8 (tamaño mínimo del objetivo, AA) y 2.5.5 (tamaño del objetivo, AAA): https://www.w3.org/TR/WCAG22/ (referencia general, no consultada en línea hoy).

_Lo legal (UX-01) es orientación informativa; validar con un abogado o asesor regulatorio._
