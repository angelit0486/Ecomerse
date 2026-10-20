# Auditoría del panel — Fase 0 (2026-10-20)

Auditoría de solo lectura del panel de administración, previa a la misión «panel al nivel de Shopify y Tiendanube para una dueña sin conocimientos técnicos, desde el celular». No cambia código. Las eliminaciones que tocan datos, RLS, RPC, migraciones o contratos (§43) esperan la aprobación del propietario (sección 6).

## 1. Línea base (commit `a715b48`, el publicado en staging)

| Prueba                                                 | Resultado                                      |
| ------------------------------------------------------ | ---------------------------------------------- |
| `pnpm verify` (lint, formato, tipos, unitarias, build) | ✅ 672 unitarias                               |
| `pnpm db:test`                                         | ✅ pgTAP 2047 en 82 archivos · integración 255 |
| E2E (Playwright + axe serio/crítico)                   | ✅ 68/68                                       |

Nada en rojo al empezar.

**Cómo se midió:**

- Se recorrieron automáticamente las 128 pantallas alcanzables del panel, a 375 px (celular) y a 1280 px. La tienda local fue `demo`: 16 productos, sin pedidos ni clientes.
- En cada pantalla se registró el tiempo hasta la red en reposo, el desborde horizontal, los objetivos táctiles menores de 44 px y las violaciones de axe.
- Lighthouse 12.8.2 en móvil, local, se corrió en 8 pantallas clave y en la tienda pública.
- El código lo revisaron dos análisis independientes (navegación y tareas; código muerto y rendimiento). Los hallazgos graves se verificaron a mano.

## 2. Mapa de navegación actual

**Menú:** 17 entradas planas, sin grupos (`layout.tsx:26-74`). En el celular forman una sola fila de botones con desplazamiento horizontal: solo se ven 4 y media.

- Inicio, Configurar tienda (solo en borrador), Productos, Pedidos, Clientes, Inventario, Descuentos, Envíos, Impuestos, Apariencia y Contenido.
- Equipo, Pagos, Notificaciones, Cumplimiento, Actividad y Exportar.

**Productos tiene 9 botones en la cabecera:** Categorías, Marcas, Atributos, Revisión, Opiniones, Ofertas, Proveedores, Importar y Agregar.

**No existen:**

- búsqueda global;
- pantalla de dominio propio;
- alta de tienda por cuenta propia (la crea alguien de la plataforma desde `/platform`);
- notificaciones dentro del panel;
- estados de carga (`loading.tsx`).

La primitiva `Skeleton` existe pero no se usa.

## 3. Clics por tarea clave (línea base)

Clics y toques contados desde el Inicio de la tienda. Los datos escritos se cuentan aparte.

| Tarea                                 | Clics                                                    | Datos a escribir                                                               | Fricción principal                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Crear tienda                          | No disponible para la dueña                              | 6 campos en la consola de plataforma + invitación, código y 2FA (unos 8 clics) | Depende de la plataforma; «slug» y «handle» en el formulario                                                                       |
| Subir el primer producto              | 6 (Productos → Agregar → Crear → subir fotos → Publicar) | 1 obligatorio (título) + precio; el formulario muestra unos 14 campos          | Las fotos no se pueden subir al crear. «Dirección (slug)», SKU, SEO, costo, contenido y porciones aparecen todos de entrada        |
| Importar catálogo                     | 5 (Productos → Importar → archivo → Validar → Confirmar) | —                                                                              | La ayuda muestra columnas y valores en inglés (`active`, `draft`, `dietary_supplement`)                                            |
| Cambiar un precio                     | 3 desde el listado («Cambiar precios»)                   | 1–2                                                                            | Bien resuelto                                                                                                                      |
| Cambiar precios en bloque             | 5 o más                                                  | % y redondeo                                                                   | Bien resuelto, con vista previa                                                                                                    |
| Ajustar inventario                    | 3 (Inventario → fila → Guardar)                          | cantidad + motivo obligatorio                                                  | Hay 5 lugares distintos para tocar existencias                                                                                     |
| Procesar un pedido (pagado → enviado) | 3 (Por surtir → pedido → Registrar envío)                | guía opcional; paquetería sugerida                                             | Bien resuelto desde la última publicación                                                                                          |
| Cambiar el diseño                     | 4 (Apariencia → pestaña → guardar → Publicar)            | —                                                                              | Logo y colores también están en «Configurar tienda», con otro formulario                                                           |
| Configurar pagos                      | 2 (transferencia)                                        | nombre e instrucciones                                                         | Duplicado en Configurar tienda y Ajustes → Pagos                                                                                   |
| Configurar envíos                     | 3 (zona → guardar → tarifa → guardar)                    | nombre, **países con código ISO de dos letras**, nombre de la tarifa y precio  | Pide «MX» en vez de elegir México                                                                                                  |
| Publicar la tienda                    | 2 + resolver pendientes                                  | —                                                                              | El error «Aún hay pendientes» no dice cuáles. El pendiente «perfil sanitario» lleva a Contenido en vez de Cumplimiento (**fallo**) |

