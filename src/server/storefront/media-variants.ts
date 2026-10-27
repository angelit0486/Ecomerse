import "server-only";

import { cache } from "react";

import { buildSrcSet } from "@/lib/media/variants";

import { mediaUrl } from "./catalog";

/**
 * ¿La tienda de ESTE request ya tiene copias de todas sus fotos? (paso 8). Lo
 * fija getStorefront al leer la tienda; fuera de él (otra ruta, vista previa
 * vieja) queda en false y las fotos salen como antes, solo con `src`.
 */
const variantsFlag = cache(() => ({ ready: false }));

export function setMediaVariantsReady(ready: boolean): void {
  variantsFlag().ready = ready;
}

/** `srcset` de una foto publicada, o undefined si la tienda aún no tiene copias. */
export function srcSetFor(path: string, width: number | null | undefined): string | undefined {
  if (!variantsFlag().ready) return undefined;
  return buildSrcSet(mediaUrl, path, width) ?? undefined;
}
