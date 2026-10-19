/**
 * Aligera las fotos en el navegador antes de subirlas: una foto de celular de
 * 3–10 MB baja a unos cientos de KB y sube mucho más rápido. El servidor sigue
 * siendo la autoridad: re-codifica y valida cada imagen (GATE0 §25.3).
 */

/** Lado mayor tras la compresión: suficiente para el zoom de la ficha. */
export const COMPRESS_MAX_SIDE = 2400;
const WEBP_QUALITY = 0.86;
/** Por debajo de esto (y sin exceder el lado) no vale la pena re-codificar. */
const SMALL_ENOUGH_BYTES = 400 * 1024;

/** Medidas finales conservando la proporción; nunca agranda. */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number = COMPRESS_MAX_SIDE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Nombre con la extensión del formato nuevo («foto.HEIC.jpg» → «foto.HEIC.webp»). */
export function webpName(name: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.webp`;
}

/**
 * Devuelve una versión WebP más ligera o, si no se puede o no conviene, el
 * archivo original (el navegador sin soporte simplemente sube el original).
 */
export async function compressImage(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const target = fitWithin(bitmap.width, bitmap.height);
    const resized = target.width !== bitmap.width || target.height !== bitmap.height;
    if (!resized && file.size <= SMALL_ENOUGH_BYTES) return file;

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", WEBP_QUALITY),
    );
    // Safari antiguo devuelve PNG si no sabe hacer WebP: entonces no conviene.
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;
    return new File([blob], webpName(file.name), { type: "image/webp" });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

/**
 * Ejecuta `work` sobre cada elemento con como mucho `limit` a la vez y devuelve
 * los resultados en el mismo orden. `work` debe atrapar sus propios errores
 * (devolverlos como resultado) para que un archivo fallido no detenga el lote.
 */
export async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, lane));
  return results;
}
