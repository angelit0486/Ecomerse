import "server-only";

import { AppError } from "@/server/errors";
import { serverEnv } from "@/server/env";

import { createFakeProvider } from "./fake";
import { manualProvider } from "./manual";
import { createMercadoPagoProvider, type MercadoPagoProvider } from "./mercadopago";
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

/** Mercado Pago configurado (access token y secreto de la firma del webhook), o null. */
export function mercadoPagoProvider(): MercadoPagoProvider | null {
  const env = serverEnv();
  if (!env.MERCADOPAGO_ACCESS_TOKEN || !env.MERCADOPAGO_WEBHOOK_SECRET) return null;
  return createMercadoPagoProvider({
    accessToken: env.MERCADOPAGO_ACCESS_TOKEN,
    webhookSecret: env.MERCADOPAGO_WEBHOOK_SECRET,
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
