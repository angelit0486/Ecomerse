/** Formatos de imagen aceptados (GATE0 §25.1): sin SVG ni GIF. Compartido con la UI. */
export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export type ImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

/** Tamaño máximo de subida: 10 MB (branding 2 MB). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_BRANDING_UPLOAD_BYTES = 2 * 1024 * 1024;
