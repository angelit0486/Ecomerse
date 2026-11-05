"use server";

import { z } from "zod";

import { RETURN_REASONS } from "@/lib/returns/labels";
import { reportActionError } from "@/server/actions/report";
import { isGuestTokenShape } from "@/server/payments/order-links";
import { dbDetail } from "@/server/storefront/cart";
import { getStorefront } from "@/server/storefront/context";
import { requestReturn } from "@/server/storefront/returns";

/**
 * Solicitud de devolución del comprador (ADR-061). La tienda sale de la firma del
 * proxy; el navegador solo aporta pedido, token del enlace, unidades, motivo y nota.
 */
export interface ReturnActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  fields?: Record<string, string>;
}

const MESSAGES: Record<string, string> = {
  items: "Elige al menos una unidad para devolver (no más de las que recibiste).",
  reason: "Elige el motivo.",
  note: "La nota puede tener hasta 1000 caracteres.",
};

export async function sendReturn(
  storeId: string,
  orderId: string,
  token: string,
  _: ReturnActionState,
  formData: FormData,
): Promise<ReturnActionState> {
  const { store } = await getStorefront(storeId);
  if (!z.uuid().safeParse(orderId).success || !isGuestTokenShape(token)) {
    return { error: "Pedido no válido." };
  }
  const reason = String(formData.get("reason") ?? "");
  if (!(RETURN_REASONS as readonly string[]).includes(reason)) {
    return { error: MESSAGES.reason, fields: { reason: MESSAGES.reason! } };
  }
  const note = String(formData.get("note") ?? "").trim();
  if (note.length > 1000) return { error: MESSAGES.note, fields: { note: MESSAGES.note! } };
  const items: { order_item_id: string; quantity: number }[] = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("q_")) continue;
    const id = name.slice(2);
    const quantity = Number(String(value).trim() || "0");
    if (!z.uuid().safeParse(id).success || !Number.isInteger(quantity) || quantity < 0) {
      return { error: MESSAGES.items, fields: { items: MESSAGES.items! } };
    }
    if (quantity > 0) items.push({ order_item_id: id, quantity });
  }
  if (items.length === 0) return { error: MESSAGES.items, fields: { items: MESSAGES.items! } };
  try {
    await requestReturn(store.id, orderId, token, { reason, note, items });
  } catch (error) {
    const e = reportActionError("storefront.return", error);
    const detail = dbDetail(e);
    if (e.code === "conflict" && detail === "return_open") {
      return { error: "Ya tienes una devolución en curso para este pedido." };
    }
    if (e.code === "conflict") return { error: "El plazo para devolver este pedido ya terminó." };
    if (e.code === "validation_failed" && detail && MESSAGES[detail]) {
      return { error: MESSAGES[detail], fields: { [detail]: MESSAGES[detail]! } };
    }
    return { error: e.message };
  }
  return {
    ok: true,
    message: "Recibimos tu solicitud. Te escribiremos por correo cuando la tienda la revise.",
  };
}
