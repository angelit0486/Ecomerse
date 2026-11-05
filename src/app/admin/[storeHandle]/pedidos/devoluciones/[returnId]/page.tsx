import { randomBytes } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { centsToInput, formatMoney } from "@/lib/money/format";
import { refundStatusNote, RETURN_REASON_LABEL, RETURN_STATUS_LABEL } from "@/lib/returns/labels";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { panelFlagEnabled } from "../../../_shared/panel-flags";
import { CloseReturnForm, DecideForms, ReceiveForm, RefundReturnForm } from "../forms";

export const metadata: Metadata = { title: "Devolución" };

interface ReturnDetail {
  id: string;
  status: "requested" | "approved" | "received" | "closed" | "rejected";
  reason: string;
  customer_note: string | null;
  customer_message: string | null;
  resolution: "refund" | "exchange" | "none" | null;
  restock: boolean | null;
  requested_at: string;
  decided_at: string | null;
  received_at: string | null;
  closed_at: string | null;
  refund: { id: string; amount: number; status: string } | null;
  order: {
    id: string;
    display_number: string;
    customer_name: string;
    currency: string;
    payment_status: string;
    refundable: number;
  };
  items: {
    order_item_id: string;
    title: string;
    variant: string | null;
    sku: string | null;
    quantity: number;
    ordered: number;
    amount: number;
  }[];
}

const NOTICES: Record<string, string> = {
  aprobada: "Devolución aprobada. Le enviamos al cliente las instrucciones.",
  rechazada: "Devolución rechazada. Le enviamos al cliente el motivo.",
  recibida: "Devolución recibida.",
  reembolsada: "Reembolso solicitado. El cliente recibirá un correo cuando se confirme.",
  cerrada: "Devolución cerrada.",
};

const RESOLUTION_LABEL: Record<string, string> = {
  refund: "Reembolso",
  exchange: "Cambio por otro producto",
  none: "Sin devolución de dinero",
};

type Props = {
  params: Promise<{ storeHandle: string; returnId: string }>;
  searchParams: Promise<{ aviso?: string }>;
};

export default async function ReturnPage({ params, searchParams }: Props) {
  const { storeHandle, returnId } = await params;
  if (!z.uuid().safeParse(returnId).success) notFound();
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "orders.read")) notFound();
  const supabase = await createSupabaseServerClient();
  if (!(await panelFlagEnabled(supabase, ctx.store.id, "returns"))) notFound();
  let r: ReturnDetail;
  try {
    r = await callRpc<ReturnDetail>(supabase, "returns_get", {
      p_store_id: ctx.store.id,
      p_return_id: returnId,
    });
  } catch {
    notFound();
  }
  const { aviso } = await searchParams;
  const base = `/admin/${ctx.store.handle}/pedidos`;
  const money = (cents: number) => formatMoney(cents, r.order.currency);
  const date = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.store.timezone,
  });
  const canRefund = hasPermission(ctx, "orders.refund");
  const canReceive = hasPermission(ctx, "orders.fulfill");
  const open = r.status === "approved" || r.status === "received";
  const suggested = Math.min(
    r.items.reduce((sum, i) => sum + i.amount, 0),
    r.order.refundable,
  );
  const refundable = ["paid", "partially_refunded"].includes(r.order.payment_status);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href={`${base}/devoluciones`} className="underline">
            Devoluciones
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Devolución del pedido {r.order.display_number}</h1>
        <p className="text-sm">
          <span className="font-medium">{RETURN_STATUS_LABEL[r.status]}</span> ·{" "}
          {r.order.customer_name} ·{" "}
          <Link href={`${base}/${r.order.id}`} className="underline">
            Ver el pedido
          </Link>
        </p>
      </header>

      {aviso && NOTICES[aviso] ? (
        <p role="status" className="rounded-md border border-success p-3 text-sm">
          {NOTICES[aviso]}
        </p>
      ) : null}

      <section aria-labelledby="pedido-devolver" className="space-y-2">
        <h2 id="pedido-devolver" className="font-semibold">
          Lo que quiere devolver
        </h2>
        <ul className="space-y-1 text-sm">
          {r.items.map((i) => (
            <li key={i.order_item_id}>
              {i.title}
              {i.variant ? ` (${i.variant})` : ""} × {i.quantity}{" "}
              <span className="text-fg-muted">
                de {i.ordered}
                {i.sku ? ` · ${i.sku}` : ""} · {money(i.amount)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="grid gap-1 text-sm">
          <div>
            <dt className="inline font-medium">Motivo: </dt>
            <dd className="inline">{RETURN_REASON_LABEL[r.reason] ?? r.reason}</dd>
          </div>
          {r.customer_note ? (
            <div>
              <dt className="inline font-medium">Nota del cliente: </dt>
              <dd className="inline">{r.customer_note}</dd>
            </div>
          ) : null}
          <div>
            <dt className="inline font-medium">Pedida: </dt>
            <dd className="inline">{date.format(new Date(r.requested_at))}</dd>
          </div>
          {r.customer_message ? (
            <div>
              <dt className="inline font-medium">Mensaje para el cliente: </dt>
              <dd className="inline">{r.customer_message}</dd>
            </div>
          ) : null}
          {r.received_at ? (
            <div>
              <dt className="inline font-medium">Recibida: </dt>
              <dd className="inline">{date.format(new Date(r.received_at))}</dd>
            </div>
          ) : null}
          {r.resolution ? (
            <div>
              <dt className="inline font-medium">Resolución: </dt>
              <dd className="inline">
                {RESOLUTION_LABEL[r.resolution]}
                {r.refund ? ` de ${money(r.refund.amount)}` : ""}
                {refundStatusNote(r.refund?.status)}
                {r.restock ? "; las unidades regresaron al inventario" : ""}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {r.status === "requested" && canRefund ? (
        <section aria-labelledby="decidir" className="space-y-3">
          <h2 id="decidir" className="font-semibold">
            Decidir
          </h2>
          <DecideForms storeHandle={ctx.store.handle} returnId={r.id} />
        </section>
      ) : null}

      {r.status === "approved" && canReceive ? (
        <section aria-labelledby="recibir" className="space-y-2">
          <h2 id="recibir" className="font-semibold">
            ¿Ya llegó el paquete?
          </h2>
          <ReceiveForm storeHandle={ctx.store.handle} returnId={r.id} />
        </section>
      ) : null}

      {open && canRefund ? (
        <section aria-labelledby="resolver" className="grid gap-6 md:grid-cols-2">
          <h2 id="resolver" className="font-semibold md:col-span-2">
            Resolver
          </h2>
          {refundable && r.order.refundable > 0 ? (
            <RefundReturnForm
              storeHandle={ctx.store.handle}
              returnId={r.id}
              idempotencyKey={randomBytes(18).toString("base64url")}
              suggested={centsToInput(suggested)}
              maxLabel={money(r.order.refundable)}
            />
          ) : (
            <p className="text-sm">Este pedido ya no tiene saldo por reembolsar.</p>
          )}
          <CloseReturnForm storeHandle={ctx.store.handle} returnId={r.id} />
        </section>
      ) : null}
    </section>
  );
}
