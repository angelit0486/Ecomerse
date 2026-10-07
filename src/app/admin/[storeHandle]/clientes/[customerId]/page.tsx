import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMoney } from "@/lib/money/format";
import { visibleStatus } from "@/lib/orders/visible-status";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { AnonymizeForm, CustomerForm } from "../customer-forms";
import type { CustomerRow } from "../page";

export const metadata: Metadata = { title: "Cliente" };

type Props = { params: Promise<{ storeHandle: string; customerId: string }> };

interface CustomerDetail extends CustomerRow {
  first_name: string | null;
  last_name: string | null;
  note: string | null;
  marketing_consent_at: string | null;
  marketing_consent_source: string | null;
  addresses: {
    recipient_name: string;
    line1: string;
    line2: string | null;
    city: string;
    region: string;
    postal_code: string;
    country: string;
    is_default: boolean;
  }[];
  orders: {
    id: string;
    display_number: string;
    placed_at: string;
    status: string;
    payment_status: string;
    fulfillment_status: string;
    total: number;
  }[];
}

export default async function CustomerPage({ params }: Props) {
  const { storeHandle, customerId } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "customers.read") || !/^[0-9a-f-]{36}$/.test(customerId)) notFound();
  const supabase = await createSupabaseServerClient();
  const c = await callRpc<CustomerDetail>(supabase, "customers_get", {
    p_store_id: ctx.store.id,
    p_customer_id: customerId,
  }).catch(() => null);
  if (!c) notFound();
  const pii = !c.masked;
  const m = (cents: number) => formatMoney(cents, ctx.store.currency);

  return (
    <section className="space-y-6">
      <header>
        <Link href={`/admin/${ctx.store.handle}/clientes`} className="text-sm underline">
          ← Clientes
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {c.anonymized ? "Cliente anonimizado" : (c.name ?? c.email)}
        </h1>
        <p className="text-sm text-fg-muted">
          {c.anonymized ? "Sus datos personales se eliminaron." : c.email}
          {c.phone && !c.anonymized ? ` · ${c.phone}` : ""}
          {" · "}
          {c.has_account ? "Con cuenta" : "Compró como invitado"}
        </p>
        <p className="text-sm">
          {c.orders_count} pedidos · {m(c.total_spent)} comprado
          {c.accepts_marketing ? " · Acepta publicidad" : ""}
        </p>
      </header>

      {c.orders.length > 0 ? (
        <section aria-labelledby="pedidos" className="space-y-2 text-sm">
          <h2 id="pedidos" className="font-semibold">
            Pedidos
          </h2>
          <ul className="divide-y divide-border">
            {c.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap justify-between gap-2 py-2">
                <Link href={`/admin/${ctx.store.handle}/pedidos/${o.id}`} className="underline">
                  {o.display_number}
                </Link>
                <span>{new Date(o.placed_at).toLocaleDateString("es-MX")}</span>
                <span>{visibleStatus(o)}</span>
                <span>{m(o.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pii && c.addresses.length > 0 ? (
        <section aria-labelledby="direcciones" className="space-y-2 text-sm">
          <h2 id="direcciones" className="font-semibold">
            Direcciones
          </h2>
          <ul className="space-y-1">
            {c.addresses.map((a, i) => (
              <li key={i}>
                {a.recipient_name}: {a.line1}
                {a.line2 ? `, ${a.line2}` : ""}, {a.postal_code} {a.city}, {a.region}, {a.country}
                {a.is_default ? " (principal)" : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pii && !c.anonymized && hasPermission(ctx, "customers.update") ? (
        <section aria-labelledby="editar" className="space-y-2">
          <h2 id="editar" className="font-semibold">
            Datos del cliente
          </h2>
          <CustomerForm
            storeHandle={ctx.store.handle}
            customerId={c.id}
            initial={{
              first_name: c.first_name ?? "",
              last_name: c.last_name ?? "",
              phone: c.phone ?? "",
              note: c.note ?? "",
              accepts_marketing: c.accepts_marketing,
            }}
          />
        </section>
      ) : null}

      {!c.anonymized && hasPermission(ctx, "customers.delete") ? (
        <section
          aria-labelledby="anonimizar"
          className="space-y-2 rounded-md border border-danger p-4"
        >
          <h2 id="anonimizar" className="font-semibold">
            Eliminar datos personales
          </h2>
          <p className="text-sm text-fg-muted">
            Úsalo cuando el cliente lo pida. Se borran su nombre, email, teléfono, direcciones y
            nota, y se desvincula su cuenta. Sus pedidos se conservan como registro de la venta.
          </p>
          <AnonymizeForm storeHandle={ctx.store.handle} customerId={c.id} />
        </section>
      ) : null}
    </section>
  );
}
