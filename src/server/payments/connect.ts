import type { Sql } from "@/server/db/role-clients";
import { AppError } from "@/server/errors";

import type { StripeApi } from "./stripe";

/**
 * Onboarding de Stripe Connect (A-01, cuentas Standard). Las llamadas de red van
 * fuera de toda transacción (§44.10): primero Stripe, luego el registro en la
 * base con el worker. El estado lo decide la respuesta de Stripe, nunca el
 * navegador.
 */
const ACCOUNT_RE = /^acct_[A-Za-z0-9]{8,64}$/;

export interface StripeAccountState {
  account_id: string;
  status: "pending" | "active" | "disabled" | "error";
  mode: "test" | "live";
  details_submitted: boolean;
}

export async function startStripeOnboarding(
  deps: { db: Sql; api: StripeApi; mode: "test" | "live" },
  input: {
    storeId: string;
    country: string;
    email: string | null;
    existingAccountId: string | null;
    returnUrl: string;
    refreshUrl: string;
  },
): Promise<string> {
  let accountId = input.existingAccountId;
  if (!accountId) {
    // Misma clave por tienda: un doble clic no crea dos cuentas en Stripe.
    const created = await deps.api.createAccount(
      input.email,
      input.country,
      `connect-account:${input.storeId}`,
    );
    if (!ACCOUNT_RE.test(created.id)) throw new AppError("provider_error");
    const [row] = await deps.db<{ id: string }[]>`
      select system.stripe_attach_account(${input.storeId}::uuid, ${created.id}, ${deps.mode}) as id`;
    accountId = row!.id;
  }
  const link = await deps.api.createAccountLink(accountId, input.refreshUrl, input.returnUrl);
  // Solo el formulario alojado por Stripe (L5): nunca otra URL aunque la API la devolviera.
  if (!/^https:\/\/connect\.stripe\.com\//.test(link.url)) throw new AppError("provider_error");
  return link.url;
}

/** Consulta a Stripe y refleja el estado (retorno del onboarding o account.updated). */
export async function syncStripeAccount(
  deps: { db: Sql; api: StripeApi },
  accountId: string,
): Promise<string> {
  const status = await deps.api.accountStatus(accountId);
  const [row] = await deps.db<{ status: string }[]>`
    select system.stripe_sync_account(${accountId}, ${status.chargesEnabled},
                                      ${status.detailsSubmitted}) as status`;
  return row!.status;
}
