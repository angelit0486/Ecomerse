# Fase 9 — Diseño detallado (white-label completo y tienda insignia de suplementos)

> Estado: **diseño de trabajo** (2026-10-15), revisado antes de construir. Se construye contra este documento;
> cualquier desviación se registra en `docs/DECISIONS.md` antes de programarla.
> Contrato: GATE0 §20 (white-label), §21.4 (caché), §43 (Theme schema v1 es contrato crítico),
> §44 (reglas de no regresión), PHASE 9 (sin tablas nuevas). Plan: `AUTONOMOUS_PLAN.md` §4, Fase 9.
> Decisiones previas: D-S-05 (tienda insignia sin cambiar el contrato), D-F5-07 (la vista previa
> del borrador se difirió a esta fase), D-S-02 (sin copiar a ninguna marca).

## 0. Qué significa "terminado" en esta fase

Una tarea solo se marca `hecha` cuando cumple **todo** lo siguiente (además de su fila del plan):

1. Cada regla de validación existe **dos veces**: en Zod (servidor de la app, mensajes por campo)
   y en SQL (la base es la autoridad). Una prueba de paridad las compara con los mismos casos.
2. pgTAP cubre cada tipo y cada límite (válido justo en el borde, inválido justo afuera),
   permisos, aislamiento entre tiendas y auditoría. Los metatests de `00_schema_security` pasan.
3. Mutación: se quita cada regla de seguridad o de validación importante y una prueba falla.
   Se incluye un control sin cambios que no debe detectarse.
4. E2E con axe en cada pantalla nueva, con teclado (sin depender del ratón) y a 375 px y 1280 px.
5. Lighthouse móvil ≥ 90 en las cuatro métricas para inicio, listado y ficha en **dos tiendas
   visualmente distintas** (criterio de aceptación de GATE0 PHASE 9).
6. `pnpm verify`, `pnpm db:test` y el E2E completo en verde; revisión adversarial de base de
   datos y de aplicación al cierre (Gate F9) con sus hallazgos corregidos o aceptados por escrito.
7. Nada inventado: ningún producto, precio, reseña, testimonio, sello ni afirmación de salud
   en el código, las semillas ni las capturas. El contenido lo carga la tienda.

## 1. Alcance

| Tarea  | Incluye                                                                                                                                                                                                        | No incluye (y por qué)                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| F9-T01 | Theme schema v1 completo: colores, tipografía curada, forma, encabezado con barra de anuncio, pie, redes, contacto, SEO global, favicon. Editor, vista previa del borrador y publicación.                      | Temas adicionales, CSS o JS del comerciante, page builder (GATE0 PHASE 9).                   |
| F9-T02 | Las 8 secciones de la portada de §20.2, con agregar, quitar, ordenar (con teclado), editar, vista previa y publicación. `featured_products` por novedades, más vendidos, categoría, marca o valor de atributo. | Secciones fuera de las 8 del contrato; reseñas o calificaciones (no existen en el contrato). |
| F9-T03 | Ficha insignia: galería con miniaturas, ahorro y % de descuento, insignias, "más para tu objetivo", envío y formas de pago visibles.                                                                           | Reseñas, "comprados juntos" con IA, video.                                                   |
| F9-T04 | Tarjetas con insignias, menú principal de 2 niveles (categorías y objetivos), sugerencias de búsqueda, barra de "te faltan $X para envío gratis".                                                              | Búsqueda difusa o con IA, mega-menú con imágenes.                                            |

F9-T03 y F9-T04 tendrán su propia sección de diseño detallado (§9 y §10) que se completa antes
de empezar cada una, con el mismo nivel que F9-T01 y F9-T02.

## 2. Theme schema v1 (contrato crítico §43)

**No es un cambio de contrato:** §20.2 ya define qué se configura y §43 exige "tokens + secciones
validados con Zod por versión". Hoy solo existen `colors`, `typography` y `shape`; esta fase
implementa el resto del mismo esquema v1 (`theme_version = 1`). Ningún campo existente cambia de
forma ni de significado, así que no hace falta migrador de settings. Si durante la construcción
algo exigiera cambiar un campo existente, se detiene la tarea y se propone un ADR.

### 2.1 `store_themes.settings` / `draft_settings`

Todas las claves son opcionales (fallback `store ▷ theme ▷ platform`, §20.3). Una clave desconocida
se rechaza (igual que hoy). Los textos se guardan recortados (`btrim`), sin caracteres de control
y nunca se interpretan como HTML.

