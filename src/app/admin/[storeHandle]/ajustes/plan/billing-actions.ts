"use server";

import { redirect } from "next/navigation";

import { reportActionError } from "@/server/actions/report";
import { getSession } from "@/server/auth/session";
import {
  checkoutInputSchema,
  createSubscriptionCheckout,
  stripeBilling,
} from "@/server/billing/stripe-billing";
import { callRpc } from "@/server/db/rpc";
import { serverEnv } from "@/server/env";

import { storeClient, type FormState } from "../../_shared/action-state";

const CONFLICTS: Record<string, string> = {
  plan_without_price: "Ese plan no tiene precio para pagar con tarjeta.",
  already_subscribed: "Ya tienes una suscripción con tarjeta activa.",
};

/**
 * ADR-044: manda a la dueña a pagar su plan en Stripe Checkout. El precio sale
 * de la base (`org_billing_checkout_input` exige org.billing.manage y AAL2); la
 * suscripción solo cambia cuando llega el webhook firmado.
 */
export async function startCardPayment(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const billing = stripeBilling();
  if (!billing) return { error: "El pago con tarjeta aún no está configurado en la plataforma." };
  let url: string;
  try {
    const { ctx, supabase, storeId } = await storeClient(storeHandle);
    const input = checkoutInputSchema.parse(
      await callRpc(supabase, "org_billing_checkout_input", {
        p_store_id: storeId,
        // «plan:intervalo» del formulario; la base valida ambos y pone el precio.
        p_plan_key: String(formData.get("choice") ?? "").split(":")[0] ?? "",
        p_interval: String(formData.get("choice") ?? "").split(":")[1] ?? "",
      }),
    );
    const base = `${serverEnv().APP_URL}/admin/${ctx.store.handle}/ajustes/plan`;
    url = await createSubscriptionCheckout(billing.api, {
      ...input,
      email: (await getSession())?.email ?? null,
      successUrl: `${base}?pago=listo`,
      cancelUrl: `${base}?pago=cancelado`,
    });
  } catch (error) {
    const e = reportActionError("billing.checkout", error);
    // El motivo del conflicto viaja en el error original de la base (`details`).
    const cause = e.cause as { details?: string | null; detail?: string } | undefined;
    const detail = cause?.details ?? cause?.detail;
    if (e.code === "conflict" && detail && CONFLICTS[detail]) return { error: CONFLICTS[detail] };
    if (e.code === "forbidden")
      return { error: "Solo la dueña de la organización puede pagar el plan." };
    return { error: "No pudimos abrir el pago. Intenta de nuevo en unos minutos." };
  }
  redirect(url);
}
