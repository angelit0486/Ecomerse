import type { FontKey } from "./schema";

/**
 * Temas de presentación por tienda («looks»): una capa visual completa que se
 * enciende con la clave de tema ya existente (`store_themes.theme_key`, que la
 * base valida con `^[a-z][a-z0-9_]{1,30}$` y hasta hoy siempre vale `base`).
 *
 * - Sin migraciones ni campos nuevos: una tienda con otra clave se ve igual que antes.
 * - Las reglas son fijas y viven en el código (regla 13: ningún valor de la
 *   tienda llega al CSS). Solo miran `.sf-root[data-look='…']` y clases `sf-*`.
 * - Con un look encendido, sus colores y fuentes mandan sobre los de Apariencia
 *   (es un tema completo); los textos, el menú, la portada y los datos siguen
 *   siendo los de la tienda.
 *
 * «Nocturno» (Alien Demon Exotics, 2026-11-18): oscuro editorial con la
 * colorimetría de la marca (Apariencia de la tienda: verde #00a303 y morado
 * #b200ff). Negro para la profundidad, verde para la acción (comprar, agregar)
 * y morado como acento (rótulos, ofertas, foco); la plata queda para el texto
 * secundario. Los tonos claros de cada color solo se usan donde el original no
 * llega al contraste AA sobre negro.
 */
export const STORE_LOOKS = ["nocturno"] as const;
export type StoreLook = (typeof STORE_LOOKS)[number];

/** Clave de tema → look, o null (lista blanca; cualquier otra clave no cambia nada). */
export function storeLook(key: unknown): StoreLook | null {
  return typeof key === "string" && (STORE_LOOKS as readonly string[]).includes(key)
    ? (key as StoreLook)
    : null;
}

/** Fuentes que el look necesita cargadas (variables `--font-*`). */
export const LOOK_FONTS: Record<StoreLook, readonly FontKey[]> = {
  nocturno: ["space-grotesk", "inter"],
};

/** Paleta de Nocturno. Los pares de texto se prueban en looks.test.ts (≥ 4.5:1). */
export const NOCTURNO = {
  void: "#09090d", // fondo: profundidad
  deep: "#12121a", // superficies: paneles, tarjetas, pie
  graphite: "#20202a", // superficie elevada y bordes marcados
  silver: "#c8cad3", // acción principal y texto secundario fuerte
  frost: "#f4f5f8", // texto principal
  mist: "#9a9caa", // texto terciario (marca, notas)
  alien: "#00a303", // verde de la marca: acción principal (relleno con texto negro)
  alienHi: "#2fc433", // verde al pasar el cursor
  violet: "#b200ff", // morado de la marca: relleno con texto blanco (insignias, selección)
  glow: "#c45cff", // morado legible sobre negro: rótulos, ofertas, foco
  white: "#ffffff", // texto sobre el morado de la marca
  // Estados legibles sobre negro (los de la plataforma son para fondos claros).
  danger: "#fca5a5",
  success: "#86efac",
  warning: "#fcd34d",
} as const;

/** Pares texto/fondo de Nocturno con su contraste mínimo (WCAG 2.2 AA). */
export const NOCTURNO_PAIRS: ReadonlyArray<readonly [string, string, string, number]> = [
  ["texto sobre fondo", NOCTURNO.frost, NOCTURNO.void, 4.5],
  ["texto sobre superficie", NOCTURNO.frost, NOCTURNO.deep, 4.5],
  ["texto sobre superficie elevada", NOCTURNO.frost, NOCTURNO.graphite, 4.5],
  ["plata sobre fondo", NOCTURNO.silver, NOCTURNO.void, 4.5],
  ["plata sobre superficie", NOCTURNO.silver, NOCTURNO.deep, 4.5],
  ["terciario sobre fondo", NOCTURNO.mist, NOCTURNO.void, 4.5],
  ["terciario sobre superficie", NOCTURNO.mist, NOCTURNO.deep, 4.5],
  ["terciario sobre superficie elevada", NOCTURNO.mist, NOCTURNO.graphite, 4.5],
  ["botón (negro sobre verde de la marca)", NOCTURNO.void, NOCTURNO.alien, 4.5],
  ["botón al pasar (negro sobre verde claro)", NOCTURNO.void, NOCTURNO.alienHi, 4.5],
  ["botón secundario al pasar (negro sobre blanco frío)", NOCTURNO.void, NOCTURNO.frost, 4.5],
  ["oferta y acento sobre fondo", NOCTURNO.glow, NOCTURNO.void, 4.5],
  ["oferta y acento sobre superficie", NOCTURNO.glow, NOCTURNO.deep, 4.5],
  [
    "insignia de oferta y carrito (blanco sobre morado de la marca)",
    NOCTURNO.white,
    NOCTURNO.violet,
    4.5,
  ],
  ["error sobre superficie", NOCTURNO.danger, NOCTURNO.deep, 4.5],
  ["éxito sobre superficie", NOCTURNO.success, NOCTURNO.deep, 4.5],
  ["aviso sobre superficie", NOCTURNO.warning, NOCTURNO.deep, 4.5],
  // Foco: indicador no textual, 3:1 (WCAG 1.4.11 y 2.4.13).
  ["anillo de foco sobre fondo", NOCTURNO.glow, NOCTURNO.void, 3],
  ["anillo de foco sobre superficie elevada", NOCTURNO.glow, NOCTURNO.graphite, 3],
  // Íconos de la franja de confianza en verde: gráfico, 3:1.
  ["ícono verde sobre fondo", NOCTURNO.alien, NOCTURNO.void, 3],
];

