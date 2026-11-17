import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildReplenishment,
  COUNTED_PAYMENT_STATUSES,
  type ReplenishmentRow,
  type SaleLine,
  salesWindow,
  type StockItem,
  type SupplierOption,
  unitsByVariant,
} from "@/lib/inventory/replenishment";
import { log } from "@/server/observability/logger";

/**
 * Datos de «Qué pedir» con el cliente del usuario: lecturas directas de tablas
 * con `GRANT SELECT` + RLS (inventory.read, orders.read, products.cost.read),
 * sin RPC ni SQL nuevo. Nada se cachea entre requests (§44.7).
 *
 * Topes (PostgREST devuelve como máximo `max_rows` = 1000 filas por llamada; se
 * pagina con `range` y se avanza por lo recibido, así que un `max_rows` menor
 * tampoco corta la lista en silencio):
 * - STOCK_CAP variantes con seguimiento en la ubicación principal.
 * - SALES_LINES_CAP partidas de pedidos pagados en la ventana.
 * - SUPPLIER_LINKS_CAP vínculos variante–proveedor activo.
 * Si se llega a un tope, el resultado lo dice y la pantalla lo declara.
 */
export const STOCK_CAP = 2000;
export const SALES_LINES_CAP = 10_000;
export const SUPPLIER_LINKS_CAP = 5000;
export const PAGE_SIZE = 1000;

export interface ReplenishmentData {
  ok: true;
  rows: ReplenishmentRow[];
  window: { from: string; to: string };
  /** Variantes con seguimiento leídas (tras el recorte). */
  stockCount: number;
  stockTruncated: boolean;
  /** false: no hay permiso para ver pedidos; solo se aplica la regla de stock bajo. */
  salesIncluded: boolean;
  salesTruncated: boolean;
  /** false: no hay permiso para ver proveedores. */
  suppliersIncluded: boolean;
  suppliersTruncated: boolean;
}

export type ReplenishmentResult = ReplenishmentData | { ok: false };

type PageResult = PromiseLike<{
  data: unknown[] | null;
  error: { message: string; code?: string } | null;
}>;

class QueryFailed extends Error {
  readonly step: string;
  readonly code: string | undefined;
  constructor(step: string, code: string | undefined) {
    super(`replenishment_query_failed:${step}`);
    this.step = step;
    this.code = code;
  }
}

/**
 * Lee hasta `cap` filas en páginas de `PAGE_SIZE` (orden estable a cargo de
 * `page`) y avisa si había más. Avanza por lo recibido y solo se detiene con una
 * página vacía o al pasar el tope: nunca da por completa una lista recortada.
 */
export async function fetchCapped<T>(
  step: string,
  page: (from: number, to: number) => PageResult,
  cap: number,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  // Se pide una fila de más para saber si había más que el tope.
  while (rows.length <= cap) {
    const from = rows.length;
    const to = Math.min(from + PAGE_SIZE, cap + 1) - 1;
    const { data, error } = await page(from, to);
    if (error) throw new QueryFailed(step, error.code);
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
  }
  const truncated = rows.length > cap;
  return { rows: truncated ? rows.slice(0, cap) : rows, truncated };
}

interface LevelRow {
  variant_id: string;
  available: number;
  low_stock_threshold: number | null;
  product_variants: {
    sku: string | null;
    option_signature: string | null;
    track_inventory: boolean;
    product_id: string;
    products: { title: string } | null;
  } | null;
}

interface ItemRow {
  variant_id: string | null;
  quantity: number;
  refunded_quantity: number;
  orders: { status: string; payment_status: string; paid_at: string | null } | null;
}

interface SupplierLinkRow {
  variant_id: string;
  suppliers: {
    id: string;
    name: string;
    status: string;
    lead_time_min_days: number | null;
    lead_time_max_days: number | null;
  } | null;
}

export interface LoadReplenishmentOptions {
  storeId: string;
  timeZone: string;
  canReadOrders: boolean;
  canReadSuppliers: boolean;
  now?: Date;
}

