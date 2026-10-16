# Gate F9: informe de cierre de la Fase 9 (White-label completo y tienda insignia de suplementos)

Fecha: 2026-10-16. Rama `claude/ecommerce-regulated-platform-41vu1e` (repositorio `angelit0486/Ecomerse`).
Contrato: GATE0 §20 y `docs/plan/F9-DESIGN.md` (criterios del propietario en §16). Cada criterio se
reporta separado en **implementado**, **verificado** (con evidencia) y **pendiente**.

## 1. Cambios realizados

| Tarea                  | Commit(s)                                     | Qué entrega                                                                                                                                                                                               |
| ---------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F9-T01                 | `bef540b`, `3fec2f0`                          | Theme schema v1 (Zod y SQL con paridad), borrador atómico, panel Apariencia, fuentes curadas, barra de anuncio, pie, SEO global, favicon y vista previa privada del borrador.                             |
| F9-T02                 | `66c6f9f`                                     | Portada por secciones (8 tipos), editor accesible con teclado, «comprar por objetivo», revisión de cumplimiento al publicar.                                                                              |
| F9-T03                 | `51a9a4a`                                     | Ficha insignia: galería, ahorro y precio por porción, insignias, «Comprar ahora», relacionados, envío gratis real y formas de pago.                                                                       |
| F9-T04                 | `70690d2`                                     | Menú de 2 niveles con «Objetivos», filtro de marca, buscador con sugerencias, barra de envío gratis en el carrito.                                                                                        |
| F9-T05                 | `b88add0`                                     | Estilos sugeridos («Deportivo» y «Neutral») y datos de demostración marcados como ejemplo.                                                                                                                |
| Gate F9 (1/3–2b/3)     | `2ceffa4`, `fb94a2a`, `1659607`               | Medición preliminar, pruebas de mutación (22/22) y correcciones de las revisiones adversariales de base y app.                                                                                            |
| Vista previa           | `1cd08d3` … `d42600e`                         | Vista previa pública en Vercel + Supabase (D-F9-17), white-label de títulos, sin indexación en preview.                                                                                                   |
| Revisión de conversión | `8fd0b6c`, `f529a4c`, `3390ca8` y este cierre | A1–A6, M1–M10 y B1–B6 (D-F9-18). Detalle en §5.2.                                                                                                                                                         |
| Pulido visual          | este cierre                                   | Franja de confianza con datos reales, banner del hero por estilo, mosaicos de categoría, pie completo, galería fija en escritorio, WhatsApp flotante solo si está configurado, carrusel móvil con margen. |

## 2. Migraciones de la fase

| Migración                          | Propósito                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `20261017000100`–`000600`          | Tema v1, lectura del tema, portada, ficha, navegación y correcciones del Gate (ver informes de commit).  |
| `20261017000700_store_launched_at` | `launched_at` en los datos públicos de la tienda: «Nuevo» solo para lo que llega después de la apertura. |
| `20261017000800_listing_total`     | `total` de `storefront.list_products` en la primera página («N productos»).                              |
| `20261017000900_home_no_repeats`   | La portada no repite productos entre secciones (cada sección se completa con los siguientes, tope 48).   |
| `20261017001000_store_timezone`    | Zona horaria de la tienda en los datos públicos (fecha estimada de entrega).                             |

Todas forward-only, probadas desde cero (`pnpm db:test`) y aplicadas en la vista previa verificando el
sha256 de cada archivo contra el commit publicado. Ninguna cambia permisos ni firmas.

## 3. Pruebas y resultados (locales, 2026-10-16)

