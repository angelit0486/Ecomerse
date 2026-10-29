"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { reportActionError } from "@/server/actions/report";
import { getSession } from "@/server/auth/session";
import {
  changeInputSchema,
  changeSubscriptionPlan,
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

const CHANGE_CONFLICTS: Record<string, string> = {
  plan_without_price: "Ese plan no tiene precio para pagar con tarjeta.",
  same_plan: "Ya tienes ese plan y periodo.",
  past_due: "Tienes un cobro pendiente. Actualiza tu tarjeta en Stripe antes de cambiar de plan.",
  no_card_subscription: "No tienes una suscripción con tarjeta para cambiar.",
  "over_limit:max_stores": "Ese plan permite menos tiendas de las que tienes abiertas.",
  "over_limit:max_products": "Ese plan permite menos productos de los que tienes.",
  "over_limit:max_staff": "Ese plan permite menos personas en el equipo de las que tienes.",
};

/**
 * ADR-044 (prorrateo): cambia el plan o el periodo de la suscripción de Stripe.
 * La base pone el precio y revisa los límites; el plan cambia aquí cuando llega
 * el webhook firmado de Stripe.
 */
export async function changeCardPlan(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const billing = stripeBilling();
  if (!billing) return { error: "El pago con tarjeta aún no está configurado en la plataforma." };
  const [planKey = "", interval = ""] = String(formData.get("choice") ?? "").split(":");
  try {
    const { ctx, supabase, storeId } = await storeClient(storeHandle);
    const input = changeInputSchema.parse(
      await callRpc(supabase, "org_billing_change_input", {
        p_store_id: storeId,
        p_plan_key: planKey,
        p_interval: interval,
      }),
    );
    await changeSubscriptionPlan(billing.api, input);
    revalidatePath(`/admin/${ctx.store.handle}/ajustes/plan`);
  } catch (error) {
    const e = reportActionError("billing.change", error);
    const cause = e.cause as { details?: string | null; detail?: string } | undefined;
    const detail = cause?.details ?? cause?.detail;
    if (e.code === "conflict" && detail && CHANGE_CONFLICTS[detail]) {
      return { error: CHANGE_CONFLICTS[detail] };
    }
    if (e.code === "forbidden")
      return { error: "Solo la dueña de la organización puede cambiar el plan." };
    return { error: "No pudimos cambiar el plan. Intenta de nuevo en unos minutos." };
  }
  return {
    ok: true,
    message:
      "Pedimos el cambio a Stripe. Tu plan se actualiza en cuanto Stripe lo confirma (suele tardar unos segundos).",
  };
}
