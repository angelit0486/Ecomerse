"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { parseMoneyToCents } from "@/lib/money/format";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { processQueueSoon } from "@/server/jobs/run-now";
import { invalidateStore } from "@/server/storefront/cache";

import { storeClient, type FormState } from "../../_shared/action-state";

/**
 * Devoluciones (ADR-061). Permisos, estados, montos e inventario los decide la
 * base; aquí solo se leen los formularios y se traducen los errores.
 */
const uuid = z.uuid();
const KEY_RE = /^[A-Za-z0-9_-]{16,100}$/;

function message(formData: FormData): string {
  return String(formData.get("message") ?? "")
    .trim()
    .slice(0, 1000);
}

function failure(error: unknown, values?: Record<string, string>): FormState {
  const e = reportActionError("returns", error);
  if (e.code === "conflict") {
    return { error: "La devolución cambió mientras la veías. Recarga la página.", values };
  }
  if (e.code === "validation_failed") {
    return { error: "Revisa los datos: el monto o el mensaje no son válidos.", values };
  }
  return { error: e.message, values };
}

function done(storeHandle: string, returnId: string, notice: string): never {
  processQueueSoon(`returns.${notice}`);
  const path = `/admin/${storeHandle}/pedidos/devoluciones/${returnId}`;
  revalidatePath(path);
  revalidatePath(`/admin/${storeHandle}/pedidos/devoluciones`);
  redirect(`${path}?aviso=${notice}`);
}

export async function decideReturn(
  storeHandle: string,
  returnId: string,
  approve: boolean,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(returnId).success) return { error: "Devolución no válida." };
  const text = message(formData);
  if (!approve && !text) {
    const msg = "Escribe el motivo: el cliente lo recibirá por correo.";
    return { error: msg, fields: { message: msg }, values: { message: text } };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "returns_decide", {
      p_store_id: storeId,
      p_return_id: returnId,
      p_approve: approve,
      p_message: text || null,
    });
  } catch (error) {
    return failure(error, { message: text });
  }
  done(storeHandle, returnId, approve ? "aprobada" : "rechazada");
}

export async function receiveReturn(
  storeHandle: string,
  returnId: string,
  _: FormState,
): Promise<FormState> {
  if (!uuid.safeParse(returnId).success) return { error: "Devolución no válida." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "returns_receive", { p_store_id: storeId, p_return_id: returnId });
  } catch (error) {
    return failure(error);
  }
  done(storeHandle, returnId, "recibida");
}

export async function refundReturn(
  storeHandle: string,
  returnId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = {
    amount: String(formData.get("amount") ?? ""),
    restock: String(formData.get("restock") ?? ""),
  };
  const key = String(formData.get("idempotency_key") ?? "");
  if (!uuid.safeParse(returnId).success || !KEY_RE.test(key)) {
    return { error: "Formulario no válido.", values };
  }
  const amount = parseMoneyToCents(values.amount);
  if (amount === null || amount <= 0) {
    const msg = "Escribe un monto mayor que cero.";
    return { error: msg, fields: { amount: msg }, values };
  }
  const restock = values.restock === "1";
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "returns_refund", {
      p_store_id: storeId,
      p_return_id: returnId,
      p_amount: amount,
      p_restock: restock,
      p_idempotency_key: key,
    });
    if (restock) invalidateStore(storeId);
  } catch (error) {
    return failure(error, values);
  }
  done(storeHandle, returnId, "reembolsada");
}

export async function closeReturn(
  storeHandle: string,
  returnId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(returnId).success) return { error: "Devolución no válida." };
  const resolution = String(formData.get("resolution") ?? "");
  const text = message(formData);
  if (resolution !== "exchange" && resolution !== "none") {
    return { error: "Elige cómo se resolvió.", values: { message: text } };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "returns_close", {
      p_store_id: storeId,
      p_return_id: returnId,
      p_resolution: resolution,
      p_message: text || null,
    });
  } catch (error) {
    return failure(error, { message: text, resolution });
  }
  done(storeHandle, returnId, "cerrada");
}

export async function setReturnWindow(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = String(formData.get("days") ?? "").trim();
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    const msg = "Escribe de 1 a 365 días.";
    return { error: msg, fields: { days: msg }, values: { days: raw } };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "returns_set_window", { p_store_id: storeId, p_days: days });
  } catch (error) {
    return failure(error, { days: raw });
  }
  revalidatePath(`/admin/${storeHandle}/pedidos/devoluciones`);
  return { ok: true, message: `Plazo guardado: ${days} días.` };
}
