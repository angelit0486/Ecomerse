# Fase 9 — Diseño detallado (white-label completo y tienda insignia de suplementos)

> Estado: **diseño de trabajo** (2026-10-15), revisado antes de construir. Se construye contra este documento;
> cualquier desviación se registra en `docs/DECISIONS.md` antes de programarla.
> Contrato: GATE0 §20 (white-label), §21.4 (caché), §43 (Theme schema v1 es contrato crítico),
> §44 (reglas de no regresión), PHASE 9 (sin tablas nuevas). Plan: `AUTONOMOUS_PLAN.md` §4, Fase 9.
> **§13 (revisión adversarial del diseño) manda sobre §2–§8 donde difieran.**
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

- **Zod** (`src/lib/theme/schema.ts`, nuevo, junto a `resolve-theme.ts`): `ThemeSettingsV1` y `HomeSectionsV1` con mensajes
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
fuentes, solo el subconjunto `latin` (U+0000–00FF: cubre á é í ó ú ñ ü ¿ ¡), en `woff2`,
declaradas con `next/font/local` a nivel de módulo (las 10, porque `next/font` exige llamadas
estáticas), con `preload: false`, `display: swap` y `adjustFontFallback`, y sus clases `variable`
en `.sf-root`. El navegador solo descarga las fuentes que el CSS de la tienda usa de verdad (las
dos elegidas); `resolveTheme` traduce la clave a `var(--font-…)` desde la lista blanca. Si
Lighthouse mostrara que hace falta precargar, se copian los `woff2` a `public/fonts/` con nombre
estable (verificado por checksum en CI) y se precargan las dos con `ReactDOM.preload()` (§13 H4).
`barlow-condensed` no tiene versión variable: un archivo por peso usado (400 y 700). Alternativas consideradas: (a) Google Fonts
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

