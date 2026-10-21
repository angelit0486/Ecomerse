import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPage } from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";
import { getPagePreview } from "@/server/storefront/preview-reads";
import { excerpt, pageMetadata } from "@/server/storefront/seo";
import { ThemeSettingsV2 } from "@/lib/theme/schema";
import { SafeHtml } from "@/ui/safe-html";

import { HomeSections } from "../../_components/home-sections";

type Props = { params: Promise<{ storeId: string; slug: string }> };

async function load(params: Props["params"]) {
  const { storeId, slug } = await params;
  const { store, preview } = await getStorefront(storeId);
  // La vista previa muestra el borrador de bloques y las páginas sin publicar (ADR-034 §3).
  const page = preview ? await getPagePreview(store.id, slug) : await getPage(store.id, slug);
  if (!page) notFound();
  return { store, preview, page };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, preview, page } = await load(params);
  return pageMetadata({
    store,
    preview,
    path: `/paginas/${page.slug}`,
    title: page.seo_title ?? page.title,
    description: page.seo_description ?? excerpt(page.body_html),
    image: page.seo_image ?? undefined,
  });
}

export default async function StorePage({ params }: Props) {
  const { store, page } = await load(params);
  const sections = page.sections ?? [];
  const parsed = ThemeSettingsV2.safeParse(store.theme?.settings ?? {});
  const contact = parsed.success ? (parsed.data.contact ?? {}) : {};
  const hasText = page.body_html.replace(/<[^>]*>/g, "").trim() !== "";
  return (
    <div className="space-y-10">
      <article className="max-w-prose space-y-4">
        {page.unpublished ? (
          <p className="text-sm font-semibold text-[var(--sf-warning)]">
            Página sin publicar: solo tú la ves en la vista previa.
          </p>
        ) : null}
        <h1 className="text-3xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl">
          {page.title}
        </h1>
        {hasText ? <SafeHtml html={page.body_html} className="sf-prose space-y-3" /> : null}
      </article>
      {sections.length > 0 ? (
        <HomeSections
          sections={sections}
          store={store}
          storeName={store.name}
          contact={contact}
          asPage
        />
      ) : null}
    </div>
  );
}
