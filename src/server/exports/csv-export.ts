import { centsToInput } from "@/lib/money/format";
import { toCsv, type CsvValue } from "@/lib/csv";
import { formatAttributes, formatNutrition, type NutritionCells } from "@/lib/catalog/compact";
import {
  ATTRIBUTE_HEADERS,
  IMPORT_HEADERS,
  REGULATORY_FIELD_COLUMNS,
  REGULATORY_HEADERS,
} from "@/server/imports/products";

/**
 * Filas de `exports_rows` → CSV (F8-T04a, §26.2). Los productos usan las mismas
 * columnas que la plantilla de importación (docs/plan/PROJECT-BRIEF.md §10.4),
 * para editar en una hoja de cálculo y volver a importar.
 */
export const EXPORT_ENTITIES = ["products", "inventory", "orders", "customers"] as const;
export type ExportEntity = (typeof EXPORT_ENTITIES)[number];

type Row = Record<string, unknown>;
const money = (v: unknown) => (typeof v === "number" ? centsToInput(v) : null);
const str = (v: unknown): CsvValue => (v === null || v === undefined ? null : (v as CsvValue));

const ORDER_LABELS: Record<string, string> = {
  pending_payment: "pendiente de pago",
  open: "abierto",
  completed: "completado",
  cancelled: "cancelado",
};

/** Columnas opcionales de productos: solo si la tienda las usa (R-T05). */
export interface ProductCsvOptions {
  regulated?: boolean;
  attributes?: boolean;
}

function regulatoryCells(value: unknown): CsvValue[] {
  const info = value as { category: string | null; data: Record<string, unknown> } | null;
  const category = info ? (info.category ?? "none") : null;
  return [
    category,
    ...REGULATORY_FIELD_COLUMNS.map((column) => {
      const v = info?.data?.[column.slice("regulatory_".length)];
      if (v === undefined || v === null) return null;
      if (column === "regulatory_nutrition") return formatNutrition(v as NutritionCells[]);
      return v as CsvValue;
    }),
  ];
}

export function exportCsv(
  entity: ExportEntity,
  rows: Row[],
  pii: boolean,
  options: ProductCsvOptions = {},
): string {
  switch (entity) {
    case "products": {
      const headers = [
        ...IMPORT_HEADERS,
        ...(options.regulated ? REGULATORY_HEADERS : []),
        ...(options.attributes ? ATTRIBUTE_HEADERS : []),
      ];
      return toCsv(
        headers,
        rows.map((r) => {
          const opts = (r.options as { name: string; value: string }[] | null) ?? [];
          const o = (i: number) => [str(opts[i]?.name), str(opts[i]?.value)];
          return [
            str(r.handle),
            str(r.title),
            str(r.status),
            str(r.description),
            str(r.brand),
            str(r.categories),
            str(r.tags),
            ...o(0),
            ...o(1),
            ...o(2),
            str(r.sku),
            str(r.barcode),
            money(r.price),
            money(r.compare_at_price),
            str(r.on_hand),
            str(r.inventory_policy),
            r.requires_shipping ? "true" : "false",
            str(r.weight_g),
            str(r.length_mm),
            str(r.width_mm),
            str(r.height_mm),
            str(r.variant_status),
            str(r.seo_title),
            str(r.seo_description),
            ...(options.regulated ? regulatoryCells(r.regulatory) : []),
            ...(options.attributes
              ? [formatAttributes((r.attributes as { key: string; values: string[] }[]) ?? [])]
              : []),
          ];
        }),
      );
    }
    case "inventory":
      return toCsv(
        ["producto", "variante", "sku", "ubicacion", "en_mano", "apartado", "disponible", "minimo"],
        rows.map((r) => [
          str(r.title),
          str(r.variant),
          str(r.sku),
          str(r.location),
          str(r.on_hand),
          str(r.reserved),
          str(r.available),
          str(r.low_stock_threshold),
        ]),
      );
    case "orders": {
      const base = [
        "pedido",
        "fecha",
        "estado",
        "pago",
        "envio",
        "unidades",
        "subtotal",
        "descuento",
        "costo_envio",
        "impuestos",
        "total",
        "pagado",
        "reembolsado",
        "moneda",
        "cupon",
        "metodo_envio",
      ];
      const contact = [
        "email",
        "nombre",
        "telefono",
        "ciudad",
        "estado_region",
        "codigo_postal",
        "pais",
      ];
      return toCsv(
        pii ? [...base, ...contact] : base,
        rows.map((r) => [
          str(r.number),
          str(r.placed_at),
          ORDER_LABELS[String(r.status)] ?? str(r.status),
          str(r.payment_status),
          str(r.fulfillment_status),
          str(r.items),
          money(r.subtotal),
          money(r.discount),
          money(r.shipping),
          money(r.tax),
          money(r.total),
          money(r.paid),
          money(r.refunded),
          str(r.currency),
          str(r.discount_code),
          str(r.shipping_method),
          ...(pii
            ? [
                str(r.email),
                str(r.customer_name),
                str(r.phone),
                str(r.city),
                str(r.region),
                str(r.postal_code),
                str(r.country),
              ]
            : []),
        ]),
      );
    }
    case "customers":
      return toCsv(
        [
          "email",
          "nombre",
          "telefono",
          "con_cuenta",
          "acepta_publicidad",
          "pedidos",
          "total_comprado",
          "anonimizado",
          "alta",
        ],
        rows.map((r) => [
          str(r.email),
          str(r.name),
          str(r.phone),
          Boolean(r.has_account),
          Boolean(r.accepts_marketing),
          str(r.orders_count),
          money(r.total_spent),
          Boolean(r.anonymized),
          str(r.created_at),
        ]),
      );
  }
}
