import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ThemeSettingsV1, type ThemeSettings } from "@/lib/theme/schema";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { publicMediaUrl } from "@/server/catalog/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { LogoForm, type LogoCandidate } from "../configuracion/logo-form";
import { BrandForm, HeaderFooterForm, PublishBar, SeoForm, SocialContactForm } from "./forms";
import { HomeEditor, type HomeEditorOptions } from "./home-editor";

export const metadata: Metadata = { title: "Apariencia" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TABS = [
  { key: "marca", label: "Marca" },
  { key: "encabezado", label: "Encabezado y pie" },
  { key: "redes", label: "Redes y contacto" },
  { key: "seo", label: "SEO" },
  { key: "portada", label: "Portada" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/**
 * Apariencia de la tienda (F9-T01, GATE0 §20.2, F9-DESIGN §7): se edita el
 * borrador por pestañas, se revisa en la vista previa y se publica. El borrador
 * manda en el editor; sin borrador, lo publicado.
 */
export default async function AppearancePage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "appearance.manage")) notFound();
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.seccion) ? (sp.seccion as Tab) : "marca";
  const discarded = typeof sp.descartado === "string" && /^\d{1,9}$/.test(sp.descartado);
  const base = `/admin/${ctx.store.handle}`;

  const supabase = await createSupabaseServerClient();
  const [{ data: theme }, { data: store }, { data: media }] = await Promise.all([
    supabase
      .from("store_themes")
      .select(
        "settings, draft_settings, home_sections, draft_home_sections, draft_revision, logo_media_id, draft_logo_media_id, published_at",
      )
      .eq("store_id", ctx.store.id)
      .maybeSingle(),
    supabase.from("stores").select("contact_email, contact_phone").eq("id", ctx.store.id).single(),
    supabase
      .from("media")
      .select("id, owner_type, status, storage_path, alt_text")
      .eq("store_id", ctx.store.id)
      .in("owner_type", ["store_branding", "banner"])
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const hasDraft = Boolean(theme?.draft_settings);
  const revision = theme?.draft_revision ?? 0;
  const parsed = ThemeSettingsV1.safeParse(
    (hasDraft ? theme?.draft_settings : theme?.settings) ?? {},
  );
  const settings: ThemeSettings = parsed.success ? parsed.data : {};
  const rows = (media ?? []) as {
    id: string;
    owner_type: string;
    status: LogoCandidate["status"];
    storage_path: string;
    alt_text: string | null;
  }[];
  const logos = rows
    .filter((m) => m.owner_type === "store_branding")
    .slice(0, 10)
    .map((m) => ({
      id: m.id,
      status: m.status,
      url: m.status === "ready" ? publicMediaUrl(m.storage_path) : null,
    }));
  const currentLogoId = hasDraft ? theme?.draft_logo_media_id : theme?.logo_media_id;
  const currentLogo = logos.find((l) => l.id === currentLogoId && l.url);
  const images = rows
    .filter((m) => m.status === "ready")
    .map((m) => ({ id: m.id, url: publicMediaUrl(m.storage_path), alt: m.alt_text }));
  const homeOptions = tab === "portada" ? await loadHomeOptions(ctx.store.id, rows) : null;
  const homeSections = ((hasDraft ? theme?.draft_home_sections : theme?.home_sections) ??
    []) as Parameters<typeof HomeEditor>[0]["initial"];
  // Tras descartar, los formularios se montan de nuevo con lo publicado.
  const formKey = discarded ? `d${sp.descartado}` : "editor";

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Apariencia</h1>
        <p className="text-sm text-fg-muted">
          Marca, encabezado, pie, redes y SEO de tu tienda. Los cambios se guardan en un borrador
          que solo tú ves hasta que lo publicas.
        </p>
      </header>

      {discarded ? (
        <p role="status" className="rounded-md border border-border p-3 text-sm">
          Cambios descartados. Volviste a la versión publicada.
        </p>
      ) : null}

      <PublishBar
        storeHandle={ctx.store.handle}
        section={tab}
        revision={revision}
        hasDraft={hasDraft}
        publishedAt={theme?.published_at ?? null}
        previewAction={`${base}/apariencia/vista-previa`}
      />

      <nav aria-label="Secciones de apariencia">
        <ul className="flex flex-wrap gap-2 border-b border-border">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={`${base}/apariencia?seccion=${t.key}`}
                aria-current={t.key === tab ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 px-3 py-2 text-sm md:min-h-0 ${
                  t.key === tab
                    ? "border-accent font-semibold text-fg"
                    : "border-transparent text-fg-muted hover:text-fg"
                }`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "marca" ? (
        <div className="space-y-8" key={formKey}>
          <section aria-labelledby="logo" className="space-y-3">
            <h2 id="logo" className="text-base font-semibold">
              Logo
            </h2>
            <LogoForm
              storeHandle={ctx.store.handle}
              storeName={ctx.store.name}
              current={currentLogo ? { id: currentLogo.id, url: currentLogo.url! } : null}
              candidates={logos}
              revision={revision}
            />
          </section>
          <BrandForm
            storeHandle={ctx.store.handle}
            revision={revision}
            settings={settings}
            storeName={ctx.store.name}
          />
        </div>
      ) : null}
      {tab === "encabezado" ? (
        <HeaderFooterForm
          key={formKey}
          storeHandle={ctx.store.handle}
          revision={revision}
          settings={settings}
          menusHref={hasPermission(ctx, "content.manage") ? `${base}/contenido/menus` : null}
        />
      ) : null}
      {tab === "redes" ? (
        <SocialContactForm
          key={formKey}
          storeHandle={ctx.store.handle}
          revision={revision}
          settings={settings}
          profileHref={
            hasPermission(ctx, "store.update") ? `${base}/configuracion#paso-datos` : null
          }
          email={store?.contact_email ?? null}
          phone={store?.contact_phone ?? null}
        />
      ) : null}
      {tab === "portada" && homeOptions ? (
        <HomeEditor
          key={formKey}
          storeHandle={ctx.store.handle}
          revision={revision}
          initial={homeSections}
          options={homeOptions}
        />
      ) : null}
      {tab === "seo" ? (
        <SeoForm
          key={formKey}
          storeHandle={ctx.store.handle}
          revision={revision}
          settings={settings}
          storeName={ctx.store.name}
          images={images}
        />
      ) : null}
    </section>
  );
}

