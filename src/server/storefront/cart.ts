import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { cookies, headers } from "next/headers";

import { gatewayDb } from "@/server/db/role-clients";
import { toAppError, type DbErrorLike } from "@/server/db/errors";
import { AppError } from "@/server/errors";
import { serverEnv } from "@/server/env";

/**
 * Carrito del comprador (GATE0 §17.1-17.2). El token vive en una cookie
 * httpOnly del host de la tienda; la base solo guarda su SHA-256. Nada del
 * carrito se cachea entre requests (depende del comprador, §44.7).
 */
export const CART_COOKIE = "__cart";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface CartLine {
  variant_id: string;
  product_id: string;
  product_title: string;
  product_slug: string;
  variant_title: string | null;
  sku: string | null;
  unit_price: number;
  compare_at_price: number | null;
  quantity: number;
  line_subtotal?: number;
  discount_allocation?: number;
  line_total?: number;
  image: { path: string; alt: string | null } | null;
  state: "ok" | "insufficient_stock" | "unavailable";
  available_quantity: number | null;
}

export interface ShippingOption {
  rate_id: string;
  name: string;
  type: "flat" | "free_over" | "pickup";
  price: number;
  free_over_subtotal: number | null;
  est_days_min: number | null;
  est_days_max: number | null;
}

export interface Address {
  recipient_name: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  phone?: string;
}

export interface CartView {
  cart_id: string;
  currency: string;
  prices_include_tax: boolean;
  email: string | null;
  shipping_address: Address | null;
  lines: CartLine[];
  item_count: number;
  requires_shipping: boolean;
  discount: { code: string; status: string; amount: number } | null;
  discount_code: string | null;
  shipping:
    | { status: "ok"; rate_id: string; name: string; price: number }
    | { status: "address_required" | "rate_required" | "unavailable" | "not_required" };
  shipping_options: ShippingOption[];
  shipping_rate_id: string | null;
  subtotal: number;
  discount_total: number;
  shipping_total: number;
  tax_total: number;
  total: number;
  has_unavailable: boolean;
  has_insufficient_stock: boolean;
}

export interface PaymentMethod {
  id: string;
  provider: "manual" | "fake";
  display_name: string;
  instructions: string | null;
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function cartToken(): Promise<string | null> {
  const value = (await cookies()).get(CART_COOKIE)?.value;
  return value && TOKEN_RE.test(value) ? value : null;
}

async function setCartCookie(token: string): Promise<void> {
  const env = serverEnv();
  (await cookies()).set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_ENV === "production" || env.APP_ENV === "preview",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

/** `detail` del error de la base (p. ej. el total nuevo en `price_changed`). */
export function dbDetail(error: AppError): string | undefined {
  const cause = error.cause as DbErrorLike | undefined;
  return cause?.detail ?? cause?.details ?? undefined;
}

async function value<T>(query: Promise<{ value: unknown }[]>): Promise<T> {
  try {
    const rows = await query;
    return rows[0]?.value as T;
  } catch (error) {
    throw toAppError(error);
  }
}

export async function getCart(storeId: string): Promise<CartView | null> {
  const token = await cartToken();
  if (!token) return null;
  return value<CartView | null>(
    gatewayDb()`select storefront.cart_get(${storeId}, ${token}) as value`,
  );
}

/** Leyendas sanitarias de lo que trae el carrito (ADR-021): carrito o checkout. */
export async function getCartLegends(
  storeId: string,
  placement: "cart" | "checkout",
): Promise<{ key: string; text: string }[]> {
  const token = await cartToken();
  if (!token) return [];
  return (
    (await value<{ key: string; text: string }[] | null>(
      gatewayDb()`select storefront.cart_legends(${storeId}, ${token}, ${placement}) as value`,
    )) ?? []
  );
}

/** Agrega unidades; crea el carrito (y su cookie) si hace falta. */
export async function addToCart(
  storeId: string,
  variantId: string,
  quantity: number,
): Promise<CartView> {
  let token = (await cartToken()) ?? newToken();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const cart = await value<CartView>(
        gatewayDb()`select storefront.cart_add_item(${storeId}, ${token}, ${variantId}, ${quantity}) as value`,
      );
      await setCartCookie(token);
      return cart;
    } catch (error) {
      const appError = toAppError(error);
      // Carrito ya convertido (pedido hecho) o de otra tienda: se empieza uno nuevo.
      if (appError.code === "conflict" && dbDetail(appError) === "cart_closed" && attempt === 0) {
        token = newToken();
        continue;
      }
      throw appError;
    }
  }
  throw new AppError("internal");
}

export async function setCartQuantity(
  storeId: string,
  variantId: string,
  quantity: number,
): Promise<CartView> {
  const token = await cartToken();
  if (!token) throw new AppError("not_found");
  return value<CartView>(
    gatewayDb()`select storefront.cart_set_quantity(${storeId}, ${token}, ${variantId}, ${quantity}) as value`,
  );
}

export async function setCartDetails(
  storeId: string,
  details: Record<string, unknown>,
): Promise<CartView> {
  const token = await cartToken();
  if (!token) throw new AppError("not_found");
  const db = gatewayDb();
  return value<CartView>(
    db`select storefront.cart_set_details(${storeId}, ${token}, ${db.json(details as never)}) as value`,
  );
}

export async function paymentMethods(storeId: string): Promise<PaymentMethod[]> {
  return (
    (await value<PaymentMethod[] | null>(
      gatewayDb()`select storefront.payment_methods(${storeId}) as value`,
    )) ?? []
  );
}

/**
 * Hash de la IP del cliente (los rate limits nunca guardan la IP en claro).
 * Supone un proxy de confianza que fija `x-forwarded-for` (Vercel lo hace); sin él
 * el valor lo elige el cliente y el límite por IP pierde eficacia (D-F6-08).
 */
export async function clientIpHash(): Promise<string> {
  const h = await headers();
  const ip =
    (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${serverEnv().ORDER_LINK_SECRET}:${ip}`).digest("hex");
}

/** Intentos de códigos por IP y tienda (A20), además del límite por carrito. */
export async function discountGuard(storeId: string): Promise<boolean> {
  const [row] = await gatewayDb()<{ ok: boolean }[]>`
    select storefront.discount_guard(${storeId}, ${await clientIpHash()}) as ok`;
  return Boolean(row?.ok);
}
