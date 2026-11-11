import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { processQueueSoon } from "@/server/jobs/run-now";
import { imageProcessingBlocked } from "@/server/system/health";

import { finalizeMediaUpload } from "./upload";

/**
 * Cierra una subida del panel y, si la imagen queda en espera, arranca la cola
 * en cuanto termina la respuesta. Sin esto la imagen espera al cron (diario en
 * el plan actual): pasó con tres banners el 2026-11-10 (Orden 04, T-20).
 * Toda subida del panel pasa por aquí; una prueba impide llamar a
 * `finalizeMediaUpload` directo desde `src/app`.
 */
export async function finalizePanelUpload(
  supabase: SupabaseClient,
  storeId: string,
  mediaId: string,
  reason: string,
): Promise<{ status: "pending" | "ready" | "rejected" }> {
  const result = await finalizeMediaUpload(supabase, storeId, mediaId);
  // Sin la clave de Storage el trabajo fallaría y gastaría un intento (D-PANEL-10).
  if (result.status === "pending" && !imageProcessingBlocked()) processQueueSoon(reason);
  return result;
}
