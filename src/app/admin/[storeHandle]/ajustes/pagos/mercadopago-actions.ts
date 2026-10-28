"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { workerDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";
import {
  authorizeUrl,
  createPkce,
  newPending,
  OAUTH_CALLBACK_PATH,
  OAUTH_COOKIE,
  OAUTH_STATE_PURPOSE,
  signPending,
} from "@/server/payments/mercadopago-oauth";
import { mercadoPagoMode, mercadoPagoOAuth, mercadoPagoProvider } from "@/server/payments/registry";
import { deriveKey, parseKey } from "@/server/security/secret-box";
import { invalidateStore } from "@/server/storefront/cache";

import { storeClient, type FormState } from "../../_shared/action-state";

export interface MercadoPagoSettings {
  account: {
    id: string;
    user_id: string;
    status: "pending" | "active" | "disabled" | "error";
    mode: "test" | "live";
    /** ADR-041: cobra en la cuenta del comercio (llaves propias). */
    own_account?: boolean;
  } | null;
}

/**
 * ADR-041: manda a la dueña a autorizar SU cuenta en Mercado Pago. La cookie
 * firmada recuerda tienda, usuario y verificador PKCE durante 10 minutos; el
 * regreso (OAUTH_CALLBACK_PATH) la exige.
 */
export async function startMercadoPagoOAuth(storeHandle: string, _: FormState): Promise<FormState> {
  let url: string;
  try {
    const { ctx, supabase, storeId } = await storeClient(storeHandle);
    // payments.manage en la base antes de mandar a nadie a Mercado Pago.
    await callRpc<MercadoPagoSettings>(supabase, "payments_get_mercadopago", {
      p_store_id: storeId,
    });
    const oauth = mercadoPagoOAuth();
    const env = serverEnv();
    if (!oauth || !env.PAYMENT_CREDENTIALS_KEY) {
      return { error: "Mercado Pago aún no está configurado en la plataforma." };
    }
    const pkce = createPkce();
    const pending = newPending({
      storeId,
      storeHandle: ctx.store.handle,
      userId: ctx.userId,
      verifier: pkce.verifier,
    });
    const key = deriveKey(parseKey(env.PAYMENT_CREDENTIALS_KEY), OAUTH_STATE_PURPOSE);
    (await cookies()).set(OAUTH_COOKIE, signPending(key, pending), {
      httpOnly: true,
      secure: env.APP_URL.startsWith("https://"),
      sameSite: "lax",
      path: OAUTH_CALLBACK_PATH,
      maxAge: 600,
    });
    url = authorizeUrl(oauth, pending.nonce, pkce.challenge);
  } catch (error) {
    const e = reportActionError("payments", error);
    return { error: e.code === "forbidden" ? e.message : "No pudimos iniciar la conexión." };
  }
  redirect(url);
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
