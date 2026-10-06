import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { getPage } from "@/server/content/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { PAGE_TYPE_LABELS } from "../../labels";
import { PageEditorForm, PageStatusForm } from "../../page-forms";

export const metadata: Metadata = { title: "Página" };

type Props = {
  params: Promise<{ storeHandle: string; pageId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PageEditorPage({ params, searchParams }: Props) {
  const { storeHandle, pageId } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "content.manage") || !/^[0-9a-f-]{36}$/.test(pageId)) notFound();
  const sp = await searchParams;
  const page = await getPage(await createSupabaseServerClient(), ctx.store.id, pageId);
  if (!page) notFound();
  const canEdit = ctx.accessMode !== "read_only" && !ctx.supportGrantId;

  return (
    <section className="space-y-6">
      <header>
        <Link href={`/admin/${ctx.store.handle}/contenido`} className="text-sm underline">
          ← Contenido
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{page.title}</h1>
        <p className="text-sm text-fg-muted">
          {PAGE_TYPE_LABELS[page.type] ?? page.type} ·{" "}
          {page.is_published ? "Publicada" : "Borrador"}
        </p>
        {sp.creada === "1" ? (
          <p role="status" className="mt-2 text-sm text-success">
            Página creada como borrador. Escribe el contenido y publícala cuando esté lista.
          </p>
        ) : null}
        {page.type !== "content" && !page.is_published ? (
          <p className="mt-2 rounded-md border border-warning px-3 py-2 text-sm">
            Esta política parte de una plantilla de guía, no de un texto legal. Sustituye cada
            marcador entre corchetes por las condiciones reales de tu tienda antes de publicarla.
          </p>
        ) : null}
      </header>
      {canEdit ? (
        <PageStatusForm
          storeHandle={ctx.store.handle}
          pageId={page.id}
          published={page.is_published}
          deletable={page.type === "content"}
        />
      ) : null}
      <PageEditorForm storeHandle={ctx.store.handle} page={page} canEdit={canEdit} />
    </section>
  );
}
