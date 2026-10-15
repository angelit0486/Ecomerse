/**
 * Enlaces configurables por la tienda (F9-DESIGN §2.4 y §13 H2). Gramática
 * anclada y sin extraer el host: la misma expresión vive en SQL
 * (`app.theme_link_valid` / `app.theme_social_url_valid`) y la prueba de paridad
 * compara ambas con los mismos casos. Nunca `http:`, `javascript:`, `data:`,
 * usuario, puerto, mayúsculas en el host, IDN ni `/\` (que el navegador
 * convierte en `//otro-sitio`).
 */

const PATH_CHARS = "A-Za-z0-9._~!$&'()*+,;=:@%/?#-";

/** Ruta interna: empieza con una sola `/`; no `//`, `/\` ni sus formas codificadas. */
export const INTERNAL_PATH_RE = new RegExp(`^/(?![/]|%5[cC]|%2[fF])[${PATH_CHARS}]*$`);

const LABEL = "[a-z0-9]([a-z0-9-]*[a-z0-9])?";

/** `https://` + host en minúsculas con al menos un punto, sin usuario ni puerto, + ruta opcional. */
export const EXTERNAL_URL_RE = new RegExp(`^https://${LABEL}(\\.${LABEL})+(/[${PATH_CHARS}]*)?$`);

export const MAX_LINK_LENGTH = 500;

export function isValidLink(value: string): boolean {
  return (
    value.length <= MAX_LINK_LENGTH && (INTERNAL_PATH_RE.test(value) || EXTERNAL_URL_RE.test(value))
  );
}

export function isExternalLink(value: string): boolean {
  return EXTERNAL_URL_RE.test(value);
}

export const SOCIAL_NETWORKS = [
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "whatsapp",
  "pinterest",
  "linkedin",
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/** Dominios de cada red (el host debe ser uno de ellos o un subdominio). */
export const SOCIAL_DOMAINS: Record<SocialNetwork, readonly string[]> = {
  facebook: ["facebook.com", "fb.com"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  youtube: ["youtube.com", "youtu.be"],
  x: ["x.com", "twitter.com"],
  whatsapp: ["wa.me", "whatsapp.com"],
  pinterest: ["pinterest.com", "pin.it"],
  linkedin: ["linkedin.com"],
};

function escapeDomain(domain: string): string {
  return domain.replaceAll(".", "\\.");
}

export function socialUrlRegex(network: SocialNetwork): RegExp {
  const domains = SOCIAL_DOMAINS[network].map(escapeDomain).join("|");
  return new RegExp(`^https://([a-z0-9-]+\\.)*(${domains})(/[${PATH_CHARS}]*)?$`);
}

export function isValidSocialUrl(network: SocialNetwork, url: string): boolean {
  return url.length <= MAX_LINK_LENGTH && socialUrlRegex(network).test(url);
}
