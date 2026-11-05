import "server-only";

import { toAppError } from "@/server/db/errors";
import { gatewayDb } from "@/server/db/role-clients";
import { tokenHash } from "@/server/payments/order-links";

/**
 * Devoluciones desde la página del pedido (ADR-061). La base verifica el token
 * del enlace, el interruptor de la tienda, el plazo y las unidades disponibles;
 * aquí solo se transporta.
 */
export interface ReturnSummary {
  id: string;
  status: "requested" | "approved" | "received" | "closed" | "rejected";
  reason: string;
  requested_at: string;
  customer_message: string | null;
  resolution: "refund" | "exchange" | "none" | null;
  items: { title: string; variant: string | null; quantity: number }[];
}

export interface ReturnOptions {
  deadline: string | null;
  open: boolean;
  window_days: number;
  last: ReturnSummary | null;
  lines: { order_item_id: string; title: string; variant: string | null; available: number }[];
}

/** null si la tienda no ofrece devoluciones. */
export async function returnOptions(
  storeId: string,
  orderId: string,
  token: string,
): Promise<ReturnOptions | null> {
  const [row] = await gatewayDb()<{ value: ReturnOptions | null }[]>`
    select storefront.return_options(${storeId}::uuid, ${orderId}::uuid, ${tokenHash(token)}) as value`;
  return row?.value ?? null;
}

export async function requestReturn(
  storeId: string,
  orderId: string,
  token: string,
  request: { reason: string; note: string; items: { order_item_id: string; quantity: number }[] },
): Promise<ReturnSummary> {
  const db = gatewayDb();
  try {
    const [row] = await db<{ value: ReturnSummary }[]>`
      select storefront.request_return(${storeId}::uuid, ${orderId}::uuid, ${tokenHash(token)},
                                       ${db.json(request)}) as value`;
    return row!.value;
  } catch (error) {
    throw toAppError(error);
  }
}
