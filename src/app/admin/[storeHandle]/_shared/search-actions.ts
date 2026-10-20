"use server";

import { hasPermission } from "@/server/auth/context";
import { reportActionError } from "@/server/actions/report";
import { searchProducts } from "@/server/catalog/queries";
import { callRpc } from "@/server/db/rpc";

import { storeClient } from "./action-state";

export interface SearchHit {
  href: string;
  label: string;
  detail: string;
}

export interface SearchResults {
  products: SearchHit[];
  orders: SearchHit[];
  customers: SearchHit[];
}

const EMPTY: SearchResults = { products: [], orders: [], customers: [] };
const PER_GROUP = 5;

/**
 * Búsqueda global del panel (misión panel, F3): productos, pedidos y clientes
 * en un solo lugar. Es una acción (POST), no una URL: lo escrito puede ser un
 * email y no debe quedar en registros ni en el historial (APP-L8). Cada grupo
 * respeta su permiso y la base filtra por tienda (RLS).
 */
export async function searchPanel(storeHandle: string, rawQuery: string): Promise<SearchResults> {
  const q = rawQuery.trim().slice(0, 100);
  if (q.length < 2) return EMPTY;
  try {
    const { ctx, supabase, storeId } = await storeClient(storeHandle);
    const base = `/admin/${ctx.store.handle}`;
    const digits = q.replace(/\D/g, "");
    const [products, orders, customers] = await Promise.all([
      hasPermission(ctx, "products.read")
        ? searchProducts(supabase, storeId, { query: q }).then((r) => r.rows.slice(0, PER_GROUP))
        : Promise.resolve([]),
      hasPermission(ctx, "orders.read") && digits.length > 0
        ? supabase
            .from("orders")
            .select("id, display_number, placed_at")
            .eq("store_id", storeId)
            .ilike("display_number", `%${digits}%`)
            .order("placed_at", { ascending: false })
            .limit(PER_GROUP)
            .then(({ data }) => data ?? [])
        : Promise.resolve([]),
      // Buscar por email o nombre es ver datos personales: requiere ese permiso.
      hasPermission(ctx, "customers.read") && hasPermission(ctx, "customers.pii.read")
        ? callRpc<{ items: { id: string; email: string; name: string | null }[] }>(
            supabase,
            "customers_list",
            { p_store_id: storeId, p_query: q, p_cursor: null, p_limit: PER_GROUP },
          ).then((r) => r.items)
        : Promise.resolve([]),
    ]);
    return {
      products: products.map((p) => ({
        href: `${base}/productos/${p.id}`,
        label: p.title,
        detail: p.status === "active" ? "Producto publicado" : "Producto sin publicar",
      })),
      orders: (orders as { id: string; display_number: string }[]).map((o) => ({
        href: `${base}/pedidos/${o.id}`,
        label: `Pedido ${o.display_number}`,
        detail: "Pedido",
      })),
      customers: customers.map((c) => ({
        href: `${base}/clientes/${c.id}`,
        label: c.name || c.email,
        detail: c.name ? c.email : "Cliente",
      })),
    };
  } catch (error) {
    reportActionError("panel.search", error);
    return EMPTY;
  }
}
