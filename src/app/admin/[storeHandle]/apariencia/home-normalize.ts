import "server-only";

import { HomeSectionsV2 } from "@/lib/theme/schema";
import { parseVideoLink } from "@/lib/theme/video";
import { sanitizeMerchantHtml } from "@/server/security/sanitize";

import { normalizeLink } from "./patch";

/**
 * Secciones del editor → lo que se guarda (F9-T02): textos recortados,
 * opcionales vacíos fuera, enlaces normalizados y HTML de `rich_text` sanitizado
 * (la base vuelve a validar todo, y `SafeHtml` sanitiza otra vez al mostrar).
 */
type Json = Record<string, unknown>;

function clean(value: unknown, multiline = false): unknown {
  if (typeof value !== "string") return value;
  if (!multiline) return value.replace(/\s+/g, " ").trim();
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MULTILINE = new Set(["body", "quote", "answer"]);

const REQUIRED_TEXT: Record<string, string[]> = {
  hero: ["heading"],
  featured_products: ["title"],
  category_grid: ["title"],
  image_with_text: ["heading", "body"],
  brand_logos: ["title"],
  testimonials: ["title"],
  faq: ["title"],
  goals: ["title"],
  reviews: ["title"],
  video: ["title", "video_id"],
  contact_map: ["title"],
};

/** Renglones de cada bloque con lista: solo sus campos, recortados. */
function cleanItem(type: string, item: Json): Json {
  const out: Json = {};
  if (type === "faq") {
    out.question = clean(item.question);
    out.answer = clean(item.answer, true);
  } else if (type === "benefits") {
    out.icon = item.icon;
    out.title = clean(item.title);
    const text = clean(item.text);
    if (text) out.text = text;
  } else {
    out.quote = clean(item.quote, true);
    out.author = clean(item.author);
    const detail = clean(item.detail);
    if (detail) out.detail = detail;
  }
  return out;
}

/** Una portada extra del hero: textos recortados, opcionales vacíos fuera. */
function cleanSlide(slide: Json): Json {
  const out: Json = { heading: clean(slide.heading) };
  for (const key of ["subheading", "image_media_id", "mobile_image_media_id"]) {
    const v = clean(slide[key]);
    if (typeof v === "string" && v) out[key] = v;
  }
  const cta = (slide.cta ?? {}) as Json;
  const label = clean(cta.label);
  const link = typeof cta.link === "string" ? normalizeLink(cta.link) : "";
  if (label || link) out.cta = { label, link };
  return out;
}

/** Punto focal: dos enteros de 0 a 100 (lo demás se descarta). */
function cleanFocal(value: unknown): Json | null {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as Json;
  const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  if (!ok(x) || !ok(y)) return null;
  const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));
  return { x: clamp(x as number), y: clamp(y as number) };
}

/** Una imagen de la portada de imágenes: solo sus campos; opcionales vacíos fuera. */
function cleanImageSlide(slide: Json): Json {
  const out: Json = { image_media_id: clean(slide.image_media_id), alt: clean(slide.alt) };
  const mobile = clean(slide.mobile_image_media_id);
  if (typeof mobile === "string" && mobile) out.mobile_image_media_id = mobile;
  const link = typeof slide.link === "string" ? normalizeLink(slide.link) : "";
  if (link) out.link = link;
  for (const key of ["focal", "mobile_focal"]) {
    const focal = cleanFocal(slide[key]);
    if (focal) out[key] = focal;
  }
  for (const key of ["starts_at", "ends_at"]) {
    if (typeof slide[key] === "string" && slide[key]) out[key] = slide[key];
  }
  return out;
}

const FIELD_LABELS: Record<string, string> = {
  heading: "Título",
  title: "Título",
  subheading: "Subtítulo",
  text: "Texto",
  body: "Texto",
  image_media_id: "Imagen",
  source: "Productos",
  limit: "Cantidad",
  cta: "Botón",
  category_ids: "Categorías",
  brand_ids: "Marcas",
  items: "Renglones",
  html: "Contenido",
  align: "Alineación",
  image_position: "Posición de la imagen",
  value_ids: "Objetivos",
  provider: "Video",
  video_id: "Video",
  caption: "Pie del video",
  layout: "Diseño",
  visibility: "Dónde se ve",
  starts_at: "Mostrar desde",
  ends_at: "Mostrar hasta",
  mobile_image_media_id: "Imagen para el celular",
  slides: "Portadas que rotan",
  alt: "Texto alternativo",
  link: "Destino",
  interval_seconds: "Segundos entre imágenes",
  transition: "Transición",
  focal: "Punto focal",
  mobile_focal: "Punto focal en el celular",
  autoplay: "Rotación",
};

