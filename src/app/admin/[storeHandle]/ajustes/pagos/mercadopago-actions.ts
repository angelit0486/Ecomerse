"use server";

import { revalidatePath } from "next/cache";

import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { workerDb } from "@/server/db/role-clients";
import { mercadoPagoMode, mercadoPagoProvider } from "@/server/payments/registry";
import { invalidateStore } from "@/server/storefront/cache";

import { storeClient, type FormState } from "../../_shared/action-state";

export interface MercadoPagoSettings {
  account: {
    id: string;
    user_id: string;
    status: "pending" | "active" | "disabled" | "error";
    mode: "test" | "live";
  } | null;
}

/**
 * Conecta Mercado Pago (ADR-028): el servidor valida la credencial de la plataforma
 * con /users/me y el worker registra el collector. El navegador nunca envía el id.
 */
export async function connectMercadoPago(storeHandle: string, _: FormState): Promise<FormState> {
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    // Verifica payments.manage en la base antes de cualquier llamada a Mercado Pago.
    await callRpc<MercadoPagoSettings>(supabase, "payments_get_mercadopago", {
      p_store_id: storeId,
    });
    const mp = mercadoPagoProvider();
    if (!mp) return { error: "Mercado Pago aún no está configurado en la plataforma." };
    const me = await mp.api.me();
    if (me.siteId && me.siteId !== "MLM") {
      return { error: "La cuenta de Mercado Pago debe ser de México." };
    }
    await workerDb()`select system.mercadopago_attach_account(${storeId}::uuid, ${me.id}, ${mercadoPagoMode()})`;
    invalidateStore(storeId);
  } catch (error) {
    const e = reportActionError("payments", error);
    return {
      error:
        e.code === "forbidden"
          ? e.message
          : e.code === "conflict"
            ? "Esta cuenta de Mercado Pago ya está conectada a otra tienda."
            : "No pudimos conectar Mercado Pago en este momento. Inténtalo de nuevo en unos minutos.",
    };
  }
  revalidatePath(`/admin/${storeHandle}/ajustes/pagos`);
  return { ok: true, message: "Mercado Pago conectado: ya aparece como método de pago." };
}

export async function setMercadoPagoEnabled(
  storeHandle: string,
  enabled: boolean,
  _: FormState,
): Promise<FormState> {
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc<string>(supabase, "payments_set_mercadopago_enabled", {
      p_store_id: storeId,
      p_enabled: enabled,
    });
    invalidateStore(storeId);
  } catch (error) {
    return { error: reportActionError("payments", error).message };
  }
  revalidatePath(`/admin/${storeHandle}/ajustes/pagos`);
  return {
    ok: true,
    message: enabled ? "Cobro con Mercado Pago reactivado." : "Cobro con Mercado Pago desactivado.",
  };
}
