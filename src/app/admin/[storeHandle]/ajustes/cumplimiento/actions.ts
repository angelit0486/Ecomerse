"use server";

import { revalidatePath } from "next/cache";

import { reportActionError } from "@/server/actions/report";
import { rpcDetail } from "@/server/compliance/errors";
import { callRpc } from "@/server/db/rpc";
import { invalidateStore } from "@/server/storefront/cache";

import { failureFrom, formValues, storeClient, type FormState } from "../../_shared/action-state";

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
    invalidateStore(storeId);
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
    invalidateStore(storeId);
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

const legendFailure = failureFrom("compliance", {
  body: "Escribe la leyenda (de 1 a 2 000 caracteres, sin caracteres de control).",
  reviewed_by: "Escribe el nombre de quien revisó la leyenda (2 a 120 caracteres).",
  pending_marker:
    "El texto todavía dice «PENDIENTE DE REVISIÓN»: ajústalo con tu asesor y quita esa nota antes de aprobarlo.",
  category: "Declara primero esta categoría.",
});

/**
 * Leyenda sanitaria de la tienda (Fase A): guardar el borrador no cambia lo que ve
 * el comprador; aprobar publica exactamente el texto enviado, con el nombre de
 * quien lo revisó. La base exige store.update y rechaza la marca de borrador.
 */
export async function saveStoreLegend(
  storeHandle: string,
  categoryKey: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["body", "reviewed_by"]);
  const approve = formData.get("intent") === "approve";
  if (approve && formData.get("confirm") !== "1") {
    return {
      error: "Confirma que tu asesor regulatorio revisó este texto.",
      fields: { confirm: "required" },
      values,
    };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "compliance_save_store_legend", {
      p_store_id: storeId,
      p_category_key: categoryKey,
      p_body: values.body,
      p_approve: approve,
      p_reviewed_by: approve ? values.reviewed_by : null,
    });
    invalidateStore(storeId);
  } catch (error) {
    return legendFailure(error, values);
  }
  revalidatePath(`/admin/${storeHandle}/ajustes/cumplimiento`);
  return {
    ok: true,
    message: approve
      ? "Leyenda aprobada: ya se muestra en tu tienda."
      : "Borrador guardado. Lo que ve el comprador no cambia hasta que lo apruebes.",
  };
}