export async function loadReplenishment(
  supabase: SupabaseClient,
  opts: LoadReplenishmentOptions,
): Promise<ReplenishmentResult> {
  const window = salesWindow(opts.timeZone, opts.now);
  try {
    const { data: location, error: locationError } = await supabase
      .from("inventory_locations")
      .select("id")
      .eq("store_id", opts.storeId)
      .eq("is_default", true)
      .maybeSingle();
    if (locationError) throw new QueryFailed("location", locationError.code);
    // Toda tienda nace con su ubicación principal; sin ella no hay cálculo posible.
    if (!location) throw new QueryFailed("location", "missing_default");
    const locationId = (location as { id: string }).id;

    const [levels, items, links] = await Promise.all([
      fetchCapped<LevelRow>(
        "inventory_levels",
        (from, to) =>
          supabase
            .from("inventory_levels")
            .select(
              "variant_id, available, low_stock_threshold, product_variants!inner(sku, option_signature, track_inventory, product_id, products!inner(title))",
            )
            .eq("store_id", opts.storeId)
            .eq("location_id", locationId)
            .eq("product_variants.track_inventory", true)
            .is("product_variants.deleted_at", null)
            .is("product_variants.products.deleted_at", null)
            .order("id")
            .range(from, to),
        STOCK_CAP,
      ),
      opts.canReadOrders
        ? fetchCapped<ItemRow>(
            "order_items",
            (from, to) =>
              supabase
                .from("order_items")
                .select(
                  "variant_id, quantity, refunded_quantity, orders!inner(status, payment_status, paid_at)",
                )
                .eq("store_id", opts.storeId)
                .not("variant_id", "is", null)
                .gte("orders.paid_at", window.start.toISOString())
                .lt("orders.paid_at", window.end.toISOString())
                .neq("orders.status", "cancelled")
                .in("orders.payment_status", [...COUNTED_PAYMENT_STATUSES])
                .order("id")
                .range(from, to),
            SALES_LINES_CAP,
          )
        : null,
      opts.canReadSuppliers
        ? fetchCapped<SupplierLinkRow>(
            "supplier_variants",
            (from, to) =>
              supabase
                .from("supplier_variants")
                .select(
                  "variant_id, suppliers!inner(id, name, status, lead_time_min_days, lead_time_max_days)",
                )
                .eq("store_id", opts.storeId)
                .eq("suppliers.status", "active")
                .order("id")
                .range(from, to),
            SUPPLIER_LINKS_CAP,
          )
        : null,
    ]);

    const stock: StockItem[] = [];
    for (const l of levels.rows) {
      const v = l.product_variants;
      if (!v) continue;
      stock.push({
        variantId: l.variant_id,
        productId: v.product_id,
        productTitle: v.products?.title ?? "",
        optionSignature: v.option_signature ?? "",
        sku: v.sku,
        trackInventory: v.track_inventory,
        available: l.available,
        lowStockThreshold: l.low_stock_threshold,
      });
    }

    const lines: SaleLine[] | null = items
      ? items.rows.map((i) => ({
          variantId: i.variant_id,
          quantity: i.quantity,
          refundedQuantity: i.refunded_quantity,
          orderStatus: i.orders?.status ?? "",
          paymentStatus: i.orders?.payment_status ?? "",
          paidAt: i.orders?.paid_at ?? null,
        }))
      : null;

    const suppliersByVariant = new Map<string, SupplierOption[]>();
    for (const link of links?.rows ?? []) {
      const s = link.suppliers;
      if (!s) continue;
      const list = suppliersByVariant.get(link.variant_id) ?? [];
      list.push({
        id: s.id,
        name: s.name,
        status: s.status,
        leadTimeMinDays: s.lead_time_min_days,
        leadTimeMaxDays: s.lead_time_max_days,
      });
      suppliersByVariant.set(link.variant_id, list);
    }

    return {
      ok: true,
      rows: buildReplenishment({
        stock,
        sales: lines ? unitsByVariant(lines, window) : null,
        suppliersByVariant,
      }),
      window: { from: window.from, to: window.to },
      stockCount: stock.length,
      stockTruncated: levels.truncated,
      salesIncluded: items !== null,
      salesTruncated: items?.truncated ?? false,
      suppliersIncluded: links !== null,
      suppliersTruncated: links?.truncated ?? false,
    };
  } catch (err) {
    // Sin datos del negocio ni PII: solo el paso y el código de error.
    log.warn("replenishment_load_failed", {
      store_id: opts.storeId,
      step: err instanceof QueryFailed ? err.step : "unknown",
      code: err instanceof QueryFailed ? err.code : undefined,
    });
    return { ok: false };
  }
}
