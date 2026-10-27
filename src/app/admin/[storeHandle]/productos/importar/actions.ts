"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { processQueueSoon } from "@/server/jobs/run-now";

import { storeClient } from "../../_shared/action-state";

const uuid = z.uuid();

/** Detalle del RAISE de la base (PostgREST lo manda como `details`). */
function dbDetail(cause: unknown): string | undefined {
  const c = cause as { details?: unknown; detail?: unknown } | null | undefined;
  const d = c?.details ?? c?.detail;
  return typeof d === "string" ? d : undefined;
}

/**
 * Confirma un plan validado (GATE0 §26.1 paso 4): imports_commit encola el job
 * `import.commit` y el worker lo aplica todo o nada, revalidando los permisos de
 * quien confirma (CF-10). Repetir no encola dos veces. Con `skipErrors` (ADR-040)
 * se importan solo los productos sin errores; los demás se saltan completos.
 */
export async function commitImport(
  storeHandle: string,
  jobId: string,
  skipErrors: boolean,
): Promise<void> {
  if (!uuid.safeParse(jobId).success) redirect(`/admin/${storeHandle}/productos/importar`);
  const path = `/admin/${storeHandle}/productos/importar/${jobId}`;
  let notice = "";
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "imports_commit", {
      p_store_id: storeId,
      p_job_id: jobId,
      // Solo se manda si se pidió: así la llamada sigue igual con la base de antes.
      ...(skipErrors ? { p_skip_errors: true } : {}),
    });
    processQueueSoon("imports.commit");
  } catch (error) {
    const e = reportActionError("imports", error);
    notice =
      e.code === "forbidden"
        ? "?aviso=permiso"
        : dbDetail(e.cause) === "import_nothing_valid"
          ? "?aviso=nada-valido"
          : "?aviso=no-listo";
  }
  revalidatePath(path);
  redirect(`${path}${notice}`);
}
