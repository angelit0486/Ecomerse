import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  DEFAULT_TARGET_DAYS,
  type ReplenishmentRow,
  SAFETY_DAYS,
  WINDOW_DAYS,
} from "@/lib/inventory/replenishment";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { loadReplenishment, STOCK_CAP } from "@/server/inventory/replenishment";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

import { variantLabel } from "../labels";

export const metadata: Metadata = { title: "Qué pedir" };

type Props = { params: Promise<{ storeHandle: string }> };

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

const days = (n: number) => (n === 1 ? "1 día" : `${n} días`);

const linkClass = "inline-flex min-h-11 items-center text-sm underline";

const HOW_IT_WORKS = [
  `Calculamos cuánto vendes de cada variante con los pedidos pagados de los últimos ${WINDOW_DAYS} días (según la zona horaria de tu tienda), divididos entre ${WINDOW_DAYS}, aunque tu tienda tenga menos tiempo vendiendo.`,
  `La cantidad sugerida alcanza para el tiempo de entrega de tu proveedor más ${SAFETY_DAYS} días de margen, o para ${DEFAULT_TARGET_DAYS} días si no hay proveedor con plazo registrado. También aparecen las variantes en o por debajo de su aviso de stock bajo.`,
  "Es una guía: PRUVA no envía pedidos a tus proveedores.",
];

const LOAD_ERROR =
  "Algo falló al leer tu inventario o tus ventas, así que no sabemos si falta algo. No se cambió nada. Vuelve a intentarlo en un momento.";

/**
 * «Qué pedir»: variantes por agotarse y cuánto conviene reponer, con las ventas
 * cobradas de los últimos 30 días. Solo informa: PRUVA no genera órdenes de compra.
 * Cálculo en `src/lib/inventory/replenishment.ts`; datos con RLS del usuario.
 */
export default async function ReplenishmentPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "inventory.read")) notFound();

  const handle = ctx.store.handle;
  const inventoryHref = `/admin/${handle}/inventario`;
  const selfHref = `${inventoryHref}/reposicion`;
  const canReadProducts = hasPermission(ctx, "products.read");
  const canReadOrders = hasPermission(ctx, "orders.read");
  const canReadSuppliers = hasPermission(ctx, "products.cost.read");

  const result = canReadProducts
    ? await loadReplenishment(await createSupabaseServerClient(), {
        storeId: ctx.store.id,
        timeZone: ctx.store.timezone,
        canReadOrders,
        canReadSuppliers,
      })
    : null;

  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <Link href={inventoryHref} className={linkClass}>
          ← Inventario
        </Link>
        <h1 className="text-xl font-semibold">Qué pedir</h1>
        <div className="max-w-prose space-y-1 text-sm text-fg-muted">
          {HOW_IT_WORKS.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </div>
      </header>

      {result === null ? (
        <EmptyState
          title="No tienes permiso para ver productos"
          description="Para calcular qué pedir se necesita ver los productos de la tienda. Pide a quien administra la tienda que te dé ese permiso."
          action={
            <Link href={inventoryHref} className={linkClass}>
              Volver a Inventario
            </Link>
          }
        />
      ) : !result.ok ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-[var(--radius-container)] border border-danger p-6"
        >
          <h2 className="text-base font-semibold">No pudimos calcular qué pedir</h2>
          <p className="max-w-prose text-fg-muted">{LOAD_ERROR}</p>
          <Link href={selfHref} className={linkClass}>
            Reintentar
          </Link>
        </div>
      ) : (
        <>
          <Notices
            salesIncluded={result.salesIncluded}
            salesTruncated={result.salesTruncated}
            stockTruncated={result.stockTruncated}
            suppliersTruncated={result.suppliersTruncated}
          />
          {result.salesIncluded ? (
            <p className="text-sm text-fg-muted">
              Ventas del {dayLabel(result.window.from)} al {dayLabel(result.window.to)}.
            </p>
          ) : null}
          {result.stockCount === 0 && !result.stockTruncated ? (
            <EmptyState
              title="Aún no hay inventario que revisar"
              description="Aquí verás qué conviene pedir cuando tengas productos con seguimiento de inventario. Agrega productos para empezar."
              action={
                <Link href={`/admin/${handle}/productos`} className={linkClass}>
                  Ir a Productos
                </Link>
              }
            />
          ) : result.rows.length === 0 ? (
            <EmptyState
              title={result.salesIncluded ? "Nada urgente que pedir" : "Nada en stock bajo"}
              description={
                result.salesIncluded
                  ? `Con las ventas de los últimos ${WINDOW_DAYS} días y tu inventario, no hay nada urgente que pedir.`
                  : "Ninguna variante está en o por debajo de su aviso de stock bajo."
              }
              action={
                <Link href={inventoryHref} className={linkClass}>
                  Ver Inventario
                </Link>
              }
            />
          ) : (
            <RowsTable
              rows={result.rows}
              handle={handle}
              salesIncluded={result.salesIncluded}
              suppliersIncluded={result.suppliersIncluded}
            />
          )}
        </>
      )}
    </section>
  );
}

