import { createHash, createHmac, randomBytes } from "node:crypto";

import { AppError } from "@/server/errors";
import { constantTimeEqual } from "@/server/security/hmac";

import { MercadoPagoHttpError } from "./mercadopago";

/**
 * OAuth de Mercado Pago (ADR-041): cada comercio autoriza a la aplicación de la
 * plataforma y Mercado Pago entrega las llaves de SU cuenta. Authorization code
 * con PKCE (S256) y `state` de un solo uso atado a la tienda, al usuario y a una
 * cookie httpOnly firmada; el código vence a los 10 minutos.
 */
export interface MercadoPagoOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Debe coincidir exactamente con la registrada en la aplicación de Mercado Pago. */
  redirectUri: string;
  authBase?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export interface MercadoPagoTokens {
  accessToken: string;
  refreshToken: string | null;
  userId: string;
  expiresAt: Date;
  liveMode: boolean | null;
}

/** Cookie httpOnly que acompaña la ida y el regreso (solo viaja a la ruta de regreso). */
export const OAUTH_COOKIE = "mp_oauth";
export const OAUTH_CALLBACK_PATH = "/api/payments/mercadopago/callback";
/** Subclave de PAYMENT_CREDENTIALS_KEY para firmar la cookie. */
export const OAUTH_STATE_PURPOSE = "mercadopago-oauth-state";

const TOKEN_RE = /^(APP_USR|TEST)-[A-Za-z0-9-]{20,300}$/;
const STATE_TTL_MS = 10 * 60 * 1000;

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(
  cfg: MercadoPagoOAuthConfig,
  state: string,
  challenge: string,
): string {
  const url = new URL("/authorization", cfg.authBase ?? "https://auth.mercadopago.com");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** Lo que la cookie recuerda entre la ida a Mercado Pago y el regreso. */
export interface OAuthPending {
  storeId: string;
  storeHandle: string;
  userId: string;
  verifier: string;
  nonce: string;
  expiresAt: number;
}

export function newPending(input: Omit<OAuthPending, "nonce" | "expiresAt">, now = Date.now()) {
  return { ...input, nonce: randomBytes(24).toString("base64url"), expiresAt: now + STATE_TTL_MS };
}

export function signPending(key: Buffer, pending: OAuthPending): string {
  const body = Buffer.from(JSON.stringify(pending)).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

/**
 * Cookie válida, del mismo usuario, sin vencer y con el `state` que regresó de
 * Mercado Pago; si no, null (el regreso se rechaza sin tocar nada).
 */
export function verifyPending(
  key: Buffer,
  cookie: string | undefined,
  input: { state: string | null; userId: string; now?: number },
): OAuthPending | null {
  if (!cookie || !input.state || cookie.length > 4096) return null;
  const [body, mac] = cookie.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", key).update(body).digest("base64url");
  if (!constantTimeEqual(mac, expected)) return null;
  let pending: OAuthPending;
  try {
    pending = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthPending;
  } catch {
    return null;
  }
  if (pending.expiresAt < (input.now ?? Date.now())) return null;
  if (pending.userId !== input.userId) return null;
  if (!constantTimeEqual(pending.nonce, input.state)) return null;
  return pending;
}

async function tokenRequest(
  cfg: MercadoPagoOAuthConfig,
  body: Record<string, string>,
  now: Date,
): Promise<MercadoPagoTokens> {
  const base = cfg.apiBase ?? "https://api.mercadopago.com";
  let response: Response;
  try {
    response = await (cfg.fetchImpl ?? fetch)(`${base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new AppError("provider_error", undefined, { cause: error });
  }
  // Nunca se lee ni se registra el cuerpo del error (podría reflejar la solicitud).
  if (!response.ok) throw new MercadoPagoHttpError(response.status, "/oauth/token", "POST");
  const t = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    user_id?: unknown;
    expires_in?: unknown;
    live_mode?: unknown;
  };
  const userId =
    typeof t.user_id === "number" || typeof t.user_id === "string" ? String(t.user_id) : "";
  if (
    typeof t.access_token !== "string" ||
    !TOKEN_RE.test(t.access_token) ||
    !/^[0-9]{1,20}$/.test(userId) ||
    typeof t.expires_in !== "number" ||
    t.expires_in < 3600 ||
    (t.refresh_token != null &&
      (typeof t.refresh_token !== "string" || t.refresh_token.length > 400))
  ) {
    throw new AppError("provider_error");
  }
  return {
    accessToken: t.access_token,
    refreshToken: typeof t.refresh_token === "string" ? t.refresh_token : null,
    userId,
    expiresAt: new Date(now.getTime() + t.expires_in * 1000),
    liveMode: typeof t.live_mode === "boolean" ? t.live_mode : null,
  };
}

export async function exchangeCode(
  cfg: MercadoPagoOAuthConfig,
  input: { code: string; verifier: string; now?: Date },
): Promise<MercadoPagoTokens> {
  if (!/^[A-Za-z0-9_-]{8,300}$/.test(input.code)) throw new AppError("validation_failed");
  return tokenRequest(
    cfg,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: cfg.redirectUri,
      code_verifier: input.verifier,
    },
    input.now ?? new Date(),
  );
}

/** Mercado Pago entrega un refresh token nuevo en cada renovación: hay que guardarlo. */
export function refreshTokens(
  cfg: MercadoPagoOAuthConfig,
  refreshToken: string,
  now = new Date(),
): Promise<MercadoPagoTokens> {
  return tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refreshToken }, now);
}
