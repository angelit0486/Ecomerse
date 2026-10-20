"use server";

import { hasPermission } from "@/server/auth/context";
import { reportActionError } from "@/server/actions/report";
import { configIssues } from "@/server/system/health";

import { storeClient } from "./action-state";

export interface PanelNotice {
  key: string;
  label: string;
  href: string;
  /** Urgente: algo que impide vender o atender. */
  urgent: boolean;
}

/**
 * Avisos del panel (misión panel, F3): lo que requiere acción, contado al
 * momento. Se piden después de cargar la página (no la hacen más lenta) y cada
 * aviso respeta su permiso; la base filtra por tienda (RLS).
 */
export async function panelNotices(storeHandle: string): Promise<PanelNotice[]> {
  try {
    const { ctx, supabase, storeId } = await storeClient(storeHandle);
    const base = `/admin/${ctx.store.handle}`;
    const count = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
    const canOrders = hasPermission(ctx, "orders.read");
    const canReviews = hasPermission(ctx, "products.read");
    const [toFulfill, attention, reviews] = await Promise.all([
      canOrders
        ? count(
            supabase
              .from("orders")
              .select("id", { count: "exact", head: true })
              .eq("store_id", storeId)
              .eq("status", "open")
              .in("fulfillment_status", ["unfulfilled", "partially_fulfilled"]),
          )
        : 0,
      canOrders
        ? count(
            supabase
              .from("orders")
              .select("id", { count: "exact", head: true })
              .eq("store_id", storeId)
              .eq("needs_attention", true),
          )
        : 0,
      canReviews
        ? count(
            supabase
              .from("product_reviews")
              .select("id", { count: "exact", head: true })
              .eq("store_id", storeId)
              .eq("status", "pending"),
          )
        : 0,
    ]);
    const notices: PanelNotice[] = [];
    if (attention > 0) {
      notices.push({
        key: "attention",
        label:
          attention === 1
            ? "1 pedido requiere atención"
            : `${attention} pedidos requieren atención`,
        href: `${base}/pedidos?estado=atencion`,
        urgent: true,
      });
    }
    if (toFulfill > 0) {
      notices.push({
        key: "fulfill",
        label: toFulfill === 1 ? "1 pedido por surtir" : `${toFulfill} pedidos por surtir`,
        href: `${base}/pedidos?estado=por-surtir`,
        urgent: false,
      });
    }
    if (reviews > 0) {
      notices.push({
        key: "reviews",
        label: reviews === 1 ? "1 opinión por revisar" : `${reviews} opiniones por revisar`,
        href: `${base}/productos/opiniones`,
        urgent: false,
      });
    }
    if (hasPermission(ctx, "store.update")) {
      for (const issue of configIssues()) {
        notices.push({ key: issue.key, label: issue.title, href: base, urgent: true });
      }
    }
    return notices;
  } catch (error) {
    reportActionError("panel.notices", error);
    return [];
  }
}
