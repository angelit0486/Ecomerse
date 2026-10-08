import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { callRpc } from "@/server/db/rpc";
import { gatewayDb } from "@/server/db/role-clients";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { clientIpHash } from "./cart";
import type { GuestOrder } from "./checkout";

/**
 * Cuenta del comprador (F8-T01, GATE0 §7.4, §21.5): sesión de Supabase con
 * cookies host-only de la tienda, nivel aal1. Todas las lecturas pasan por RPC
 * con el JWT del comprador; la tienda viene verificada por la firma del proxy.
 */
export interface AccountOverview {
  customer: {
    email: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    accepts_marketing: boolean;
  };
  orders: {
    id: string;
    display_number: string;
    placed_at: string;
    status: string;
    payment_status: string;
    fulfillment_status: string;
    total: number;
    currency: string;
  }[];
  addresses: AccountAddress[];
}

export interface AccountAddress {
  id: string;
  recipient_name: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  phone: string | null;
  is_default: boolean;
}

export interface AccountOrder extends GuestOrder {
  shipments: {
    status: string;
    carrier: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
  }[];
}

/**
 * Registra el intento (marca del email del código) y aplica los límites de
 * frecuencia. Devuelve el nonce que viaja en redirect_to hasta el Send Email Hook,
 * o null si se superó un límite.
 */
export async function recordLoginIntent(storeId: string, email: string): Promise<string | null> {
  const [row] = await gatewayDb()<{ nonce: string | null }[]>`
    select storefront.record_login_intent(${storeId}, ${email}, ${await clientIpHash()}) as nonce`;
  return row?.nonce ?? null;
}

/** Cuenta un intento de verificar el código (por email en todas las tiendas y por IP). */
export async function takeCodeAttempt(storeId: string, email: string): Promise<boolean> {
  const [row] = await gatewayDb()<{ ok: boolean }[]>`
    select storefront.take_code_attempt(${storeId}, ${email}, ${await clientIpHash()}) as ok`;
  return row?.ok === true;
}

export async function buyerClient(): Promise<SupabaseClient> {
  return createSupabaseServerClient();
}

/** Usuario de la sesión de esta tienda (validado con Auth, no solo la cookie). */
export async function buyerUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function linkCustomer(supabase: SupabaseClient, storeId: string): Promise<string> {
  return callRpc<string>(supabase, "storefront_link_customer", { p_store_id: storeId });
}

export async function accountOverview(storeId: string): Promise<AccountOverview | null> {
  const supabase = await buyerClient();
  if (!(await buyerUserId(supabase))) return null;
  return callRpc<AccountOverview | null>(supabase, "account_overview", { p_store_id: storeId });
}

export async function accountOrder(storeId: string, orderId: string): Promise<AccountOrder | null> {
  const supabase = await buyerClient();
  if (!(await buyerUserId(supabase))) return null;
  try {
    return await callRpc<AccountOrder | null>(supabase, "account_get_order", {
      p_store_id: storeId,
      p_order_id: orderId,
    });
  } catch {
    return null; // sin cuenta en esta tienda: igual que un pedido inexistente
  }
}
