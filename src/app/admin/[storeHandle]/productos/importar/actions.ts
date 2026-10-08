"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";

import { storeClient } from "../../_shared/action-state";

const uuid = z.uuid();

/**
 * Confirma un plan validado (GATE0 §26.1 paso 4): imports_commit encola el job
 * `import.commit` y el worker lo aplica todo o nada, revalidando los permisos de
 * quien confirma (CF-10). Repetir no encola dos veces.
 */
export async function commitImport(storeHandle: string, jobId: string): Promise<void> {
  if (!uuid.safeParse(jobId).success) redirect(`/admin/${storeHandle}/productos/importar`);
  const path = `/admin/${storeHandle}/productos/importar/${jobId}`;
  let notice = "";
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "imports_commit", { p_store_id: storeId, p_job_id: jobId });
  } catch (error) {
    const e = reportActionError("imports", error);
    notice = e.code === "forbidden" ? "?aviso=permiso" : "?aviso=no-listo";
  }
  revalidatePath(path);
  redirect(`${path}${notice}`);
}
