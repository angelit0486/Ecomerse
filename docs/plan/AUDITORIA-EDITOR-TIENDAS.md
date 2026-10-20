# Auditoría: capacidad de edición de tiendas (2026-10-20)

Paso 1 de la misión «Estudio de tiendas». Solo lectura, salvo las correcciones de §4, que no tocan contratos críticos.

**Línea base** sobre `7458583`, todo en verde:

| Suite       | Resultado     |
| ----------- | ------------- |
| verify      | 739 unitarias |
| pgTAP       | 2068          |
| Integración | 260           |
| E2E         | 73/73         |

**Staging:** tiene las 102 migraciones del repo. 98 coinciden por huella sha256; las 4 de `20261018000800–1100` se aplicaron antes de que se registrara la huella.

**Metodología del recorrido:** prueba temporal que no se versiona. Recorre cada pantalla alcanzable desde el menú y sus enlaces, sin permisos especiales. Lo hace con 4 identidades y 2 anchos:

- dueña de una tienda **vacía**, a 375 y 1280 px;
- Solo lectura, Catálogo y Marketing en una tienda con datos, a 375 px.

En cada pantalla anota:

- código HTTP y página de error;
- excepciones y errores de consola;
- desborde horizontal;
- objetivos táctiles menores de 44 px (celular) o 24 px (escritorio);
- todas las violaciones de axe (no solo las graves);
- botones visibles por rol.

## 1. Qué se puede editar hoy

| Área                                                      | ¿Se edita?                                                                        | Dónde                                  | Límite principal                                                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Colores (5), fuentes (2 de 10), esquinas, estilo de botón | Sí, con vista previa y contraste en vivo                                          | Apariencia → Marca                     | Sin sombras ni densidad. Los estilos prediseñados (PRUVA, Anaquel, Deportivo, Neutral, Grafito y oliva) solo rellenan el formulario         |
| Logo                                                      | Sí                                                                                | Apariencia → Marca y Configurar tienda | —                                                                                                                                           |
| Favicon                                                   | **No**                                                                            | —                                      | Siempre es el monograma (inicial + color)                                                                                                   |
| Portada por bloques                                       | Sí: 8 tipos, ≤ 12, mover, ocultar                                                 | Apariencia → Portada                   | Faltan FAQ, video, beneficios, opiniones verificadas y productos elegidos a mano. No hay visibilidad por dispositivo ni vigencia por bloque |
| Otras páginas por bloques                                 | **No**                                                                            | —                                      | Las páginas son HTML en un cuadro de texto, sin imágenes                                                                                    |
| Páginas de contenido y políticas                          | Sí: título, dirección, HTML básico, SEO, publicar                                 | Contenido                              | Sin borrador separado, sin historial, sin imágenes                                                                                          |
| Menús                                                     | Sí: principal y pie, 2 niveles, ≤ 50 enlaces                                      | Contenido → Menús                      | Se publican al guardar (no pasan por el borrador del tema). No se crean menús extra                                                         |
| Barra de anuncio                                          | Sí: texto, enlace y colores                                                       | Apariencia → Encabezado                | Sin vigencia, un solo mensaje                                                                                                               |
| Encabezado y pie                                          | Posición del logo, texto legal, medios de pago, redes, contacto                   | Apariencia                             | Sin accesos rápidos móviles configurables ni columnas de pie                                                                                |
| Banners                                                   | Solo como bloques de portada                                                      | Apariencia → Portada                   | Sin programación                                                                                                                            |
| Dominio                                                   | Solo lectura (lista y estado)                                                     | Ajustes → Dominio                      | Alta y verificación pendientes de **E16**                                                                                                   |
| SEO                                                       | Tienda (título, descripción, imagen), producto y página                           | Apariencia → SEO, ficha, Contenido     | Sin vista previa de Google ni redes. Categorías sin SEO editable. Sin redirecciones                                                         |
| Envíos                                                    | Zonas y tarifas (fija, gratis desde, recoger)                                     | Envíos                                 | Sin tarifas por peso ni paqueterías                                                                                                         |
| Pagos                                                     | Mercado Pago, Stripe y manual                                                     | Ajustes → Pagos y Configurar tienda    | Sin verificar con cuentas reales                                                                                                            |
| Impuestos                                                 | Precios con IVA incluido y IVA en envío                                           | Impuestos                              | —                                                                                                                                           |
| Notificaciones al equipo                                  | Correos y avisos de pedido                                                        | Ajustes → Notificaciones               | —                                                                                                                                           |
| Correos al comprador                                      | **No**                                                                            | Plantillas en código                   | Asuntos y textos fijos                                                                                                                      |
| Borrador / publicado del tema                             | Sí: borrador atómico, vista previa privada, publicar y descartar                  | Apariencia                             | **Sin historial ni restaurar** (solo la auditoría guarda el antes y el después)                                                             |
| Duplicar tienda, exportar o importar tema                 | **No**                                                                            | —                                      | —                                                                                                                                           |
| Alta de tienda y plantilla por giro                       | Solo la crea la plataforma; no hay plantillas                                     | Consola de plataforma                  | El alta por cuenta propia es **E15**                                                                                                        |
| Lista de lanzamiento                                      | Sí: pago, producto, envío, 4 políticas sin marcadores, contacto, perfil sanitario | Configurar tienda                      | —                                                                                                                                           |
| Categorías                                                | Nombre, padre, visible y, **desde hoy, descripción**                              | Productos → Categorías                 | SEO e imagen sin formulario (requieren cambiar la RPC)                                                                                      |
| Colecciones inteligentes                                  | **No** (P2 en GATE0)                                                              | —                                      | ADR-035                                                                                                                                     |
| Cupones                                                   | Código, %/monto/envío gratis, mínimo, vigencia, usos                              | Descuentos                             | No se limitan a productos y no hay descuentos automáticos (ADR-036)                                                                         |
| Ofertas con fecha                                         | Sí (ADR-030)                                                                      | Productos → Ofertas                    | —                                                                                                                                           |
| Roles                                                     | 7 de sistema, invitar, cambiar rol, suspender                                     | Ajustes → Equipo                       | No hay rol «Diseño». `seo.manage` y `domains.manage` no se usan                                                                             |

