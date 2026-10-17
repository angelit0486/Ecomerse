"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  parseSupplierCsv,
  SUPPLIER_CSV_MESSAGES,
  type SupplierCsvError,
} from "@/lib/catalog/supplier-csv";
import { parseMoneyToCents } from "@/lib/money/format";
import { rpcDetail } from "@/server/compliance/errors";
import { callRpc } from "@/server/db/rpc";
import { invalidateStore } from "@/server/storefront/cache";

import { failureFrom, formValues, storeClient, type FormState } from "../../_shared/action-state";

/**
 * Proveedores (ADR-025). La base exige los permisos (products.update y
 * products.cost.read; inventory.adjust para la disponibilidad) y valida todo;
 * aquí solo se convierten los datos del formulario.
 */
const uuid = z.uuid();
const path = (storeHandle: string, id?: string) =>
  `/admin/${storeHandle}/productos/proveedores${id ? `/${id}` : ""}`;

const supplierFailure = failureFrom("suppliers", {
  name: "Escribe un nombre de hasta 120 caracteres.",
  code: "Ese proveedor ya existe o su nombre no sirve como clave.",
  status: "Elige un estado.",
  lead_time: "Plazo en días entre 0 y 365; el mínimo no puede pasar del máximo.",
  shipping_terms: "Hasta 1 000 caracteres.",
});

const variantFailure = failureFrom("suppliers", {
  sku: "No hay una variante con ese SKU en tu tienda.",
  variant: "No hay una variante con ese SKU en tu tienda.",
  availability: "Elige la disponibilidad que informó el proveedor.",
  quantity: "Escribe cuántas piezas informó el proveedor (0 a 1 000 000).",
  unit_cost: "Escribe un costo como 450.00.",
  supplier_sku: "Hasta 100 caracteres.",
  reserved: "Hay pedidos reservados con este proveedor: no se puede desvincular todavía.",
});

const int = (v: string) => (v === "" ? null : /^\d{1,3}$/.test(v) ? Number(v) : Number.NaN);

export async function saveSupplier(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, [
    "id",
    "name",
    "status",
    "lead_time_min_days",
    "lead_time_max_days",
    "shipping_terms",
  ]);
  const min = int(values.lead_time_min_days!);
  const max = int(values.lead_time_max_days!);
  if (Number.isNaN(min) || Number.isNaN(max)) {
    return { error: "Revisa el plazo.", fields: { lead_time: "Escribe días enteros." }, values };
  }
  if (values.id && !uuid.safeParse(values.id).success) return { error: "Proveedor no válido." };
  let id: string;
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    id = await callRpc<string>(supabase, "suppliers_save", {
      p_store_id: storeId,
      p_supplier: {
        ...(values.id ? { id: values.id } : {}),
        name: values.name,
        status: values.status || "active",
        lead_time_min_days: min,
        lead_time_max_days: max,
        shipping_terms: values.shipping_terms,
      },
    });
    // Activar o desactivar un proveedor cambia la disponibilidad en la tienda.
    invalidateStore(storeId);
  } catch (error) {
    return supplierFailure(error, values);
  }
  revalidatePath(path(storeHandle));
  revalidatePath(path(storeHandle, id));
  return {
    ok: true,
    message: values.id ? "Proveedor guardado." : `Proveedor «${values.name}» creado.`,
  };
}

