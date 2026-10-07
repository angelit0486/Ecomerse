"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { invalidateStore } from "@/server/storefront/cache";

import { storeClient } from "../../_shared/action-state";

const uuid = z.uuid();

/** Confirma un plan validado: todo o nada en la base (imports_commit). Repetir no duplica. */
export async function commitImport(storeHandle: string, jobId: string): Promise<void> {
  if (!uuid.safeParse(jobId).success) redirect(`/admin/${storeHandle}/productos/importar`);
  const path = `/admin/${storeHandle}/productos/importar/${jobId}`;
  let notice = "importado";
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    const result = await callRpc<{ status: string }>(supabase, "imports_commit", {
      p_store_id: storeId,
      p_job_id: jobId,
    });
    if (result.status === "failed") notice = "fallo";
    else invalidateStore(storeId);
  } catch (error) {
    reportActionError("imports", error);
    notice = "no-listo";
  }
  revalidatePath(path);
  revalidatePath(`/admin/${storeHandle}/productos`);
  redirect(`${path}?aviso=${notice}`);
}
