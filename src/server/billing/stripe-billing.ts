import "server-only";

import type { Sql } from "@/server/db/role-clients";
import { z } from "zod";

import { AppError } from "@/server/errors";
import { serverEnv } from "@/server/env";
import { StripeApi, verifyStripeSignature } from "@/server/payments/stripe";

/**
 * Cobro de la suscripción de cada organización con Stripe Billing (ADR-044,
 * aprobado el 2026-10-29). Usa la cuenta Stripe de la PLATAFORMA (sin
 * `Stripe-Account`): PRUVA es quien cobra la mensualidad. El precio sale de la
 * base (`org_billing_checkout_input`), nunca del formulario (regla 8). Solo el
 * webhook firmado cambia la suscripción (regla 11).
 */
export interface BillingConfig {
  api: StripeApi;
  webhookSecret: string;
  live: boolean;
}

/** Stripe Billing configurado (clave de plataforma + secreto del webhook de cobro), o null. */
export function stripeBilling(): BillingConfig | null {
  const env = serverEnv();
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_BILLING_WEBHOOK_SECRET) return null;
  return {
    api: new StripeApi({
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_BILLING_WEBHOOK_SECRET,
      ...(env.STRIPE_API_BASE ? { apiBase: env.STRIPE_API_BASE } : {}),
    }),
    webhookSecret: env.STRIPE_BILLING_WEBHOOK_SECRET,
    live: env.STRIPE_SECRET_KEY.startsWith("sk_live_"),
  };
}

export const checkoutInputSchema = z.object({
  organization_id: z.uuid(),
  plan_key: z.string(),
  plan_name: z.string(),
  interval: z.enum(["monthly", "annual"]),
  amount: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  customer_id: z.string().nullable(),
});
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

/** Abre Stripe Checkout en modo suscripción y devuelve la URL a la que se manda a la dueña. */
export async function createSubscriptionCheckout(
  api: StripeApi,
  input: CheckoutInput & { email: string | null; successUrl: string; cancelUrl: string },
): Promise<string> {
  const metadata = {
    organization_id: input.organization_id,
    plan_key: input.plan_key,
    interval: input.interval,
  };
  // Un doble clic en el mismo minuto no abre dos sesiones.
  const minute = Math.floor(Date.now() / 60_000);
  const session = await api.request<{ url: string | null }>("POST", "/v1/checkout/sessions", {
    params: {
      mode: "subscription",
      client_reference_id: input.organization_id,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      ...(input.customer_id
        ? { customer: input.customer_id }
        : input.email
          ? { customer_email: input.email }
          : {}),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amount,
            recurring: { interval: input.interval === "annual" ? "year" : "month" },
            product_data: { name: `PRUVA · plan ${input.plan_name}` },
          },
        },
      ],
      metadata,
      subscription_data: { metadata },
    },
    idempotencyKey: `billing:${input.organization_id}:${input.plan_key}:${input.interval}:${minute}`,
  });
  if (!session.url) throw new AppError("provider_error");
  return session.url;
}

export const changeInputSchema = z.object({
  organization_id: z.uuid(),
  subscription_id: z.string().regex(/^sub_[A-Za-z0-9]{3,250}$/),
  plan_key: z.string(),
  plan_name: z.string(),
  interval: z.enum(["monthly", "annual"]),
  amount: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type ChangeInput = z.infer<typeof changeInputSchema>;

const subscriptionItems = z.object({
  items: z.object({
    data: z.array(z.object({ id: z.string().regex(/^si_[A-Za-z0-9]{3,250}$/) })).min(1),
  }),
});

/**
 * Cambia el plan o el periodo de la suscripción de Stripe con prorrateo (ADR-044):
 * Stripe abona lo no usado del plan anterior y cobra la diferencia. Aquí nada
 * cambia hasta que llega el webhook `customer.subscription.updated`.
 */
export async function changeSubscriptionPlan(api: StripeApi, input: ChangeInput): Promise<void> {
  const current = subscriptionItems.parse(
    await api.request("GET", `/v1/subscriptions/${input.subscription_id}`),
  );
  const minute = Math.floor(Date.now() / 60_000);
  const key = `billing-change:${input.organization_id}:${input.plan_key}:${input.interval}:${minute}`;
  // `price_data` de una suscripción pide un producto existente: uno por plan pedido.
  const product = await api.request<{ id: string }>("POST", "/v1/products", {
    params: { name: `PRUVA · plan ${input.plan_name}` },
    idempotencyKey: `${key}:product`,
  });
  if (!/^prod_[A-Za-z0-9]{3,250}$/.test(product.id)) throw new AppError("provider_error");
  const metadata = {
    organization_id: input.organization_id,
    plan_key: input.plan_key,
    interval: input.interval,
  };
  await api.request("POST", `/v1/subscriptions/${input.subscription_id}`, {
    params: {
      items: [
        {
          id: current.items.data[0]!.id,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amount,
            recurring: { interval: input.interval === "annual" ? "year" : "month" },
            product: product.id,
          },
        },
      ],
      proration_behavior: "create_prorations",
      metadata,
    },
    idempotencyKey: key,
  });
}

const subscriptionObject = z.object({
  id: z.string().regex(/^sub_[A-Za-z0-9]{3,250}$/),
  customer: z.string().regex(/^cus_[A-Za-z0-9]{3,250}$/),
  status: z.string(),
  current_period_end: z.number().int().optional(),
  metadata: z.object({
    organization_id: z.string(),
    plan_key: z.string(),
    interval: z.enum(["monthly", "annual"]).optional(),
  }),
});

const eventSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9]{3,250}$/),
  type: z.string(),
  created: z.number().int(),
  livemode: z.boolean(),
  data: z.object({ object: z.unknown() }),
});

