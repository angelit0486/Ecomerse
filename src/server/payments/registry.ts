import "server-only";

import { AppError } from "@/server/errors";
import { serverEnv } from "@/server/env";

import { createFakeProvider } from "./fake";
import { manualProvider } from "./manual";
import type { PaymentProvider } from "./provider";

/** Adaptador por clave. `fake` no existe en producción, aunque la base lo permitiera. */
export function paymentProvider(key: string): PaymentProvider {
  const env = serverEnv();
  if (key === "manual") return manualProvider;
  if (key === "fake" && env.APP_ENV !== "production")
    return createFakeProvider(env.ORDER_LINK_SECRET);
  throw new AppError("provider_error", "Este método de pago no está disponible.");
}