export async function setSupplierVariant(
  storeHandle: string,
  supplierId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, [
    "sku",
    "supplier_sku",
    "unit_cost",
    "availability",
    "quantity",
  ]);
  if (!uuid.safeParse(supplierId).success) return { error: "Proveedor no válido." };
  const cost = values.unit_cost
    ? parseMoneyToCents(values.unit_cost.replace(/^(\d+),(\d{1,2})$/, "$1.$2"))
    : null;
  if (values.unit_cost && cost === null) {
    return {
      error: "Revisa el costo.",
      fields: { unit_cost: "Escribe un costo como 450.00." },
      values,
    };
  }
  const quantity =
    values.quantity === ""
      ? null
      : /^\d{1,7}$/.test(values.quantity!)
        ? Number(values.quantity)
        : NaN;
  if (Number.isNaN(quantity)) {
    return {
      error: "Revisa la cantidad.",
      fields: { quantity: "Escribe un número entero." },
      values,
    };
  }
  let message: string;
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    const { data, error } = await supabase
      .from("product_variants")
      .select("id")
      .eq("store_id", storeId)
      .eq("sku", values.sku!.toUpperCase())
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return {
        error: "Revisa el SKU.",
        fields: { sku: "No hay una variante con ese SKU en tu tienda." },
        values,
      };
    }
    const result = await callRpc<{ on_hand: number; clamped_to_reserved: boolean }>(
      supabase,
      "suppliers_set_variant",
      {
        p_store_id: storeId,
        p_supplier_id: supplierId,
        p_variant_id: data.id,
        p_data: {
          supplier_sku: values.supplier_sku,
          unit_cost: cost,
          availability: values.availability,
          quantity,
        },
      },
    );
    invalidateStore(storeId);
    message = result.clamped_to_reserved
      ? `Guardado. Quedan ${result.on_hand} piezas del proveedor: ya estaban reservadas por pedidos.`
      : `Guardado. Disponibles del proveedor: ${result.on_hand}.`;
  } catch (error) {
    return variantFailure(error, values);
  }
  revalidatePath(path(storeHandle, supplierId));
  return { ok: true, message };
}

export async function unlinkSupplierVariant(
  storeHandle: string,
  supplierId: string,
  variantId: string,
  _: FormState,
  __: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(supplierId).success || !uuid.safeParse(variantId).success) {
    return { error: "Datos no válidos." };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "suppliers_unlink_variant", {
      p_store_id: storeId,
      p_supplier_id: supplierId,
      p_variant_id: variantId,
    });
    invalidateStore(storeId);
  } catch (error) {
    if (rpcDetail(error).detail === "reserved") {
      return {
        error: "Hay pedidos reservados con este proveedor: no se puede desvincular todavía.",
      };
    }
    return variantFailure(error);
  }
  revalidatePath(path(storeHandle, supplierId));
  return { ok: true, message: "Variante desvinculada." };
}

export interface SupplierCsvState {
  ok?: boolean;
  message?: string;
  error?: string;
  rowErrors?: { row: number; message: string }[];
}

// Bajo el límite de 1 MB de las server actions de Next (5 000 filas caben de sobra).
const CSV_MAX_BYTES = 900 * 1024;

/**
 * Lista de disponibilidad del proveedor en CSV (ADR-025 paso 2): todo o nada.
 * El formato se valida aquí; SKU, repetidos y permisos, en la base.
 */
export async function importSupplierCsv(
  storeHandle: string,
  supplierId: string,
  _: SupplierCsvState,
  formData: FormData,
): Promise<SupplierCsvState> {
  if (!uuid.safeParse(supplierId).success) return { error: "Proveedor no válido." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Elige un archivo CSV." };
  if (file.size > CSV_MAX_BYTES) return { error: "El archivo pasa de 900 KB." };
  const parsed = parseSupplierCsv(await file.text());
  const rowErrors = (errors: SupplierCsvError[]) =>
    errors.slice(0, 50).map((e) => ({ row: e.row, message: SUPPLIER_CSV_MESSAGES[e.field] }));
  if (!parsed.ok) {
    return {
      error:
        parsed.message ?? `Hay ${parsed.errors.length} problema(s); no se aplicó ningún cambio.`,
      rowErrors: parsed.message ? [] : rowErrors(parsed.errors),
    };
  }
  let result: { applied: boolean; errors: SupplierCsvError[]; updated: number; clamped: number };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    result = await callRpc(supabase, "suppliers_import_variants", {
      p_store_id: storeId,
      p_supplier_id: supplierId,
      p_rows: parsed.rows,
    });
    if (result.applied) invalidateStore(storeId);
  } catch (error) {
    const failure = variantFailure(error);
    return { error: failure.error ?? "No se pudo cargar el archivo." };
  }
  if (!result.applied) {
    return {
      error: `Hay ${result.errors.length} problema(s); no se aplicó ningún cambio.`,
      rowErrors: rowErrors(result.errors),
    };
  }
  revalidatePath(path(storeHandle, supplierId));
  return {
    ok: true,
    message:
      `${result.updated} ${result.updated === 1 ? "variante actualizada" : "variantes actualizadas"}.` +
      (result.clamped > 0 ? ` En ${result.clamped} se conservó lo ya reservado por pedidos.` : ""),
  };
}