## 4. Fricciones (por gravedad)

### Fallos (corregir ya, sin tocar contratos)

1. **La marca de «Configurar tienda» no llega a la tienda al publicarla.**
   - Qué pasa: `saveBranding` guarda colores y forma en el _borrador_ del tema (`configuracion/actions.ts:76-111`), pero `stores_launch` solo cambia el estado de la tienda y no publica el tema (`20261014000400_store_launch.sql:104-133`).
   - Resultado: la dueña elige colores, publica la tienda y la ve con los colores anteriores.
   - Solución: que «Publicar tienda» publique también el borrador del tema con su RPC existente, o avisar de forma explícita. Es una llamada a una función que ya existe; no cambia ningún contrato.
2. **El pendiente `compliance_profile` lleva a `/contenido`** en vez de `/ajustes/cumplimiento` (`configuracion/page.tsx:48-54`).
3. **Desborde horizontal a 375 px en la ficha de producto:** de 3 a 22 px en 4 de las 16 fichas. La tabla de variantes llega a 9 columnas.
4. **Accesibilidad:**
   - 1 violación **crítica** de axe: un campo sin etiqueta en Apariencia → SEO (a 375 y a 1280).
   - 126 de 128 pantallas tienen violaciones moderadas `landmark-one-main` y `region`: el panel no usa `<main>`. Los E2E solo fallan con violaciones serias o críticas, por eso no lo detectaban.

### Fricción de uso

5. **Celular, primera pantalla:**
   - En Productos, los 9 botones de la cabecera y los 5 filtros empujan el primer producto fuera de la pantalla.
   - En Inicio, lo primero que se ve son «Estado: Publicada» y «Tu acceso: Administrador…», en lugar de ventas y pedidos por atender.
6. **Objetivos táctiles:** 439 por debajo de 44 px, en las 128 pantallas. Los que más se repiten: «Contraseña» y «Salir» en la cabecera, los filtros de Actividad y los enlaces de la cabecera de Productos.
7. **Textos técnicos:**
   - «handle», «slug», «Dirección (slug)», «SKU» sin explicar, la pestaña «SEO».
   - Valores del CSV en inglés.
   - «Países: códigos de dos letras».
   - «Cumplimiento» sin decir que es sanitario.
8. **Pantallas que se solapan:**
   - Logo y colores: Configurar tienda y Apariencia.
   - Pago por transferencia: Configurar tienda y Ajustes → Pagos.
   - Existencias: Inventario, la ficha, el enlace «Ajustar» del editor, Proveedores y el CSV.
   - Ofertas: la página Ofertas, la ficha, la acción en bloque y Descuentos (este último es otro concepto).
   - Revisión del catálogo frente al filtro «Pendientes» del listado.
9. **Formularios largos:**
   - La ficha de producto apila en una sola columna estado, programación, ofertas, imágenes, ficha sanitaria, atributos, el editor completo, existencias e historial.
   - Configurar tienda junta 4 formularios en una página.
10. **Vacíos sin guía:**
    - `/admin` sin tiendas.
    - Inventario dice «Agrega productos…» sin enlace.
    - Pedidos y Clientes no tienen ninguna acción.
    - El vacío de Productos promete «con sus fotos», pero el formulario de alta no tiene fotos.
    - Inicio no enlaza a «Configurar tienda» mientras la tienda está en borrador.
11. **Errores genéricos:** «Ocurrió un error inesperado», «No se pudo guardar», y publicar la tienda sin decir qué falta.
12. **Campos del modelo que no se pueden editar en el panel:** peso (`weight_g`), «requiere envío», código de barras, controlar existencias y vender sin existencias. Solo se cambian por CSV.

## 5. Rendimiento

### Lighthouse móvil (local)

