import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { photoProgress } from "@/lib/media/progress";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { resumeQueue } from "@/server/jobs/run-now";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { imageProcessingBlocked } from "@/server/system/health";

import { REJECTION_REASONS } from "../../messages";
import { AutoRefresh } from "../auto-refresh";

export const metadata: Metadata = { title: "Fotos en proceso" };

type Props = { params: Promise<{ storeHandle: string }> };

const SHOWN_REJECTED = 100;

/**
 * Productos → Importar → Fotos en proceso (Orden 09, RM-10). Al importar un
 * catálogo con miles de fotos por enlace, la tienda ve cuántas faltan y cuáles
 * no se pudieron usar, con su motivo. Mientras la página está abierta, la cola
 * sigue avanzando aunque el cron sea diario (cada pasada procesa ~45 s).
 */
export default async function PhotoProgressPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "products.read")) notFound();
  const supabase = await createSupabaseServerClient();
  const count = (status: string) =>
    supabase
      .from("media")
      .select("id", { count: "exact", head: true })
      .eq("store_id", ctx.store.id)
      .eq("owner_type", "product")
      .eq("status", status)
      .is("deleted_at", null);
  const [pending, ready, rejected, rejectedRows] = await Promise.all([
    count("pending"),
    count("ready"),
    count("rejected"),
    supabase
      .from("media")
      .select("id, product_id, rejection_reason, source_url, created_at")
      .eq("store_id", ctx.store.id)
      .eq("owner_type", "product")
      .eq("status", "rejected")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(SHOWN_REJECTED),
  ]);
  for (const result of [pending, ready, rejected, rejectedRows]) {
    if (result.error) throw result.error;
  }
  const counts = {
    pending: pending.count ?? 0,
    ready: ready.count ?? 0,
    rejected: rejected.count ?? 0,
  };
  const progress = photoProgress(counts);
  const rows = (rejectedRows.data ?? []) as {
    id: string;
    product_id: string | null;
    rejection_reason: string | null;
    source_url: string | null;
  }[];
  const productIds = [...new Set(rows.map((r) => r.product_id).filter((id) => id !== null))];
  const { data: products, error: productsError } = productIds.length
    ? await supabase
        .from("products")
        .select("id, title")
        .eq("store_id", ctx.store.id)
        .in("id", productIds)
    : { data: [], error: null };
  if (productsError) throw productsError;
  const titles = new Map((products ?? []).map((p) => [p.id as string, p.title as string]));

  const blocked = imageProcessingBlocked();
  // Con la página abierta la cola no se detiene (como mucho una pasada cada 10 s).
  if (counts.pending > 0 && !blocked) resumeQueue("media.progress");
  const base = `/admin/${ctx.store.handle}/productos`;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href={base} className="underline">
            Productos
          </Link>{" "}
          ·{" "}
          <Link href={`${base}/importar`} className="underline">
            Importar
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Fotos en proceso</h1>
        <p className="text-sm text-fg-muted">
          Cada foto se revisa, se aligera y se guarda en varios tamaños antes de aparecer en tu
          tienda.
        </p>
      </header>

      <section aria-labelledby="avance" className="space-y-3 rounded-md border border-border p-4">
        <h2 id="avance" className="font-semibold">
          Avance
        </h2>
        <progress
          aria-label="Fotos terminadas"
          max={100}
          value={progress.percent}
          className="h-2 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-accent"
        />
        <p role="status" className="text-sm">
          <span className="font-medium tabular-nums">{progress.percent} %</span> ·{" "}
          {progress.summary}
        </p>
        {counts.pending > 0 && blocked ? (
          <p role="alert" className="rounded-md border border-warning p-3 text-sm">
            Las fotos están guardadas, pero el servidor todavía no tiene configurada la optimización
            de imágenes: no avanzarán hasta que se configure (lo ves en Inicio → Estado del
            sistema).
          </p>
        ) : null}
        {counts.pending > 0 && !blocked ? (
          <p className="text-sm text-fg-muted">
            Deja esta página abierta: se actualiza sola y las fotos siguen avanzando. Puedes
            cerrarla y volver después; lo ya terminado no se pierde.
            <AutoRefresh everyMs={5000} />
          </p>
        ) : null}
        {progress.done && progress.total > 0 ? (
          <p className="text-sm text-fg-muted">No queda ninguna foto en espera.</p>
        ) : null}
      </section>

      {counts.rejected > 0 ? (
        <section aria-labelledby="rechazadas" className="space-y-2">
          <h2 id="rechazadas" className="font-semibold">
            Fotos que no se pudieron usar
          </h2>
          <p className="text-sm text-fg-muted">
            {counts.rejected > rows.length
              ? `Se muestran las ${rows.length} más recientes de ${counts.rejected.toLocaleString("es-MX")}. `
              : null}
            Abre el producto para subir otra foto.
          </p>
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {rows.map((row) => (
              <li key={row.id} className="space-y-1 p-3">
                <p className="font-medium">
                  {row.product_id && titles.has(row.product_id) ? (
                    <Link href={`${base}/${row.product_id}`} className="underline">
                      {titles.get(row.product_id)}
                    </Link>
                  ) : (
                    "Producto eliminado"
                  )}
                </p>
                <p>
                  {REJECTION_REASONS[row.rejection_reason ?? ""] ??
                    "No pudimos usar esta foto. Sube otra desde el producto."}
                </p>
                {row.source_url ? (
                  <p className="break-all text-[13px] text-fg-muted">
                    Enlace del archivo: {hostAndPath(row.source_url)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

/** Dominio y ruta del enlace, sin la consulta: puede llevar una firma. */
function hostAndPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`.slice(0, 200);
  } catch {
    return "enlace no válido";
  }
}