| Clave                    | Forma                                              | Reglas                                                                                                                                                        |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `colors`                 | `{primary, accent, background, foreground, muted}` | Sin cambios: `^#[0-9a-f]{6}$`. Contraste (§20.2) bloquea guardar y publicar.                                                                                  |
| `typography`             | `{heading, body}`                                  | Ahora además: el valor debe ser una clave de la **lista curada** (§2.3), no cualquier slug.                                                                   |
| `shape`                  | `{radius, button_style}`                           | Sin cambios.                                                                                                                                                  |
| `header.logo_position`   | `left` \| `center`                                 | Fallback `left`.                                                                                                                                              |
| `header.announcement`    | `{text, link?, background, foreground}`            | `text` 1–120; `link` (§2.4); colores hex; **contraste ≥ 4.5:1** entre ambos (mismo bloqueo que la paleta). Sin `announcement` no hay barra.                   |
| `footer.legal_text`      | texto                                              | ≤ 500, saltos de línea permitidos (se muestran como párrafos), sin HTML.                                                                                      |
| `footer.payment_methods` | lista sin repetir                                  | De `visa`, `mastercard`, `amex`, `oxxo`, `spei`, `paypal`, `mercado_pago`, `cash_on_delivery`. Solo íconos y nombres; no habilita cobros.                     |
| `social`                 | lista ≤ 8 de `{network, url}`                      | `network` ∈ `facebook`, `instagram`, `tiktok`, `youtube`, `x`, `whatsapp`, `pinterest`, `linkedin`; `url` https y dominio de esa red (§2.4). Sin repetir red. |
| `seo`                    | `{title?, description?, image_media_id?}`          | `title` ≤ 70, `description` ≤ 160; la imagen es un `media` de la tienda, listo, de tipo `store_branding` o `banner`.                                          |
| `contact`                | `{whatsapp?, address?, hours?}`                    | `whatsapp` E.164 de México o internacional (`^\+[1-9][0-9]{7,14}$`); `address` ≤ 300; `hours` ≤ 200. Email y teléfono siguen en `stores`.                     |

`stores.contact_email` y `contact_phone` no se mueven (email obligatorio para lanzar, F7-T05);
el editor los muestra en la misma pantalla y los guarda con su RPC existente.

### 2.2 Validación en dos capas

- **Zod** (`src/lib/theming/schema.ts`, nuevo): `ThemeSettingsV1` y `HomeSectionsV1` con mensajes
  en español por campo. El editor valida antes de llamar a la RPC y muestra errores por campo.
- **SQL** (`app.theme_settings_valid`, redefinida con `create or replace`, forward-only): mismas
  reglas estructurales. Las referencias a filas (media, categorías, marcas, atributos) las valida
  `app.theme_references_valid(store_id, settings, sections)` porque necesitan la tienda.
- **Paridad:** `tests/integration/theme-schema-parity.test.ts` corre un mismo archivo de casos
  (válidos e inválidos, uno por regla y por borde) contra Zod y contra la base. Si divergen, falla.

### 2.3 Tipografía curada (≤ 10, autoalojada)

GATE0 exige fuentes autoalojadas (el CSP solo permite `font-src 'self'`). Lista propuesta, todas
con licencia SIL OFL y variables donde existen, cubriendo estilos distintos para que dos tiendas
se vean diferentes:

| Clave       | Uso sugerido            | Clave              | Uso sugerido                   |
| ----------- | ----------------------- | ------------------ | ------------------------------ |
| `inter`     | cuerpo neutro (default) | `oswald`           | títulos deportivos condensados |
| `dm-sans`   | cuerpo moderno          | `barlow-condensed` | títulos deportivos             |
| `manrope`   | cuerpo y títulos        | `montserrat`       | títulos geométricos            |
| `work-sans` | cuerpo legible          | `playfair-display` | títulos editoriales            |
| `lora`      | cuerpo serif            | `space-grotesk`    | títulos técnicos               |