| Tipo                | Props (todas recortadas y sin HTML salvo `rich_text`)                                       | Límites y reglas                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hero`              | `heading`, `subheading?`, `image_media_id?`, `cta?{label, link}`, `align` (`left`/`center`) | heading 1–80, subheading ≤ 200, label 1–30. Imagen: media `banner` lista de la tienda. Texto sobre imagen con velo fijo del tema (contraste garantizado, no configurable).                                                                                                                         |
| `featured_products` | `title`, `source{type, id?}`, `limit`, `show_view_all`                                      | title 1–60; `type` ∈ `newest`, `best_selling`, `category` (id), `brand` (id), `attribute_value` (`id` = id del valor de un atributo filtrable; las claves se pueden reutilizar tras borrar, el id no); `limit` 4–12. Máximo 4 secciones de productos y 48 productos en total por portada (§13 M3). |
| `category_grid`     | `title`, `category_ids?`                                                                    | title 1–60; 1–12 categorías visibles de la tienda, sin repetir; vacío = categorías raíz.                                                                                                                                                                                                           |
| `promo_banner`      | `image_media_id`, `heading?`, `text?`, `cta?{label, link}`                                  | heading ≤ 80, text ≤ 200. La imagen lleva texto alternativo obligatorio (el de la media).                                                                                                                                                                                                          |
| `image_with_text`   | `image_media_id`, `heading`, `body`, `cta?`, `image_position` (`left`/`right`)              | heading 1–80, body 1–600 (párrafos por salto de línea).                                                                                                                                                                                                                                            |
| `brand_logos`       | `title`, `brand_ids`                                                                        | 2–12 marcas de la tienda **con logo**; sin repetir.                                                                                                                                                                                                                                                |
| `testimonials`      | `title`, `items[{quote, author, detail?}]`                                                  | 1–6 items; quote 1–300, author 1–60, detail ≤ 60. Ver la regla de veracidad abajo.                                                                                                                                                                                                                 |
| `rich_text`         | `heading?`, `html`                                                                          | `html` ≤ 20 000 bytes, sanitizado con el mismo `SafeHtml` de la descripción del producto (F3-T04) al guardar y al mostrar.                                                                                                                                                                         |

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
| `appearance_save_theme_draft(store, settings)`          | Redefinida: estructura + referencias + contraste. Audita `theme.draft_saved` con el antes y el después (como hoy); la publicación también guarda antes y después completos para poder revertir (§13 M6).                                                                                                                                       |
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
  existe del carrito). Imágenes con `<img>` (como el resto de la tienda; `next/image` emite atributos `style` que el
  CSP con nonce bloquea, §13 H6) y las variantes del worker de medios en `srcset`/`sizes`; la del
  hero con `fetchpriority="high"` y el resto con `loading="lazy"`. Encabezados en orden (un solo `h1`: el del hero o el
  nombre de la tienda).

## 7. Panel: Apariencia

Ruta `/admin/[storeHandle]/apariencia` (permiso `appearance.manage`; enlace en la navegación del
panel). La pantalla de onboarding sigue, pero guarda con el mismo parche por claves que el editor,
así que nunca borra lo configurado en Apariencia (§13 C2), y apunta aquí para "más opciones".

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

## 13. Revisión adversarial del diseño (2026-10-15) y cómo se resuelve

Una revisión independiente, de solo lectura y contra el código real, encontró 2 críticos, 6 altos,
8 medios y 6 bajos. Ninguno exige cambiar un contrato de §43 si se resuelven como sigue. Cada
resolución entra al plan de pruebas (§8) con su caso.

| ID  | Sev.    | Hallazgo (verificado)                                                                                                                                                                                      | Resolución                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Crítica | `appearance_publish_theme` copia `draft_settings` y `draft_logo_media_id` siempre (`20261009000400_store_logo.sql:116-121`): publicar solo secciones fallaría (`settings` es NOT NULL) o borraría el logo. | **Borrador atómico:** la primera edición de cualquier parte siembra las tres (`draft_settings := settings`, `draft_home_sections := home_sections`, `draft_logo_media_id := logo_media_id`); publicar copia las tres; descartar vacía las tres. pgTAP: publicar solo secciones deja tema y logo iguales.                                                                                                |
| C2  | Crítica | El onboarding manda `{colors, shape}` y la RPC reemplaza todo el borrador (`configuracion/actions.ts:82-85`): borraría encabezado, pie, redes, SEO, contacto y tipografía.                                 | `appearance_save_theme_draft` pasa a **parche por claves de primer nivel**: `borrador := borrador                                                                                                                                                                                                                                                                                                       |     | parche`y se valida el resultado completo; una clave con`null` se quita. El onboarding y el editor usan la misma RPC. E2E: guardar en onboarding conserva SEO y redes. |
| H1  | Alta    | Dos personas editando a la vez se pisan sin aviso; "vista previa y publicar" podría publicar cambios ajenos no vistos.                                                                                     | Columna `draft_revision integer` en `store_themes` (columna, no tabla). Toda RPC de borrador y la publicación reciben la revisión esperada; si no coincide → `conflict` ("Otra persona cambió el borrador. Recarga para ver sus cambios."). La vista previa muestra la revisión y publicar exige la misma.                                                                                              |
| H2  | Alta    | El validador de enlaces deja pasar `/\evil.com`, `https://instagram.com@evil.com`, puertos, mayúsculas, IDN y punto final.                                                                                 | Gramática anclada, igual en Zod y SQL: internos `^/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$` sin `\`; externos `^https://[a-z0-9.-]+(/[^\s\\]*)?$` en minúsculas, sin usuario ni puerto; redes `^https://([a-z0-9-]+\.)*instagram\.com(/[^\s\\]*)?$` y equivalentes. Se revalida al mostrar.                                                                                                        |
| H3  | Alta    | Redefinir la función de un CHECK no revalida las filas existentes.                                                                                                                                         | Se borran y se vuelven a crear los CHECK con nombre (Postgres valida todas las filas, incluidos `draft_*`). Las listas cerradas (fuentes, redes, medios de pago) solo crecen: quitar un valor exige primero un migrador de settings (§20.3). Metatest: las funciones que usan los CHECK son `immutable` y no leen tablas.                                                                               |
| H4  | Alta    | `next/font` exige llamadas estáticas: no se puede "precargar solo las dos de la tienda" ni separar `latin-ext`.                                                                                            | §2.3 corregido: las 10 declaradas, sin precarga, solo `latin`, fallback ajustado; prueba de que la página no precarga más de 2 fuentes y Lighthouse lo valida.                                                                                                                                                                                                                                          |
| H5  | Alta    | Un `icon.tsx` bajo `_store/[storeId]` genera una URL `/_store/…` que el proxy bloquea; el favicon global se cuela en todos los hosts.                                                                      | Ruta pública `/icon` (y `/manifest.webmanifest` con 192/512) reescrita por el proxy a un Route Handler de la tienda; `metadata.icons` apunta a `/icon?v=<published_at>`; `Cache-Control` público con versión. Los tamaños se generan con un job encolado al publicar (dentro de la transacción) desde una imagen cuadrada opcional; sin ella, monograma. Se quita `src/app/favicon.ico` del storefront. |
| H6  | Alta    | `next/image` emite `style=` que el CSP con nonce bloquea; la tienda ya usa `<img>`.                                                                                                                        | §6 corregido: `<img>` con `srcset`; colores de la barra como variables en el `<style nonce>`, nunca como `style`. E2E escucha `securitypolicyviolation` y falla si aparece una.                                                                                                                                                                                                                         |
| M1  | Media   | La revisión de cumplimiento (D-R-06) no mira la portada publicada.                                                                                                                                         | `compliance.recheck` de tienda también revisa `home_sections`: una sección con término prohibido se oculta (`enabled = false` en lo publicado), se audita con motivo `compliance` y se avisa en el panel.                                                                                                                                                                                               |
| M2  | Media   | Zod cuenta UTF-16 y SQL puntos de código; "bytes" difiere; `.trim()` transforma y SQL solo rechaza.                                                                                                        | Zod cuenta con `[...texto].length` y `Buffer.byteLength`; la RPC recorta y el CHECK rechaza texto sin recortar o con controles. Casos de paridad con emoji, NBSP, `\r\n` y `\t`.                                                                                                                                                                                                                        |
| M3  | Media   | Hasta 12 secciones de productos con listados sin límite.                                                                                                                                                   | Máximo 4 secciones de productos y 48 productos por portada; cada una con `limit`; prueba de `EXPLAIN` con 10 000 productos y presupuesto de tiempo.                                                                                                                                                                                                                                                     |
| M4  | Media   | Atributos por clave pueden apuntar a otro valor tras borrar y reutilizar la clave.                                                                                                                         | Fuente por id del valor (§3). Al mostrar: `brand_logos` con menos de 2 marcas con logo y `category_grid` sin categorías visibles se omiten.                                                                                                                                                                                                                                                             |
| M5  | Media   | Con botón `outline` el texto es `primary` sobre `background` y solo se exige 3:1.                                                                                                                          | `outline` exige 4.5:1 entre `primary` y `background`. Velo fijo del hero `rgba(0,0,0,0.55)` probado contra una imagen blanca.                                                                                                                                                                                                                                                                           |
| M6  | Media   | Auditar "solo claves" debilita la auditoría actual.                                                                                                                                                        | Antes y después completos (§4 corregido). Los nombres de los testimonios son datos de terceros: se documenta su retención con la auditoría.                                                                                                                                                                                                                                                             |
| M7  | Media   | El token de vista previa se crea al cargar la página y vence a los 15 min; no hay forma de salir; el aviso actual habla de tiendas no lanzadas.                                                            | El token se crea en una Server Action al pulsar "Vista previa"; ruta `/_preview/salir` (POST) que borra la cookie; aviso nuevo para tiendas activas: "Estás viendo el borrador. Tus clientes ven la versión publicada."                                                                                                                                                                                 |
| M8  | Media   | No está definido cómo leen el borrador el layout, el listado y la ficha.                                                                                                                                   | Módulo `server-only` `src/server/storefront/preview-reads.ts` sin caché (una prueba falla si importa `cachedRead`); en vista previa todas las páginas usan el tema del borrador; las secciones se resuelven con los mismos filtros públicos (solo productos publicados).                                                                                                                                |
| L1  | Baja    | `SafeHtml` permite `http`, `mailto` y enlaces relativos al protocolo.                                                                                                                                      | `rich_text` usa `SafeHtml` con `allowProtocolRelative: false` y solo `https` y rutas internas; la autoridad es el saneado al mostrar (la verificación en SQL es solo defensa extra).                                                                                                                                                                                                                    |
| L2  | Baja    | §20.2 pide logo claro y oscuro.                                                                                                                                                                            | Se difiere el logo oscuro: la tienda no tiene modo oscuro todavía. Se registra en DECISIONS.                                                                                                                                                                                                                                                                                                            |
| L3  | Baja    | "Menús" está en el frontend de la fase.                                                                                                                                                                    | "Encabezado y pie" enlaza al editor de menús existente (D-F5-06).                                                                                                                                                                                                                                                                                                                                       |
| L4  | Baja    | `src/lib/theming/` duplicaría `src/lib/theme/`.                                                                                                                                                            | Un solo directorio: `src/lib/theme/`.                                                                                                                                                                                                                                                                                                                                                                   |
| L5  | Baja    | `appearance_get_editor` no necesita `SECURITY DEFINER`.                                                                                                                                                    | Se lee con RLS (select existente) desde el servidor del panel; no se crea la RPC.                                                                                                                                                                                                                                                                                                                       |
| L6  | Baja    | Reordenar debe conservar el foco y anunciar la posición.                                                                                                                                                   | El foco queda en el botón movido y una región `aria-live` dice "Sección movida a la posición 3 de 7".                                                                                                                                                                                                                                                                                                   |

**Pruebas que se agregan a §8:** publicar solo secciones o solo logo; onboarding conserva las claves
v1; guardados simultáneos → `conflict`; migración con una fuente fuera de lista en un borrador →
aborta; base desde cero; media borrada tras publicar → sección omitida y `og:image` por defecto;
cambio de reglas → portada revisada; enlaces `/\`, con usuario, en mayúsculas o IDN; paridad con
Unicode; `authenticated` y `anon` no pueden ejecutar `storefront.get_theme_preview`; vista previa en
dominio propio y en tienda no lanzada; la cookie de la tienda A no sirve en la B; favicon accesible
por el proxy con su `Cache-Control`; ≤ 2 fuentes descargadas; cero violaciones de CSP; sin JSON-LD de
reseñas con testimonios; contraste del botón `outline`. Mutaciones nuevas: quitar la siembra del
logo al publicar y quitar el parche por claves.

**Decisiones nuevas:** D-F9-05 (borrador atómico, parche por claves y revisión del borrador),
D-F9-06 (favicon por ruta pública y job al publicar), D-F9-07 (logo oscuro diferido),
D-F9-08 (límite de 4 secciones de productos y 48 productos).
