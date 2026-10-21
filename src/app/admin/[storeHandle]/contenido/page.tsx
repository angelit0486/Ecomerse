import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { listPages } from "@/server/content/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { PAGE_TYPE_LABELS } from "./labels";
import { NewPageForm } from "./page-forms";

export const metadata: Metadata = { title: "Contenido" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ContentPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  const canPages = hasPermission(ctx, "content.manage");
  const canMenus = hasPermission(ctx, "appearance.manage");
  const canRedirects = hasPermission(ctx, "seo.manage");
  if (!canPages && !canMenus) notFound();
  const sp = await searchParams;
  const base = `/admin/${ctx.store.handle}/contenido`;
  const pages = canPages ? await listPages(await createSupabaseServerClient(), ctx.store.id) : [];

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Contenido</h1>
        <p className="text-sm text-fg-muted">
          Páginas informativas, políticas de la tienda y menús de navegación.
        </p>
        {sp.eliminada === "1" ? (
          <p role="status" className="text-sm text-success">
            Página eliminada.
          </p>
        ) : null}
      </header>

      {canMenus || canRedirects ? (
        <p className="flex flex-wrap gap-x-6">
          {canMenus ? (
            <Link
              href={`${base}/menus`}
              className="inline-flex min-h-11 items-center text-sm underline"
            >
              Editar menús de la tienda
            </Link>
          ) : null}
          {canRedirects ? (
            <Link
              href={`${base}/redirecciones`}
              className="inline-flex min-h-11 items-center text-sm underline"
            >
              Redirecciones de direcciones viejas
            </Link>
          ) : null}
        </p>
      ) : null}

      {canPages ? (
        <>
          <NewPageForm storeHandle={ctx.store.handle} />
          <div role="region" aria-label="Páginas" tabIndex={0} className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Páginas de la tienda</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Título
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Tipo
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Dirección
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.id} className="border-b border-border">
                    <td className="py-2 pr-3">
                      <Link href={`${base}/paginas/${p.id}`} className="underline">
                        {p.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{PAGE_TYPE_LABELS[p.type] ?? p.type}</td>
                    <td className="py-2 pr-3 font-mono text-xs">/paginas/{p.slug}</td>
                    <td className="py-2">{p.is_published ? "Publicada" : "Borrador"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
