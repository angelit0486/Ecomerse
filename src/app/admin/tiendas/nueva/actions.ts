"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { formValues } from "@/lib/form-values";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * ADR-038: la dueña o una administradora de la organización crea otra tienda.
 * La base decide el permiso (`org.stores.create`), la organización y el límite
 * del plan; aquí solo se traducen los errores.
 */
export interface NewStoreState {
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
}

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
  } catch (error) {
    const appError = reportActionError("org.create_store", error);
    if (appError.code === "conflict") {
      return {
        error: "Ya existe una tienda con esa dirección.",
        fields: { store_handle: "Ya existe una tienda con esa dirección. Elige otra." },
        values,
      };
    }
    if (appError.code === "limit_reached") {
      return {
        error: "Tu plan ya no permite más tiendas. Pide a la plataforma subir de plan.",
        values,
      };
    }
    if (appError.code === "forbidden") {
      return { error: "Tu rol no permite crear tiendas en esta organización.", values };
    }
    const fields: Record<string, string> = {};
    if (appError.fields && "store_name" in appError.fields) {
      fields.store_name = "Escribe un nombre de 2 a 80 caracteres.";
    }
    if (appError.fields && "store_handle" in appError.fields) {
      fields.store_handle =
        "Usa de 3 a 40 minúsculas, números o guiones (sin «--» ni palabras reservadas como «admin»).";
    }
    return { error: appError.message, ...(Object.keys(fields).length ? { fields } : {}), values };
  }
  // Directo a configurarla: plantilla, copiar estructura, logo y pagos.
  redirect(`/admin/${handle}/configuracion`);
}
