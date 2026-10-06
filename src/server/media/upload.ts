import type { SupabaseClient } from "@supabase/supabase-js";

import { callRpc } from "@/server/db/rpc";
import { AppError } from "@/server/errors";

import { ALLOWED_IMAGE_MIME } from "@/lib/media/constants";

/**
 * Subida directa del navegador a Storage (GATE0 §25.3, pasos 1-3), siempre con
 * el cliente del USUARIO: la RPC reserva la ruta y Storage solo firma la URL si
 * la política media_upload_insert acepta esa ruta para ese usuario.
 */
export type MediaOwnerType = "product" | "brand" | "category" | "store_branding" | "banner";

export interface MediaUploadTicket {
  mediaId: string;
  path: string;
  /** URL absoluta de Storage para un PUT del archivo; caduca. */
  signedUrl: string;
}

export async function createMediaUpload(
  supabase: SupabaseClient,
  input: {
    storeId: string;
    ownerType: MediaOwnerType;
    productId: string | null;
    mimeType: string;
    bytes: number;
  },
): Promise<MediaUploadTicket> {
  if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(input.mimeType)) {
    throw new AppError("validation_failed", undefined, {
      fields: { file: "Formato no permitido" },
    });
  }
  const reserved = await callRpc<{ media_id: string; bucket: string; path: string }>(
    supabase,
    "media_create_upload",
    {
      p_store_id: input.storeId,
      p_owner_type: input.ownerType,
      p_product_id: input.productId,
      p_mime_type: input.mimeType,
      p_bytes: input.bytes,
    },
  );
  const { data, error } = await supabase.storage
    .from(reserved.bucket)
    .createSignedUploadUrl(reserved.path);
  if (error || !data) throw new AppError("internal", undefined, { cause: error });
  return { mediaId: reserved.media_id, path: reserved.path, signedUrl: data.signedUrl };
}

export async function finalizeMediaUpload(
  supabase: SupabaseClient,
  storeId: string,
  mediaId: string,
): Promise<{ status: "pending" | "ready" | "rejected" }> {
  return callRpc(supabase, "media_finalize", { p_store_id: storeId, p_media_id: mediaId });
}
