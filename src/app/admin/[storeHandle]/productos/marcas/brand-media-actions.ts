"use server";

import { revalidatePath } from "next/cache";

import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@/lib/media/constants";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { createMediaUpload, finalizeMediaUpload } from "@/server/media/upload";
import { invalidateStore } from "@/server/storefront/cache";

import { storeClient } from "../../_shared/action-state";
import { FIELD_MESSAGES } from "../messages";

/**
 * Logo y portada de una marca (misión Portada/Marcas, Paso 2): el mismo
 * pipeline seguro de medios (§25.3): la RPC reserva la ruta, el navegador sube
 * directo a Storage, el worker re-codifica (sin EXIF, SVG rechazado) y
 * `catalog_set_brand_media` liga la imagen a la marca (misma tienda, permiso
 * `brands.manage`).
 */
export type BrandImageKind = "logo" | "cover";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_ERROR = "Usa una imagen JPG, PNG, WebP o AVIF de hasta 10 MB.";

type Result = { ok: true } | { ok: false; error: string };

function message(scope: string, error: unknown): string {
  const e = reportActionError(scope, error);
  if (e.code === "forbidden") return "Tu rol no permite cambiar las marcas.";
  const field = e.fields ? Object.keys(e.fields)[0] : undefined;
  return (field && FIELD_MESSAGES[field]) || e.message;
}

export async function requestBrandImageUpload(
  storeHandle: string,
  input: { mimeType: string; bytes: number },
): Promise<{ ok: true; mediaId: string; signedUrl: string } | { ok: false; error: string }> {
  if (
    !(ALLOWED_IMAGE_MIME as readonly string[]).includes(input?.mimeType) ||
    !Number.isInteger(input?.bytes) ||
    input.bytes < 1 ||
    input.bytes > MAX_UPLOAD_BYTES
  ) {
    return { ok: false, error: FILE_ERROR };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    const ticket = await createMediaUpload(supabase, {
      storeId,
      ownerType: "brand",
      productId: null,
      mimeType: input.mimeType,
      bytes: input.bytes,
    });
    return { ok: true, mediaId: ticket.mediaId, signedUrl: ticket.signedUrl };
  } catch (error) {
    return { ok: false, error: message("brands.image", error) };
  }
}

/** Termina la subida, describe la imagen con el nombre de la marca y la liga. */
export async function attachBrandImage(
  storeHandle: string,
  input: { brandId: string; mediaId: string; kind: BrandImageKind; brandName: string },
): Promise<Result> {
  if (!UUID.test(input?.brandId ?? "") || !UUID.test(input?.mediaId ?? "")) {
    return { ok: false, error: "Recarga la página e inténtalo de nuevo." };
  }
  if (input.kind !== "logo" && input.kind !== "cover")
    return { ok: false, error: "Elige logo o portada." };
  // Texto alternativo obligatorio: sale del nombre de la marca (accesibilidad).
  const name = String(input.brandName ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const alt = `${input.kind === "logo" ? "Logo" : "Portada"} de ${name || "la marca"}`;
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await finalizeMediaUpload(supabase, storeId, input.mediaId);
    await callRpc(supabase, "media_set_alt_text", {
      p_store_id: storeId,
      p_media_id: input.mediaId,
      p_alt_text: alt,
    });
    await callRpc(supabase, "catalog_set_brand_media", {
      p_store_id: storeId,
      p_brand_id: input.brandId,
      p_kind: input.kind,
      p_media_id: input.mediaId,
    });
    invalidateStore(storeId);
  } catch (error) {
    return { ok: false, error: message("brands.image", error) };
  }
  revalidatePath(`/admin/${storeHandle}/productos/marcas`);
  return { ok: true };
}

export async function removeBrandImage(
  storeHandle: string,
  input: { brandId: string; kind: BrandImageKind },
): Promise<Result> {
  if (!UUID.test(input?.brandId ?? "")) return { ok: false, error: "Marca no válida." };
  if (input.kind !== "logo" && input.kind !== "cover")
    return { ok: false, error: "Elige logo o portada." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "catalog_set_brand_media", {
      p_store_id: storeId,
      p_brand_id: input.brandId,
      p_kind: input.kind,
      p_media_id: null,
    });
    invalidateStore(storeId);
  } catch (error) {
    return { ok: false, error: message("brands.image", error) };
  }
  revalidatePath(`/admin/${storeHandle}/productos/marcas`);
  return { ok: true };
}
