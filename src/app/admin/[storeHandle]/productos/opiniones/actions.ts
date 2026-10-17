"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { invalidateStore } from "@/server/storefront/cache";

import { storeClient, type FormState } from "../../_shared/action-state";

/** Publicar o rechazar una opinión (ADR-029); permisos y auditoría en la base. */
export async function moderateReview(
  storeHandle: string,
  reviewId: string,
  status: "published" | "rejected",
  _: FormState,
): Promise<FormState> {
  if (!z.uuid().safeParse(reviewId).success) return { error: "Opinión no válida." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc<string>(supabase, "reviews_moderate", {
      p_store_id: storeId,
      p_review_id: reviewId,
      p_status: status,
    });
    // La ficha del producto deja de servir lo cacheado (promedio y lista).
    invalidateStore(storeId);
  } catch (error) {
    return { error: reportActionError("reviews", error).message };
  }
  revalidatePath(`/admin/${storeHandle}/productos/opiniones`);
  return {
    ok: true,
    message: status === "published" ? "Opinión publicada." : "Opinión rechazada.",
  };
}