**Dependencia nueva (regla 16):** paquetes `@fontsource-variable/*` / `@fontsource/*` de esas 10
fuentes, solo el subconjunto `latin` + `latin-ext` (acentos y ñ), en `woff2`, cargados con
`next/font/local` para que Next los sirva desde el propio dominio con `font-display: swap` y
precarga solo de las dos fuentes que usa la tienda. Alternativas consideradas: (a) Google Fonts
remoto: viola `font-src 'self'` y filtra la IP del comprador a terceros; (b) solo pilas del
sistema: no da identidad propia; (c) copiar los `woff2` al repositorio: mismo resultado, pero sin
actualizaciones ni procedencia clara. Tamaño: ~20–60 KB por fuente y peso; solo se descargan las
dos de la tienda. Se registra como D-F9-01 con este texto.

### 2.4 Enlaces y URLs

Un único validador de enlaces, igual en Zod y SQL, para la barra de anuncio, las secciones y los
botones:

- Interno: ruta que empieza con `/` (no `//`), ≤ 500, sin espacios ni caracteres de control.
- Externo: `https://` con host válido, ≤ 500. Nunca `http:`, `javascript:`, `data:` ni `mailto:`.
- Redes: además del https, el host debe ser el de la red o un subdominio
  (`instagram.com`, `facebook.com`/`fb.com`, `tiktok.com`, `youtube.com`/`youtu.be`, `x.com`/
  `twitter.com`, `wa.me`/`whatsapp.com`, `pinterest.com`/`pin.it`, `linkedin.com`).
- Los externos se renderizan con `rel="noopener noreferrer"` y sin `target` forzado.

## 3. Secciones de la portada (Home sections v1)

`store_themes.home_sections` / `draft_home_sections`: arreglo de 0 a 12 objetos
`{id, type, enabled, props}`. `id` es un uuid que crea el editor (para reordenar y editar sin
ambigüedad); se rechaza repetido. `enabled = false` se guarda pero no se muestra. Un arreglo vacío
publicado = plantilla del tema (§20.2 fallback: hero con el nombre, productos recientes, categorías).

