"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { workerDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";
import { startStripeOnboarding } from "@/server/payments/connect";
import { stripeProvider } from "@/server/payments/registry";
import { invalidateStore } from "@/server/storefront/cache";

import { storeClient, type FormState } from "../../_shared/action-state";

export interface StripeSettings {
  store: { country: string; contact_email: string | null };
  account: {
    id: string;
    account_id: string;
    status: "pending" | "active" | "disabled" | "error";
    mode: "test" | "live";
    details_submitted: boolean;
  } | null;
}

/** URLs de retorno del onboarding: siempre en el panel (APP_URL), nunca en la tienda. */
function onboardingUrls(storeHandle: string) {
  const base = `${serverEnv().APP_URL}/admin/${encodeURIComponent(storeHandle)}/ajustes/pagos/stripe`;
  return { returnUrl: `${base}/retorno`, refreshUrl: `${base}/reanudar` };
}

/** Crea (o retoma) la cuenta conectada y lleva al formulario de Stripe. */
export async function stripeOnboardingUrl(storeHandle: string): Promise<string> {
  const { supabase, storeId } = await storeClient(storeHandle);
  // Verifica payments.manage en la base antes de cualquier llamada a Stripe.
  const settings = await callRpc<StripeSettings>(supabase, "payments_get_stripe", {
    p_store_id: storeId,
  });
  const stripe = stripeProvider();
  if (!stripe) throw new Error("stripe_not_configured");
  const mode = serverEnv().STRIPE_SECRET_KEY!.startsWith("sk_live_") ? "live" : "test";
  return startStripeOnboarding(
    { db: workerDb(), api: stripe.api, mode },
    {
      storeId,
      country: settings.store.country,
      email: settings.store.contact_email,
      existingAccountId: settings.account?.account_id ?? null,
      ...onboardingUrls(storeHandle),
    },
  );
}

export async function connectStripe(storeHandle: string, _: FormState): Promise<FormState> {
  let url: string;
  try {
    url = await stripeOnboardingUrl(storeHandle);
  } catch (error) {
    const e = reportActionError("payments", error);
    return {
      error:
        e.code === "forbidden"
          ? e.message
          : "No pudimos abrir Stripe en este momento. Inténtalo de nuevo en unos minutos.",
    };
  }
  redirect(url);
}

export async function setStripeEnabled(
  storeHandle: string,
  enabled: boolean,
  _: FormState,
): Promise<FormState> {
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "payments_set_stripe_enabled", {
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
    message: enabled
      ? "Cobro con tarjeta reactivado: se activa cuando Stripe lo confirme."
      : "Cobro con tarjeta desactivado.",
  };
}
