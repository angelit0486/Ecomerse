"use server";

import { revalidatePath } from "next/cache";

import { reportActionError } from "@/server/actions/report";
import { rpcDetail } from "@/server/compliance/errors";
import { callRpc } from "@/server/db/rpc";

import { storeClient, type FormState } from "../../_shared/action-state";

/**
 * Ajustes → Cumplimiento (R-T02, ADR-021). La tienda declara qué categorías
 * reguladas vende; la base aplica la denegación por defecto y los permisos
 * (store.update para declarar, products.update para clasificar).
 */
export async function setRegulatedCategory(
  storeHandle: string,
  categoryKey: string,
  enabled: boolean,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!enabled && formData.get("confirm") !== "1") {
    return { error: "Confirma que quieres retirar la categoría.", fields: { confirm: "required" } };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "compliance_set_store_category", {
      p_store_id: storeId,
      p_category_key: categoryKey,
      p_enabled: enabled,
    });
  } catch (error) {
    const e = reportActionError("compliance", error);
    const { detail, hint } = rpcDetail(error);
    if (e.code === "conflict" && detail === "unclassified_products") {
      const n = Number(hint ?? "0");
      return {
        error: `Antes de declararla, clasifica ${n === 1 ? "tu producto publicado" : `tus ${n} productos publicados`}: márcalos abajo como no regulados o completa su ficha sanitaria.`,
      };
    }
    if (e.code === "conflict" && detail === "category_in_use") {
      return {
        error:
          "Hay productos clasificados en esta categoría. Cambia su ficha sanitaria antes de retirarla.",
      };
    }
    return { error: e.code === "forbidden" ? "Tu rol no permite cambiar esto." : e.message };
  }
  revalidatePath(`/admin/${storeHandle}/ajustes/cumplimiento`);
  return { ok: true, message: enabled ? "Categoría declarada." : "Categoría retirada." };
}

export async function classifyPublishedAsUnregulated(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  if (formData.get("confirm") !== "1") {
    return {
      error: "Confirma que esos productos no son suplementos ni otro producto regulado.",
      fields: { confirm: "required" },
    };
  }
  let count = 0;
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    count = await callRpc<number>(supabase, "catalog_classify_active_unregulated", {
      p_store_id: storeId,
    });
  } catch (error) {
    const e = reportActionError("compliance", error);
    return {
      error: e.code === "forbidden" ? "Tu rol no permite clasificar productos." : e.message,
    };
  }
  revalidatePath(`/admin/${storeHandle}/ajustes/cumplimiento`);
  return {
    ok: true,
    message:
      count === 1
        ? "1 producto marcado como no regulado."
        : `${count} productos marcados como no regulados.`,
  };
}