/** Recorta textos, quita opcionales vacíos, normaliza enlaces y sanitiza el HTML. */
export function normalizeSections(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  return input.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const section = raw as Json;
    const props = { ...((section.props as Json) ?? {}) };
    for (const [key, value] of Object.entries(props)) {
      if (key === "html") {
        props.html = sanitizeMerchantHtml(typeof value === "string" ? value : "");
      } else if (key === "cta") {
        const cta = (value ?? {}) as Json;
        const label = clean(cta.label);
        const link = typeof cta.link === "string" ? normalizeLink(cta.link) : "";
        if (!label && !link) delete props.cta;
        else props.cta = { label, link };
      } else if (key === "slides" && Array.isArray(value) && section.type === "image_carousel") {
        // Portada de imágenes: la lista vacía se deja para que el esquema pida una imagen.
        props.slides = value.map((slide: Json) => cleanImageSlide(slide ?? {}));
      } else if (key === "slides" && Array.isArray(value)) {
        // Portadas extra del hero (tema v3): mismas reglas que el hero.
        const slides = value.map((slide: Json) => cleanSlide(slide ?? {}));
        if (slides.length === 0) {
          delete props.slides;
          delete props.autoplay;
        } else props.slides = slides;
      } else if (key === "items" && Array.isArray(value)) {
        props.items = value.map((item: Json) => cleanItem(String(section.type), item ?? {}));
      } else if (key === "video_id" && typeof value === "string") {
        // Se acepta el enlace completo: se guarda solo el código (ADR-034).
        const parsed = parseVideoLink(value);
        if (parsed) {
          props.provider = parsed.provider;
          props.video_id = parsed.id;
        } else props.video_id = clean(value);
      } else if (typeof value === "string") {
        const v = clean(value, MULTILINE.has(key));
        // Vacío: se quita si es opcional; si es obligatorio se deja para que el
        // esquema diga qué falta.
        if (v === "" && !REQUIRED_TEXT[String(section.type)]?.includes(key)) delete props[key];
        else props[key] = v;
      } else if (Array.isArray(value) && value.length === 0 && key === "category_ids") {
        delete props[key];
      }
    }
    // Comunes (ADR-034): «en todos los dispositivos» y sin fechas es lo de siempre.
    const out: Json = { ...section, props };
    if (out.visibility === "all" || out.visibility === "") delete out.visibility;
    if (out.spacing === "normal" || out.spacing === "") delete out.spacing;
    for (const key of ["starts_at", "ends_at"]) {
      if (out[key] === "" || out[key] === null) delete out[key];
    }
    return out;
  });
}

export function sectionIssues(input: unknown): Record<string, string[]> | string | null {
  const parsed = HomeSectionsV2.safeParse(input);
  if (parsed.success) return null;
  const sections = Array.isArray(input) ? (input as Json[]) : [];
  const out: Record<string, string[]> = {};
  let general: string | null = null;
  for (const issue of parsed.error.issues) {
    const index = typeof issue.path[0] === "number" ? issue.path[0] : null;
    const id = index !== null ? String(sections[index]?.id ?? "") : "";
    if (!id) {
      general ??= issue.message;
      continue;
    }
    // Campo de las props (path[2]) o de la sección misma (vigencia, visibilidad).
    const key =
      issue.path[1] === "props"
        ? issue.path[2]
        : typeof issue.path[1] === "string"
          ? issue.path[1]
          : undefined;
    let field = typeof key === "string" ? FIELD_LABELS[key] : undefined;
    // Portada de imágenes: «Imagen 2, Texto alternativo: …» (cuál y qué campo).
    if (
      sections[index!]?.type === "image_carousel" &&
      key === "slides" &&
      typeof issue.path[3] === "number"
    ) {
      const inner = typeof issue.path[4] === "string" ? FIELD_LABELS[issue.path[4]] : undefined;
      field = `Imagen ${issue.path[3] + 1}${inner ? `, ${inner}` : ""}`;
    } else if (sections[index!]?.type === "image_carousel" && key === "slides") {
      field = "Imágenes";
    }
    const message = field ? `${field}: ${issue.message}` : issue.message;
    const list = (out[id] ??= []);
    if (!list.includes(message)) list.push(message);
  }
  return Object.keys(out).length ? out : (general ?? "Revisa las secciones.");
}