## 2. Brecha contra un estudio de tiendas completo (priorizada por impacto para la dueña)

| #   | Brecha                                                                                                                         | Impacto                                                 | Toca contrato                  | Va en                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------ | --------------------------------------------- |
| 1   | Plantillas de tienda por giro con datos de ejemplo marcados                                                                    | Muy alto: una tienda nueva queda vacía y sin estructura | Tema v1 y alta de tienda       | ADR-034 §5                                    |
| 2   | Historial de versiones del diseño con «Restaurar»                                                                              | Muy alto: hoy un error de diseño no se puede deshacer   | Publicación del tema           | ADR-034 §4                                    |
| 3   | Bloques que faltan: FAQ, beneficios y confianza, opiniones verificadas, video, contacto, productos elegidos a mano, carruseles | Alto                                                    | Tema v1                        | ADR-034 §2                                    |
| 4   | Visibilidad por celular o escritorio y vigencia por bloque y anuncio (banners programados)                                     | Alto                                                    | Tema v1                        | ADR-034 §1–2                                  |
| 5   | Páginas por bloques, no solo la portada                                                                                        | Alto                                                    | `store_pages`                  | ADR-034 §3                                    |
| 6   | Favicon propio, sombras, densidad y sugerencia automática de color con contraste                                               | Medio                                                   | Tema v1                        | ADR-034 §1                                    |
| 7   | Dominio propio con verificación                                                                                                | Alto para lanzar con marca propia                       | Dominios y Vercel              | **E16**                                       |
| 8   | Vista previa de Google y de redes en SEO                                                                                       | Medio                                                   | No                             | Paso 2, sin ADR                               |
| 9   | Redirecciones 301                                                                                                              | Medio: al migrar de Shopify se pierden enlaces          | No                             | D-EST-02                                      |
| 10  | Rol «Diseño»                                                                                                                   | Medio                                                   | No                             | D-EST-01                                      |
| 11  | Colecciones inteligentes                                                                                                       | Medio                                                   | Fase futura (P2)               | ADR-035                                       |
| 12  | Correos al comprador editables                                                                                                 | Medio                                                   | No (plantillas)                | Después del lanzamiento                       |
| 13  | Exportar, importar y duplicar tema entre tiendas                                                                               | Medio                                                   | Tema y medios                  | ADR-034 §6                                    |
| 14  | Cupones por producto y descuentos automáticos                                                                                  | Medio                                                   | **Cálculo del carrito**        | ADR-036 (recomendado después del lanzamiento) |
| 15  | Menús como parte del borrador                                                                                                  | Bajo-medio                                              | Menús                          | Anotado; no se cambia sin ADR                 |
| 16  | SEO e imagen de categoría                                                                                                      | Bajo-medio                                              | RPC de categorías (no crítico) | Siguiente migración                           |