| Tipo                | Props (todas recortadas y sin HTML salvo `rich_text`)                                       | Límites y reglas                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hero`              | `heading`, `subheading?`, `image_media_id?`, `cta?{label, link}`, `align` (`left`/`center`) | heading 1–80, subheading ≤ 200, label 1–30. Imagen: media `banner` lista de la tienda. Texto sobre imagen con velo fijo del tema (contraste garantizado, no configurable). |
| `featured_products` | `title`, `source{type, id?, attribute_key?, value_key?}`, `limit`, `show_view_all`          | title 1–60; `type` ∈ `newest`, `best_selling`, `category` (id), `brand` (id), `attribute_value` (claves de atributo filtrable y valor); `limit` 4–12.                      |
| `category_grid`     | `title`, `category_ids?`                                                                    | title 1–60; 1–12 categorías visibles de la tienda, sin repetir; vacío = categorías raíz.                                                                                   |
| `promo_banner`      | `image_media_id`, `heading?`, `text?`, `cta?{label, link}`                                  | heading ≤ 80, text ≤ 200. La imagen lleva texto alternativo obligatorio (el de la media).                                                                                  |
| `image_with_text`   | `image_media_id`, `heading`, `body`, `cta?`, `image_position` (`left`/`right`)              | heading 1–80, body 1–600 (párrafos por salto de línea).                                                                                                                    |
| `brand_logos`       | `title`, `brand_ids`                                                                        | 2–12 marcas de la tienda **con logo**; sin repetir.                                                                                                                        |
| `testimonials`      | `title`, `items[{quote, author, detail?}]`                                                  | 1–6 items; quote 1–300, author 1–60, detail ≤ 60. Ver la regla de veracidad abajo.                                                                                         |
| `rich_text`         | `heading?`, `html`                                                                          | `html` ≤ 20 000 bytes, sanitizado con el mismo `SafeHtml` de la descripción del producto (F3-T04) al guardar y al mostrar.                                                 |

**Testimonios (regla de veracidad).** El contrato incluye `testimonials`; la plataforma nunca los
genera ni los siembra. El editor muestra junto a la sección: "Solo publica opiniones reales de tus
clientes, con su permiso." No hay estrellas, calificaciones ni JSON-LD `Review`/`AggregateRating`
(los motores de búsqueda los exigen verificables). Se audita su publicación como cualquier cambio.

**Cumplimiento en la portada (tiendas reguladas).** El texto visible de las secciones (títulos,
subtítulos, cuerpo, botones, testimonios, `rich_text` decodificado con `app.compliance_html_text`)
se revisa con los términos prohibidos de las categorías que declaró la tienda, igual que la ficha
de producto (D-R-06). Un término prohibido **bloquea publicar** con el código y la sección donde
aparece. Esto evita que "comprar por objetivo" se convierta en una afirmación de salud en la portada.

**Referencias que desaparecen.** Validar al guardar no basta: una categoría, marca, atributo o
imagen puede borrarse después. Al **publicar** se revalida todo; al **mostrar**, una sección cuya
referencia ya no existe o no es visible se omite (nunca se muestra rota ni lanza error). La lectura
pública nunca expone ids de borradores ni productos no publicados.

## 4. Base de datos (sin tablas nuevas)

Migración `2026101700xxxx_phase9_theme_v1.sql` (forward-only). Todas las funciones nuevas siguen
§44.5: `SECURITY DEFINER` solo donde hace falta, `set search_path = ''`, nombres calificados,
`revoke execute ... from public`, grants explícitos.

| Objeto                                                  | Cambio                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.theme_settings_valid(jsonb)`                       | Redefinida con las claves de §2.1. Sigue siendo `immutable` y el CHECK de la columna la usa: los datos existentes (solo `colors`/`typography`/`shape`) siguen siendo válidos, **salvo** una tipografía fuera de la lista curada → se comprueba en la migración que no existe ninguna antes de endurecer (si existiera, se aborta con mensaje). |
| `app.home_sections_valid(jsonb)`                        | Nueva, `immutable`, estructura de §3. Nuevo CHECK en `home_sections` y `draft_home_sections` (`NOT VALID` + `VALIDATE` en la misma migración: hoy todas son `[]`).                                                                                                                                                                             |
| `app.theme_references_valid(store, settings, sections)` | Nueva, `stable`: media lista, de la tienda y del tipo correcto; categorías visibles; marcas con logo; atributo filtrable y valor existentes. Devuelve la lista de problemas (`text[]`).                                                                                                                                                        |
| `app.theme_contrast_issues(jsonb)`                      | Redefinida: agrega `announcement` (texto/fondo ≥ 4.5).                                                                                                                                                                                                                                                                                         |
| `app.home_compliance_issues(store, sections)`           | Nueva: términos prohibidos en el texto de la portada (§3).                                                                                                                                                                                                                                                                                     |
| `appearance_save_theme_draft(store, settings)`          | Redefinida: estructura + referencias + contraste. Audita `theme.draft_saved` con las claves cambiadas (no los valores).                                                                                                                                                                                                                        |
| `appearance_save_home_draft(store, sections)`           | Nueva: estructura + referencias; sanitiza `rich_text` en la app antes de llamar (la base vuelve a verificar tamaño y que no haya `<script`, `on*=`, `javascript:` como defensa en profundidad).                                                                                                                                                |
| `appearance_discard_draft(store)`                       | Nueva: vacía `draft_settings`, `draft_home_sections` y `draft_logo_media_id`. Audita.                                                                                                                                                                                                                                                          |
| `appearance_publish_theme(store)`                       | Redefinida: publica si hay **cualquier** borrador (settings, secciones o logo); `no_draft` solo si no hay ninguno. Revalida estructura, referencias, contraste y cumplimiento con lo que va a quedar publicado. Audita `theme.published` e invalida la caché (la app llama `invalidateStore`).                                                 |
| `appearance_get_editor(store)`                          | Nueva: borrador ∪ publicado para el editor (qué cambió), con aal2 y `appearance.manage`.                                                                                                                                                                                                                                                       |
| `storefront.get_store_public`                           | Redefinida: agrega header, footer, social, seo y contact **publicados** (nunca borradores).                                                                                                                                                                                                                                                    |
| `storefront.get_home(store)`                            | Redefinida: si hay secciones publicadas, devuelve las habilitadas con sus datos resueltos (productos por fuente vía `app.listing_products`, categorías, marcas, media); si no, la plantilla actual.                                                                                                                                            |
| `storefront.get_theme_preview(store)`                   | Nueva, solo `storefront_gateway`: devuelve el **borrador** (settings + secciones resueltas). La app solo la llama con una cookie de vista previa válida (§5). Nunca se cachea.                                                                                                                                                                 |

Permisos: todo con `appearance.manage` y aal2 (como hoy). `catalog_manager` y `viewer` no editan
la apariencia (pgTAP lo prueba). Ninguna tabla recibe grants nuevos; `anon` sigue sin grants.

