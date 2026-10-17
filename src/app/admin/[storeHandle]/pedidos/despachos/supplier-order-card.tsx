import Link from "next/link";

import { SUPPLIER_ORDER_LABELS } from "@/lib/orders/supplier-order-status";
import type { SupplierOrder } from "@/server/orders/supplier-orders";

import { SupplierOrderForm } from "./forms";

/** Un despacho de proveedor: qué pedirle, su estado y el formulario de avance. */
export function SupplierOrderCard({
  storeHandle,
  supplierOrder: so,
  canUpdate,
  showOrder,
  timeZone,
}: {
  storeHandle: string;
  supplierOrder: SupplierOrder;
  canUpdate: boolean;
  showOrder?: boolean;
  /** Zona horaria de la tienda (el servidor corre en UTC). */
  timeZone: string;
}) {
  const fmt = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  const date = (iso: string | null) => (iso ? fmt.format(new Date(iso)) : null);
  const lead =
    so.supplier.lead_time_min_days != null && so.supplier.lead_time_max_days != null
      ? `Plazo informado: ${so.supplier.lead_time_min_days}–${so.supplier.lead_time_max_days} días`
      : null;
  const orderCancelled = so.order.status === "cancelled";
  const steps: [string, string | null][] = [
    ["Solicitado", date(so.requested_at)],
    ["Confirmado", date(so.confirmed_at)],
    ["Enviado", date(so.shipped_at)],
    ["Entregado", date(so.delivered_at)],
  ];
  return (
    <article
      aria-label={`Despacho de ${so.supplier.name}`}
      className="space-y-3 rounded-md border border-border p-4 text-sm"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          {so.supplier.name}
          {showOrder ? (
            <>
              {" · "}
              <Link href={`/admin/${storeHandle}/pedidos/${so.order_id}`} className="underline">
                Pedido {so.order.display_number}
              </Link>
            </>
          ) : null}
        </h3>
        <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-medium">
          {SUPPLIER_ORDER_LABELS[so.status]}
        </span>
      </header>
      {orderCancelled && so.status !== "cancelled" && so.status !== "delivered" ? (
        <p role="note" className="rounded-md border border-warning p-2">
          El pedido se canceló. Si ya se lo pediste al proveedor, avísale y marca este despacho como
          cancelado.
        </p>
      ) : null}
      <ul className="space-y-1">
        {so.items.map((i, n) => (
          <li key={`${i.variant_id ?? "x"}-${n}`}>
            <span className="font-medium">{i.quantity} ×</span> {i.product_title}
            {i.variant_title ? ` — ${i.variant_title}` : ""}
            <span className="text-fg-muted">
              {i.supplier_sku ? ` · SKU proveedor ${i.supplier_sku}` : ""}
              {i.sku ? ` · tu SKU ${i.sku}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-fg-muted">
        {[
          lead,
          so.external_reference ? `Referencia: ${so.external_reference}` : null,
          so.carrier ? `Paquetería: ${so.carrier}` : null,
          so.tracking_number ? `Guía: ${so.tracking_number}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Captura manual: este proveedor no tiene integración automática."}
        {so.tracking_url ? (
          <>
            {" "}
            <a
              href={so.tracking_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Rastrear
            </a>
          </>
        ) : null}
      </p>
      {steps.some(([, d]) => d) ? (
        <p className="text-xs text-fg-muted">
          {steps
            .filter(([, d]) => d)
            .map(([label, d]) => `${label}: ${d}`)
            .join(" · ")}
        </p>
      ) : null}
      {so.note ? <p className="whitespace-pre-line">Nota: {so.note}</p> : null}
      {canUpdate ? (
        <SupplierOrderForm
          storeHandle={storeHandle}
          supplierOrder={{
            id: so.id,
            orderId: so.order_id,
            status: so.status,
            external_reference: so.external_reference,
            carrier: so.carrier,
            tracking_number: so.tracking_number,
            tracking_url: so.tracking_url,
            note: so.note,
          }}
        />
      ) : null}
    </article>
  );
}