/** Lo que se puede elegir en la portada: imágenes, categorías, marcas y objetivos. */
async function loadHomeOptions(
  storeId: string,
  media: {
    id: string;
    owner_type: string;
    status: string;
    storage_path: string;
    alt_text: string | null;
  }[],
): Promise<HomeEditorOptions> {
  const supabase = await createSupabaseServerClient();
  const [{ data: categories }, { data: brands }, { data: attributes }] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, depth")
      .eq("store_id", storeId)
      .eq("is_visible", true)
      .is("deleted_at", null)
      .order("path"),
    supabase
      .from("brands")
      .select("id, name, logo_media_id")
      .eq("store_id", storeId)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("attributes")
      .select("name, is_filterable, attribute_values(id, label, position)")
      .eq("store_id", storeId)
      .eq("is_filterable", true)
      .order("position"),
  ]);
  return {
    banners: media
      .filter((m) => m.owner_type === "banner" && m.status === "ready")
      .map((m) => ({ id: m.id, url: publicMediaUrl(m.storage_path), alt: m.alt_text })),
    categories: (categories ?? []).map((c) => ({
      id: c.id,
      name: `${"— ".repeat(c.depth ?? 0)}${c.name}`,
    })),
    brands: (brands ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      hasLogo: Boolean(b.logo_media_id),
    })),
    goals: (attributes ?? []).flatMap((a) =>
      [...((a.attribute_values ?? []) as { id: string; label: string; position: number }[])]
        .sort((x, y) => x.position - y.position)
        .map((v) => ({ id: v.id, label: `${a.name}: ${v.label}` })),
    ),
  };
}