## 5. Vista previa del borrador (CF-09)

Hoy la vista previa solo desbloquea una tienda no lanzada y muestra el tema publicado (D-F5-07).
Diseño:

1. El editor pide un token de vista previa (ya existe: HMAC, 15 min, una tienda) y abre
   `/_preview?token=…` en el dominio de la tienda. El proxy lo canjea por la cookie `__preview`
   (`HttpOnly`, `Secure`, `SameSite=Lax`, ruta `/`, 15 min).
2. Con la cookie válida **para esa tienda**, las páginas leen el tema y la portada con
   `get_theme_preview`; sin ella, con las lecturas públicas. La decisión se toma en el servidor en
   cada request; el token nunca viaja al cliente en el HTML.
3. Respuestas en vista previa: `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`, sin
   `unstable_cache` (lectura directa), y una barra visible "Vista previa del borrador — no es lo
   que ven tus clientes" con botón para salir (borra la cookie).
4. Prueba de no filtración (GATE0 PHASE 9): con el borrador cambiado, un navegador sin cookie, otra
   tienda con la misma cookie y una cookie vencida ven siempre lo publicado; y la caché pública
   nunca guarda una respuesta de vista previa (se verifica pidiendo la página pública justo después).

Riesgo aceptado (se registra como D-F9-02): la función de borrador la puede llamar cualquier código
de servidor con el rol `storefront_gateway`; el control es la verificación HMAC en la app. El
borrador es apariencia, no datos personales ni precios.

## 6. Storefront

- `resolveTheme` crece con tipografía (variables `--sf-font-heading` y `--sf-font-body` desde la
  lista curada), estilo de botón (`solid`/`outline` con su color de texto calculado), barra de
  anuncio y posición del logo. Sigue siendo pura, con lista blanca de valores, y su resultado es lo
  único que entra a la etiqueta `<style nonce>`.
- Encabezado: barra de anuncio opcional (enlace accesible, no se puede cerrar para no tapar
  avisos legales), logo a la izquierda o centrado, menú `main`.
- Pie: menú `footer`, contacto (email, teléfono, WhatsApp con `wa.me`, dirección, horario), redes
  con íconos SVG propios en línea (sin dependencias de íconos de marca), medios de pago, texto legal.
- SEO global: `title` y `description` por defecto de la tienda y `og:image` desde la media; las
  páginas con SEO propio (producto, categoría) siguen mandando.
- Favicon (§20.2): con logo cuadrado, se generan 32/180/192/512 con `sharp` en el worker de medios
  cuando se publica el logo; sin logo, monograma (inicial + color primario) generado en una ruta
  `icon` con `ImageResponse`. Ambos se cachean con el tag de la tienda.
- Portada: un componente por tipo de sección, todos servidor (sin JS en el cliente salvo lo que ya
  existe del carrito). Imágenes con `next/image`, tamaños responsivos, la primera del hero con
  prioridad (LCP) y el resto diferidas. Encabezados en orden (un solo `h1`: el del hero o el
  nombre de la tienda).

## 7. Panel: Apariencia

Ruta `/admin/[storeHandle]/apariencia` (permiso `appearance.manage`; enlace en la navegación del
panel; la pantalla de onboarding sigue igual y apunta aquí para "más opciones").

- Pestañas: **Marca** (logo, colores con avisos de contraste en vivo, tipografía con muestra,
  forma), **Encabezado y pie** (barra de anuncio con contraste, posición del logo, texto legal,
  medios de pago), **Redes y contacto**, **SEO**, **Portada** (secciones).
- Portada: lista de secciones con agregar (elige el tipo), editar en un panel, mostrar/ocultar,
  eliminar con confirmación y **mover arriba/abajo con botones** (accesible con teclado; arrastrar
  es opcional y nunca la única forma). Límite de 12 visible.
- Barra fija: "Hay cambios sin publicar" + **Vista previa** (abre la tienda con el borrador) +
  **Publicar** (muestra antes la lista de lo que cambia y cualquier bloqueo: contraste, referencia
  rota, término prohibido) + **Descartar borrador** (confirmación).
- Errores por campo con los mismos mensajes que Zod; nada se pierde tras un error (formularios
  controlados sin el reinicio automático de React 19, como en Gate R).

## 8. Pruebas de F9-T01 y F9-T02 (mínimo)

