"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isSupplierOrderStatus, SUPPLIER_ORDER_LABELS } from "@/lib/orders/supplier-order-status";
import { callRpc } from "@/server/db/rpc";

import { failureFrom, formValues, storeClient, type FormState } from "../../_shared/action-state";

/**
 * Avance del despacho de un proveedor (ADR-025 paso 2, adaptador manual): la
 * dueña registra lo que hizo o lo que le informó el proveedor. La base exige
 * orders.update y valida transiciones, guía y enlace.
 */
const uuid = z.uuid();

const failure = failureFrom("supplier_orders", {
  status: "Elige un estado.",
  external_reference: "Hasta 100 caracteres.",
  carrier: "Hasta 80 caracteres.",
  tracking_number: "Solo letras, números, espacios y guiones (3 a 60).",
  tracking_url: "El enlace debe empezar con https://",
  note: "Hasta 1 000 caracteres.",
});

export async function setSupplierOrderStatus(
  storeHandle: string,
  supplierOrderId: string,
  orderId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, [
    "status",
    "external_reference",
    "carrier",
    "tracking_number",
    "tracking_url",
    "note",
  ]);
  if (!uuid.safeParse(supplierOrderId).success || !uuid.safeParse(orderId).success) {
    return { error: "Despacho no válido." };
  }
  if (!isSupplierOrderStatus(values.status)) {
    return { error: "Elige un estado.", values };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "supplier_orders_set_status", {
      p_store_id: storeId,
      p_supplier_order_id: supplierOrderId,
      p_status: values.status,
      p_data: {
        external_reference: values.external_reference,
        carrier: values.carrier,
        tracking_number: values.tracking_number,
        tracking_url: values.tracking_url,
        note: values.note,
      },
    });
  } catch (error) {
    // Un cambio de estado que ya no aplica (otra persona lo avanzó) llega como conflicto.
    return failure(error, values);
  }
  revalidatePath(`/admin/${storeHandle}/pedidos/${orderId}`);
  revalidatePath(`/admin/${storeHandle}/pedidos/despachos`);
  return { ok: true, message: `Despacho: ${SUPPLIER_ORDER_LABELS[values.status].toLowerCase()}.` };
}