## 3. Errores y fallos reales encontrados

El recorrido cubrió 189 pantallas:

- 0 desbordes horizontales;
- 0 páginas de error;
- 0 excepciones;
- **0 violaciones de axe de cualquier gravedad.**

| #    | Fallo                                                                                                      | Cómo reproducirlo                                                                    | Estado                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-1  | El rol **Marketing** ve un enlace a «Ajustes → Pagos» que da **404**                                       | Entra como Marketing → Configurar tienda → paso «Pagos» → enlace «Ajustes → Pagos»   | **Corregido.** El enlace solo aparece con `payments.manage`; si no, dice quién activa los pagos. El texto ya menciona Mercado Pago (antes solo Stripe) |
| F-2  | Filtros de Pedidos de **20 px** de alto (celular y escritorio)                                             | Pedidos a 375 px: «Por surtir», «Pagados»…                                           | **Corregido:** 44 px en el celular                                                                                                                     |
| F-3  | Periodos de Inicio (7, 30 y 90 días) de 30 px                                                              | Inicio a 375 px                                                                      | **Corregido**                                                                                                                                          |
| F-4  | Pestañas de Apariencia de 38 px y de Opiniones de 34 px                                                    | Apariencia u Opiniones a 375 px                                                      | **Corregido**                                                                                                                                          |
| F-5  | Selector de tienda de 40 px y sus opciones de 32 px                                                        | Cualquier pantalla a 375 px → nombre de la tienda                                    | **Corregido**                                                                                                                                          |
| F-6  | Botones de archivo (logo, fotos de producto, banner) de 20 px de alto                                      | Configurar tienda, ficha o Portada a 375 px                                          | **Corregido**                                                                                                                                          |
| F-7  | Un error al cargar una pantalla de la tienda **ocultaba el menú** (lo atrapaba el `error.tsx` de `/admin`) | Cualquier fallo de lectura en una sección                                            | **Corregido:** `error.tsx` propio de la tienda, con menú y «Reintentar»                                                                                |
| F-8  | Al navegar entre secciones no había esqueleto de carga a nivel de página                                   | Navegar con red lenta                                                                | **Corregido:** `loading.tsx` de la tienda con esqueletos y anuncio «Cargando…» para lectores de pantalla                                               |
| F-9  | Si falta una migración, el panel decía «Ocurrió un error inesperado»                                       | Usar una acción cuya función no existe en la base (pasó en staging antes de ADR-033) | **Corregido** (D-EST-04): mensaje accionable «La base de datos de la tienda no está actualizada…», sin cambiar los códigos de error                    |
| F-10 | La descripción de categoría existía en la base y se mostraba en la tienda, pero no había dónde escribirla  | Productos → Categorías                                                               | **Corregido** (D-EST-03)                                                                                                                               |
| F-11 | `seo.manage` y `domains.manage` existen pero ninguna pantalla los usa                                      | —                                                                                    | Anotado: se usarán con el rol Diseño y con E16                                                                                                         |

**Restantes por debajo de 44 px:**

- Las casillas de 24 px, que es la decisión de F4 y el mínimo de WCAG 2.5.8.
- Los `select` nativos ocultos de Radix (1×1, no son interactivos).

**Estados revisados:**

- **Vacío:** la tienda nueva no tiene errores y cada lista vacía dice qué hacer.
- **Sin permiso:** Solo lectura ve 0 botones de acción. Catálogo y Marketing solo ven sus secciones, salvo F-1.
- **Cargando:** F-8.
- **Error:** F-7 y F-9.

## 4. Lo que se corrige sin aprobación y lo que espera

- **Hecho en este paso:** F-1 a F-10 y D-EST-03 (descripción de categoría).
- **Sin ADR, siguiente:**
  - D-EST-01: rol Diseño;
  - D-EST-02: redirecciones 301;
  - vista previa de Google y de redes;
  - SEO de categoría (con su migración y pgTAP).
- **Requieren tu aprobación:**
  - ADR-034 (estudio de diseño);
  - ADR-035 (colecciones);
  - ADR-036 (cupones por producto);
  - E15 (alta de tienda por cuenta propia);
  - E16 (dominio propio).
