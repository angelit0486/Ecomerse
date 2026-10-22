"use server";

import { revalidatePath } from "next/cache";

import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@/lib/media/constants";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { createMediaUpload, finalizeMediaUpload } from "@/server/media/upload";
import { invalidateStore } from "@/server/storefront/cache";

import { storeClient } from "../../_shared/action-state";
import { FIELD_MESSAGES } from "../messages";
import { ENTITY_MEDIA, type MediaEntity } from "./entity-media";

/**
 * Imágenes de marcas (logo y portada, misión Portada/Marcas) y de categorías
 * (foto cuadrada y banner, misión Panel, Paso A) con el mismo pipeline seguro
 * de medios (§25.3): la RPC reserva la ruta, el navegador sube directo a
 * Storage, el worker re-codifica (sin EXIF, SVG rechazado) y
 * `catalog_set_brand_media` / `catalog_set_category_media` liga la imagen
 * (misma tienda y permiso de marcas o de categorías).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_ERROR = "Usa una imagen JPG, PNG, WebP o AVIF de hasta 10 MB.";

type Result = { ok: true } | { ok: false; error: string };

function config(entity: MediaEntity) {
  return Object.hasOwn(ENTITY_MEDIA, entity) ? ENTITY_MEDIA[entity] : null;
}

function message(entity: MediaEntity, error: unknown): string {
  const e = reportActionError(`${entity}.image`, error);
  if (e.code === "forbidden") return ENTITY_MEDIA[entity].forbidden;
  const field = e.fields ? Object.keys(e.fields)[0] : undefined;
  return (field && FIELD_MESSAGES[field]) || e.message;
}

export async function requestEntityImageUpload(
  storeHandle: string,
  input: { entity: MediaEntity; mimeType: string; bytes: number },
): Promise<{ ok: true; mediaId: string; signedUrl: string } | { ok: false; error: string }> {
  const cfg = config(input?.entity);
  if (!cfg) return { ok: false, error: "Recarga la página e inténtalo de nuevo." };
  if (
    !(ALLOWED_IMAGE_MIME as readonly string[]).includes(input.mimeType) ||
    !Number.isInteger(input.bytes) ||
    input.bytes < 1 ||
    input.bytes > MAX_UPLOAD_BYTES
  ) {
    return { ok: false, error: FILE_ERROR };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    const ticket = await createMediaUpload(supabase, {
      storeId,
      ownerType: cfg.ownerType,
      productId: null,
      mimeType: input.mimeType,
      bytes: input.bytes,
    });
    return { ok: true, mediaId: ticket.mediaId, signedUrl: ticket.signedUrl };
  } catch (error) {
    return { ok: false, error: message(input.entity, error) };
  }
}

/** Termina la subida, describe la imagen con el nombre (texto alternativo) y la liga. */
export async function attachEntityImage(
  storeHandle: string,
  input: { entity: MediaEntity; id: string; mediaId: string; kind: string; name: string },
): Promise<Result> {
  const cfg = config(input?.entity);
  if (!cfg || !UUID.test(input.id ?? "") || !UUID.test(input.mediaId ?? "")) {
    return { ok: false, error: "Recarga la página e inténtalo de nuevo." };
  }
  const kind = cfg.kinds.find((k) => k.key === input.kind);
  if (!kind) return { ok: false, error: "Elige qué imagen cambiar." };
  const name = String(input.name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const alt = `${kind.altPrefix} ${name || cfg.fallbackName}`;
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await finalizeMediaUpload(supabase, storeId, input.mediaId);
    await callRpc(supabase, "media_set_alt_text", {
      p_store_id: storeId,
      p_media_id: input.mediaId,
      p_alt_text: alt,
    });
    await callRpc(supabase, cfg.rpc, {
      p_store_id: storeId,
      [cfg.idParam]: input.id,
      p_kind: kind.key,
      p_media_id: input.mediaId,
    });
    invalidateStore(storeId);
  } catch (error) {
    return { ok: false, error: message(input.entity, error) };
  }
  revalidatePath(`/admin/${storeHandle}${cfg.path}`);
  return { ok: true };
}

export async function removeEntityImage(
  storeHandle: string,
  input: { entity: MediaEntity; id: string; kind: string },
): Promise<Result> {
  const cfg = config(input?.entity);
  if (!cfg || !UUID.test(input.id ?? "")) {
    return { ok: false, error: "Recarga la página e inténtalo de nuevo." };
  }
  if (!cfg.kinds.some((k) => k.key === input.kind)) {
    return { ok: false, error: "Elige qué imagen quitar." };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, cfg.rpc, {
      p_store_id: storeId,
      [cfg.idParam]: input.id,
      p_kind: input.kind,
      p_media_id: null,
    });
    invalidateStore(storeId);
  } catch (error) {
    return { ok: false, error: message(input.entity, error) };
  }
  revalidatePath(`/admin/${storeHandle}${cfg.path}`);
  return { ok: true };
}