const R = ".sf-root[data-look='nocturno']";
const N = NOCTURNO;
/** Títulos grandes de la tienda (mismo criterio que DISPLAY_HEADINGS). */
const DISPLAY =
  ":is(h1,:is(h2,h3,h4):is([class*=text-xl],[class*=text-2xl],[class*=text-3xl],[class*=text-4xl],[class*=text-5xl])):not(.sf-text-font)";
const EASE = "cubic-bezier(.2,.7,.2,1)";

/**
 * Reglas de Nocturno, sin capa: van después de Tailwind y de la personalidad, así
 * que ganan sin `!important`. Todo el movimiento va dentro de
 * `prefers-reduced-motion: no-preference`.
 */
const NOCTURNO_CSS = [
  // ── Tokens ────────────────────────────────────────────────────────────────
  `${R}{color-scheme:dark;` +
    `--ad-void:${N.void};--ad-deep:${N.deep};--ad-graphite:${N.graphite};--ad-silver:${N.silver};` +
    `--ad-frost:${N.frost};--ad-mist:${N.mist};--ad-violet:${N.violet};--ad-glow:${N.glow};` +
    `--ad-hair:color-mix(in srgb,${N.silver} 13%,${N.void});--ad-hair-strong:color-mix(in srgb,${N.silver} 34%,${N.void});` +
    `--ad-ease:${EASE};--ad-dur:220ms;` +
    `--sf-primary:${N.alien};--sf-accent:${N.glow};--sf-bg:${N.void};--sf-fg:${N.frost};--sf-muted:${N.mist};` +
    `--sf-on-primary:${N.void};--sf-radius:4px;` +
    `--sf-btn-bg:${N.alien};--sf-btn-fg:${N.void};--sf-btn-border:${N.alien};` +
    `--sf-sale-bg:${N.violet};--sf-sale-fg:${N.white};--sf-sale-text:${N.glow};` +
    `--sf-footer-bg:${N.deep};--sf-footer-fg:${N.frost};--sf-link:${N.silver};--sf-photo-blend:normal;` +
    `--sf-danger:${N.danger};--sf-success:${N.success};--sf-warning:${N.warning};` +
    "--sf-font-heading:var(--font-space-grotesk);--sf-font-body:var(--font-inter);" +
    "--sf-shadow-card:none;--sf-section-gap:4rem;--sf-section-gap-lg:7rem;" +
    `--sf-announce-bg:${N.deep};--sf-announce-fg:${N.silver};` +
    `--sf-surface:${N.deep};--sf-border:var(--ad-hair);--sf-border-strong:var(--ad-hair-strong);` +
    "--sf-radius-card:6px;--sf-radius-panel:12px;--sf-radius-control:4px;--sf-radius-btn:4px;" +
    "font-family:var(--font-inter),system-ui,sans-serif;font-size:16px;line-height:1.6}",
  // Sin destello blanco al estirar la página en el celular.
  `html:has(${R}){background:${N.void};color-scheme:dark}`,
  `${R} ::selection{background:${N.violet};color:${N.white}}`,
  `${R} :focus-visible{outline:2px solid ${N.glow};outline-offset:3px}`,
  `${R} input[type=checkbox],${R} input[type=radio]{accent-color:${N.violet}}`,
  `${R} :is(input,select,textarea){background-color:${N.deep};color:${N.frost};border-color:var(--ad-hair-strong)}`,
  `${R} ::placeholder{color:${N.mist};opacity:1}`,

  // ── Tipografía ────────────────────────────────────────────────────────────
  `${R} ${DISPLAY}{font-family:var(--font-space-grotesk),system-ui,sans-serif;font-weight:600;letter-spacing:-.025em}`,
  `${R} h2:is([class*=text-2xl],[class*=text-3xl]):not(.sf-text-font){font-weight:500}`,
  // Rótulo (eyebrow): mayúsculas espaciadas, nunca menos de 12 px.
  `${R} .sf-eyebrow{font:500 .75rem/1.2 var(--font-space-grotesk),system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:${N.glow}}`,
  `${R} .sf-section-title{font-size:clamp(1.75rem,1.2rem + 2vw,2.75rem);line-height:1.05;font-weight:500;letter-spacing:-.025em}`,
  // Numeración editorial de los bloques de la portada (01, 02…), solo visual.
  `${R} .sf-home{counter-reset:ad-sec}`,
  `${R} .sf-home .sf-section-title{counter-increment:ad-sec}`,
  `${R} .sf-home .sf-section-title::before{content:counter(ad-sec,decimal-leading-zero);content:counter(ad-sec,decimal-leading-zero) / "";` +
    `display:block;margin-bottom:.875rem;font:500 .75rem/1 var(--font-space-grotesk),system-ui,sans-serif;letter-spacing:.2em;color:${N.glow}}`,
  `${R} .sf-view-all{gap:.5rem;font-weight:500;letter-spacing:.04em;color:${N.silver};text-decoration:none}`,
  `${R} .sf-view-all::after{content:"→";content:"→" / "";transition:translate var(--ad-dur) var(--ad-ease)}`,
  `${R} .sf-view-all:hover{color:${N.frost};text-decoration:none}`,
  `${R} .sf-view-all:hover::after{translate:4px 0}`,

  // ── Barra de anuncio y encabezado ─────────────────────────────────────────
  `${R} aside[aria-label='Aviso de la tienda']{font-weight:500;letter-spacing:.06em;border-bottom:1px solid var(--ad-hair);padding-block:.625rem}`,
  `${R} header.sf-el-header{background:${N.void}}`,
  `${R} .sf-wordmark{font-family:var(--font-space-grotesk),system-ui,sans-serif;font-weight:600;text-transform:uppercase;letter-spacing:.14em;font-size:1rem;line-height:1.15;color:${N.frost}}`,
  `@media (min-width:640px){${R} .sf-wordmark{font-size:1.0625rem}}`,
  // Tableta (640–1023 px): el nombre en dos renglones deja al carrito en la misma fila.
  `@media (min-width:640px) and (max-width:1023px){${R} .sf-wordmark{max-width:9.5rem;font-size:.9375rem;letter-spacing:.1em}}`,
  `${R} nav[aria-label='Principal'] :is(a,button){font-weight:500;letter-spacing:.03em}`,
  `${R} nav[aria-label='Principal'] > ul > li > :is(a,button){position:relative;color:${N.silver}}`,
  `${R} nav[aria-label='Principal'] > ul > li > :is(a,button):hover{color:${N.frost};text-decoration:none}`,
  `${R} nav[aria-label='Principal'] > ul > li > :is(a,button)::after{content:"";position:absolute;left:0;right:0;bottom:.55rem;height:1px;background:${N.glow};transform:scaleX(0);transform-origin:left;transition:transform var(--ad-dur) var(--ad-ease)}`,
  `${R} nav[aria-label='Principal'] > ul > li > :is(a,button):is(:hover,[aria-expanded=true])::after{transform:scaleX(1)}`,
  // Buscador: contorno fino que se enciende en verde al escribir (sin caja verde permanente).
  `${R} header.sf-el-header form[role=search] > div:first-of-type{border-width:1px;border-color:${N.mist};background:${N.deep};transition:border-color var(--ad-dur) var(--ad-ease)}`,
  `${R} header.sf-el-header form[role=search] > div:first-of-type:focus-within{border-color:${N.alien}}`,
  `${R} header.sf-el-header a[href='/carrito'] span[aria-hidden=true]{background:${N.violet};color:${N.white};box-shadow:0 0 0 2px ${N.void}}`,

  // ── Botones ───────────────────────────────────────────────────────────────
  `${R} :is(button,a)[class*='bg-[var(--sf-btn-bg)]']{font-weight:600;letter-spacing:.02em;transition:background-color var(--ad-dur) var(--ad-ease),color var(--ad-dur) var(--ad-ease),border-color var(--ad-dur) var(--ad-ease),transform 120ms var(--ad-ease)}`,
  `${R} :is(button,a)[class*='bg-[var(--sf-btn-bg)]']:not(:disabled):hover{background:${N.alienHi};border-color:${N.alienHi}}`,
  `${R} :is(button,a)[class*='bg-[var(--sf-btn-bg)]']:not(:disabled):active{transform:scale(.985)}`,

  // ── Hero ──────────────────────────────────────────────────────────────────
  `${R} .sf-hero-bg{min-height:clamp(32rem,74svh,46rem);border:1px solid var(--ad-hair);border-radius:var(--sf-radius-panel)}`,
  `${R} .sf-hero-veil{background:linear-gradient(0deg,rgb(9 9 13/.94) 0%,rgb(9 9 13/.78) 42%,rgb(9 9 13/.35) 100%)}`,
  `@media (min-width:768px){${R} .sf-hero-veil{background:linear-gradient(90deg,rgb(9 9 13/.94) 0%,rgb(9 9 13/.8) 40%,rgb(9 9 13/.2) 78%,rgb(9 9 13/.1) 100%)}}`,
  `${R} .sf-hero-body{gap:1.25rem;padding:clamp(2rem,6vw,4.5rem) clamp(1.25rem,5vw,4.5rem)}`,
  `${R} .sf-hero-body::before{content:"";display:block;width:3rem;height:1px;background:${N.glow}}`,
  `${R} .sf-hero-title{font-size:clamp(2.5rem,1.3rem + 5.2vw,5.5rem);line-height:.98;font-weight:600;letter-spacing:-.035em;max-width:14ch;color:${N.frost}}`,
  `${R} .sf-hero-sub{font-size:clamp(1rem,.9rem + .4vw,1.1875rem);line-height:1.6;color:${N.silver};max-width:34rem}`,
  `${R} .sf-hero-cta{background:${N.alien};color:${N.void};border-radius:var(--sf-radius-btn);gap:.75rem;padding-inline:1.75rem;font-weight:600;letter-spacing:.02em;transition:background-color var(--ad-dur) var(--ad-ease)}`,
  `${R} .sf-hero-cta::after{content:"→";content:"→" / "";transition:translate var(--ad-dur) var(--ad-ease)}`,
  `${R} .sf-hero-cta:hover{background:${N.alienHi}}`,
  `${R} .sf-hero-cta:hover::after{translate:4px 0}`,
  `${R} .sf-hero-split{--sf-primary:${N.deep};--sf-on-primary:${N.frost};background:${N.deep};color:${N.frost};border:1px solid var(--ad-hair)}`,
  `${R} .sf-hero-split .sf-hero-cta{background:${N.alien};color:${N.void}}`,
  // En el celular el hero va de orilla a orilla: más presencia sin achicar el texto.
  `@media (max-width:639px){${R} .sf-hero-bg{margin-inline:-1rem;border-radius:0;border-inline:0;min-height:34rem}}`,

  // El hero, los objetivos y la franja de confianza se leen como un solo bloque.
  `${R} .sf-hero-group{gap:2rem}`,
  `@media (min-width:640px){${R} .sf-hero-group{gap:2.5rem}}`,
  // ── Franja de confianza y beneficios ──────────────────────────────────────
  `${R} .sf-trust{background:transparent;border-block:1px solid var(--ad-hair);border-radius:0;padding-inline:0}`,
  `${R} .sf-trust svg{color:${N.alien}}`,
  `${R} .sf-benefits > li{background:${N.deep};border:1px solid var(--ad-hair);padding:1.5rem;gap:.75rem}`,
  `${R} .sf-benefits > li > span:first-child{color:${N.glow}}`,

  // ── Categorías: fichas editoriales 4:5 en lugar de círculos ───────────────
  `${R} .sf-cat-list > li{width:10rem}`,
  `@media (min-width:640px){${R} .sf-cat-list > li{width:auto}` +
    `${R} .sf-cat-list:not(:has(> li:nth-child(7))){grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);grid-template-columns:none}}`,
  `${R} .sf-cat-link{align-items:stretch;text-align:left;gap:.875rem}`,
  `${R} .sf-cat-media{aspect-ratio:4/5;border-radius:var(--sf-radius-card);background:${N.deep};box-shadow:none;outline:1px solid var(--ad-hair);outline-offset:-1px;transition:outline-color var(--ad-dur) var(--ad-ease)}`,
  `${R} .sf-cat-media img{object-fit:cover;padding:0}`,
  `${R} .sf-cat-link:hover .sf-cat-media{outline-color:var(--ad-hair-strong)}`,
  `${R} .sf-cat-name{display:flex;justify-content:space-between;gap:.5rem;font:500 .8125rem/1.3 var(--font-space-grotesk),system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${N.silver}}`,
  `${R} .sf-cat-name::after{content:"→";content:"→" / "";color:${N.mist};transition:translate var(--ad-dur) var(--ad-ease),color var(--ad-dur) var(--ad-ease)}`,
  `${R} .sf-cat-link:hover .sf-cat-name{color:${N.frost}}`,
  `${R} .sf-cat-link:hover .sf-cat-name::after{translate:4px 0;color:${N.glow}}`,

  // ── Tarjeta de producto ───────────────────────────────────────────────────
  `${R} .sf-card{border:0;background:transparent;padding:0;box-shadow:none;gap:0}`,
  `${R} .sf-card-media{border-radius:var(--sf-radius-card);background:${N.deep};outline:1px solid var(--ad-hair);outline-offset:-1px;transition:outline-color var(--ad-dur) var(--ad-ease)}`,
  `${R} .sf-card:hover .sf-card-media{outline-color:var(--ad-hair-strong)}`,
  `${R} .sf-card-img{object-fit:cover;padding:0;mix-blend-mode:normal}`,
  `${R} .sf-card-brand{margin-top:.875rem;font:500 .75rem/1.3 var(--font-space-grotesk),system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:${N.mist}}`,
  // Dos renglones reservados: los precios quedan alineados en toda la fila.
  `${R} .sf-card-title{font-size:.9375rem;font-weight:500;line-height:1.4;min-height:2.8em;color:${N.frost};text-decoration:none}`,
  `${R} .sf-card:hover .sf-card-title{text-decoration:underline;text-decoration-color:var(--ad-hair-strong);text-underline-offset:4px}`,
  `${R} .sf-card-price > span:first-child{font-family:var(--font-space-grotesk),system-ui,sans-serif;font-weight:500;font-size:1.0625rem;letter-spacing:-.01em;color:${N.silver}}`,
  `${R} .sf-card-price > span[class*='sf-sale-text']{color:${N.glow}}`,
  // «Agregar» en la tarjeta: contorno fino; se rellena al pasar (la ficha conserva el botón lleno).
  `${R} .sf-card form button{background:transparent;color:${N.frost};border-color:var(--ad-hair-strong);font-weight:500}`,
  `${R} .sf-card form button:not(:disabled):hover{background:${N.alien};border-color:${N.alien};color:${N.void}}`,
  `${R} .sf-card-choose{border-width:1px;border-color:var(--ad-hair-strong);color:${N.frost};font-weight:500}`,
  // Carga: la foto ocupa su lugar desde el inicio (sin saltos); un barrido tenue
  // indica que llega. Se detiene solo, por si la foto tiene transparencia.
  `${R} .sf-card-media,${R} .sf-cat-media{background-image:linear-gradient(100deg,transparent 30%,rgb(200 202 211/.06) 50%,transparent 70%);background-size:220% 100%;background-position:120% 0}`,
  `@keyframes ad-sheen{to{background-position:-120% 0}}`,
  `@media (prefers-reduced-motion:no-preference){${R} .sf-card-media,${R} .sf-cat-media{animation:ad-sheen 1.6s var(--ad-ease) 3}}`,
  // Agotado: la foto se apaga (ya lo hace la tarjeta) y la insignia «Agotado» la explica.
  `${R} .sf-card-img.grayscale{opacity:.45}`,
  // Error: si la foto no carga, el texto alternativo se lee en el tono terciario.
  `${R} .sf-card-img{color:${N.mist};font-size:.8125rem}`,

  // ── Historia de marca (imagen con texto) ──────────────────────────────────
  `${R} .sf-story{border:1px solid var(--ad-hair);background:${N.deep};border-radius:var(--sf-radius-panel);padding:0;gap:0;overflow:hidden}`,
  `@media (min-width:640px){${R} .sf-story{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}`,
  `${R} .sf-story-media{border-radius:0;aspect-ratio:1/1;height:100%}`,
  `${R} .sf-story-body{padding:clamp(1.75rem,5vw,4rem);display:flex;flex-direction:column;justify-content:center;gap:1.25rem}`,
  `${R} .sf-story-body p{color:${N.silver};font-size:1.0625rem;line-height:1.7;max-width:34rem}`,
  `${R} .sf-story-cta{color:${N.frost};text-decoration:none;gap:.75rem;font-weight:500;letter-spacing:.02em}`,
  `${R} .sf-story-cta::after{content:"→";content:"→" / "";color:${N.glow};transition:translate var(--ad-dur) var(--ad-ease)}`,
  `${R} .sf-story-cta:hover::after{translate:4px 0}`,

  // ── Pie ───────────────────────────────────────────────────────────────────
  `${R} .sf-footer{margin-top:7rem;border-top:1px solid var(--ad-hair)}`,
  `${R} .sf-footer-name{font-family:var(--font-space-grotesk),system-ui,sans-serif;font-weight:600;font-size:clamp(2rem,1rem + 4.5vw,4.5rem);line-height:.95;letter-spacing:-.03em;text-transform:uppercase}`,
  `${R} .sf-footer :is(h2,h3){font:500 .75rem/1.2 var(--font-space-grotesk),system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:${N.mist}}`,
  `${R} .sf-footer a:hover{color:${N.glow}}`,
  `${R} .sf-footer [aria-labelledby='sf-pagos'] li{background:transparent;color:${N.silver};border:1px solid var(--ad-hair-strong)}`,

  // ── Ficha de producto ─────────────────────────────────────────────────────
  `${R} nav[aria-label='Ruta de navegación']{font-size:.8125rem;letter-spacing:.04em}`,
  `@media (min-width:768px){${R} .sf-pdp-grid{grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:4rem}}`,
  // Galería de orilla a orilla: fotos cuadradas llenan su marco como en las tarjetas.
  `${R} .sf-pdp-gallery img{background:${N.deep};padding:0;object-fit:cover}`,
  // «Comprar ahora» queda como acción secundaria (contorno); «Agregar» es la principal.
  `${R} form button[class*='bg-[var(--sf-fg)]']{background:transparent;color:${N.frost};border-color:var(--ad-hair-strong);transition:background-color var(--ad-dur) var(--ad-ease),color var(--ad-dur) var(--ad-ease)}`,
  `${R} form button[class*='bg-[var(--sf-fg)]']:not(:disabled):hover{background:${N.frost};color:${N.void};border-color:${N.frost}}`,
  `${R} .sf-pdp-brand{font:500 .75rem/1.3 var(--font-space-grotesk),system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:${N.glow}}`,
  `${R} .sf-pdp-title{font-size:clamp(2rem,1.3rem + 2.4vw,3.25rem);line-height:1.02;font-weight:500;letter-spacing:-.03em}`,
  `${R} .sf-pdp-price{font-weight:500;letter-spacing:-.02em}`,
  `${R} .sf-pdp-facts{border-color:var(--ad-hair);background:${N.deep}}`,
  `${R} .sf-pdp-desc{color:${N.silver}}`,
  `${R} .sf-pdp-desc :is(strong,b){color:${N.frost}}`,
  // Contenido regulatorio: un panel propio, distinguible y sin adornos.
  `${R} .sf-regulatory{border:1px solid var(--ad-hair);border-left:2px solid ${N.glow};background:${N.deep};border-radius:var(--sf-radius-card);padding:1.25rem 1.25rem 1.5rem}`,

  // ── Movimiento (CSS, sin bibliotecas) ─────────────────────────────────────
  "@keyframes ad-rise{from{opacity:.001;transform:translateY(24px)}to{opacity:1;transform:none}}",
  "@keyframes ad-in{from{opacity:.001;transform:translateY(10px)}to{opacity:1;transform:none}}",
  "@media (prefers-reduced-motion:no-preference){" +
    `${R} .sf-hero-body>*{animation:ad-in .7s var(--ad-ease) both}` +
    `${R} .sf-hero-body>:nth-child(2){animation-delay:.08s}` +
    `${R} .sf-hero-body>:nth-child(3){animation-delay:.16s}` +
    `${R} .sf-card-img{transition:scale .6s var(--ad-ease)}` +
    "@supports (animation-timeline:view()){" +
    `${R} .sf-home>:not(style)~:not(style){animation:ad-rise linear both;animation-timeline:view();animation-range:entry 0% entry 30%}}}`,
].join("");

const LOOK_CSS: Record<StoreLook, string> = { nocturno: NOCTURNO_CSS };

/** CSS fijo del look (va en el <style> con nonce del layout). */
export function lookCss(look: StoreLook): string {
  return LOOK_CSS[look];
}