| Pantalla                 | Rendimiento                 | Accesibilidad | Buenas prácticas | LCP   | TBT    | JS transferido |
| ------------------------ | --------------------------- | ------------- | ---------------- | ----- | ------ | -------------- |
| Inicio                   | 95                          | 100           | 100              | 2.0 s | 230 ms | 141 KB         |
| Productos                | **91**                      | 100           | 100              | 2.4 s | 60 ms  | 146 KB         |
| Nuevo producto           | 99                          | 100           | 100              | 2.0 s | 70 ms  | 147 KB         |
| Ficha de producto        | 96                          | 100           | 100              | 2.7 s | 80 ms  | 158 KB         |
| Pedidos                  | 96                          | 100           | 100              | 2.6 s | 60 ms  | 141 KB         |
| Inventario               | **91**                      | 100           | 100              | 2.7 s | 120 ms | 143 KB         |
| Apariencia               | 92                          | 100           | **93**           | 2.4 s | 290 ms | **276 KB**     |
| Configurar tienda        | 95                          | 100           | **93**           | 2.4 s | 160 ms | 177 KB         |
| Tienda pública (portada) | 96 (2 corridas; 92 en frío) | 100           | 100              | 2.6 s | 70 ms  | 143 KB         |

- Las 8 pantallas medidas del panel ya pasan de 90. Las más justas son Productos, Inventario y Apariencia.
- «Buenas prácticas 93» se debe a errores en consola: son los avisos de la CSP con Radix, ya documentados en D-LOTE-06.
- La tienda pública queda **por debajo de la meta de 95** cuando la caché está en frío.

### Tiempo hasta la red en reposo (128 pantallas, sin limitar la red)

- **375 px:** mediana 0.99 s; percentil 90, 1.07 s; máximo 1.37 s (Productos).
- **1280 px:** mediana 1.41 s; máximo 2.15 s (Productos).

### Consultas

**Listas sin paginar que pueden crecer sin control:**

- Proveedores: `listSuppliers` y `listSupplierVariants`.
- Destinos de la subida de imágenes en lote: lee el catálogo completo en bloques de 1000.
- Categorías y marcas: se cargan enteras en cada render de Productos, ficha, alta y menús.
- Descuentos.

Opiniones (200), despachos (200) y ofertas (100) tienen tope fijo pero no paginan. Inventario pagina con OFFSET, que se degrada con tablas grandes.

**Rondas en serie:**

- La ficha de producto hace 4 o 5 rondas encadenadas, con unas 15 consultas por render.
- Ajustes → Equipo hace 3 consultas en serie.
- Inicio pide el conteo de opiniones aparte del resto.

**Cada pantalla de una tienda** llama además a `access_list_my_stores` para el selector de tiendas.

## 6. Candidatos a eliminar o fusionar

**Riesgo:**

- **Bajo:** solo interfaz.
- **Medio:** cambia un flujo cubierto por E2E.
- **Alto:** toca datos, RPC o contratos.

En la columna «Aprobación»:

- **Libre:** código muerto o cambio solo visual. Lo hago sin preguntar, como indica la misión.
- **Pide aprobación:** espera tu sí.