| Nivel       | Casos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pgTAP       | Cada clave de §2.1 y cada tipo de §3 en su borde válido e inválido; clave desconocida; tipografía fuera de la lista; URL `javascript:`/`http:`/`//`; red con dominio ajeno; media de otra tienda, no lista o de otro tipo; categoría/marca/atributo de otra tienda; 13 secciones; id repetido; contraste de la barra; término prohibido en la portada de una tienda regulada (y no en una no regulada); publicar solo secciones; descartar; `no_draft`; auditoría; permisos por rol; `get_store_public` nunca devuelve borrador; `get_home` omite referencias rotas. |
| Unit        | Zod por campo; `resolveTheme` con lista blanca (valores maliciosos no llegan al CSS); validador de enlaces; generador del monograma.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Integración | Paridad Zod ↔ SQL; publicar invalida la caché (la lectura pública cambia sin esperar el TTL).                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| E2E + axe   | Editar marca → vista previa muestra el borrador → público no → publicar → público sí; barra de anuncio; redes y pie; portada: agregar las 8 secciones, reordenar con teclado, ocultar, eliminar; "comprar por objetivo" lista los productos del valor de atributo; no filtración de la vista previa (§5.4); 375 y 1280 px.                                                                                                                                                                                                                                           |
| Lighthouse  | Dos tiendas de prueba con temas distintos (tipografía, colores, forma y secciones): ≥ 90 en inicio, listado y ficha.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Mutación    | Quitar: lista blanca de tipografía, dominio de redes, `https` de enlaces, contraste de la barra, referencias de otra tienda, revalidación al publicar, cumplimiento de la portada, `no-store` de la vista previa, filtro de borrador en la lectura pública. Más un control sin cambios.                                                                                                                                                                                                                                                                              |

## 9. F9-T03 Ficha insignia (diseño a detallar antes de empezarla)

Puntos ya decididos: precio con `compare_at_price` → ahorro en pesos y % redondeado hacia abajo
(nunca exagera el descuento), calculados en el servidor desde centavos `bigint`; insignias
estructurales y verificables: **Oferta** (hay precio de comparación mayor), **Nuevo** (publicado
hace ≤ 30 días), **Últimas piezas** (disponible ≤ umbral de stock bajo de la tienda, sin mostrar
la cantidad exacta), **Agotado**; "más para tu objetivo" = productos publicados que comparten
valores de atributo filtrable y luego categoría, sin el propio, máximo 8; envío y formas de pago
desde la configuración real de la tienda (nunca texto fijo). Pendiente de detallar: galería
accesible (miniaturas como botones, flechas, sin carrusel automático), datos estructurados.

## 10. F9-T04 Navegación y listados (diseño a detallar antes de empezarla)

Puntos ya decididos: las mismas insignias de F9-T03 en las tarjetas (una sola función de
servidor); menú `main` de 2 niveles con teclado (patrón de navegación de divulgación, no menú de
aplicación); "Objetivos" como entrada del menú que enlaza a `?objetivo=…`; sugerencias de búsqueda
con títulos, categorías y marcas publicados (límite y tiempo de respuesta medidos); barra de envío
gratis calculada en el servidor desde la regla `free_over` real de la tienda y el subtotal del
carrito (sin regla, no se muestra).

## 11. Decisiones a registrar al construir

- **D-F9-01** Fuentes autoalojadas con `@fontsource` (§2.3), dependencia justificada.
- **D-F9-02** Vista previa del borrador por `storefront_gateway` con control HMAC en la app (§5).
- **D-F9-03** Cumplimiento sanitario también en la portada de tiendas reguladas (§3).
- **D-F9-04** Testimonios: solo los que carga la tienda, sin calificaciones ni JSON-LD de reseñas (§3).

## 12. Orden de construcción

1. Esquema v1 en Zod + validador de enlaces + casos de paridad (unit).
2. Migración (validadores, RPCs, lecturas) + pgTAP + paridad.
3. `resolveTheme`, fuentes, encabezado, pie, SEO global, favicon.
4. Vista previa del borrador + prueba de no filtración.
5. Panel de Apariencia (Marca, Encabezado y pie, Redes y contacto, SEO) → commit F9-T01.
6. Secciones: componentes del storefront, `get_home`, editor de Portada → commit F9-T02.
7. F9-T03 y F9-T04 con su diseño detallado primero.
8. Gate F9: dos tiendas distintas, Lighthouse, revisiones adversariales, mutaciones, informe.
