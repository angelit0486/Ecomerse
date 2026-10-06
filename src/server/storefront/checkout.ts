import "server-only";

import { randomBytes } from "node:crypto";

import { headers } from "next/headers";

import { gatewayDb } from "@/server/db/role-clients";
import { toAppError } from "@/server/db/errors";
import { AppError } from "@/server/errors";
import { serverEnv } from "@/server/env";
import { createLogger } from "@/server/observability/logger";
import { guestToken, tokenHash } from "@/server/payments/order-links";
import type { PaymentProviderKey } from "@/server/payments/provider";
import { paymentProvider } from "@/server/payments/registry";

import { cartToken, clientIpHash } from "./cart";

/**
 * Checkout (GATE0 §17.4-17.5): place_order en una transacción de la base y,
 * DESPUÉS del commit, createCheckout con el proveedor. Ninguna llamada de red
 * ocurre dentro de la transacción.
 */
const log = createLogger();

export interface PlaceOrderInput {
  email: string;
  customer_name: string;
  phone?: string;
  shipping_address?: Record<string, string>;
  shipping_rate_id?: string;
  discount_code?: string;
  customer_note?: string;
  payment_account_id: string;
  accepts_marketing?: boolean;
}

interface PlacedOrder {
  order_id: string;
  display_number: string;
  replayed: boolean;
  payment: { id: string; provider: PaymentProviderKey; status: string } | null;
}

/** Clave de idempotencia generada al renderizar el checkout (§16.6). */
export function newCheckoutKey(): string {
  return `chk_${randomBytes(18).toString("base64url")}`;
}

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  if (!host) throw new AppError("internal");
  const env = serverEnv();
  const proto = env.APP_ENV === "production" || env.APP_ENV === "preview" ? "https" : "http";
  return `${proto}://${host}`;
}

export function orderPath(orderId: string, token: string): string {
  return `/pedido/${orderId}?t=${token}`;
}

/** Devuelve a dónde llevar al comprador: la pasarela o la página del pedido. */
export async function placeOrder(
  storeId: string,
  input: PlaceOrderInput,
  expectedTotal: number,
  idempotencyKey: string,
): Promise<string> {
  const token = await cartToken();
  if (!token) throw new AppError("cart_invalid");
  const db = gatewayDb();
  const [guard] = await db<{ ok: boolean }[]>`
    select storefront.checkout_guard(${storeId}, ${await clientIpHash()}, ${input.email}) as ok`;
  if (!guard?.ok) throw new AppError("rate_limited");

  const guest = guestToken(serverEnv().ORDER_LINK_SECRET, idempotencyKey);
  let placed: PlacedOrder;
  try {
    const [row] = await db<{ value: PlacedOrder }[]>`
      select storefront.place_order(${storeId}, ${token}, ${db.json(input as never)}, ${expectedTotal},
                                    ${idempotencyKey}, ${tokenHash(guest)}) as value`;
    placed = row!.value;
  } catch (error) {
    throw toAppError(error);
  }
  const back = orderPath(placed.order_id, guest);
  if (!placed.payment || placed.payment.status !== "created") return back;
  return startPayment(storeId, placed.payment.id, back);
}