| #   | Candidato                                                                                              | Qué toca                                                                | Riesgo                    | Recomendación                                                                                                                                                                                                                              | Aprobación                                                  |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| E1  | Primitivas sin uso: `checkbox.tsx`, `drawer.tsx`, `tabs.tsx` (solo las usan sus pruebas)               | Código y pruebas de primitivas                                          | Bajo                      | Eliminar. `Skeleton` se conserva porque la Fase 4 la usa                                                                                                                                                                                   | Libre                                                       |
| E2  | Exports muertos: `clearCartCookie`, `isStandardWebhookSecret` y `THEME_VERSION`                        | Código                                                                  | Bajo                      | Eliminar                                                                                                                                                                                                                                   | Libre                                                       |
| E3  | Re-export duplicado `_shared/submit.ts`                                                                | Imports                                                                 | Bajo                      | Unificar en `@/ui/submit`                                                                                                                                                                                                                  | Libre                                                       |
| E4  | 5 componentes `Feedback` locales y unos 70 `role=alert/status` escritos a mano                         | Interfaz                                                                | Bajo                      | Unificar en `FormFeedback`                                                                                                                                                                                                                 | Libre                                                       |
| E5  | Marca (logo y colores) duplicada en Configurar tienda y Apariencia                                     | Interfaz; el checklist usa `brandingSaved`                              | Medio                     | Que Configurar tienda enlace al editor de Apariencia y no tenga formulario propio, y que publicar la tienda publique el tema (fallo 1)                                                                                                     | Libre: no toca datos ni RPC, solo qué formulario se muestra |
| E6  | Pago por transferencia en dos pantallas                                                                | Interfaz, mismo componente                                              | Bajo                      | Dejarlo en Configurar tienda solo mientras la tienda está en borrador; su lugar fijo es Ajustes → Pagos                                                                                                                                    | Libre                                                       |
| E7  | «Revisión del catálogo» como pantalla aparte del filtro «Pendientes»                                   | Interfaz; E2E de revisión                                               | Medio                     | **Conservar.** Desde D-PANEL-07 es la que publica los completos. Se agrega un enlace desde el filtro                                                                                                                                       | — (no se elimina)                                           |
| E8  | Enlace «Ajustar» dentro del editor de variantes (5.º lugar para existencias)                           | Interfaz                                                                | Bajo                      | Quitarlo. La ficha ya tiene «Existencias» con idempotencia                                                                                                                                                                                 | Libre                                                       |
| E9  | 9 botones de la cabecera de Productos                                                                  | Interfaz                                                                | Bajo                      | Dejar 2 visibles (Agregar e Importar) y el resto en un menú «Más»                                                                                                                                                                          | Libre                                                       |
| E10 | Menú plano de 17 entradas                                                                              | Interfaz                                                                | Medio (E2E de navegación) | Agrupar en 6: Inicio, Productos (con Inventario), Pedidos (con Clientes), Tienda en línea (Apariencia y Contenido), Marketing (Descuentos) y Ajustes (Pagos, Envíos, Impuestos, Equipo, Notificaciones, Cumplimiento, Actividad, Exportar) | Libre                                                       |
| E11 | Campos «Costo», «Contenido», «Porciones», SEO, «Dirección (slug)» y «Etiquetas» visibles al crear      | Interfaz. Contenido y porciones alimentan la ficha sanitaria (ADR-026)  | Medio                     | **Plegarlos en «Avanzado».** No se elimina ningún dato                                                                                                                                                                                     | Libre                                                       |
| E12 | Datos de «Estado» y «Tu acceso» arriba en Inicio                                                       | Interfaz                                                                | Bajo                      | Moverlos al final o a una línea discreta                                                                                                                                                                                                   | Libre                                                       |
| E13 | Campos `weight_g`, `requires_shipping`, `barcode`, `track_inventory` e `inventory_policy` sin interfaz | **Añadir**, no eliminar                                                 | Medio                     | Mostrarlos en «Avanzado» con textos simples; usan el esquema y la RPC actuales                                                                                                                                                             | Libre (no cambia el contrato)                               |
| E14 | Unificar «Ofertas» de la ficha, la acción en bloque y la página                                        | Interfaz + lógica de fechas (ADR-030)                                   | Medio-alto                | **No fusionar todavía.** Se ordena la navegación y se deja la lógica                                                                                                                                                                       | Pide aprobación si se quisiera fusionar                     |
| E15 | Alta de tienda por cuenta propia (hoy solo la crea la plataforma)                                      | **Contrato de tenencia**, entitlements y planes                         | Alto                      | Requiere un ADR (registro, plan, límites, abuso). Mientras tanto: plantilla y onboarding guiado para la tienda que crea la plataforma                                                                                                      | **Pide aprobación (ADR)**                                   |
| E16 | Dominio propio con verificación                                                                        | Tabla `store_domains`, verificación DNS y un proveedor externo (Vercel) | Alto                      | Requiere un ADR y credenciales de Vercel. Mientras tanto: guía paso a paso sin automatizar                                                                                                                                                 | **Pide aprobación (ADR + credenciales)**                    |

Nada de esta lista borra datos, cambia RLS o RPC, ni toca contratos críticos, salvo E15 y E16, que no se empiezan sin tu aprobación.

## 7. Plan derivado (orden de trabajo)

- **Fase 1, alta sin fricción:**
  - Alta corta: nombre, precio, fotos y existencias. Todo lo demás en «Avanzado».
  - Fotos al crear.
  - Importación en español sencillo, con «corregir y reintentar».
  - Plantillas por tipo de producto.
  - Borrador guardado en el navegador.
  - «Qué falta para publicar».
- **Fase 2, tienda y diseño:**
  - Corregir los fallos 1 y 2.
  - Un solo editor de marca y estilos con un clic, con la vista previa existente.
  - Checklist de lanzamiento con barra de progreso.
  - Guía de dominio sin automatizar.
- **Fase 3, operación diaria:**
  - Inicio con lo de hoy primero.
  - Acciones masivas en Pedidos.
  - Búsqueda global.
  - Avisos dentro del panel, a partir de los contadores que ya existen.
- **Fase 4, profesionalizar:**
  - Usar `<main>`, objetivos de 44 px, esqueletos de carga y feedback unificado.
  - Paginación de proveedores y descuentos.
  - Rondas de consultas en paralelo en la ficha.
  - Lighthouse del panel ≥ 90 y de la tienda ≥ 95.

Cada tarea lleva unitarias, E2E y axe. Al cerrar cada fase: verify, db:test, integración y E2E completos, revisión adversarial e informe en `docs/phases/`.
