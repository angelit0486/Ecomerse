"use server";

import { redirect } from "next/navigation";

import { reportActionError } from "@/server/actions/report";
import { serverEnv } from "@/server/env";
import { verifyOptout } from "@/server/notifications/cart-recovery-links";
import { optOutCartRecovery, recoverCart } from "@/server/storefront/cart";
import { getStorefront } from "@/server/storefront/context";

/**
 * ADR-048: el correo abre una página y la acción se confirma con un botón (POST).
 * Así los revisores de enlaces del correo no gastan el enlace de un solo uso ni
 * dan de baja a nadie solo por abrirlo.
 */
export async function recoverFromReminder(storeId: string, formData: FormData): Promise<void> {
  const { store } = await getStorefront(storeId);
  const token = String(formData.get("t") ?? "");
  let ok = false;
  try {
    ok = await recoverCart(store.id, token);
  } catch (error) {
    reportActionError("storefront", error);
  }
  redirect(ok ? "/carrito" : "/carrito/recuperar?estado=vencido");
}

export async function optOutFromReminders(storeId: string, formData: FormData): Promise<void> {
  const { store } = await getStorefront(storeId);
  const hash = String(formData.get("h") ?? "");
  const signature = String(formData.get("s") ?? "");
  if (!verifyOptout(serverEnv().ORDER_LINK_SECRET, store.id, hash, signature)) {
    redirect("/carrito/recordatorios?estado=invalido");
  }
  try {
    await optOutCartRecovery(store.id, hash);
  } catch (error) {
    reportActionError("storefront", error);
    redirect("/carrito/recordatorios?estado=error");
  }
  redirect("/carrito/recordatorios?estado=listo");
}
