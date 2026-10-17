import "server-only";

import { callRpc } from "@/server/db/rpc";
import { gatewayDb } from "@/server/db/role-clients";
import { toAppError } from "@/server/db/errors";
import { tokenHash } from "@/server/payments/order-links";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * Opiniones del comprador desde la página de su pedido (ADR-029). La base
 * verifica el token del enlace, que el pedido esté pagado y entregado y que el
 * producto sea de ese pedido; el nombre visible lo calcula la base.
 */
export interface Reviewable {
  product_id: string;
  title: string;
  reviewed: boolean;
}

export async function orderReviewables(
  storeId: string,
  orderId: string,
  token: string,
): Promise<Reviewable[]> {
  const [row] = await gatewayDb()<{ value: Reviewable[] | null }[]>`
    select storefront.order_reviewables(${storeId}::uuid, ${orderId}::uuid, ${tokenHash(token)}) as value`;
  return row?.value ?? [];
}

export async function submitReview(
  storeId: string,
  orderId: string,
  token: string,
  productId: string,
  review: { rating: number; title: string; body: string },
): Promise<void> {
  const db = gatewayDb();
  try {
    await db`select storefront.submit_review(${storeId}::uuid, ${orderId}::uuid, ${tokenHash(token)},
                                             ${productId}::uuid, ${db.json(review)}) as value`;
  } catch (error) {
    throw toAppError(error);
  }
}

/** Desde «Mi cuenta» (sesión del comprador): sin el enlace del pedido. */
export async function accountReviewables(storeId: string, orderId: string): Promise<Reviewable[]> {
  const supabase = await createSupabaseServerClient();
  try {
    return (
      (await callRpc<Reviewable[]>(supabase, "account_order_reviewables", {
        p_store_id: storeId,
        p_order_id: orderId,
      })) ?? []
    );
  } catch {
    return [];
  }
}

export async function submitAccountReview(
  storeId: string,
  orderId: string,
  productId: string,
  review: { rating: number; title: string; body: string },
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await callRpc(supabase, "account_submit_review", {
    p_store_id: storeId,
    p_order_id: orderId,
    p_product_id: productId,
    p_review: review,
  });
}
