import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { ModerateButtons } from "./forms";

export const metadata: Metadata = { title: "Opiniones" };

type Status = "pending" | "published" | "rejected";

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<{ estado?: string }>;
};

interface ReviewList {
  counts: Record<Status, number>;
  items: {
    id: string;
    rating: number;
    title: string | null;
    body: string;
    author_name: string;
    status: Status;
    created_at: string;
    product: { id: string; title: string; slug: string };
    order: { id: string; display_number: string };
  }[];
}

const TABS: { key: Status; param: string; label: string }[] = [
  { key: "pending", param: "pendientes", label: "Por revisar" },
  { key: "published", param: "publicadas", label: "Publicadas" },
  { key: "rejected", param: "rechazadas", label: "Rechazadas" },
];

/**
 * Opiniones de compradores (ADR-029): solo de pedidos pagados y entregados.
 * Ninguna se publica sola: en suplementos una opinión puede afirmar curas o
 * efectos que la ley no permite publicar.
 */
export default async function ReviewsPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "products.read")) notFound();
  const { estado } = await searchParams;
  const tab = TABS.find((t) => t.param === estado) ?? TABS[0]!;
  const supabase = await createSupabaseServerClient();
  const list = await callRpc<ReviewList>(supabase, "reviews_list", {
    p_store_id: ctx.store.id,
    p_status: tab.key,
  });
  const canModerate = hasPermission(ctx, "products.update");
  const base = `/admin/${ctx.store.handle}`;
  const date = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeZone: ctx.store.timezone,
  });

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href={`${base}/productos`} className="underline">
            Productos
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Opiniones</h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Solo opinan quienes recibieron su pedido. Revisa cada opinión antes de publicarla: no
          publiques las que digan que un suplemento cura, trata o previene enfermedades.
        </p>
      </header>

      <nav aria-label="Estado" className="flex flex-wrap gap-2 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`${base}/productos/opiniones?estado=${t.param}`}
            aria-current={t.key === tab.key ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 md:min-h-0 ${t.key === tab.key ? "border-fg font-medium" : "border-border"}`}
          >
            {t.label} ({list.counts[t.key] ?? 0})
          </Link>
        ))}
      </nav>

      {list.items.length === 0 ? (
        <p role="status" className="rounded-md border border-border p-4 text-sm">
          {tab.key === "pending"
            ? "No hay opiniones por revisar. Aparecerán aquí cuando tus clientes opinen desde la página de su pedido."
            : "No hay opiniones en esta sección."}
        </p>
      ) : (
        <ul aria-label={`Opiniones: ${tab.label}`} className="space-y-3">
          {list.items.map((r) => (
            <li key={r.id} className="space-y-2 rounded-md border border-border p-4">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">
                  {r.rating} de 5 <span aria-hidden>{"★".repeat(r.rating)}</span>
                </span>
                <Link
                  href={`${base}/productos/${r.product.id}`}
                  className="underline underline-offset-2"
                >
                  {r.product.title}
                </Link>
                <span className="text-fg-muted">
                  {r.author_name} · pedido{" "}
                  <Link href={`${base}/pedidos/${r.order.id}`} className="underline">
                    {r.order.display_number}
                  </Link>{" "}
                  · {date.format(new Date(r.created_at))}
                </span>
              </p>
              {r.title ? <p className="font-semibold">{r.title}</p> : null}
              <p className="whitespace-pre-line text-sm">{r.body}</p>
              {canModerate ? (
                <ModerateButtons storeHandle={ctx.store.handle} reviewId={r.id} status={r.status} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
