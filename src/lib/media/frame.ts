/**
 * Encuadrar una imagen antes de subirla (logos y portadas de marca, misión
 * Portada/Marcas): «completo» la mete entera en el cuadro, «llenar» recorta al
 * centro. Se dibuja en un canvas, así que también se van los datos EXIF; el
 * worker vuelve a re-codificar de todos modos (GATE0 §25.3).
 */
export type Fit = "contain" | "cover";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Dónde dibujar una imagen `src` dentro de un lienzo `dst`. */
export function fitRect(srcW: number, srcH: number, dstW: number, dstH: number, fit: Fit): Rect {
  const scale =
    fit === "contain" ? Math.min(dstW / srcW, dstH / srcH) : Math.max(dstW / srcW, dstH / srcH);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  return { x: Math.round((dstW - w) / 2), y: Math.round((dstH - h) / 2), w, h };
}

/** La imagen encuadrada como WebP (o PNG si el navegador no sabe hacer WebP). */
export async function frameImage(
  file: File,
  size: { width: number; height: number },
  fit: Fit,
): Promise<File> {
  if (typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  const r = fitRect(bitmap.width, bitmap.height, size.width, size.height, fit);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, r.x, r.y, r.w, r.h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.9),
  );
  if (!blob) return file;
  const type = blob.type === "image/webp" ? "image/webp" : "image/png";
  const base = file.name.replace(/\.[^.]+$/, "") || "imagen";
  return new File([blob], `${base}.${type === "image/webp" ? "webp" : "png"}`, { type });
}
