import "server-only";

import { gatewayDb } from "@/server/db/role-clients";
import { toAppError } from "@/server/db/errors";
import { tokenHash } from "@/server/payments/order-links";

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