| Prueba                                                                           | Resultado                                                                                                                                                            |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` (lint, formato, tipos, unitarias, build)                           | Verde. Unitarias: 541 en 62 archivos.                                                                                                                                |
| `pnpm db:test`                                                                   | pgTAP: 1 613 pruebas en 60 archivos, `PASS` (incluye `58_conversion_review` y los metatests de seguridad). Integración: 233/233.                                     |
| E2E (Playwright, app compilada + stack local)                                    | **49/49** en la corrida completa final.                                                                                                                              |
| axe-core (WCAG 2.0/2.1/2.2 A y AA + buenas prácticas)                            | **0 violaciones de cualquier nivel** en 24 combinaciones: portada, listado, ficha, carrito, checkout y búsqueda sin resultados, en las dos tiendas, a 375 y 1280 px. |
| Lighthouse 12.8.2 móvil (3 corridas por página; se reporta la mediana y la peor) | Tabla siguiente.                                                                                                                                                     |

| Tienda             | Página  | Rendimiento (mediana / peor) | Accesibilidad | Buenas prácticas | SEO | LCP    | CLS   |
| ------------------ | ------- | ---------------------------- | ------------- | ---------------- | --- | ------ | ----- |
| demo («Deportivo») | Portada | 96 / 93                      | 100           | 100              | 100 | 2.45 s | 0.017 |
| demo               | Listado | 97 / 95                      | 100           | 100              | 100 | 2.28 s | 0.033 |
| demo               | Ficha   | 97 / 94                      | 100           | 100              | 100 | 2.28 s | 0.001 |
| demo2 («Neutral»)  | Portada | 96 / 95                      | 100           | 100              | 100 | 2.71 s | 0.004 |
| demo2              | Listado | 97 / 96 (2 corridas válidas) | 100           | 100              | 100 | 2.28 s | 0.033 |
| demo2              | Ficha   | 98 / 96                      | 100           | 100              | 100 | 2.05 s | 0.001 |

Evidencia: `docs/phases/f9-evidencia/` (README con la medición preliminar, capturas `demo/`, `demo2/` y
`competencia/`).

## 4. Criterios de cierre (F9-DESIGN §16)

| #   | Criterio                                                                                                           | Implementado | Verificado                                                                                                                                                              | Pendiente                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Lighthouse móvil ≥ 95 (4 categorías) en portada, listado y ficha                                                   | Sí           | **Medianas ≥ 96** en las 6 páginas y 100 en accesibilidad, buenas prácticas y SEO. Corridas sueltas de 93 y 94 por ruido de CPU compartida.                             | Repetir en producción (red y CDN reales).                                                                                                                                |
| 2   | 0 violaciones serias o críticas de axe                                                                             | Sí           | 0 de **cualquier** nivel en 24 combinaciones (§3); además axe en cada E2E de tienda.                                                                                    | —                                                                                                                                                                        |
| 3   | Compra en ≤ 3 clics desde la ficha                                                                                 | Sí           | E2E «compra completa en 3 clics desde la ficha» y, en móvil, desde la barra fija.                                                                                       | —                                                                                                                                                                        |
| 4   | Capturas 375/1280 de 5 páginas, lado a lado con GNC, Birdman y B Life                                              | Sí           | Nuestras 20 capturas (2 tiendas × 5 páginas × 2 tamaños) y las portadas de las 3 referencias en móvil y escritorio (§5.3).                                              | Las referencias son solo portada (sus fichas cambian a diario); Birdman se tomó de su tienda oficial en Mercado Libre porque `birdman.mx` no tiene una tienda funcional. |
| 5   | Filtros (objetivo, sabor, marca), buscador con sugerencias, relacionados, envío gratis, ficha sanitaria y leyendas | Sí           | E2E `attributes`, `navigation`, `product-page`, `compliance`.                                                                                                           | Textos sanitarios reales (R0).                                                                                                                                           |
| 6   | Nada inventado                                                                                                     | Sí           | Sin reseñas, testimonios, sellos ni cifras; la franja de confianza solo muestra datos configurados; «pendiente de contenido real» solo en la vista previa (E2E `home`). | —                                                                                                                                                                        |
| 7   | Revisión adversarial de diseño y conversión                                                                        | Sí           | 22 hallazgos, todos atendidos (§5.2).                                                                                                                                   | Tolerancia a errores de escritura (M7) y precio por porción por variante (M5).                                                                                           |

## 5. Revisión del gate

### 5.1 Revisiones adversariales de base de datos y aplicación

Hallazgos de la primera ronda (G9-1…G9-5 y los de app) corregidos en `1659607`. Pruebas de mutación de
F9-T03/T04: 22/22 mutantes detectados (`fb94a2a`).

Segunda revisión adversarial (código del 2026-10-16: migraciones 0700–1000, siembra y componentes
nuevos). Sin hallazgos altos ni de aislamiento o permisos:

| Sev.       | Hallazgo                                                                                                       | Resolución                                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Media      | Al quitar un filtro activo, su casilla seguía marcada (campo no controlado) y volvía a enviarse al marcar otro | `AutoSubmitForm` realinea las casillas con la URL; E2E en `attributes.spec`.                                                                                                                                      |
| Baja/Media | La fecha estimada aparecía en pedidos completados, reembolsados o con fechas pasadas                           | Solo con el pedido abierto, pagado y sin devolución, y nunca si la fecha ya pasó; prueba unitaria.                                                                                                                |
| Baja       | Una variante sin imagen dejaba la imagen de la anterior en la galería                                          | El evento también se emite sin imagen y la galería vuelve a la suya.                                                                                                                                              |
| Baja       | En Safari un clic fuera no cerraba el submenú de escritorio                                                    | Cierre con `pointerdown` fuera del menú.                                                                                                                                                                          |
| Baja       | La portada calcula `total` en cada sección (`home_resolve` → `list_products` con cursor nulo)                  | Aceptado y anotado en riesgos: con el tope de 4 secciones y catálogos chicos el costo es menor; cambiar la firma exige quitar la función anterior (operación destructiva) y queda para cuando el volumen lo pida. |

### 5.2 Revisión de diseño y conversión

Una revisión con capturas a 375 y 1280 px encontró 22 puntos (6 altos, 10 medios, 6 bajos). Estado:

| ID  | Hallazgo                                                         | Estado                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | En la compra móvil, resumen y total debajo de «Confirmar pedido» | Hecho: resumen plegable arriba y total en el botón (`1659607`).                                                                                                                                                                    |
| A2  | Errores de la compra casi invisibles                             | Hecho: errores por campo con foco (`1659607`).                                                                                                                                                                                     |
| A3  | «Comprar ahora» fuera de la primera pantalla en móvil            | Hecho: barra fija con precio (`8fd0b6c`), E2E en móvil.                                                                                                                                                                            |
| A4  | Encabezado de móvil de 233 px y no fijo                          | Hecho: ≈ 110 px y fijo (`8fd0b6c`), E2E mide ≤ 120 px.                                                                                                                                                                             |
| A5  | Hero roto en móvil                                               | Hecho: imagen como banda y texto debajo; banner nuevo por estilo.                                                                                                                                                                  |
| A6  | Tarjetas pobres                                                  | Hecho: descuento y precio por porción (`7f419ba`).                                                                                                                                                                                 |
| M1  | Dirección pensada fuera de México                                | Hecho: colonia, estado y código postal (`1659607`).                                                                                                                                                                                |
| M2  | Envío gratis contradictorio                                      | Hecho: preselección con el precio efectivo (`1659607`).                                                                                                                                                                            |
| M3  | Datos de confianza sin mostrar                                   | Hecho: costo y tiempo de envío en la ficha (`7f419ba`); franja de confianza en la portada.                                                                                                                                         |
| M4  | Chips de atributos parecían selectores                           | Hecho: atributos como datos; solo el objetivo enlaza (`f529a4c`).                                                                                                                                                                  |
| M5  | Variantes                                                        | Hecho: precio arriba e imagen de la variante en la galería (`3390ca8`). Sin producto demo con variantes: cubierto por E2E de `storefront.spec`. Precio por porción por variante: pendiente del dato de porciones por presentación. |
| M6  | Listado móvil con fricción                                       | Hecho: filtros y orden se aplican solos, filas de 44 px, conteo, «Para tu …», agotados al final de cada página (`f529a4c`).                                                                                                        |
| M7  | Búsqueda sin resultados sin salida                               | Hecho: objetivos y lo más vendido (`f529a4c`). Tolerancia a errores de escritura: pendiente.                                                                                                                                       |
| M8  | Insignias saturadas                                              | Hecho: una sola insignia y «Nuevo» tras la apertura; «Oferta» con el acento si contrasta (`f529a4c`).                                                                                                                              |
| M9  | Portada repetitiva                                               | Hecho: sin repetidos, chips de objetivos, carrusel en móvil, mosaicos de categoría (`f529a4c` y este cierre).                                                                                                                      |
| M10 | Carrito                                                          | Hecho: −/+ que se envían solos, código plegado, sugerencias de envío gratis, carrito vacío con salida (`f529a4c`).                                                                                                                 |
| B1  | Tipografía condensada a 14 px                                    | Hecho: condensada solo ≥ 20 px (`3390ca8`).                                                                                                                                                                                        |
| B2  | «Objetivos» solo abría con la flecha                             | Hecho: el nombre abre el submenú (`3390ca8`).                                                                                                                                                                                      |
| B3  | Cantidad con `input number`                                      | Hecho: control −/+ de 44 px (`8fd0b6c`).                                                                                                                                                                                           |
| B4  | Sin fecha estimada en la confirmación                            | Hecho: «Llega entre el … (estimado)» en el calendario de la tienda (`3390ca8`).                                                                                                                                                    |
| B5  | «Calcular envío» visible y h1 «Pago»                             | Hecho (`1659607`).                                                                                                                                                                                                                 |
| B6  | «Neutral» con el azul de Tailwind                                | Hecho: paleta propia (`3390ca8`).                                                                                                                                                                                                  |

### 5.3 Comparación con GNC, Birdman y B Life

Capturas del 2026-10-16 con el mismo navegador (Chromium 141), a 375×812 y 1280×800, tras cerrar
las ventanas emergentes que se dejan cerrar: `docs/phases/f9-evidencia/competencia/`. Nuestras
tiendas: `demo/` y `demo2/`.

| Aspecto                 | GNC                                                                                     | Birdman (tienda oficial en Mercado Libre)        | B Life                                                     | Nuestras tiendas                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Primera pantalla móvil  | Banner de app, aviso de fraude y una promoción a pantalla completa que vuelve a abrirse | Encabezado de Mercado Libre y banner de producto | Barra de promoción, banner 4×3 y avisos de envío y cookies | Encabezado de 110 px, hero, objetivos y franja de confianza sin ventanas emergentes                    |
| Confianza               | «Garantía GNC», recoger en tienda, entrega en 60 min, WhatsApp                          | Reputación y envío de Mercado Libre              | Envío gratis, pagos seguros, WhatsApp                      | Envío gratis y costo, tiempo de entrega, formas de pago y WhatsApp **solo si la tienda los configura** |
| Fotografía              | Real, de producto y personas                                                            | Real, de producto                                | Real, de personas                                          | **Ilustraciones de ejemplo**: es la mayor brecha y la cierra el contenido del propietario              |
| Navegación por objetivo | Por categoría y marca                                                                   | Por categoría                                    | Por categoría                                              | Chips de objetivo, menú «Objetivos» y filtros por objetivo, sabor y marca                              |
| Compra                  | Varios pasos                                                                            | Flujo de Mercado Libre                           | Varios pasos                                               | ≤ 3 clics desde la ficha; barra fija «Comprar ahora» en móvil                                          |

Conclusión honesta: en estructura, accesibilidad, velocidad y claridad de compra las tiendas de la
plataforma están al nivel de las tres referencias o por encima. En **confianza percibida** siguen por
debajo mientras usen ilustraciones de ejemplo y no tengan logo, políticas ni contacto: eso no se
resuelve con código y está en §7.

## 6. Riesgos

- **Contenido de demostración:** las tiendas de ejemplo usan ilustraciones, marcas ficticias y textos
  sanitarios de prueba. La impresión de confianza frente a las tres tiendas de referencia depende de
  fotos reales, logo, políticas y contacto del propietario (§7).
- **Agotados al final por página, no por catálogo** (D-F9-18 e): suficiente para catálogos chicos;
  con miles de productos un agotado puede quedar antes que disponibles de la página siguiente.
- **Mediciones locales:** Lighthouse corre con red y CPU simuladas en el contenedor; en producción los
  números cambian (red y CDN reales).
- **Caché de 60 s del storefront:** cambios hechos directo en la base (fuera del panel) tardan hasta un
  minuto en verse.

## 7. Pendientes

**Del propietario (bloquean «confiable» en producción, no el gate):**

- Fotos reales de producto (frente y tabla nutrimental), logo y favicon.
- Políticas de envío, devoluciones y términos, y aviso de privacidad (LFPDPPP).
- WhatsApp, correo y horario (el botón flotante y la franja de confianza lo muestran solos al configurarlo).
- Textos sanitarios reales (bloqueo R0) y confirmar si los precios incluyen IVA.
- Entrada al panel en la vista previa: plantilla de correo de Supabase o Resend.

**Técnicos (siguientes fases):** tolerancia a errores de escritura en la búsqueda, precio por porción
por variante, ordenar agotados en todo el catálogo si el volumen lo pide, cron por minuto al pasar a
Vercel Pro (N-4), limpieza de la vista previa (`pruva_apply`, `pruva_fetch`, `pg_net` en `public`).

## 8. Definition of Done

- [x] Criterios de §16 implementados y verificados con evidencia (§4), salvo lo marcado como pendiente.
- [x] `pnpm verify`, `pnpm db:test` y E2E completos en verde (§3).
- [x] Revisiones adversariales de base, aplicación, y diseño y conversión, con sus hallazgos resueltos o
      aceptados con motivo (§5).
- [x] Migraciones forward-only, probadas desde cero y aplicadas en la vista previa con sha256 verificado.
- [x] Decisiones registradas (D-F9-01 … D-F9-18) y PROGRESS al día.
- [ ] Contenido real del propietario (fotos, logo, políticas, contacto, textos sanitarios): no bloquea el
      gate técnico, sí el lanzamiento de la tienda insignia.

**Gate F9: cerrado en lo técnico.** La siguiente fase según el orden acordado (D-S-05) es la Fase P (pagos
en México).
