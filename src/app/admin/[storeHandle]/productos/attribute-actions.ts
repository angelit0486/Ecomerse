"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { MAX_ATTRIBUTE_VALUES, normalizeAttributeForm } from "@/lib/catalog/attributes";
import { reportActionError } from "@/server/actions/report";
import { rpcDetail } from "@/server/compliance/errors";
import { callRpc } from "@/server/db/rpc";
import { invalidateStore } from "@/server/storefront/cache";

import { storeClient, type FormState } from "../_shared/action-state";

const uuid = z.uuid();

const SAVE_ERRORS: Record<string, { field: string; message: string }> = {
  name: { field: "name", message: "Ya tienes un atributo con ese nombre." },
  key: {
    field: "name",
    message:
      "Usa otro nombre: debe empezar con una letra y no puede parecerse a otro atributo ni a una palabra que usa la tienda (orden, marca, precio…).",
  },
  values: {
    field: "values",
    message: `Revisa los valores: sin repetir, entre 1 y ${MAX_ATTRIBUTE_VALUES}, de hasta 60 caracteres.`,
  },
  attributes_limit: { field: "name", message: "Puedes tener hasta 20 atributos." },
  publish: {
    field: "values",
    message:
      "Hay productos publicados con este atributo y el cambio incluye un término que las reglas sanitarias no permiten.",
  },
};

/** Error de una RPC de atributos → mensaje (y campo) para el formulario. */
function attributeFailure(
  scope: string,
  error: unknown,
  values?: Record<string, string>,
): FormState {
  const e = reportActionError(scope, error);
  const { detail } = rpcDetail(error);
  const known = e.code === "validation_failed" && detail ? SAVE_ERRORS[detail] : undefined;
  if (known) {
    return {
      error: known.message,
      fields: { [known.field]: known.message },
      ...(values ? { values } : {}),
    };
  }
  if (e.code === "not_found") {
    return { error: "El atributo o uno de sus valores ya no existe. Recarga la página." };
  }
  return { error: e.message, ...(values ? { values } : {}) };
}

/** Lo escrito en el formulario, para no perderlo tras un error. */
function readAttributeForm(formData: FormData) {
  const count = Number(formData.get("value_count") ?? 0) || 0;
  const values = Array.from({ length: Math.min(count, MAX_ATTRIBUTE_VALUES) }, (_, i) => ({
    id: String(formData.get(`value_id_${i}`) ?? ""),
    label: String(formData.get(`value_label_${i}`) ?? ""),
  }));
  return {
    id: String(formData.get("id") ?? ""),
    name: String(formData.get("name") ?? ""),
    filterable: formData.get("is_filterable") === "1",
    values,
    // El formulario nunca manda más renglones: nada se recorta en silencio (un
    // valor que faltara se borraría al guardar).
    tooMany: count > MAX_ATTRIBUTE_VALUES,
  };
}

/**
 * Crea o edita un atributo con su lista completa de valores (R-T04). La base
 * conserva las claves de la URL al renombrar y borra los valores que faltan.
 */
export async function saveAttribute(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = readAttributeForm(formData);
  const echo = { name: raw.name };
  if (raw.tooMany) {
    const message = SAVE_ERRORS.values!.message;
    return { error: message, fields: { values: message }, values: echo };
  }
  const result = normalizeAttributeForm(raw);
  if (!result.ok) {
    if (result.fields.id) return { error: "Atributo no válido. Recarga la página." };
    return { error: Object.values(result.fields)[0], fields: result.fields, values: echo };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "catalog_save_attribute", {
      p_store_id: storeId,
      p_attribute: result.attribute,
    });
    // Los filtros y las fichas de la tienda pública cambian (§21.4).
    invalidateStore(storeId);
  } catch (error) {
    return attributeFailure("catalog.attribute", error, echo);
  }
  // La página vuelve a cargar los atributos (con los ids de los valores nuevos):
  // los formularios se rehacen con esos datos y el aviso sale arriba.
  revalidatePath(`/admin/${storeHandle}/productos/atributos`);
  redirect(`/admin/${storeHandle}/productos/atributos?guardado=1`);
}

export async function deleteAttribute(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  if (!uuid.safeParse(id).success) return { error: "Atributo no válido." };
  if (formData.get("confirm") !== "1") {
    return { error: "Marca la casilla para confirmar que quieres eliminarlo." };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "catalog_delete_attribute", {
      p_store_id: storeId,
      p_attribute_id: id,
    });
    invalidateStore(storeId);
  } catch (error) {
    return attributeFailure("catalog.attribute", error);
  }
  revalidatePath(`/admin/${storeHandle}/productos/atributos`);
  redirect(`/admin/${storeHandle}/productos/atributos?eliminado=1`);
}

/** Valores de los atributos de un producto (la lista completa de casillas marcadas). */
export async function saveProductAttributes(
  storeHandle: string,
  productId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const ids = formData.getAll("value").map(String);
  if (!uuid.safeParse(productId).success || ids.some((id) => !uuid.safeParse(id).success)) {
    return { error: "Recarga la página e inténtalo de nuevo." };
  }
  if (ids.length > 40) return { error: "Un producto puede llevar hasta 40 valores." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "catalog_set_product_attributes", {
      p_store_id: storeId,
      p_product_id: productId,
      p_value_ids: ids,
    });
    invalidateStore(storeId);
  } catch (error) {
    const e = reportActionError("catalog.attribute", error);
    const { detail } = rpcDetail(error);
    if (e.code === "validation_failed" && detail === "publish") {
      return {
        error:
          "El producto está publicado y uno de los valores incluye un término que las reglas sanitarias no permiten.",
      };
    }
    if (e.code === "validation_failed") {
      return { error: "Uno de los valores ya no existe. Recarga la página." };
    }
    return { error: e.message };
  }
  revalidatePath(`/admin/${storeHandle}/productos/${productId}`);
  return { ok: true, message: "Atributos guardados." };
}
