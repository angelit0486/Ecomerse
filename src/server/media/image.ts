import "server-only";

import sharp, { type Metadata } from "sharp";

import type { ImageMime } from "@/lib/media/constants";

/**
 * Validación y re-codificación de imágenes subidas (GATE0 §25.3.4). Nunca se
 * publica el archivo del usuario: se decodifica y se vuelve a codificar, lo que
 * descarta EXIF y metadatos, cualquier contenido añadido (polyglots) y todo lo
 * que no sea píxeles.
 */
export type { ImageMime };

/** Máximo por lado del archivo publicado. */
export const MAX_IMAGE_SIDE = 4096;
/** Límite de píxeles de ENTRADA: corta las bombas de descompresión antes de decodificar. */
export const MAX_INPUT_PIXELS = 40_000_000;
export const SHARP_TIMEOUT_SECONDS = 15;

export type RejectionReason =
  "too_large" | "unsupported_format" | "mime_mismatch" | "too_many_pixels" | "decode_failed";

export type ProcessResult =
  | { ok: true; data: Buffer; width: number; height: number; mime: ImageMime }
  | { ok: false; reason: RejectionReason };

sharp.cache(false);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Tipo real según los magic bytes; null si no es un formato permitido. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  // ISO-BMFF: caja ftyp con la marca avif/avis (principal o compatible).
  if (bytes.length >= 16 && ascii(bytes, 4, 8) === "ftyp") {
    const boxSize = Math.min(
      ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0,
      bytes.length,
      256,
    );
    const brands = [ascii(bytes, 8, 12)];
    for (let offset = 16; offset + 4 <= boxSize; offset += 4)
      brands.push(ascii(bytes, offset, offset + 4));
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
  }
  return null;
}

function pixelLimitError(error: unknown): boolean {
  return error instanceof Error && /pixel limit/i.test(error.message);
}

const SHARP_FORMAT: Record<ImageMime, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "heif",
};

/**
 * Valida y re-codifica. `declaredMime` es el MIME reservado en `media`; debe
 * coincidir con los magic bytes y con el decodificador de sharp.
 */
export async function processImage(
  input: Buffer,
  declaredMime: string,
  maxBytes: number,
): Promise<ProcessResult> {
  if (input.length === 0 || input.length > maxBytes) return { ok: false, reason: "too_large" };
  const sniffed = sniffImageMime(input);
  if (!sniffed) return { ok: false, reason: "unsupported_format" };
  if (sniffed !== declaredMime) return { ok: false, reason: "mime_mismatch" };

  const options = {
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: "error",
    sequentialRead: true,
  } as const;
  let metadata: Metadata;
  try {
    metadata = await sharp(input, options).metadata();
  } catch (error) {
    return { ok: false, reason: pixelLimitError(error) ? "too_many_pixels" : "decode_failed" };
  }
  // Defensa en profundidad: el decodificador elegido por sharp debe ser el esperado
  // (nunca SVG u otro formato aunque los magic bytes engañen).
  if (metadata.format !== SHARP_FORMAT[sniffed]) return { ok: false, reason: "mime_mismatch" };
  if (!metadata.width || !metadata.height) return { ok: false, reason: "decode_failed" };
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS)
    return { ok: false, reason: "too_many_pixels" };

  try {
    const pipeline = sharp(input, options)
      // Tope de CPU por imagen: protege la cola compartida (Gate F3).
      .timeout({ seconds: SHARP_TIMEOUT_SECONDS })
      .rotate() // aplica la orientación EXIF antes de descartar los metadatos
      .resize({
        width: MAX_IMAGE_SIDE,
        height: MAX_IMAGE_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      });
    const encoded =
      sniffed === "image/jpeg"
        ? pipeline.jpeg({ quality: 82, mozjpeg: true })
        : sniffed === "image/png"
          ? pipeline.png({ compressionLevel: 9 })
          : sniffed === "image/webp"
            ? pipeline.webp({ quality: 82 })
            : pipeline.avif({ quality: 55, effort: 2 });
    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    if (data.length > maxBytes) return { ok: false, reason: "too_large" };
    return { ok: true, data, width: info.width, height: info.height, mime: sniffed };
  } catch (error) {
    return { ok: false, reason: pixelLimitError(error) ? "too_many_pixels" : "decode_failed" };
  }
}
