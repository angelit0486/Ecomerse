import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { getCatalogQuality } from "@/server/catalog/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { STATUS_LABELS, qualityIssueMessage, QUALITY_ISSUES } from "../messages";

export const metadata: Metadata = { title: "Revisión del catálogo" };

type Props = { params: Promise<{ storeHandle: string }> };

/**
 * Revisión del catálogo (super prompt §16): qué le falta a cada producto para
 * venderse bien (marca, categoría, imagen, descripción, SKU, código de barras,
 * peso de envío) y qué impide publicarlo. Cada producto enlaza a su editor.
 */
export default async function CatalogQualityPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "products.read")) notFound();
  const supabase = await createSupabaseServerClient();
  const report = await getCatalogQuality(supabase, ctx.store.id);
  const base = `/admin/${ctx.store.handle}/productos`;
  const summary = Object.entries(report.by_code).sort((a, b) => b[1] - a[1]);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href={base} className="underline">
            Productos
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Revisión del catálogo</h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Datos que faltan en tus productos (sin contar los archivados). Los marcados «Bloquea la
          publicación» impiden publicar; el resto son recomendaciones para que el comprador compare
          y confíe.
        </p>
      </header>

      {report.total === 0 ? (
        <p role="status" className="rounded-md border border-border p-4 text-sm">
          {report.checked === 0
            ? "Aún no tienes productos."
            : `Tus ${report.checked} productos tienen los datos completos.`}
        </p>
      ) : (
        <>
          <section aria-labelledby="resumen" className="space-y-2">
            <h2 id="resumen" className="font-semibold">
              Resumen
            </h2>
            <ul className="flex flex-wrap gap-2 text-sm">
              {summary.map(([code, n]) => (
                <li key={code} className="rounded-md border border-border px-3 py-2">
                  {QUALITY_ISSUES[code]?.short ?? qualityIssueMessage(code)}:{" "}
                  <span className="font-semibold">{n}</span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="productos" className="space-y-2">
            <h2 id="productos" className="font-semibold">
              {report.total === 1
                ? "1 producto por revisar"
                : `${report.total} productos por revisar`}
              {report.total > report.products.length
                ? ` (se muestran los primeros ${report.products.length})`
                : ""}
            </h2>
            <ul className="divide-y divide-border rounded-md border border-border">
              {report.products.map((product) => (
                <li key={product.id} className="space-y-1 p-4">
                  <p className="text-sm">
                    <Link
                      href={`${base}/${product.id}`}
                      className="font-medium underline underline-offset-4"
                    >
                      {product.title}
                    </Link>{" "}
                    <span className="text-fg-muted">
                      · {STATUS_LABELS[product.status] ?? product.status}
                    </span>
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm">
                    {product.codes.map((code) => (
                      <li key={code}>
                        {qualityIssueMessage(code)}
                        {QUALITY_ISSUES[code] ? null : (
                          <span className="ml-1 font-medium text-danger">
                            (bloquea la publicación)
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
