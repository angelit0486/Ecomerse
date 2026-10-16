# Auditoría para la tienda premium de suplementos (super prompt, 2026-10-16)

Auditoría no destructiva del repositorio y de la vista previa. Contrato técnico: `docs/architecture/GATE0-ARCHITECTURE-REVIEW.md`.

## A. Arquitectura detectada

- **Next.js 16 (App Router) + React 19 + Tailwind 4**. Una sola app con tres caras:
  - tienda pública por host: `src/app/%5Fstore/[storeId]`, resuelta en `src/proxy.ts`;
  - panel `/admin/[storeHandle]`;
  - consola `/platform`.
- **Supabase (PostgreSQL 17):**
  - multi-tenant Organización → Tienda, con RLS + FORCE RLS en todas las tablas;
  - la tienda pública lee solo con el rol `storefront_gateway`, mediante funciones `storefront.*` y sin acceso a tablas;
  - el panel usa RPC con permisos por rol;
  - los jobs corren en `system.jobs` con `system_worker`.
- **Caché de la tienda:** `unstable_cache` de 60 s por tienda, invalidada por tag. Lo que depende del comprador (carrito, cuenta) no se cachea.
- **Catálogo:**
  - `products` → `product_options` (hasta 3) → `product_variants`, con SKU y código de barras únicos por tienda, precio, precio de comparación, peso, estado, política de inventario e imagen por variante;
  - `variant_costs` (sensible, `products.cost.read`);
  - `brands` con logo y SEO;
  - `categories` jerárquicas, con una principal y varias secundarias por producto;
  - atributos filtrables (`attributes`, `attribute_values`);
  - ficha sanitaria (`product_regulatory_info`).
- **Compra:**
  - carrito con token de servidor y precios recalculados en la base (`app.calculate_cart`);
  - checkout con idempotencia (`place_order`) y reservas de inventario con TTL;
  - pagos por adaptador (Stripe Connect y proveedor manual), webhooks en `payment_events` con reconciliación;
  - envíos por zonas y tarifas; impuestos en `tax_rate_bps`.
- **Calidad:** el gate actual (prueba → resultado):

  | Prueba           | Resultado     |
  | ---------------- | ------------- |
  | Unitarias        | 553           |
  | pgTAP            | 1682          |
  | Integración      | 233           |
  | E2E              | 49 + 4 nuevas |
  | Lighthouse móvil | 96–98         |
  | axe              | 0 violaciones |

## B. Funcionalidades que se conservan (sólidas y probadas)

- Variantes reales: cada combinación tiene su id, SKU, precio, disponibilidad e imagen.
  - El selector de variantes de la ficha cambia precio, disponibilidad e imagen.
  - Una combinación inexistente no se puede agregar: la base valida la variante.
- Carrito y checkout:
  - el precio, el total y el stock los pone el servidor;
  - hay protección contra doble envío y reintentos;
  - las variantes agotadas no se compran.
- Búsqueda:
  - texto completo en español sin acentos y con similitud por trigramas en el título;
  - coincidencia exacta de SKU y código de barras;
  - sugerencias con imagen, marca y precio real.
- Listados:
  - orden, «Solo disponibles», filtros por atributo con conteo y filtro por marca;
  - total de resultados y paginación por cursor;
  - URLs compartibles que canonicalizan a la URL limpia, así los filtros no generan páginas indexables duplicadas.
- Ficha:
  - galería, ficha sanitaria y leyendas;
  - precio por porción, envío real y relacionados;
  - JSON-LD solo con datos verídicos.
- Portada por secciones, tema con tokens y contraste validado, y cumplimiento sanitario (Fase A).

## C. Problemas visuales y de usabilidad

1. **Corregido:** no había **directorio de marcas** (solo la página de cada marca).
2. **Corregido:** no había **filtro de precio** en la interfaz; la base ya lo soportaba.
3. **Corregido:** no había página de **Ofertas** ni filtro «Solo ofertas».
4. **Corregido:** el menú no tenía accesos a Marcas ni a Ofertas.
5. **Pendiente:** no hay **Guía para elegir productos**. Necesita contenido real; ver §G.
6. **Pendiente:** no existe un estilo de tema con la paleta grafito / blanco cálido / verde oliva. Hoy hay «Deportivo» y «Neutral»; se agrega validando contraste.
7. La vista previa quedó sin productos publicados hasta que el asesor apruebe las reglas sanitarias (Fase A).

## D. Problemas de arquitectura de catálogo

