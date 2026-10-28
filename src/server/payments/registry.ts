import "server-only";

import { AppError } from "@/server/errors";
import { serverEnv } from "@/server/env";

import { createFakeProvider } from "./fake";
import { manualProvider } from "./manual";
import { workerDb } from "@/server/db/role-clients";
import { parseKey } from "@/server/security/secret-box";

import { createMercadoPagoProvider, type MercadoPagoProvider } from "./mercadopago";
import { createTokenResolver, type CredentialDeps } from "./mercadopago-credentials";
import { OAUTH_CALLBACK_PATH, type MercadoPagoOAuthConfig } from "./mercadopago-oauth";
import type { PaymentProvider } from "./provider";
import { createStripeProvider, type StripeProvider } from "./stripe";

/** Stripe configurado (clave de plataforma y secreto del webhook Connect), o null. */
export function stripeProvider(): StripeProvider | null {
  const env = serverEnv();
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_CONNECT_WEBHOOK_SECRET) return null;
  // En producción solo claves live; fuera de producción solo test (nunca se cobra de verdad en pruebas).
  const live = env.STRIPE_SECRET_KEY.startsWith("sk_live_");
  if (live !== (env.APP_ENV === "production")) return null;
  return createStripeProvider({
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_CONNECT_WEBHOOK_SECRET,
    ...(env.STRIPE_API_BASE ? { apiBase: env.STRIPE_API_BASE } : {}),
  });
}

/** Aplicación OAuth de Mercado Pago (ADR-041), o null si no está configurada. */
export function mercadoPagoOAuth(): MercadoPagoOAuthConfig | null {
  const env = serverEnv();
  if (
    !env.MERCADOPAGO_CLIENT_ID ||
    !env.MERCADOPAGO_CLIENT_SECRET ||
    !env.PAYMENT_CREDENTIALS_KEY
  ) {
    return null;
  }
  return {
    clientId: env.MERCADOPAGO_CLIENT_ID,
    clientSecret: env.MERCADOPAGO_CLIENT_SECRET,
    redirectUri: `${env.APP_URL}${OAUTH_CALLBACK_PATH}`,
    ...(env.MERCADOPAGO_AUTH_BASE ? { authBase: env.MERCADOPAGO_AUTH_BASE } : {}),
    ...(env.MERCADOPAGO_API_BASE ? { apiBase: env.MERCADOPAGO_API_BASE } : {}),
  };
}

/** Llaves de los comercios: base del worker, clave de cifrado y renovación. */
export function mercadoPagoCredentialDeps(): CredentialDeps | null {
  const env = serverEnv();
  if (!env.PAYMENT_CREDENTIALS_KEY || !env.MERCADOPAGO_ACCESS_TOKEN) return null;
  return {
    db: workerDb(),
    key: parseKey(env.PAYMENT_CREDENTIALS_KEY),
    oauth: mercadoPagoOAuth(),
    platformToken: env.MERCADOPAGO_ACCESS_TOKEN,
  };
}

/** Mercado Pago configurado (access token y secreto de la firma del webhook), o null. */
export function mercadoPagoProvider(): MercadoPagoProvider | null {
  const env = serverEnv();
  if (!env.MERCADOPAGO_ACCESS_TOKEN || !env.MERCADOPAGO_WEBHOOK_SECRET) return null;
  const credentials = mercadoPagoCredentialDeps();
  return createMercadoPagoProvider({
    accessToken: env.MERCADOPAGO_ACCESS_TOKEN,
    webhookSecret: env.MERCADOPAGO_WEBHOOK_SECRET,
    // ADR-041: cada cuenta con llaves propias cobra, consulta y reembolsa con ellas.
    ...(credentials ? { tokenFor: createTokenResolver(credentials) } : {}),
    ...(env.MERCADOPAGO_API_BASE ? { apiBase: env.MERCADOPAGO_API_BASE } : {}),
  });
}

/** Modo de las cuentas de Mercado Pago: en producción solo cobros reales; fuera, solo de prueba. */
export function mercadoPagoMode(): "test" | "live" {
  return serverEnv().APP_ENV === "production" ? "live" : "test";
}

/** Adaptador por clave. `fake` no existe en producción, aunque la base lo permitiera. */
export function paymentProvider(key: string): PaymentProvider {
  const env = serverEnv();
  if (key === "manual") return manualProvider;
  if (key === "fake" && env.APP_ENV !== "production")
    return createFakeProvider(env.ORDER_LINK_SECRET);
  if (key === "stripe") {
    const stripe = stripeProvider();
    if (stripe) return stripe;
  }
  if (key === "mercadopago") {
    const mp = mercadoPagoProvider();
    if (mp) return mp;
  }
  throw new AppError("provider_error", "Este método de pago no está disponible.");
}