/** createCheckout fuera de la transacción; un fallo deja el pedido pendiente (§17.5.16). */
export async function startPayment(
  storeId: string,
  paymentId: string,
  backPath: string,
): Promise<string> {
  const db = gatewayDb();
  const [row] = await db<{ value: CheckoutData | null }[]>`
    select storefront.payment_for_checkout(${storeId}, ${paymentId}) as value`;
  const data = row?.value;
  if (!data) throw new AppError("not_found");
  const back = `${await requestOrigin()}${backPath}`;
  try {
    const result = await paymentProvider(data.account.provider).createCheckout({
      account: {
        id: data.account.id,
        provider: data.account.provider,
        mode: data.account.mode,
        publicConfig: data.account.public_config,
      },
      payment: {
        id: data.payment.id,
        amount: Number(data.payment.amount),
        currency: data.payment.currency,
      },
      order: {
        id: data.order.id,
        displayNumber: data.order.display_number,
        items: data.items.map((i) => ({
          title: i.title,
          quantity: i.quantity,
          unitPrice: Number(i.unit_price),
        })),
      },
      buyer: { email: data.order.email, name: data.order.customer_name },
      returnUrls: { success: back, pending: back, failure: back },
      expiresAt: new Date(data.payment.expires_at),
      idempotencyKey: data.payment.id,
    });
    await db`select storefront.record_checkout_result(${storeId}, ${paymentId}, true, ${result.providerCheckoutId})`;
    return result.redirectUrl ?? backPath;
  } catch (error) {
    log.warn("createCheckout falló", { payment_id: paymentId, provider: data.account.provider });
    await db`select storefront.record_checkout_result(${storeId}, ${paymentId}, false, 'provider_error')`;
    if (error instanceof AppError) throw error;
    return backPath;
  }
}

interface CheckoutData {
  payment: { id: string; amount: number; currency: string; status: string; expires_at: string };
  account: {
    id: string;
    provider: PaymentProviderKey;
    mode: "test" | "live";
    public_config: Record<string, unknown>;
  };
  order: { id: string; display_number: string; email: string; customer_name: string };
  items: { title: string; quantity: number; unit_price: number }[];
}

export interface GuestOrder {
  id: string;
  display_number: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  placed_at: string;
  cancel_reason: string | null;
  email: string;
  customer_name: string;
  shipping_address: Record<string, string> | null;
  currency: string;
  prices_include_tax: boolean;
  subtotal: number;
  discount_total: number;
  shipping_total: number;
  tax_total: number;
  total: number;
  shipping: { name: string; est_days_min: number | null; est_days_max: number | null } | null;
  discount: { code: string; amount: number } | null;
  items: {
    product_title: string;
    variant_title: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
    image_path: string | null;
  }[];
  events: { type: string; to_value: string | null; message: string | null; created_at: string }[];
  payment: {
    id: string;
    provider: PaymentProviderKey;
    status: string;
    expires_at: string | null;
    display_name: string;
    instructions: string | null;
  } | null;
}

export async function guestOrder(
  storeId: string,
  orderId: string,
  token: string,
): Promise<(GuestOrder & { minutes_left: number | null }) | null> {
  const [row] = await gatewayDb()<{ value: GuestOrder | null }[]>`
    select storefront.get_order_for_guest(${storeId}, ${orderId}, ${tokenHash(token)}) as value`;
  const order = row?.value;
  if (!order) return null;
  const expires = order.payment?.expires_at ? Date.parse(order.payment.expires_at) : NaN;
  return {
    ...order,
    minutes_left: Number.isFinite(expires)
      ? Math.max(0, Math.round((expires - Date.now()) / 60000))
      : null,
  };
}

export async function retryPayment(
  storeId: string,
  orderId: string,
  token: string,
): Promise<string> {
  const back = orderPath(orderId, token);
  let payment: { id: string; status: string; replayed: boolean };
  try {
    const [row] = await gatewayDb()<{ value: typeof payment }[]>`
      select storefront.retry_payment(${storeId}, ${orderId}, ${tokenHash(token)}) as value`;
    payment = row!.value;
  } catch (error) {
    throw toAppError(error);
  }
  return startPayment(storeId, payment.id, back);
}

export async function fakePaymentResult(
  storeId: string,
  paymentId: string,
  outcome: "succeeded" | "failed",
): Promise<void> {
  if (serverEnv().APP_ENV === "production") throw new AppError("not_found");
  try {
    await gatewayDb()`select storefront.fake_payment_result(${storeId}, ${paymentId}, ${outcome})`;
  } catch (error) {
    throw toAppError(error);
  }
}