1. **No hay modelo de proveedor ni de despacho directo.** Faltan proveedor, SKU del proveedor, costo de adquisición por proveedor, disponibilidad del proveedor, última sincronización, plazo de despacho y estado de cumplimiento separado del estado comercial. Es la Fase F de este plan.
2. Lote y caducidad por variante no existen (pendiente de la Fase C del lanzamiento).
3. Tipo, sabor y tamaño son atributos que la tienda da de alta. Es correcto (los define quien conoce el catálogo), pero la importación exige crearlos antes.
4. Características como «sin cafeína» solo se pueden filtrar como atributo asignado por la tienda. Es lo correcto: nunca se deducen del texto.

## E. Rendimiento, accesibilidad y SEO

- Medidas actuales: Lighthouse móvil 96–98 y 100 en accesibilidad, buenas prácticas y SEO; axe 0 en 24 combinaciones.
- Tolerancia a errores de escritura: la similitud por trigramas solo mira el título. Marca y categoría entran por el texto completo, que no tolera errores. Mejora candidata: incluir la marca en la similitud.
- Listados: el estado de disponibilidad se calcula por producto en cada página (máximo 48). Es suficiente para el catálogo actual; con miles de productos convendría precalcularlo.

## F. Riesgos técnicos y de seguridad

1. El acceso al panel en la vista previa no envía correos: la dueña real no puede entrar. Hace falta Resend o el SMTP de Supabase.
2. Pagos: falta Mercado Pago para México (lanzamiento, Fase D). Hoy existen Stripe y el proveedor manual.
3. No hay integración con proveedores. No se finge: se construirá un adaptador delimitado.
4. Advisors de Supabase: `pg_net` en `public` y la protección de contraseñas filtradas apagada (interruptor del panel).

## G. Plan priorizado (dependencias reales)

| #   | Fase           | Contenido                                                                                                                                                       | Estado          |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | Descubrimiento | Precio, ofertas reales, directorio de marcas, accesos del menú                                                                                                  | **Hecho** (§H)  |
| 2   | Sistema visual | Estilo de tema «Grafito y oliva» con contraste validado; guía para elegir (página de contenido editable)                                                        | Siguiente       |
| 3   | Operaciones    | Modelo de proveedor y despacho directo: tablas con `store_id`, RLS y FK compuestas; adaptador `SupplierProvider` sin integración falsa; estados de cumplimiento | Pendiente (ADR) |
| 4   | Catálogo       | Lotes y caducidad, validaciones del panel (productos sin marca o sin imagen, datos de proveedor incompletos)                                                    | Pendiente       |
| 5   | Búsqueda       | Tolerancia a errores en marca y categoría                                                                                                                       | Pendiente       |
| 6   | Calidad        | Lighthouse y axe de las páginas nuevas en la vista previa; revisión adversarial                                                                                 | Pendiente       |

## H. Implementado en esta entrega (descubrimiento)

- Migración `20261018000400_discovery_price_offers_brands.sql`:
  - `app.product_on_sale`: oferta = alguna variante activa con precio de comparación mayor que su precio;
  - `list_products` con `p_on_sale`;
  - `list_facets` con precio y ofertas, para que los conteos respeten el filtro;
  - `list_brands` (solo marcas con productos publicados);
  - `discovery_summary`.
- Listado:
  - rango de precio (`precio_min` y `precio_max` en la URL) con «Aplicar precio» y la etiqueta «$200 a $500» para quitarlo;
  - «Solo ofertas»;
  - el botón «Filtros (n)» de móvil también cuenta el precio y la oferta;
  - el panel de filtros siempre está presente si hay productos.
- Páginas nuevas:
  - `/ofertas`, con descuentos reales;
  - `/marcas`, con buscador por nombre a partir de 9 marcas, logo y conteo.
- Menú y pie de página: «Marcas» (con 2 o más) y «Ofertas» (con al menos una), sin duplicar lo que ya esté en el menú de la tienda.
- Formularios: los campos de número no navegan con cada tecla; se aplican con el botón o con Enter.

## I. Segunda entrega (2026-10-16)

- **Sistema visual:** estilo «Grafito y oliva» en Apariencia → Estilos sugeridos (D-SP-05).
- **Búsqueda tolerante:** errores de escritura en nombre, marca, categoría, atributos y sabor o tamaño; también en las sugerencias (D-SP-06, migración `20261018000500`).
- **Calidad de datos:** Productos → Revisión (D-SP-07, `20261018000600`).
- **Proveedores y despacho directo, paso 1** (ADR-025 aprobado; D-SP-08, `20261018000700`): Productos → Proveedores; la disponibilidad del proveedor se vende sin sobreventa (prueba de concurrencia: 20 compradores, 1 propia y 2 del proveedor → 3 pedidos).
- **Guía para elegir:** sin desarrollo nuevo. Es una página de contenido (Contenido → Páginas, `/paginas/guia`) que se enlaza desde el menú. El texto lo escribe la tienda; la plataforma no redacta recomendaciones de uso.
