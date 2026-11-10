"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { formValues } from "@/lib/form-values";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { processQueueSoon } from "@/server/jobs/run-now";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { newStoreErrorState, type NewStoreState } from "./errors";

/**
 * ADR-038: la dueña o una administradora de la organización crea otra tienda.
 * La base decide el permiso (`org.stores.create`), la organización y el límite
 * del plan; aquí solo se traducen los errores.
 */

const FIELDS = ["store_name", "store_handle"] as const;

export async function createStore(
  organizationId: string,
  _: NewStoreState,
  formData: FormData,
): Promise<NewStoreState> {
  const values = formValues(formData, [...FIELDS]);
  if (!z.uuid().safeParse(organizationId).success) {
    return { error: "Recarga la página e inténtalo de nuevo.", values };
  }
  let handle: string;
  try {
    const supabase = await createSupabaseServerClient();
    const result = await callRpc<{ handle: string }>(supabase, "org_create_store", {
      p_org_id: organizationId,
      p_store_name: String(formData.get("store_name") ?? ""),
      p_store_handle: String(formData.get("store_handle") ?? ""),
    });
    handle = result.handle;
    // Alta de la dirección en el hosting (job `domains.attach_platform`).
    processQueueSoon("org.create_store");
  } catch (error) {
    return newStoreErrorState(reportActionError("org.create_store", error), values);
  }
  // Directo a configurarla: plantilla, copiar estructura, logo y pagos.
  redirect(`/admin/${handle}/configuracion`);
}