/** Lo que recibe `system.billing_apply_stripe_event`. */
export interface BillingEvent {
  event_id: string;
  created: number;
  type: string;
  organization_id: string;
  customer_id: string;
  subscription_id: string;
  status: string;
  plan_key: string;
  interval: "monthly" | "annual";
  current_period_end: number | null;
}

/** Eventos que cambian la suscripción; los demás (facturas, sesiones) se responden 200 sin hacer nada. */
export const BILLING_EVENT_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export type BillingWebhookResult =
  | { kind: "rejected"; status: 400 | 401; reason: string }
  | { kind: "ignored"; reason: string }
  | { kind: "event"; event: BillingEvent };

/** Verifica la firma y traduce el evento de Stripe. Nunca confía en el cuerpo sin firma. */
export function parseBillingWebhook(input: {
  secret: string;
  signature: string | null;
  rawBody: string;
  now: Date;
  requireLivemode: boolean;
}): BillingWebhookResult {
  const verified = verifyStripeSignature({
    secret: input.secret,
    header: input.signature,
    rawBody: input.rawBody,
    now: input.now,
  });
  if (!verified.ok) return { kind: "rejected", status: 401, reason: verified.reason };
  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return { kind: "rejected", status: 400, reason: "malformed" };
  }
  const event = eventSchema.safeParse(json);
  if (!event.success) return { kind: "rejected", status: 400, reason: "malformed" };
  // En producción un evento de modo prueba no cobra nada (igual que los pagos).
  if (input.requireLivemode && !event.data.livemode)
    return { kind: "ignored", reason: "test_mode" };
  if (!BILLING_EVENT_TYPES.has(event.data.type)) return { kind: "ignored", reason: "type" };
  const sub = subscriptionObject.safeParse(event.data.data.object);
  if (!sub.success) return { kind: "ignored", reason: "not_ours" };
  return {
    kind: "event",
    event: {
      event_id: event.data.id,
      created: event.data.created,
      type: event.data.type,
      organization_id: sub.data.metadata.organization_id,
      customer_id: sub.data.customer,
      subscription_id: sub.data.id,
      // Borrada = cancelada aunque el objeto traiga otro estado.
      status: event.data.type === "customer.subscription.deleted" ? "canceled" : sub.data.status,
      plan_key: sub.data.metadata.plan_key,
      interval: sub.data.metadata.interval ?? "monthly",
      current_period_end: sub.data.current_period_end ?? null,
    },
  };
}

/**
 * Webhook del cobro (ruta /api/webhooks/billing/stripe). Firma inválida → 401 y
 * evento de seguridad con límite de frecuencia; evento válido → la base lo aplica
 * con idempotencia (`system.billing_apply_stripe_event`).
 */
export async function handleBillingWebhook(deps: {
  db: Sql;
  config: BillingConfig;
  signature: string | null;
  rawBody: string;
  now: Date;
  requireLivemode: boolean;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = parseBillingWebhook({
    secret: deps.config.webhookSecret,
    signature: deps.signature,
    rawBody: deps.rawBody,
    now: deps.now,
    requireLivemode: deps.requireLivemode,
  });
  if (parsed.kind === "rejected") {
    await deps.db`select system.record_webhook_rejection(${`billing.webhook_${parsed.reason}`}, 'stripe')`;
    return { status: parsed.status, body: { received: false } };
  }
  if (parsed.kind === "ignored")
    return { status: 200, body: { received: true, outcome: "ignored" } };
  const [row] = await deps.db<{ r: { outcome: string } }[]>`
    select system.billing_apply_stripe_event(${deps.db.json(parsed.event as never)}) as r`;
  return { status: 200, body: { received: true, outcome: row?.r.outcome ?? "unknown" } };
}
