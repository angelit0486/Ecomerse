import { ALIEN_DEMON_CUTOFF, type CutoffConfig } from "./delivery-cutoff";
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

/**
 * Nombre de la tienda tal como lo dibuja un look. Con letras «decorativas» de
 * Unicode (𝓐𝓛𝓘𝓔𝓝: símbolos matemáticos) el celular cambia de fuente a media
 * palabra y el lector de pantalla las deletrea como símbolos; NFKC las vuelve
 * letras normales para que el look use su tipografía. Quita separadores sueltos
 * al final («Tienda |»). El nombre guardado no cambia.
 */
export function lookStoreName(name: string): string {
  const shown = name
    .normalize("NFKC")
    .replace(/[\s|·•\-–—/]+$/u, "")
    .trim();
  return shown || name;
}

/**
 * Hora de corte de envío que muestra un look (cuenta regresiva bajo el aviso).
 * Nocturno = Alien Demon: 4:20 pm, Hermosillo, lunes a viernes.
 */
export const LOOK_CUTOFF: Partial<Record<StoreLook, CutoffConfig>> = {
  nocturno: ALIEN_DEMON_CUTOFF,
};

/** Fuentes que el look necesita cargadas (variables `--font-*`). */
export const LOOK_FONTS: Record<StoreLook, readonly FontKey[]> = {
  nocturno: ["barlow-condensed", "manrope"],
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
  neon: "#afff6e", // verde neón del hero original de la tienda: títulos de portada
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
  ["título neón sobre fondo", NOCTURNO.neon, NOCTURNO.void, 4.5],
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
    `--sf-on-primary:${N.void};--sf-radius:10px;` +
    `--sf-btn-bg:${N.alien};--sf-btn-fg:${N.void};--sf-btn-border:${N.alien};` +
    `--sf-sale-bg:${N.violet};--sf-sale-fg:${N.white};--sf-sale-text:${N.glow};` +
    `--sf-footer-bg:${N.deep};--sf-footer-fg:${N.frost};--sf-link:${N.silver};--sf-photo-blend:normal;` +
    `--sf-danger:${N.danger};--sf-success:${N.success};--sf-warning:${N.warning};` +
    "--sf-font-heading:var(--font-barlow-condensed);--sf-font-body:var(--font-manrope);" +
    "--sf-shadow-card:none;--sf-section-gap:4rem;--sf-section-gap-lg:7rem;" +
    `--sf-announce-bg:${N.violet};--sf-announce-fg:${N.white};` +
    `--sf-surface:${N.deep};--sf-border:var(--ad-hair);--sf-border-strong:var(--ad-hair-strong);` +
    "--sf-radius-card:14px;--sf-radius-panel:22px;--sf-radius-control:10px;--sf-radius-btn:999px;" +
    "font-family:var(--font-manrope),system-ui,sans-serif;font-size:16px;line-height:1.6}",
  // Sin destello blanco al estirar la página en el celular.
  `html:has(${R}){background:${N.void};color-scheme:dark}`,
  `${R} ::selection{background:${N.violet};color:${N.white}}`,
  `${R} :focus-visible{outline:2px solid ${N.glow};outline-offset:3px}`,
  `${R} input[type=checkbox],${R} input[type=radio]{accent-color:${N.violet}}`,
  `${R} :is(input,select,textarea){background-color:${N.deep};color:${N.frost};border-color:var(--ad-hair-strong)}`,
  `${R} ::placeholder{color:${N.mist};opacity:1}`,

  // ── Tipografía ────────────────────────────────────────────────────────────
  `${R} ${DISPLAY}{font-family:var(--font-barlow-condensed),'Arial Narrow',sans-serif;font-weight:700;letter-spacing:.005em;text-transform:uppercase;line-height:.95}`,
  // Rótulo: condensada en mayúsculas, como etiqueta de producto (sin espaciado exagerado).
  `${R} .sf-eyebrow{font:700 .9375rem/1.1 var(--font-barlow-condensed),'Arial Narrow',sans-serif;letter-spacing:.04em;text-transform:uppercase;color:${N.glow}}`,
  `${R} .sf-section-title{font-size:clamp(2.25rem,1.5rem + 2.6vw,3.5rem);line-height:.92;font-weight:700}`,
  `${R} .sf-view-all{font-weight:700;color:${N.frost};text-decoration:underline;text-decoration-color:${N.alien};text-decoration-thickness:2px;text-underline-offset:6px;transition:color var(--ad-dur) var(--ad-ease)}`,
  `${R} .sf-view-all:hover{color:${N.alienHi}}`,

  // ── Barra de anuncio y encabezado ─────────────────────────────────────────
  `${R} aside[aria-label='Aviso de la tienda']{font-weight:700;letter-spacing:.01em;padding-block:.625rem}`,
  // Encabezado de vidrio: deja ver el contenido difuminado al desplazarse (texto ≥ 10:1 aun sobre blanco).
  `${R} header.sf-el-header{background:transparent;isolation:isolate}`,
  `${R} header.sf-el-header:not(.sticky){position:relative}`,
  // El vidrio va en una capa propia: un backdrop-filter en el <header> lo haría
  // contenedor de sus hijos fijos y el menú del celular quedaría atrapado en él.
  `${R} header.sf-el-header::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background:color-mix(in srgb,${N.void} 78%,transparent);-webkit-backdrop-filter:blur(18px) saturate(1.5);backdrop-filter:blur(18px) saturate(1.5)}`,
  `${R} .sf-wordmark{font-family:var(--font-barlow-condensed),'Arial Narrow',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:1.5rem;line-height:.95;color:${N.frost}}`,
  `@media (min-width:640px){${R} .sf-wordmark{font-size:1.75rem}}`,
  // Tableta (640–1023 px): el nombre en dos renglones deja al carrito en la misma fila.
  `@media (min-width:640px) and (max-width:1023px){${R} .sf-wordmark{max-width:9rem;font-size:1.375rem}}`,
  `${R} nav[aria-label='Principal'] :is(a,button){font-weight:600}`,
  `${R} nav[aria-label='Principal'] > ul > li > :is(a,button){position:relative;color:${N.silver}}`,
  `${R} nav[aria-label='Principal'] > ul > li > :is(a,button):hover{color:${N.frost};text-decoration:none}`,
  `${R} nav[aria-label='Principal'] > ul > li > :is(a,button)::after{content:"";position:absolute;left:0;right:0;bottom:.5rem;height:2px;background:${N.alien};transform:scaleX(0);transform-origin:left;transition:transform var(--ad-dur) var(--ad-ease)}`,
  `${R} nav[aria-label='Principal'] > ul > li > :is(a,button):is(:hover,[aria-expanded=true])::after{transform:scaleX(1)}`,
  // Buscador: contorno fino que se enciende en verde al escribir (sin caja verde permanente).
  `${R} header.sf-el-header form[role=search] > div:first-of-type{border-width:1px;border-color:${N.mist};background:${N.deep};transition:border-color var(--ad-dur) var(--ad-ease)}`,
  `${R} header.sf-el-header form[role=search] > div:first-of-type:focus-within{border-color:${N.alien}}`,
  `${R} header.sf-el-header a[href='/carrito'] span[aria-hidden=true]{background:${N.violet};color:${N.white};box-shadow:0 0 0 2px ${N.void}}`,

  // ── Botones ───────────────────────────────────────────────────────────────
  `${R} :is(button,a)[class*='bg-[var(--sf-btn-bg)]']{font-weight:700;letter-spacing:.01em;transition:background-color var(--ad-dur) var(--ad-ease),color var(--ad-dur) var(--ad-ease),border-color var(--ad-dur) var(--ad-ease),transform 120ms var(--ad-ease)}`,
  `${R} :is(button,a)[class*='bg-[var(--sf-btn-bg)]']:not(:disabled):hover{background:${N.alienHi};border-color:${N.alienHi}}`,
  `${R} :is(button,a)[class*='bg-[var(--sf-btn-bg)]']:not(:disabled):active{transform:scale(.985)}`,

  // ── Hero ──────────────────────────────────────────────────────────────────
  `${R} .sf-hero-bg{min-height:clamp(32rem,74svh,46rem);border:1px solid var(--ad-hair);border-radius:var(--sf-radius-panel)}`,
  `${R} .sf-hero-veil{background:linear-gradient(0deg,rgb(9 9 13/.94) 0%,rgb(9 9 13/.78) 42%,rgb(9 9 13/.35) 100%)}`,
  `@media (min-width:768px){${R} .sf-hero-veil{background:linear-gradient(90deg,rgb(9 9 13/.94) 0%,rgb(9 9 13/.8) 40%,rgb(9 9 13/.2) 78%,rgb(9 9 13/.1) 100%)}}`,
  `${R} .sf-hero-body{gap:1.25rem;padding:clamp(2rem,6vw,4.5rem) clamp(1.25rem,5vw,4.5rem)}`,
  `${R} .sf-hero-title{font-size:clamp(3.25rem,1.6rem + 7vw,7.5rem);line-height:.86;font-weight:700;max-width:12ch;color:${N.neon}}`,
  `${R} .sf-hero-sub{font-size:clamp(1rem,.9rem + .4vw,1.1875rem);line-height:1.6;color:${N.silver};max-width:34rem}`,
  `${R} .sf-hero-cta{background:${N.alien};color:${N.void};border-radius:var(--sf-radius-btn);gap:.75rem;padding-inline:2rem;font-weight:700;letter-spacing:.01em;transition:background-color var(--ad-dur) var(--ad-ease)}`,
  `${R} .sf-hero-cta:hover{background:${N.alienHi}}`,
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
  `${R} .sf-benefits > li{background:${N.deep};border:1px solid var(--ad-hair);border-radius:var(--sf-radius-panel);padding:1.5rem;gap:.875rem}`,
  // Ícono dentro de un círculo con el anillo de la marca (mismo motivo que las categorías).
  `${R} .sf-benefits > li > span:first-child{display:grid;place-items:center;width:3rem;height:3rem;border-radius:50%;color:${N.alien};border:2px solid transparent;` +
    `background:linear-gradient(${N.void},${N.void}) padding-box,conic-gradient(from 200deg,${N.alien},${N.glow},${N.violet},${N.alien}) border-box}`,
  `${R} .sf-benefits > li > span:nth-child(2){font:700 1.25rem/1 var(--font-barlow-condensed),'Arial Narrow',sans-serif;text-transform:uppercase;letter-spacing:.01em}`,

  // ── Categorías: círculos con anillo de la marca («portal» verde → morado) ──
  // El anillo es un borde con degradado cónico (fondo en dos capas); la foto queda
  // separada por un aro negro. Al pasar el cursor el anillo gira media vuelta.
  "@property --ad-spin{syntax:'<angle>';inherits:false;initial-value:200deg}",
  `${R} .sf-cat-list > li{width:6.75rem}`,
  `@media (min-width:640px){${R} .sf-cat-list > li{width:auto}${R} .sf-cat-list{gap:2rem 1.5rem}}`,
  `${R} .sf-cat-link{gap:.75rem}`,
  `${R} .sf-cat-media{aspect-ratio:1;border-radius:50%;padding:4px;border:2px solid transparent;box-shadow:none;` +
    `background:linear-gradient(${N.deep},${N.deep}) padding-box,conic-gradient(from var(--ad-spin),${N.alien},${N.glow},${N.violet},${N.alien}) border-box}`,
  `${R} .sf-cat-media img{border-radius:50%;object-fit:cover;padding:0;mix-blend-mode:normal}`,
  `${R} .sf-cat-media svg{color:${N.silver}}`,
  `${R} .sf-cat-link:hover .sf-cat-media{--ad-spin:380deg;box-shadow:0 0 28px -6px color-mix(in srgb,${N.alien} 55%,transparent)}`,
  `${R} .sf-cat-name{font:700 1rem/1.05 var(--font-barlow-condensed),'Arial Narrow',sans-serif;text-transform:uppercase;letter-spacing:.02em;color:${N.frost}}`,
  `${R} .sf-cat-link:hover .sf-cat-name{color:${N.alienHi}}`,
  `@media (prefers-reduced-motion:no-preference){${R} .sf-cat-media{transition:--ad-spin .7s var(--ad-ease),box-shadow var(--ad-dur) var(--ad-ease)}}`,

  // ── Tarjeta de producto ───────────────────────────────────────────────────
  `${R} .sf-card{border:0;background:transparent;padding:0;box-shadow:none;gap:0}`,
  `${R} .sf-card-media{border-radius:var(--sf-radius-card);background:${N.deep};outline:1px solid var(--ad-hair);outline-offset:-1px;transition:outline-color var(--ad-dur) var(--ad-ease)}`,
  `${R} .sf-card:hover .sf-card-media{outline-color:var(--ad-hair-strong)}`,
  `${R} .sf-card-img{object-fit:cover;padding:0;mix-blend-mode:normal}`,
  `${R} .sf-card-brand{margin-top:.875rem;font:700 .875rem/1.2 var(--font-barlow-condensed),'Arial Narrow',sans-serif;letter-spacing:.04em;text-transform:uppercase;color:${N.glow}}`,
  // Dos renglones reservados: los precios quedan alineados en toda la fila.
  `${R} .sf-card-title{font-size:.9375rem;font-weight:600;line-height:1.4;min-height:2.8em;color:${N.frost};text-decoration:none}`,
  `${R} .sf-card:hover .sf-card-title{text-decoration:underline;text-decoration-color:${N.alien};text-decoration-thickness:2px;text-underline-offset:4px}`,
  `${R} .sf-card-price > span:first-child{font-family:var(--font-barlow-condensed),'Arial Narrow',sans-serif;font-weight:700;font-size:1.375rem;letter-spacing:.01em;color:${N.frost}}`,
  `${R} .sf-card-price > span[class*='sf-sale-text']{color:${N.glow}}`,
  // «Agregar» en la tarjeta: contorno fino; se rellena al pasar (la ficha conserva el botón lleno).
  `${R} .sf-card form button{background:transparent;color:${N.frost};border-color:var(--ad-hair-strong);font-weight:700}`,
  `${R} .sf-card form button:not(:disabled):hover{background:${N.alien};border-color:${N.alien};color:${N.void}}`,
  `${R} .sf-card-choose{border-width:1px;border-color:var(--ad-hair-strong);color:${N.frost};font-weight:700}`,
  // Carga: la foto ocupa su lugar desde el inicio (sin saltos); un barrido tenue
  // indica que llega. Se detiene solo, por si la foto tiene transparencia.
  `${R} .sf-card-media{background-image:linear-gradient(100deg,transparent 30%,rgb(200 202 211/.06) 50%,transparent 70%);background-size:220% 100%;background-position:120% 0}`,
  `@keyframes ad-sheen{to{background-position:-120% 0}}`,
  `@media (prefers-reduced-motion:no-preference){${R} .sf-card-media{animation:ad-sheen 1.6s var(--ad-ease) 3}}`,
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
  `${R} .sf-story-cta{color:${N.frost};font-weight:700;text-decoration:underline;text-decoration-color:${N.alien};text-decoration-thickness:2px;text-underline-offset:6px}`,
  `${R} .sf-story-cta:hover{color:${N.alienHi}}`,

  // ── Pie ───────────────────────────────────────────────────────────────────
  `${R} .sf-footer{margin-top:7rem;border-top:0;background-image:linear-gradient(90deg,${N.alien},${N.glow},${N.violet});background-size:100% 2px;background-repeat:no-repeat}`,
  `${R} .sf-footer-name{font-family:var(--font-barlow-condensed),'Arial Narrow',sans-serif;font-weight:700;font-size:clamp(3rem,1rem + 8vw,8.5rem);line-height:.85;text-transform:uppercase;color:${N.neon}}`,
  `${R} .sf-footer :is(h2,h3){font:700 1rem/1.1 var(--font-barlow-condensed),'Arial Narrow',sans-serif;letter-spacing:.04em;text-transform:uppercase;color:${N.mist}}`,
  `${R} .sf-footer a:hover{color:${N.alienHi}}`,
  `${R} .sf-footer [aria-labelledby='sf-pagos'] li{background:transparent;color:${N.silver};border:1px solid var(--ad-hair-strong)}`,

  // ── Ficha de producto ─────────────────────────────────────────────────────
  `${R} nav[aria-label='Ruta de navegación']{font-size:.8125rem}`,
  `@media (min-width:768px){${R} .sf-pdp-grid{grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:4rem}}`,
  // Galería de orilla a orilla: fotos cuadradas llenan su marco como en las tarjetas.
  `${R} .sf-pdp-gallery img{background:${N.deep};padding:0;object-fit:cover}`,
  // «Comprar ahora» queda como acción secundaria (contorno); «Agregar» es la principal.
  `${R} form button[class*='bg-[var(--sf-fg)]']{background:transparent;color:${N.frost};border-color:var(--ad-hair-strong);transition:background-color var(--ad-dur) var(--ad-ease),color var(--ad-dur) var(--ad-ease)}`,
  `${R} form button[class*='bg-[var(--sf-fg)]']:not(:disabled):hover{background:${N.frost};color:${N.void};border-color:${N.frost}}`,
  `${R} .sf-pdp-brand{font:700 1rem/1.1 var(--font-barlow-condensed),'Arial Narrow',sans-serif;letter-spacing:.04em;text-transform:uppercase;color:${N.glow}}`,
  `${R} .sf-pdp-title{font-size:clamp(2.5rem,1.6rem + 3.2vw,4.25rem);line-height:.9;font-weight:700}`,
  `${R} .sf-pdp-price{font-family:var(--font-barlow-condensed),'Arial Narrow',sans-serif;font-weight:700;font-size:2.25rem;letter-spacing:.01em}`,
  `${R} .sf-pdp-facts{border-color:var(--ad-hair);background:${N.deep}}`,
  `${R} .sf-pdp-desc{color:${N.silver}}`,
  `${R} .sf-pdp-desc :is(strong,b){color:${N.frost}}`,
  // Contenido regulatorio: un panel propio, distinguible y sin adornos.
  `${R} .sf-regulatory{border:1px solid var(--ad-hair);border-left:2px solid ${N.glow};background:${N.deep};border-radius:var(--sf-radius-card);padding:1.25rem 1.25rem 1.5rem}`,

  // ── Atmósfera, hero, marcas y testimonios (v3) ────────────────────────────
  // Resplandor tenue de la marca arriba de la página: profundidad sin imágenes.
  `${R}{background-image:radial-gradient(70rem 32rem at 50% -12rem,color-mix(in srgb,${N.violet} 16%,transparent),transparent 70%);background-repeat:no-repeat}`,
  // Tarjeta de producto al pasar: halo verde y la foto se acerca un poco.
  `${R} .sf-card:hover .sf-card-media{outline-color:${N.alien};box-shadow:0 18px 44px -18px color-mix(in srgb,${N.alien} 60%,transparent)}`,
  `@media (prefers-reduced-motion:no-preference){${R} .sf-card-media{transition:outline-color var(--ad-dur) var(--ad-ease),box-shadow .35s var(--ad-ease)}${R} .sf-card:hover .sf-card-img{scale:1.04}}`,
  // Marcas: fichas claras para que cualquier logo (oscuro o claro) se lea.
  `${R} a[href^='/marca/']{background:${N.frost};color:${N.void};border-color:transparent;border-radius:var(--sf-radius-card);transition:box-shadow var(--ad-dur) var(--ad-ease)}`,
  `${R} a[href^='/marca/']:hover{box-shadow:0 0 0 2px ${N.void},0 0 0 4px ${N.alien}}`,
  `${R} a[href^='/marca/'] :is(span,[aria-hidden=true]){color:${N.void}}`,
  // Opiniones y testimonios: paneles con comillas grandes en verde neón.
  `${R} .sf-home figure{background:${N.deep};border:1px solid var(--ad-hair);border-radius:var(--sf-radius-panel);padding:1.75rem}`,
  `${R} .sf-home figure:has(> blockquote:first-child)::before{content:"“";content:"“" / "";display:block;height:2.25rem;font:700 5rem/1 var(--font-barlow-condensed),'Arial Narrow',sans-serif;color:${N.neon}}`,
  `${R} .sf-home figcaption{color:${N.silver}}`,
  `${R} .sf-home figcaption > span:first-child{color:${N.frost};font:700 1.0625rem/1.2 var(--font-barlow-condensed),'Arial Narrow',sans-serif;text-transform:uppercase;letter-spacing:.02em}`,

  // ── Primera impresión: el portal (v4) ─────────────────────────────────────
  // Un solo momento orquestado: al entrar, el anillo de la marca da una vuelta
  // detrás del título y el título se enciende como letrero de neón. Después todo
  // queda quieto (sin movimiento continuo); con «reducir movimiento», nada se anima.
  "@property --ad-orbit{syntax:'<angle>';inherits:false;initial-value:0deg}",
  `${R} .sf-hero-split{position:relative;isolation:isolate;border:1px solid var(--ad-hair);` +
    `background:radial-gradient(1.5px 1.5px at 8% 18%,color-mix(in srgb,${N.frost} 80%,transparent),transparent),radial-gradient(1.5px 1.5px at 17% 62%,color-mix(in srgb,${N.frost} 55%,transparent),transparent),radial-gradient(1.5px 1.5px at 26% 9%,color-mix(in srgb,${N.frost} 70%,transparent),transparent),radial-gradient(1.5px 1.5px at 34% 78%,color-mix(in srgb,${N.frost} 45%,transparent),transparent),radial-gradient(1.5px 1.5px at 43% 30%,color-mix(in srgb,${N.frost} 65%,transparent),transparent),radial-gradient(1.5px 1.5px at 57% 12%,color-mix(in srgb,${N.frost} 50%,transparent),transparent),radial-gradient(1.5px 1.5px at 63% 70%,color-mix(in srgb,${N.frost} 75%,transparent),transparent),radial-gradient(1.5px 1.5px at 71% 38%,color-mix(in srgb,${N.frost} 55%,transparent),transparent),radial-gradient(1.5px 1.5px at 79% 86%,color-mix(in srgb,${N.frost} 60%,transparent),transparent),radial-gradient(1.5px 1.5px at 86% 22%,color-mix(in srgb,${N.frost} 80%,transparent),transparent),radial-gradient(1.5px 1.5px at 92% 55%,color-mix(in srgb,${N.frost} 50%,transparent),transparent),radial-gradient(1.5px 1.5px at 4% 88%,color-mix(in srgb,${N.frost} 45%,transparent),transparent),` +
    `radial-gradient(70% 90% at 50% 0%,color-mix(in srgb,${N.violet} 26%,transparent),transparent 70%),` +
    `radial-gradient(55% 70% at 100% 100%,color-mix(in srgb,${N.alien} 16%,transparent),transparent 70%),${N.deep}}`,
  // El portal: anillo cónico verde → morado (máscara de aro) con halo, centrado tras el título.
  `${R} .sf-hero-split::before{content:"";position:absolute;z-index:-1;left:50%;top:clamp(-9rem,-12vw,-3rem);width:min(118vw,52rem);aspect-ratio:1;translate:-50% 0;border-radius:50%;pointer-events:none;` +
    `background:conic-gradient(from var(--ad-orbit),${N.alien},${N.glow},${N.violet},transparent 62%,${N.alien});` +
    `mask:radial-gradient(closest-side,transparent calc(100% - 3px),black calc(100% - 2px),black 100%,transparent);` +
    `filter:drop-shadow(0 0 18px color-mix(in srgb,${N.alien} 55%,transparent)) drop-shadow(0 0 42px color-mix(in srgb,${N.violet} 45%,transparent));opacity:.9}`,
  // Núcleo del portal: un resplandor verde suave detrás del texto.
  `${R} .sf-hero-split::after{content:"";position:absolute;z-index:-1;left:50%;top:clamp(-4rem,-4vw,0rem);width:min(90vw,36rem);aspect-ratio:1;translate:-50% 0;border-radius:50%;pointer-events:none;` +
    `background:radial-gradient(closest-side,color-mix(in srgb,${N.alien} 18%,transparent),transparent)}`,
  `${R} .sf-hero-split > *{position:relative}`,
  // Título de neón: resplandor del mismo verde (el texto sigue siendo #afff6e, 16:1).
  `${R} .sf-hero-title{text-shadow:0 0 14px color-mix(in srgb,${N.neon} 45%,transparent),0 0 44px color-mix(in srgb,${N.alien} 40%,transparent)}`,
  "@keyframes ad-orbit{from{--ad-orbit:-200deg}to{--ad-orbit:0deg}}",
  "@keyframes ad-portal{from{opacity:0;scale:.82}to{opacity:.9;scale:1}}",
  // Encendido de letrero: dos parpadeos cortos y queda prendido (menos de 1 s; sin destellos rápidos repetidos).
  "@keyframes ad-neon{0%{opacity:.15}12%{opacity:1}18%{opacity:.35}30%{opacity:1}36%{opacity:.55}100%{opacity:1}}",
  "@media (prefers-reduced-motion:no-preference){" +
    `${R} .sf-hero-group > .sf-hero-split::before,${R} .sf-hero-group [aria-roledescription=portada]:first-child .sf-hero-split::before{animation:ad-orbit 2.4s cubic-bezier(.16,1,.3,1) both,ad-portal 1.2s var(--ad-ease) both}` +
    `${R} .sf-hero-group > .sf-hero-split .sf-hero-title,${R} .sf-hero-group [aria-roledescription=portada]:first-child .sf-hero-title{animation:ad-neon .9s linear .35s both}` +
    "}",

  // ── Avisos de la tienda (bloque «Texto» de la portada) ────────────────────
  // Panel con filete de la marca; una lista numerada se lee como pasos con
  // números grandes en círculos verdes (la lista ya es una secuencia).
  `${R} .sf-home > section:has(> .sf-prose){max-width:none;position:relative;padding:clamp(1.5rem,4vw,3rem);border-radius:var(--sf-radius-panel);border:2px solid transparent;` +
    `background:radial-gradient(60% 120% at 0% 0%,color-mix(in srgb,${N.violet} 18%,transparent),transparent 70%) padding-box,linear-gradient(${N.deep},${N.deep}) padding-box,` +
    `linear-gradient(120deg,${N.alien},${N.glow},${N.violet}) border-box}`,
  `${R} .sf-home > section:has(> .sf-prose) .sf-section-title{color:${N.frost};max-width:22ch}`,
  `${R} .sf-home .sf-prose{color:${N.silver};font-size:1.0625rem;line-height:1.65;max-width:none}`,
  `${R} .sf-home .sf-prose > p{max-width:62ch}`,
  `${R} .sf-home .sf-prose strong{color:${N.frost}}`,
  `${R} .sf-home .sf-prose ol{list-style:none;counter-reset:ad-step;padding:0;margin-block:1.5rem;display:grid;gap:1rem}`,
  `@media (min-width:768px){${R} .sf-home .sf-prose ol{grid-template-columns:repeat(3,minmax(0,1fr))}}`,
  `${R} .sf-home .sf-prose ol > li{counter-increment:ad-step;margin:0;padding:1.25rem;border-radius:var(--sf-radius-card);background:${N.void};border:1px solid var(--ad-hair);color:${N.silver}}`,
  `${R} .sf-home .sf-prose ol > li::before{content:counter(ad-step);display:grid;place-items:center;width:2.5rem;height:2.5rem;margin-bottom:.75rem;border-radius:50%;` +
    `font:700 1.375rem/1 var(--font-barlow-condensed),'Arial Narrow',sans-serif;color:${N.void};background:${N.alien};box-shadow:0 0 22px -4px color-mix(in srgb,${N.alien} 70%,transparent)}`,

  // ── Ficha y carrito (v6) ──────────────────────────────────────────────────
  // Sin franja blanca al final cuando la barra fija de compra reserva espacio.
  `body:has(${R}){background:${N.void}}`,
  // Barra fija de compra en el celular: vidrio con filete de la marca arriba.
  `${R} .fixed.inset-x-0.bottom-0.z-30{border-top:0;box-shadow:none;background:linear-gradient(90deg,${N.alien},${N.glow},${N.violet}) top/100% 2px no-repeat,color-mix(in srgb,${N.void} 82%,transparent);` +
    `-webkit-backdrop-filter:blur(18px) saturate(1.5);backdrop-filter:blur(18px) saturate(1.5)}`,
  // Resumen del carrito: panel con filete en degradado; título condensado.
  `${R} aside[aria-label='Resumen']{border:2px solid transparent;border-radius:var(--sf-radius-panel);padding:1.5rem;` +
    `background:radial-gradient(80% 60% at 100% 0%,color-mix(in srgb,${N.violet} 16%,transparent),transparent 70%) padding-box,linear-gradient(${N.deep},${N.deep}) padding-box,` +
    `linear-gradient(140deg,${N.alien},${N.glow},${N.violet}) border-box}`,
  `${R} aside[aria-label='Resumen'] > h2{font:700 1.75rem/1 var(--font-barlow-condensed),'Arial Narrow',sans-serif;text-transform:uppercase;letter-spacing:.01em}`,

  // ── Catálogo (v7) ─────────────────────────────────────────────────────────
  // Ordenar y «Solo disponibles» como píldoras; la casilla marcada se enciende en verde.
  `${R} select[name=orden]{border-radius:999px;padding-inline:1rem 2.25rem;border-color:${N.mist};background-color:${N.deep};font-weight:600}`,
  `${R} label:has(> input[name=disponible]){padding-inline:.875rem 1rem;border:1px solid ${N.mist};border-radius:999px;background:${N.deep};font-weight:600;cursor:pointer;transition:border-color var(--ad-dur) var(--ad-ease),color var(--ad-dur) var(--ad-ease)}`,
  `${R} label:has(> input[name=disponible]:checked){border-color:${N.alien};color:${N.alienHi}}`,
  `${R} input[name=disponible]{accent-color:${N.alien}}`,
  // Cantidad (−/+): píldora con los botones que se encienden en verde al pasar.
  `${R} div:has(> input.sf-qty){border-radius:999px;overflow:hidden;border-color:${N.mist};background:${N.deep}}`,
  `${R} div:has(> input.sf-qty) > button{transition:background-color var(--ad-dur) var(--ad-ease),color var(--ad-dur) var(--ad-ease)}`,
  `${R} div:has(> input.sf-qty) > button:not(:disabled):hover{background:${N.alien};color:${N.void}}`,
  `${R} input.sf-qty{background:transparent;border-color:var(--ad-hair-strong);font-weight:700}`,

  // ── Pedido, vacíos y 404 (v8, fase 1 del plan) ────────────────────────────
  // Pago pendiente: lo más importante de la página. Panel con filete de la marca,
  // los datos de la cuenta en una caja propia y el botón de WhatsApp grande.
  `${R} section[aria-labelledby=pago]{padding:clamp(1.25rem,3vw,2rem);border:2px solid transparent;border-radius:var(--sf-radius-panel);` +
    `background:radial-gradient(70% 90% at 100% 0%,color-mix(in srgb,${N.violet} 18%,transparent),transparent 70%) padding-box,linear-gradient(${N.deep},${N.deep}) padding-box,` +
    `linear-gradient(130deg,${N.alien},${N.glow},${N.violet}) border-box}`,
  `${R} section[aria-labelledby=pago] > p.whitespace-pre-line{font-size:1.0625rem;line-height:1.7;color:${N.frost};font-variant-numeric:tabular-nums;letter-spacing:.01em;` +
    `padding:1rem 1.25rem;border-radius:var(--sf-radius-control);background:${N.void};border:1px solid var(--ad-hair-strong)}`,
  `${R} section[aria-labelledby=pago] > a[href^='https://wa.me']{min-height:3.25rem;padding-inline:1.75rem;font-size:1rem;font-weight:700;` +
    `box-shadow:0 12px 36px -12px color-mix(in srgb,${N.alien} 70%,transparent);transition:background-color var(--ad-dur) var(--ad-ease)}`,
  `${R} section[aria-labelledby=pago] > a[href^='https://wa.me']:hover{background:${N.alienHi}}`,
  `@media (max-width:639px){${R} section[aria-labelledby=pago] > a[href^='https://wa.me']{display:flex;width:100%;text-align:center;padding-block:.625rem}}`,
  // Títulos de las partes del pedido en la letra condensada.
  `${R} :is(h2#pago,h2#productos,h2#envio,h2#retiro,h2#ayuda){font:700 1.5rem/1 var(--font-barlow-condensed),'Arial Narrow',sans-serif;text-transform:uppercase;letter-spacing:.01em}`,
  // Avance del pedido: pasos hechos en verde con halo; el siguiente, en degradado de la marca.
  `${R} ol[aria-label='Avance del pedido'] > li > span[aria-hidden=true]{height:6px}`,
  `${R} ol[aria-label='Avance del pedido'] > li:not([aria-current]) > span[aria-hidden=true][class*='btn-bg)]']{box-shadow:0 0 14px -2px color-mix(in srgb,${N.alien} 70%,transparent)}`,
  `${R} ol[aria-label='Avance del pedido'] > li[aria-current=step] > span[aria-hidden=true]{background:linear-gradient(90deg,${N.alien},${N.glow})}`,
  // 404: el número como letrero de neón dentro de un anillo de la marca.
  `${R} p[aria-hidden=true][class*='sf-font-heading']{position:relative;isolation:isolate;display:inline-block;padding:.12em .3em;font-weight:700;color:${N.neon};` +
    `text-shadow:0 0 14px color-mix(in srgb,${N.neon} 45%,transparent),0 0 44px color-mix(in srgb,${N.alien} 40%,transparent)}`,
  `${R} p[aria-hidden=true][class*='sf-font-heading']::before{content:"";position:absolute;z-index:-1;inset:50% auto auto 50%;width:1.75em;aspect-ratio:1;translate:-50% -50%;border-radius:50%;` +
    `background:conic-gradient(from 200deg,${N.alien},${N.glow},${N.violet},${N.alien});mask:radial-gradient(closest-side,transparent calc(100% - 3px),black calc(100% - 2px),black 100%,transparent);opacity:.85;` +
    `filter:drop-shadow(0 0 16px color-mix(in srgb,${N.violet} 55%,transparent))}`,
  // Carrito vacío: el anillo de la marca, vacío, encima del título.
  `${R} section.text-center:has(> h1 + p + a[href='/productos'])::before{content:"";display:block;width:6rem;aspect-ratio:1;margin:0 auto 1.5rem;border-radius:50%;` +
    `background:conic-gradient(from 200deg,${N.alien},${N.glow},${N.violet},${N.alien});mask:radial-gradient(closest-side,transparent calc(100% - 4px),black calc(100% - 3px),black 100%,transparent);` +
    `filter:drop-shadow(0 0 18px color-mix(in srgb,${N.alien} 50%,transparent))}`,
  // Botón flotante de WhatsApp (fase 3): anillo de la marca alrededor del verde de WhatsApp.
  `${R} .sf-whatsapp{box-shadow:0 0 0 3px ${N.void},0 0 0 5px ${N.violet},0 10px 30px -6px color-mix(in srgb,${N.alien} 60%,transparent)}`,

  // ── Menú del celular (v9, fase 3 del plan) ────────────────────────────────
  // Vidrio con el resplandor de la marca; secciones en la letra condensada grande;
  // fotos de categoría en círculo con anillo. Entra deslizándose (@starting-style).
  `${R} div[role=dialog][aria-label='Menú']{background:radial-gradient(90% 50% at 0% 0%,color-mix(in srgb,${N.violet} 22%,transparent),transparent 70%),` +
    `radial-gradient(70% 40% at 100% 100%,color-mix(in srgb,${N.alien} 14%,transparent),transparent 70%),color-mix(in srgb,${N.void} 90%,transparent);` +
    `-webkit-backdrop-filter:blur(20px) saturate(1.4);backdrop-filter:blur(20px) saturate(1.4)}`,
  `${R} div[role=dialog][aria-label='Menú'] > div:first-child{background:transparent;border-bottom:0;background-image:linear-gradient(90deg,${N.alien},${N.glow},${N.violet});background-size:100% 2px;background-position:bottom;background-repeat:no-repeat}`,
  `${R} div[role=dialog][aria-label='Menú'] > div:first-child > p{font:700 1.75rem/1 var(--font-barlow-condensed),'Arial Narrow',sans-serif;text-transform:uppercase}`,
  `${R} div[role=dialog][aria-label='Menú'] nav a.min-h-14{font:700 1.625rem/1.1 var(--font-barlow-condensed),'Arial Narrow',sans-serif;text-transform:uppercase;letter-spacing:.01em;gap:.875rem;transition:color var(--ad-dur) var(--ad-ease)}`,
  `${R} div[role=dialog][aria-label='Menú'] nav a.min-h-14:hover{color:${N.alienHi}}`,
  `${R} div[role=dialog][aria-label='Menú'] nav a img{width:2.5rem;height:2.5rem;border-radius:50%;object-fit:cover;padding:2px;` +
    `background:conic-gradient(from 200deg,${N.alien},${N.glow},${N.violet},${N.alien})}`,
  "@media (prefers-reduced-motion:no-preference){" +
    `${R} div[role=dialog][aria-label='Menú']{transition:opacity .25s var(--ad-ease),translate .3s var(--ad-ease)}` +
    `@starting-style{${R} div[role=dialog][aria-label='Menú']{opacity:0;translate:-16px 0}}` +
    "}",

  // ── Checkout (v10) ────────────────────────────────────────────────────────
  // Secciones en la letra condensada; envío y forma de pago como tarjetas que se
  // encienden en verde al elegirlas; resumen con el filete de la marca.
  `${R} form fieldset > legend.text-lg{font:700 1.5rem/1 var(--font-barlow-condensed),'Arial Narrow',sans-serif;text-transform:uppercase;letter-spacing:.01em;margin-bottom:.25rem}`,
  `${R} label:has(> input:is([name=payment_account_id],[name=shipping_rate_id])){padding:1rem 1.125rem;border-color:${N.mist};border-radius:var(--sf-radius-control);background:${N.deep};font-size:1rem;font-weight:600;cursor:pointer;` +
    `transition:border-color var(--ad-dur) var(--ad-ease),box-shadow var(--ad-dur) var(--ad-ease),background-color var(--ad-dur) var(--ad-ease)}`,
  `${R} label:has(> input:is([name=payment_account_id],[name=shipping_rate_id]):checked){border-color:${N.alien};background:color-mix(in srgb,${N.alien} 10%,${N.deep});box-shadow:0 0 0 1px ${N.alien},0 10px 30px -14px color-mix(in srgb,${N.alien} 70%,transparent)}`,
  `${R} label:has(> input:is([name=payment_account_id],[name=shipping_rate_id])) > input{accent-color:${N.alien};width:1.125rem;height:1.125rem}`,
  `${R} aside[aria-label='Resumen del pedido']{border:2px solid transparent;border-radius:var(--sf-radius-panel);padding:1.5rem;` +
    `background:radial-gradient(80% 60% at 100% 0%,color-mix(in srgb,${N.violet} 16%,transparent),transparent 70%) padding-box,linear-gradient(${N.deep},${N.deep}) padding-box,` +
    `linear-gradient(140deg,${N.alien},${N.glow},${N.violet}) border-box}`,
  `${R} aside[aria-label='Resumen del pedido'] > h2{font:700 1.75rem/1 var(--font-barlow-condensed),'Arial Narrow',sans-serif;text-transform:uppercase;letter-spacing:.01em}`,
  // En el celular, durante el pago, el botón flotante de WhatsApp tapaba campos del formulario.
  `@media (max-width:639px){${R}:has(input[name=payment_account_id]) .sf-whatsapp{display:none}}`,

  // ── Cuenta regresiva al corte de envío (v11) ──────────────────────────────
  `${R} .sf-cutoff{background:linear-gradient(90deg,color-mix(in srgb,${N.alien} 14%,${N.deep}),${N.deep} 50%,color-mix(in srgb,${N.violet} 14%,${N.deep}));` +
    `border-bottom:1px solid var(--ad-hair);color:${N.frost};font-weight:600;letter-spacing:.01em}`,
  `${R} .sf-cutoff-clock{display:inline-block;min-width:4.5ch;padding:.05rem .5rem;border-radius:999px;background:${N.void};border:1px solid ${N.alien};` +
    `font:700 1.0625rem/1.2 var(--font-barlow-condensed),'Arial Narrow',sans-serif;color:${N.neon};text-shadow:0 0 10px color-mix(in srgb,${N.neon} 45%,transparent)}`,

  // ── Lo más nuevo de CSS (v5) ──────────────────────────────────────────────
  // Holograma al pasar el cursor: un brillo iridiscente cruza la foto como el
  // foil de un empaque o una carta coleccionable (solo degradados y mezcla de color).
  `${R} .sf-card-media::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;` +
    `background:linear-gradient(115deg,transparent 18%,color-mix(in srgb,${N.neon} 55%,transparent) 34%,color-mix(in srgb,${N.glow} 55%,transparent) 44%,color-mix(in srgb,${N.frost} 60%,transparent) 50%,color-mix(in srgb,${N.violet} 55%,transparent) 57%,color-mix(in srgb,${N.alien} 50%,transparent) 67%,transparent 82%);background-size:260% 260%;background-position:100% 100%;mix-blend-mode:color-dodge;opacity:0}`,
  `${R} .sf-card:hover .sf-card-media::after{opacity:.6;background-position:0% 0%}`,
  // CTA del hero: halo verde al pasar, como si el portal lo iluminara.
  `${R} .sf-hero-cta:hover{box-shadow:0 0 0 2px ${N.void},0 0 0 4px ${N.neon},0 12px 40px -8px color-mix(in srgb,${N.alien} 70%,transparent)}`,
  // Precios con cifras de ancho fijo: no «bailan» entre tarjetas.
  `${R} :is(.sf-card-price,.sf-pdp-price){font-variant-numeric:tabular-nums}`,
  // Barra de avance de lectura en el encabezado, ligada al desplazamiento
  // (animación por desplazamiento, sin JS). Solo donde el navegador la soporta.
  "@keyframes ad-progress{from{transform:scaleX(0)}to{transform:scaleX(1)}}",
  "@media (prefers-reduced-motion:no-preference){@supports (animation-timeline:scroll()){" +
    `${R} header.sf-el-header::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;transform-origin:left;pointer-events:none;` +
    `background:linear-gradient(90deg,${N.alien},${N.glow},${N.violet});animation:ad-progress linear both;animation-timeline:scroll(root)}` +
    "}}",
  "@media (prefers-reduced-motion:no-preference){" +
    `${R} .sf-card-media::after{transition:opacity .35s var(--ad-ease),background-position .9s var(--ad-ease)}` +
    "}",

  // ── Movimiento (CSS, sin bibliotecas) ─────────────────────────────────────
  "@keyframes ad-in{from{opacity:.001;transform:translateY(10px)}to{opacity:1;transform:none}}",
  "@media (prefers-reduced-motion:no-preference){" +
    `${R} .sf-hero-body>*{animation:ad-in .7s var(--ad-ease) both}` +
    `${R} .sf-hero-body>:nth-child(2){animation-delay:.08s}` +
    `${R} .sf-hero-body>:nth-child(3){animation-delay:.16s}` +
    `${R} .sf-card-img{transition:scale .6s var(--ad-ease)}` +
    "}",
  // ── Sobriedad (v12): tus fotos y la portada son las protagonistas ─────────
  // Las imágenes de la tienda ya traen neón, humo y logos; un marco que brilla
  // en todos lados compite con ellas y se ve de plantilla. Va al final para
  // ganar sobre lo anterior: queda un solo resplandor (el portal) y el resto
  // usa filetes y color, sin halos.
  `${R}{background-image:radial-gradient(70rem 32rem at 50% -12rem,color-mix(in srgb,${N.violet} 9%,transparent),transparent 70%)}`,
  `${R} .sf-hero-title{text-shadow:0 0 22px color-mix(in srgb,${N.neon} 22%,transparent)}`,
  `${R} .sf-hero-split::before{filter:drop-shadow(0 0 16px color-mix(in srgb,${N.alien} 35%,transparent))}`,
  // Con foto en la portada: sin estrellas, la foto ya llena el espacio.
  `${R} .sf-hero-split:has(img){background:radial-gradient(70% 70% at 50% 0%,color-mix(in srgb,${N.violet} 18%,transparent),transparent 70%),${N.deep}}`,
  `${R} .sf-hero-cta:hover{box-shadow:0 0 0 2px ${N.void},0 0 0 4px ${N.neon}}`,
  `${R} .sf-cat-link:hover .sf-cat-media{box-shadow:none}`,
  `${R} .sf-card:hover .sf-card-media{box-shadow:none}`,
  `${R} .sf-card:hover .sf-card-media::after{opacity:.3}`,
  // Paneles: el filete de la marca sólo en lo que importa (aviso y pago); los
  // resúmenes, en un panel liso.
  `${R} .sf-home > section:has(> .sf-prose),${R} section[aria-labelledby=pago]{background:linear-gradient(${N.deep},${N.deep}) padding-box,linear-gradient(120deg,${N.alien},${N.glow},${N.violet}) border-box}`,
  `${R} :is(aside[aria-label='Resumen'],aside[aria-label='Resumen del pedido']){border:1px solid var(--ad-hair-strong);background:${N.deep}}`,
  `${R} .sf-home .sf-prose ol > li::before{box-shadow:none}`,
  `${R} section[aria-labelledby=pago] > a[href^='https://wa.me']{box-shadow:none}`,
  `${R} ol[aria-label='Avance del pedido'] > li > span[aria-hidden=true]{box-shadow:none}`,
  `${R} label:has(> input:is([name=payment_account_id],[name=shipping_rate_id]):checked){box-shadow:0 0 0 1px ${N.alien}}`,
  `${R} .sf-whatsapp{box-shadow:0 0 0 3px ${N.void},0 0 0 5px ${N.violet}}`,
  `${R} p[aria-hidden=true][class*='sf-font-heading']{text-shadow:0 0 22px color-mix(in srgb,${N.neon} 22%,transparent)}`,
  `${R} p[aria-hidden=true][class*='sf-font-heading']::before,${R} section.text-center:has(> h1 + p + a[href='/productos'])::before{filter:none}`,
  `${R} div[role=dialog][aria-label='Menú']{background:radial-gradient(90% 50% at 0% 0%,color-mix(in srgb,${N.violet} 12%,transparent),transparent 70%),color-mix(in srgb,${N.void} 92%,transparent)}`,
  `${R} .sf-cutoff{background:${N.deep}}`,
  `${R} .sf-cutoff-clock{text-shadow:none}`,
  // Logo: tu logo es JPG con fondo negro; «aclarar» lo funde con el encabezado
  // (sin rectángulo) y se muestra más grande para que se lea.
  `${R} header.sf-el-header a[href='/'] > img{mix-blend-mode:lighten;height:3rem;max-width:7.5rem}`,
  `@media (min-width:640px){${R} header.sf-el-header a[href='/'] > img{height:3.5rem;max-width:9rem}}`,
  // Emblema + nombre (cuando la tienda tiene logo): el logo en insignia se ve
  // como emblema y el nombre se lee en la letra de la marca.
  `${R} header.sf-el-header a[href='/']:has(> .sf-wordmark-lockup){gap:.625rem}`,
  `${R} header.sf-el-header a[href='/']:has(> .sf-wordmark-lockup) > img{height:2.75rem;max-width:4.25rem}`,
  `${R} .sf-wordmark-lockup{font-size:1.0625rem;line-height:1;max-width:7rem;color:${N.frost}}`,
  `@media (min-width:640px){${R} header.sf-el-header a[href='/']:has(> .sf-wordmark-lockup) > img{height:3.25rem;max-width:5rem}${R} .sf-wordmark-lockup{font-size:1.375rem;max-width:none}}`,
  `@media (min-width:640px) and (max-width:1023px){${R} .sf-wordmark-lockup{max-width:8rem;font-size:1.125rem}}`,
  // Portada con foto propia: la foto es la protagonista; el título baja un poco
  // y el anillo se achica para no competir con ella.
  `${R} .sf-hero-split:has(img) .sf-hero-title{font-size:clamp(2.25rem,1.5rem + 3.2vw,4.5rem);max-width:16ch}`,
  `${R} .sf-hero-split:has(img)::before{width:min(110vw,40rem);top:clamp(-8rem,-10vw,-3rem)}`,
  // Aviso en el celular: pasos en fila (número a la izquierda) y título más corto
  // de alto; el aviso pasa de pantalla y media a menos de una.
  "@media (max-width:767px){" +
    `${R} .sf-home > section:has(> .sf-prose) .sf-section-title{font-size:clamp(1.75rem,1.3rem + 2vw,2.25rem)}` +
    `${R} .sf-home .sf-prose ol{gap:.625rem;margin-block:1.25rem}` +
    `${R} .sf-home .sf-prose ol > li{position:relative;min-height:4rem;padding:.875rem 1rem .875rem 4rem}` +
    `${R} .sf-home .sf-prose ol > li::before{position:absolute;left:1rem;top:.875rem;width:2.25rem;height:2.25rem;margin:0;font-size:1.125rem}` +
    "}",
  // Vidrio un poco más opaco: el negro del logo JPG se funde sin dejar recuadro.
  `${R} header.sf-el-header::before{background:color-mix(in srgb,${N.void} 92%,transparent)}`,
  // ── Buscador y aviso del carrito (v14) ───────────────────────────────────
  // Sugerencias: panel de vidrio oscuro; la opción activa en verde; fotos con
  // esquinas suaves; títulos de grupo en la letra condensada.
  `${R} [role=listbox][aria-label=Sugerencias]{background:color-mix(in srgb,${N.deep} 94%,transparent);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4);` +
    `border:1px solid var(--ad-hair-strong);border-radius:var(--sf-radius-panel);padding:.5rem;box-shadow:0 24px 60px -24px rgb(0 0 0/.8)}`,
  `${R} [role=listbox][aria-label=Sugerencias] [role=group] > div:first-child{font:700 .875rem/1 var(--font-barlow-condensed),'Arial Narrow',sans-serif;letter-spacing:.04em;color:${N.mist}}`,
  `${R} [role=listbox][aria-label=Sugerencias] [role=option]{border-radius:var(--sf-radius-control);padding:.5rem .625rem}`,
  `${R} [role=listbox][aria-label=Sugerencias] [role=option][aria-selected=true]{outline:1px solid ${N.alien};background:color-mix(in srgb,${N.alien} 12%,${N.deep})}`,
  `${R} [role=listbox][aria-label=Sugerencias] [role=option] img{width:2.75rem;height:2.75rem;border-radius:.625rem}`,
  // «Se agregó a tu carrito»: panel oscuro con palomita verde, en lugar de la caja blanca.
  `${R} div[aria-live=polite].fixed.bottom-0.z-40 > div{background:${N.deep};color:${N.frost};border:1px solid var(--ad-hair-strong);border-left:3px solid ${N.alien};border-radius:var(--sf-radius-card);box-shadow:0 18px 40px -18px rgb(0 0 0/.8)}`,
  `${R} div[aria-live=polite].fixed.bottom-0.z-40 > div > svg{color:${N.alien}}`,
  `${R} div[aria-live=polite].fixed.bottom-0.z-40 a{color:${N.alienHi};text-decoration-color:${N.alien}}`,
  `${R} div[aria-live=polite].fixed.bottom-0.z-40 > div :focus-visible{outline-color:${N.glow}}`,
  "@media (prefers-reduced-motion:no-preference){" +
    `${R} div[aria-live=polite].fixed.bottom-0.z-40 > div{transition:opacity .25s var(--ad-ease),translate .3s var(--ad-ease)}` +
    `@starting-style{${R} div[aria-live=polite].fixed.bottom-0.z-40 > div{opacity:0;translate:0 12px}}` +
    "}",
  // El campo del buscador ya muestra el foco en su contorno verde: sin segundo marco.
  `${R} form[role=search] > div:first-of-type input:focus-visible{outline:none}`,
].join("");

const LOOK_CSS: Record<StoreLook, string> = { nocturno: NOCTURNO_CSS };

/** CSS fijo del look (va en el <style> con nonce del layout). */
export function lookCss(look: StoreLook): string {
  return LOOK_CSS[look];
}
