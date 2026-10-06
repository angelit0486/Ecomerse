import "server-only";

import sanitizeHtml from "sanitize-html";

/**
 * Sanitización del HTML del comerciante (GATE0 §44.16, amenaza T-06): lista
 * blanca de etiquetas de texto, sin atributos salvo `href` en enlaces, sin
 * estilos, clases, ids, imágenes, iframes, formularios ni scripts. Se aplica al
 * guardar (servidor) y SIEMPRE al renderizar (`SafeHtml`): la RPC también se
 * puede llamar directamente por la Data API, así que lo guardado no es de fiar.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "h2",
    "h3",
    "h4",
    "blockquote",
    "hr",
    "a",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  // `rel` lo fija la transformación de `a` (sobrescribe el del comerciante).
  allowedAttributes: { a: ["href", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  allowedStyles: {},
  allowVulnerableTags: false,
  // Lo prohibido se descarta con su contenido cuando es código o incrustado.
  disallowedTagsMode: "discard",
  nonTextTags: [
    "script",
    "style",
    "textarea",
    "option",
    "noscript",
    "template",
    "iframe",
    "object",
    "embed",
    "svg",
    "math",
  ],
  transformTags: {
    // Enlaces del comerciante: sin `window.opener` ni traspaso de reputación.
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: "nofollow noopener noreferrer ugc" },
    }),
    h1: "h2",
  },
  parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
};

export const MAX_DESCRIPTION_BYTES = 102_400;

export function sanitizeMerchantHtml(input: string | null | undefined): string {
  if (!input) return "";
  return sanitizeHtml(input, OPTIONS).trim();
}
