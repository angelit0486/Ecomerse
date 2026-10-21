import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { getPage } from "@/server/content/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { publicMediaUrl } from "@/server/catalog/queries";

import { HomeEditor } from "../../../apariencia/home-editor";
import { loadHomeOptions } from "../../../apariencia/home-options";
import { savePageBlocks } from "../../actions";
import { PAGE_TYPE_LABELS } from "../../labels";
import { PageBlocksBar, PageEditorForm, PageStatusForm } from "../../page-forms";

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
  const supabase = await createSupabaseServerClient();
  const page = await getPage(supabase, ctx.store.id, pageId);
  if (!page) notFound();
  const canEdit = ctx.accessMode !== "read_only" && !ctx.supportGrantId;
  // Imágenes de la tienda (banners y marca) para los bloques y la imagen social.
  const [{ data: media }, { data: domain }] = await Promise.all([
    supabase
      .from("media")
      .select("id, owner_type, status, storage_path, alt_text")
      .eq("store_id", ctx.store.id)
      .in("owner_type", ["store_branding", "banner"])
      .eq("status", "ready")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("store_domains")
      .select("hostname")
      .eq("store_id", ctx.store.id)
      .eq("status", "active")
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const rows = (media ?? []) as {
    id: string;
    owner_type: string;
    status: string;
    storage_path: string;
    alt_text: string | null;
  }[];
  const images = rows.map((m) => ({
    id: m.id,
    url: publicMediaUrl(m.storage_path),
    alt: m.alt_text,
  }));
  const blocksEnabled = page.type === "content" && canEdit;
  const options = blocksEnabled ? await loadHomeOptions(ctx.store.id, rows) : null;
  const blocks = (page.draft_sections ?? page.sections ?? []) as Parameters<
    typeof HomeEditor
  >[0]["initial"];
  const host = domain?.hostname ?? `${ctx.store.handle}`;
  const previewHref = hasPermission(ctx, "appearance.manage")
    ? `/admin/${ctx.store.handle}/apariencia/vista-previa?ruta=${encodeURIComponent(`/paginas/${page.slug}`)}`
    : null;

  return (
    <section className="space-y-6">
      <header>
        <Link
          href={`/admin/${ctx.store.handle}/contenido`}
          className="inline-flex min-h-11 items-center text-sm underline"
        >
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
      <PageEditorForm
        storeHandle={ctx.store.handle}
        page={page}
        canEdit={canEdit}
        images={images}
        pageUrl={`https://${host}/paginas/${page.slug}`}
      />
      {blocksEnabled && options ? (
        <section aria-labelledby="bloques-pagina" className="space-y-4">
          <h2 id="bloques-pagina" className="text-base font-semibold">
            Bloques de la página
          </h2>
          <p className="text-sm text-fg-muted">
            Arma la página con los mismos bloques de la portada (preguntas, beneficios, video,
            productos…). Van debajo del texto; puedes dejar el texto vacío y usar solo bloques.
          </p>
          <PageBlocksBar
            storeHandle={ctx.store.handle}
            pageId={page.id}
            hasDraft={page.draft_sections !== null && page.draft_sections !== undefined}
            previewHref={previewHref}
          />
          <HomeEditor
            storeHandle={ctx.store.handle}
            revision={0}
            initial={blocks}
            options={options}
            save={savePageBlocks.bind(null, ctx.store.handle, page.id)}
            saveLabel="Guardar bloques en el borrador"
            emptyText="Esta página aún no tiene bloques. Agrega uno abajo."
          />
        </section>
      ) : null}
    </section>
  );
}
