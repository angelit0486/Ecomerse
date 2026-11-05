import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RETURN_REASON_LABEL } from "@/lib/returns/labels";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { panelFlagEnabled } from "../../_shared/panel-flags";
import { WindowForm } from "./forms";

export const metadata: Metadata = { title: "Devoluciones" };

type Status = "requested" | "approved" | "received" | "closed" | "rejected";

interface ReturnList {
  counts: Partial<Record<Status, number>>;
  items: {
    id: string;
    status: Status;
    reason: string;
    requested_at: string;
    units: number;
    order: { id: string; display_number: string; customer_name: string };
  }[];
}

const TABS: { key: Status; param: string; label: string }[] = [
  { key: "requested", param: "por-revisar", label: "Por revisar" },
  { key: "approved", param: "aprobadas", label: "Esperando el paquete" },
  { key: "received", param: "recibidas", label: "Recibidas" },
  { key: "closed", param: "cerradas", label: "Cerradas" },
  { key: "rejected", param: "rechazadas", label: "Rechazadas" },
];

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<{ estado?: string }>;
};

/**
 * Devoluciones (ADR-061, interruptor `returns`): el cliente las pide desde la
 * página de su pedido; aquí se revisan, se reciben y se reembolsan.
 */
export default async function ReturnsPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "orders.read")) notFound();
  const supabase = await createSupabaseServerClient();
  if (!(await panelFlagEnabled(supabase, ctx.store.id, "returns"))) notFound();
  const { estado } = await searchParams;
  const tab = TABS.find((t) => t.param === estado) ?? TABS[0]!;
  const [list, store] = await Promise.all([
    callRpc<ReturnList>(supabase, "returns_list", { p_store_id: ctx.store.id, p_status: tab.key }),
    supabase.from("stores").select("return_window_days").eq("id", ctx.store.id).maybeSingle(),
  ]);
  const days = (store.data?.return_window_days as number | undefined) ?? 30;
  const base = `/admin/${ctx.store.handle}/pedidos`;
  const date = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeZone: ctx.store.timezone,
  });

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href={base} className="underline">
            Pedidos
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Devoluciones</h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Tus clientes piden la devolución desde la página de su pedido, hasta {days} días después
          del envío. Apruébala con las instrucciones para mandarla, registra cuando llegue y
          reembolsa o resuelve con un cambio.
        </p>
      </header>

      {hasPermission(ctx, "store.update") ? (
        <WindowForm storeHandle={ctx.store.handle} days={days} />
      ) : null}

      <nav aria-label="Estado" className="flex flex-wrap gap-2 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`${base}/devoluciones?estado=${t.param}`}
            aria-current={t.key === tab.key ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 md:min-h-0 ${t.key === tab.key ? "border-fg font-medium" : "border-border"}`}
          >
            {t.label} ({list.counts[t.key] ?? 0})
          </Link>
        ))}
      </nav>

      {list.items.length === 0 ? (
        <p role="status" className="rounded-md border border-border p-4 text-sm">
          {tab.key === "requested"
            ? "No hay devoluciones por revisar."
            : "No hay devoluciones en esta sección."}
        </p>
      ) : (
        <ul aria-label={`Devoluciones: ${tab.label}`} className="space-y-3">
          {list.items.map((r) => (
            <li key={r.id} className="rounded-md border border-border p-4 text-sm">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link
                  href={`${base}/devoluciones/${r.id}`}
                  className="font-medium underline underline-offset-2"
                >
                  Pedido {r.order.display_number}
                </Link>
                <span>{r.order.customer_name}</span>
                <span>
                  {r.units === 1 ? "1 unidad" : `${r.units} unidades`} ·{" "}
                  {RETURN_REASON_LABEL[r.reason] ?? r.reason}
                </span>
                <span className="text-fg-muted">{date.format(new Date(r.requested_at))}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