function Notices({
  salesIncluded,
  salesTruncated,
  stockTruncated,
  suppliersTruncated,
}: {
  salesIncluded: boolean;
  salesTruncated: boolean;
  stockTruncated: boolean;
  suppliersTruncated: boolean;
}) {
  const notes: string[] = [];
  if (!salesIncluded) {
    notes.push(
      "No tienes permiso para ver pedidos, así que no podemos estimar tus ventas ni cuánto pedir. Solo se muestran las variantes en o por debajo de su aviso de stock bajo.",
    );
  }
  if (salesTruncated) {
    notes.push(
      `Tuviste más ventas de las que pudimos leer en los últimos ${WINDOW_DAYS} días. El cálculo está incompleto: las ventas y cantidades sugeridas pueden quedarse cortas.`,
    );
  }
  if (stockTruncated) {
    notes.push(
      `Se calcularon las primeras ${STOCK_CAP.toLocaleString("es-MX")} variantes. Puede haber otras por reponer que no aparecen aquí.`,
    );
  }
  if (suppliersTruncated) {
    notes.push(
      "No pudimos leer todos los proveedores. Algunas variantes pueden usar el plazo predeterminado en lugar del de su proveedor.",
    );
  }
  if (notes.length === 0) return null;
  return (
    <ul
      aria-label="Avisos del cálculo"
      className="space-y-1 rounded-[var(--radius-container)] border border-border bg-surface p-4 text-sm"
    >
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

function RowsTable({
  rows,
  handle,
  salesIncluded,
  suppliersIncluded,
}: {
  rows: ReplenishmentRow[];
  handle: string;
  salesIncluded: boolean;
  suppliersIncluded: boolean;
}) {
  return (
    <Table caption="Variantes por reponer, de la más urgente a la menos urgente">
      <THead>
        <TR>
          <TH>Producto</TH>
          <TH>SKU</TH>
          <TH className="text-right">Disponible</TH>
          {salesIncluded ? (
            <>
              <TH className="text-right">Vendidas en {WINDOW_DAYS} días</TH>
              <TH>Te alcanza para</TH>
              <TH>Cantidad a pedir</TH>
            </>
          ) : null}
          {suppliersIncluded ? <TH>Proveedor</TH> : null}
          <TH>
            <span className="sr-only">Enlaces</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => {
          const variant = variantLabel(r.optionSignature);
          const label = [r.productTitle, variant].filter(Boolean).join(" · ");
          return (
            <TR key={r.variantId}>
              <TD>
                <Link href={`/admin/${handle}/productos/${r.productId}`} className={linkClass}>
                  {r.productTitle}
                </Link>
                {variant ? <span className="block text-fg-muted">{variant}</span> : null}
              </TD>
              <TD>{r.sku ?? "—"}</TD>
              <TD className="text-right tabular-nums">
                {r.available}
                {r.available <= 0 ? (
                  <span className="block text-danger">Agotado</span>
                ) : r.lowStock ? (
                  <span className="block text-danger">Stock bajo</span>
                ) : null}
              </TD>
              {salesIncluded ? (
                <>
                  <TD className="text-right tabular-nums">{r.unitsSold}</TD>
                  <TD className="tabular-nums">
                    {r.coverageDays !== null
                      ? days(r.coverageDays)
                      : r.unitsSold === 0
                        ? `Sin ventas en ${WINDOW_DAYS} días`
                        : "No se puede calcular"}
                  </TD>
                  <TD className="tabular-nums">
                    {r.suggestedQuantity !== null ? (
                      <>
                        <span className="font-semibold">{r.suggestedQuantity}</span>
                        <span className="block text-fg-muted">
                          {r.suggestedQuantity === 0
                            ? `Te alcanza para ${days(r.targetDays)}`
                            : `Para ${days(r.targetDays)}`}
                        </span>
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="block text-fg-muted">
                          Sin ventas recientes para estimar
                        </span>
                      </>
                    )}
                  </TD>
                </>
              ) : null}
              {suppliersIncluded ? (
                <TD>
                  {r.supplier ? (
                    <>
                      {r.supplier.name}
                      <span className="block text-fg-muted tabular-nums">
                        {r.supplier.leadDays !== null
                          ? `Entrega en ${days(r.supplier.leadDays)}`
                          : "Sin plazo registrado"}
                      </span>
                    </>
                  ) : (
                    <span className="text-fg-muted">Sin proveedor</span>
                  )}
                </TD>
              ) : null}
              <TD>
                <Link
                  href={`/admin/${handle}/inventario/${r.variantId}`}
                  className={linkClass}
                  aria-label={`Historial de ${label}`}
                >
                  Historial
                </Link>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
