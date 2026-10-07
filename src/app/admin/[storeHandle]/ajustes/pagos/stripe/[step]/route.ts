import { NextResponse, type NextRequest } from "next/server";

import { callRpc } from "@/server/db/rpc";
import { workerDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";
import { reportActionError } from "@/server/actions/report";
import { syncStripeAccount } from "@/server/payments/connect";
import { stripeProvider } from "@/server/payments/registry";
import { invalidateStore } from "@/server/storefront/cache";

import { storeClient } from "../../../../_shared/action-state";
import { stripeOnboardingUrl, type StripeSettings } from "../../actions";

/**
 * Retorno del onboarding de Stripe (Account Links). `retorno`: se consulta a
 * Stripe y se refleja el estado; `reanudar`: el enlace venció y se emite otro.
 * Los parámetros de la URL no deciden nada: solo la respuesta de Stripe.
 */
type Params = { params: Promise<{ storeHandle: string; step: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { storeHandle, step } = await params;
  const back = new URL(
    `/admin/${encodeURIComponent(storeHandle)}/ajustes/pagos`,
    serverEnv().APP_URL,
  );
  try {
    if (step === "reanudar") {
      return NextResponse.redirect(await stripeOnboardingUrl(storeHandle), 303);
    }
    if (step !== "retorno") return new NextResponse(null, { status: 404 });
    const { supabase, storeId } = await storeClient(storeHandle);
    const settings = await callRpc<StripeSettings>(supabase, "payments_get_stripe", {
      p_store_id: storeId,
    });
    const stripe = stripeProvider();
    if (stripe && settings.account) {
      const status = await syncStripeAccount(
        { db: workerDb(), api: stripe.api },
        settings.account.account_id,
      );
      invalidateStore(storeId);
      back.searchParams.set("stripe", status === "active" ? "activo" : "pendiente");
    }
  } catch (error) {
    reportActionError("payments", error);
    back.searchParams.set("stripe", "error");
  }
  return NextResponse.redirect(back, 303);
}
