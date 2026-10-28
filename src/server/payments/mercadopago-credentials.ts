import type { Sql } from "@/server/db/role-clients";
import { AppError } from "@/server/errors";
import { open, seal } from "@/server/security/secret-box";

import type { MercadoPagoApi } from "./mercadopago";
import {
  exchangeCode,
  refreshTokens,
  type MercadoPagoOAuthConfig,
  type MercadoPagoTokens,
} from "./mercadopago-oauth";
import type { PaymentAccountCredentials } from "./provider";

/**
 * Llaves de Mercado Pago de cada comercio (ADR-041). Viven cifradas en
 * `system.payment_credentials`; aquí se descifran solo en memoria y para una
 * llamada. Las llamadas de red van fuera de toda transacción (§44.10).
 */
export interface CredentialDeps {
  db: Sql;
  key: Buffer;
  oauth: MercadoPagoOAuthConfig | null;
  /** Cuentas conectadas antes de ADR-041 (sin llaves propias) siguen con esta. */
  platformToken: string;
  now?: () => Date;
}

/** Dato autenticado del sobre: una llave copiada a otra tienda no se abre. */
export function credentialContext(storeId: string): string {
  return `mercadopago:${storeId}`;
}

/** Se renueva si le queda menos de un día (además de la renovación diaria a 30 días). */
const RENEW_MARGIN_MS = 24 * 60 * 60 * 1000;

interface Row {
  store_id: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: Date;
}

async function saveRefreshed(
  deps: CredentialDeps,
  accountId: string,
  row: Row,
  t: MercadoPagoTokens,
) {
  const ctx = credentialContext(row.store_id);
  await deps.db`
    select system.mercadopago_save_tokens(${accountId}::uuid, ${seal(deps.key, t.accessToken, ctx)},
                                          ${t.refreshToken ? seal(deps.key, t.refreshToken, ctx) : null},
                                          ${t.expiresAt})`;
}

/** Renueva las llaves de una cuenta con su refresh token y las guarda; devuelve el access token. */
export async function refreshAccount(
  deps: CredentialDeps,
  accountId: string,
): Promise<string | null> {
  const [row] = await deps.db<
    Row[]
  >`select * from system.mercadopago_credentials(${accountId}::uuid)`;
  if (!row?.refresh_token_enc || !deps.oauth) return null;
  const refresh = open(deps.key, row.refresh_token_enc, credentialContext(row.store_id));
  const tokens = await refreshTokens(deps.oauth, refresh, deps.now?.() ?? new Date());
  await saveRefreshed(deps, accountId, row, tokens);
  return tokens.accessToken;
}

/** Token con el que se habla con Mercado Pago en nombre de la cuenta de la tienda. */
export function createTokenResolver(
  deps: CredentialDeps,
): (account: PaymentAccountCredentials) => Promise<string> {
  return async (account) => {
    if (!account.id) return deps.platformToken;
    const [row] = await deps.db<
      Row[]
    >`select * from system.mercadopago_credentials(${account.id}::uuid)`;
    if (!row) return deps.platformToken;
    const now = deps.now?.() ?? new Date();
    if (new Date(row.expires_at).getTime() - now.getTime() < RENEW_MARGIN_MS && deps.oauth) {
      const fresh = await refreshAccount(deps, account.id);
      if (fresh) return fresh;
    }
    return open(deps.key, row.access_token_enc, credentialContext(row.store_id));
  };
}

export type ConnectFailure = "not_mexico" | "mode_mismatch" | "account_mismatch";

/**
 * Regreso de la autorización: cambia el código por las llaves, confirma con
 * /users/me (con la llave del comercio) que la cuenta es de México y es la misma,
 * y las guarda cifradas. El navegador nunca envía el id de la cuenta.
 */
export async function connectWithCode(
  deps: CredentialDeps & {
    oauth: MercadoPagoOAuthConfig;
    api: MercadoPagoApi;
    mode: "test" | "live";
  },
  input: { storeId: string; code: string; verifier: string },
): Promise<{ ok: true; accountId: string } | { ok: false; reason: ConnectFailure }> {
  const tokens = await exchangeCode(deps.oauth, {
    code: input.code,
    verifier: input.verifier,
    now: deps.now?.() ?? new Date(),
  });
  // Producción solo con cuentas reales; fuera de producción solo de prueba.
  if (tokens.liveMode !== null && tokens.liveMode !== (deps.mode === "live")) {
    return { ok: false, reason: "mode_mismatch" };
  }
  const me = await deps.api.me(tokens.accessToken);
  if (me.siteId && me.siteId !== "MLM") return { ok: false, reason: "not_mexico" };
  if (me.id !== tokens.userId) return { ok: false, reason: "account_mismatch" };
  const ctx = credentialContext(input.storeId);
  const [row] = await deps.db<{ id: string }[]>`
    select system.mercadopago_attach_oauth(
      ${input.storeId}::uuid, ${tokens.userId}, ${deps.mode},
      ${seal(deps.key, tokens.accessToken, ctx)},
      ${tokens.refreshToken ? seal(deps.key, tokens.refreshToken, ctx) : null},
      ${tokens.expiresAt}) as id`;
  if (!row?.id) throw new AppError("internal");
  return { ok: true, accountId: row.id };
}

/** Job diario: renueva las llaves que vencen en menos de 30 días. */
export async function refreshDueAccounts(deps: CredentialDeps): Promise<number> {
  const due = await deps.db<{ payment_account_id: string }[]>`
    select payment_account_id from system.mercadopago_credentials_due(50)`;
  let renewed = 0;
  for (const d of due) {
    // Un fallo de una cuenta no detiene las demás; el job de mañana la reintenta.
    if (await refreshAccount(deps, d.payment_account_id).catch(() => null)) renewed += 1;
  }
  return renewed;
}
