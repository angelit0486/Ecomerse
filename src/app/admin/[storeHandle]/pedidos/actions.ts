"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { parseMoneyToCents } from "@/lib/money/format";
import { callRpc } from "@/server/db/rpc";
import { invalidateStore } from "@/server/storefront/cache";

import { failureFrom, storeClient, type FormState } from "../_shared/action-state";

const failure = failureFrom("orders", { staff_note: "La nota puede tener hasta 4000 caracteres." });
const uuid = z.uuid();

export async function confirmManualPayment(
  storeHandle: string,
  orderId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(orderId).success) return { error: "Pedido no válido." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "orders_mark_paid_manual", {
      p_store_id: storeId,
      p_order_id: orderId,
      p_note: String(formData.get("note") ?? "").slice(0, 1000) || null,
    });
    // Las existencias publicadas cambian con la venta confirmada.
    invalidateStore(storeId);
  } catch (error) {
    const e = reportActionError("orders", error);
    if (e.code === "conflict")
      return { error: "Este pedido ya no está pendiente de pago (o su reserva venció)." };
    return { error: e.message };
  }
  revalidatePath(`/admin/${storeHandle}/pedidos/${orderId}`);
  return { ok: true, message: "Pago confirmado. El pedido está listo para prepararse." };
}

export async function saveStaffNote(
  storeHandle: string,
  orderId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(orderId).success) return { error: "Pedido no válido." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "orders_set_staff_note", {
      p_store_id: storeId,
      p_order_id: orderId,
      p_note: String(formData.get("staff_note") ?? ""),
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/admin/${storeHandle}/pedidos/${orderId}`);
  return { ok: true, message: "Nota guardada." };
}

// -----------------------------------------------------------------------------
// F7-T06: surtir (parcial), entregar, cancelar y reembolsar. La clave de
// idempotencia viene del formulario renderizado: un doble envío repite la misma
// operación sin duplicarla (GATE0 §16.4, §18.6).
// -----------------------------------------------------------------------------
const KEY_RE = /^[A-Za-z0-9_-]{16,100}$/;
const CANCEL_REASONS = new Set(["customer", "staff", "fraud", "out_of_stock", "other"]);

/** Tras el éxito el aviso vive en la página: la sección del formulario puede desaparecer. */
function done(storeHandle: string, orderId: string, notice: string): never {
  const path = `/admin/${storeHandle}/pedidos/${orderId}`;
  revalidatePath(path);
  redirect(`${path}?aviso=${notice}`);
}

/** Lo escrito no se pierde tras un error (React reinicia el formulario al terminar). */
function keep(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value === "string" && name !== "idempotency_key") values[name] = value;
  }
  return values;
}

function lineItems(
  formData: FormData,
  prefix: string,
): { order_item_id: string; quantity: number }[] | null {
  const items: { order_item_id: string; quantity: number }[] = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(prefix)) continue;
    const id = name.slice(prefix.length);
    const quantity = Number(String(value).trim() || "0");
    if (!uuid.safeParse(id).success || !Number.isInteger(quantity) || quantity < 0) return null;
    if (quantity > 0) items.push({ order_item_id: id, quantity });
  }
  return items;
}

function rpcFailure(error: unknown, conflict: string, values: Record<string, string>): FormState {
  const e = reportActionError("orders", error);
  if (e.code === "conflict") return { error: conflict, values };
  if (e.code === "validation_failed") {
    return {
      error: "Revisa los datos: alguna cantidad o monto no es válido para este pedido.",
      values,
    };
  }
  return { error: e.message, values };
}

function validForm(orderId: string, formData: FormData): string | null {
  const key = String(formData.get("idempotency_key") ?? "");
  return uuid.safeParse(orderId).success && KEY_RE.test(key) ? key : null;
}

export async function fulfillOrder(
  storeHandle: string,
  orderId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = keep(formData);
  const key = validForm(orderId, formData);
  if (!key) return { error: "Formulario no válido.", values };
  const items = lineItems(formData, "qty_");
  if (!items || items.length === 0) {
    return { error: "Indica cuántas unidades envías de al menos un producto.", values };
  }
  const trackingUrl = String(formData.get("tracking_url") ?? "").trim();
  if (trackingUrl && !/^https:\/\/\S+$/.test(trackingUrl)) {
    const message = "El enlace de rastreo debe empezar con https://";
    return { error: message, fields: { tracking_url: message }, values };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "orders_fulfill", {
      p_store_id: storeId,
      p_order_id: orderId,
      p_items: items,
      p_carrier: String(formData.get("carrier") ?? "").trim() || null,
      p_tracking_number: String(formData.get("tracking_number") ?? "").trim() || null,
      p_tracking_url: trackingUrl || null,
      p_idempotency_key: key,
    });
  } catch (error) {
    return rpcFailure(
      error,
      "Este pedido no se puede surtir (sin pagar, cancelado o ya surtido).",
      values,
    );
  }
  done(storeHandle, orderId, "envio");
}

export async function markDelivered(
  storeHandle: string,
  orderId: string,
  shipmentId: string,
  _: FormState,
): Promise<FormState> {
  if (!uuid.safeParse(orderId).success || !uuid.safeParse(shipmentId).success) {
    return { error: "Envío no válido." };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "orders_mark_delivered", {
      p_store_id: storeId,
      p_shipment_id: shipmentId,
    });
  } catch (error) {
    return rpcFailure(error, "Este envío no se puede marcar como entregado.", {});
  }
  done(storeHandle, orderId, "entregado");
}

export async function cancelOrder(
  storeHandle: string,
  orderId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = keep(formData);
  const key = validForm(orderId, formData);
  const reason = String(formData.get("reason") ?? "");
  if (!key) return { error: "Formulario no válido.", values };
  if (!CANCEL_REASONS.has(reason)) return { error: "Elige un motivo.", values };
  if (formData.get("confirm") !== "1") {
    return { error: "Confirma que quieres cancelar el pedido.", values };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "orders_cancel", {
      p_store_id: storeId,
      p_order_id: orderId,
      p_reason: reason,
      p_note:
        String(formData.get("note") ?? "")
          .trim()
          .slice(0, 500) || null,
      p_idempotency_key: key,
    });
    // Las existencias liberadas vuelven a la tienda.
    invalidateStore(storeId);
  } catch (error) {
    return rpcFailure(
      error,
      "Este pedido ya no se puede cancelar (tiene unidades enviadas o ya está cerrado).",
      values,
    );
  }
  done(storeHandle, orderId, "cancelado");
}

export async function requestRefund(
  storeHandle: string,
  orderId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = keep(formData);
  const key = validForm(orderId, formData);
  if (!key) return { error: "Formulario no válido.", values };
  const amount = parseMoneyToCents(String(formData.get("amount") ?? ""));
  if (amount === null || amount <= 0) {
    const message = "Escribe un monto mayor que cero.";
    return { error: message, fields: { amount: message }, values };
  }
  const items = lineItems(formData, "ret_");
  if (!items) return { error: "Revisa las unidades devueltas.", values };
  const restock = formData.get("restock") === "1";
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "orders_request_refund", {
      p_store_id: storeId,
      p_order_id: orderId,
      p_amount: amount,
      p_items: items,
      p_restock: restock,
      p_reason:
        String(formData.get("reason") ?? "")
          .trim()
          .slice(0, 500) || null,
      p_idempotency_key: key,
    });
    if (restock) invalidateStore(storeId);
  } catch (error) {
    return rpcFailure(error, "Este pedido no admite reembolsos.", values);
  }
  done(storeHandle, orderId, "reembolso");
}
