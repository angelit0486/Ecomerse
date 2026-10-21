import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { DeleteRedirect, RedirectForm } from "./forms";

export const metadata: Metadata = { title: "Redirecciones" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<{ quitada?: string }>;
};

/**
 * Redirecciones 301 (D-EST-02): cuando cambia la dirección de un producto o una
 * página, los enlaces viejos (Google, redes, WhatsApp) siguen llegando.
 */
export default async function RedirectsPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const removed = (await searchParams).quitada === "1";
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "seo.manage")) notFound();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("store_redirects")
    .select("id, from_path, to_path")
    .eq("store_id", ctx.store.id)
    .order("from_path");
  if (error) throw error;
  const rows = (data ?? []) as { id: string; from_path: string; to_path: string }[];

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <Link
          href={`/admin/${ctx.store.handle}/contenido`}
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          ← Contenido
        </Link>
        <h1 className="text-xl font-semibold">Redirecciones</h1>
        <p className="text-sm text-fg-muted">
          Si cambiaste la dirección de un producto o una página, lleva la dirección vieja a la nueva
          para no perder visitas ni posiciones en Google. Solo dentro de tu tienda.
        </p>
      </header>

      {removed ? (
        <p role="status" className="rounded-md border border-border p-3 text-sm">
          Redirección quitada.
        </p>
      ) : null}

      <RedirectForm storeHandle={ctx.store.handle} />

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
          Todavía no tienes redirecciones.
        </p>
      ) : (
        <div role="region" aria-label="Redirecciones" tabIndex={0} className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Redirecciones de la tienda</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Dirección vieja
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Lleva a
                </th>
                <th scope="col" className="py-2">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border align-middle">
                  <td className="break-all py-2 pr-3 font-mono text-[13px]">{r.from_path}</td>
                  <td className="break-all py-2 pr-3 font-mono text-[13px]">{r.to_path}</td>
                  <td className="py-2 text-right">
                    <DeleteRedirect storeHandle={ctx.store.handle} id={r.id} from={r.from_path} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
