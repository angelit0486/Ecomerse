import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addressLines, type ShippingAddress } from "@/server/notifications/order-templates";

export interface SlipLine {
  title: string;
  variant: string | null;
  sku: string | null;
  quantity: number;
}

export interface PackingSlip {
  id: string;
  number: string;
  placedAt: string;
  shippingName: string | null;
  /** null: sin permiso para ver datos del cliente (customers.pii.read). */
  contact: { name: string; phone: string | null; address: string[]; note: string | null } | null;
  lines: SlipLine[];
}

/**
 * Datos de las notas de empaque con los mismos permisos que el detalle del
 * pedido: RLS para el pedido y sus productos, y `orders_get_contact` (que exige
 * customers.pii.read) para nombre, teléfono y dirección. Cada línea muestra lo
 * que falta por enviar: pedido − cancelado − ya enviado.
 */
export async function loadPackingSlips(
  supabase: SupabaseClient,
  storeId: string,
  orderIds: string[],
  canPii: boolean,
): Promise<PackingSlip[]> {
  if (orderIds.length === 0) return [];
  const [orders, items, shipped] = await Promise.all([
    supabase
      .from("orders")
      .select("id, display_number, placed_at, shipping_snapshot")
      .eq("store_id", storeId)
      .in("id", orderIds),
    supabase
      .from("order_items")
      .select(
        "id, order_id, product_title, variant_title, sku, quantity, cancelled_quantity, position",
      )
      .eq("store_id", storeId)
      .in("order_id", orderIds)
      .order("position"),
    supabase
      .from("shipment_items")
      .select("order_item_id, quantity, shipments!inner(order_id)")
      .eq("store_id", storeId)
      .in("shipments.order_id", orderIds),
  ]);
  for (const r of [orders, items, shipped]) if (r.error) throw r.error;
  const sent = new Map<string, number>();
  for (const s of (shipped.data ?? []) as { order_item_id: string; quantity: number }[]) {
    sent.set(s.order_item_id, (sent.get(s.order_item_id) ?? 0) + s.quantity);
  }
  const contacts = new Map<string, PackingSlip["contact"]>();
  if (canPii) {
    await Promise.all(
      orderIds.map(async (id) => {
        const { data } = await supabase.rpc("orders_get_contact", {
          p_store_id: storeId,
          p_order_id: id,
        });
        const c = data as {
          customer_name: string;
          phone: string | null;
          shipping_address: ShippingAddress | null;
          customer_note: string | null;
        } | null;
        if (c) {
          contacts.set(id, {
            name: c.customer_name,
            phone: c.phone,
            address: addressLines(c.shipping_address),
            note: c.customer_note,
          });
        }
      }),
    );
  }
  const byId = new Map(
    (
      (orders.data ?? []) as {
        id: string;
        display_number: string;
        placed_at: string;
        shipping_snapshot: { name?: string } | null;
      }[]
    ).map((o) => [o.id, o]),
  );
  // En el orden pedido (el lote llega del más antiguo al más nuevo).
  return orderIds.flatMap((id) => {
    const o = byId.get(id);
    if (!o) return [];
    const lines = (
      (items.data ?? []) as {
        id: string;
        order_id: string;
        product_title: string;
        variant_title: string | null;
        sku: string | null;
        quantity: number;
        cancelled_quantity: number;
      }[]
    )
      .filter((i) => i.order_id === id)
      .map((i) => ({
        title: i.product_title,
        variant: i.variant_title,
        sku: i.sku,
        quantity: i.quantity - (i.cancelled_quantity ?? 0) - (sent.get(i.id) ?? 0),
      }))
      .filter((l) => l.quantity > 0);
    return [
      {
        id,
        number: o.display_number,
        placedAt: o.placed_at,
        shippingName: o.shipping_snapshot?.name ?? null,
        contact: canPii ? (contacts.get(id) ?? null) : null,
        lines,
      },
    ];
  });
}
