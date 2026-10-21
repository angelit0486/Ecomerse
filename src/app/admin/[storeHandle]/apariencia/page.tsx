import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ThemeSettingsV2, type ThemeSettings } from "@/lib/theme/schema";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { publicMediaUrl } from "@/server/catalog/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { LogoForm, type LogoCandidate } from "../configuracion/logo-form";
import {
  BrandForm,
  HeaderFooterForm,
  PresentationForm,
  PublishBar,
  SeoForm,
  SocialContactForm,
} from "./forms";
import { ThemeHistory, type ThemeVersionRow } from "./history";
import { MoveDesign } from "./move-design";
import { HomeEditor } from "./home-editor";
import { loadHomeOptions } from "./home-options";
import { loadSiblingStores } from "../_shared/sibling-stores";

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
  { key: "presentacion", label: "Ficha y listados" },
  { key: "historial", label: "Historial" },
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
  const [{ data: theme }, { data: store }, { data: media }, { data: domain }] = await Promise.all([
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
      .select("id, owner_type, status, storage_path, alt_text, width, height")
      .eq("store_id", ctx.store.id)
      .in("owner_type", ["store_branding", "banner"])
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

  const hasDraft = Boolean(theme?.draft_settings);
  const revision = theme?.draft_revision ?? 0;
  const parsed = ThemeSettingsV2.safeParse(
    (hasDraft ? theme?.draft_settings : theme?.settings) ?? {},
  );
  const settings: ThemeSettings = parsed.success ? parsed.data : {};
  const rows = (media ?? []) as {
    id: string;
    owner_type: string;
    status: LogoCandidate["status"];
    storage_path: string;
    alt_text: string | null;
    width: number | null;
    height: number | null;
  }[];
  // Favicon (ADR-034): imágenes de marca cuadradas ya procesadas.
  const faviconCandidates = rows
    .filter(
      (m) =>
        m.owner_type === "store_branding" &&
        m.status === "ready" &&
        m.width !== null &&
        m.width === m.height &&
        m.width >= 48,
    )
    .map((m) => ({ id: m.id, url: publicMediaUrl(m.storage_path) }));
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
  const versions = tab === "historial" ? await loadVersions(ctx.store.id) : [];
  const siblingStores = tab === "historial" ? await loadSiblingStores(ctx.store.id) : [];
  const homeSections = ((hasDraft ? theme?.draft_home_sections : theme?.home_sections) ??
    []) as Parameters<typeof HomeEditor>[0]["initial"];
  // Tras descartar, los formularios se montan de nuevo con lo publicado.
  const formKey = discarded ? `d${sp.descartado}` : "editor";

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Apariencia</h1>
        <p className="text-sm text-fg-muted">
          Marca, encabezado, pie, redes, SEO, portada y presentación de tu tienda. Los cambios se
          guardan en un borrador que solo tú ves hasta que lo publicas.
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
            faviconCandidates={faviconCandidates}
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
      {tab === "portada" ? (
        <p className="rounded-md border border-border p-3 text-sm">
          {settings.header?.announcement
            ? `Barra de anuncio arriba de la portada: «${settings.header.announcement.text}». `
            : "Sin barra de anuncio arriba de la portada. "}
          <Link
            href={`${base}/apariencia?seccion=encabezado#anuncio`}
            className="inline-flex min-h-11 items-center font-medium underline underline-offset-2 md:min-h-0"
          >
            {settings.header?.announcement
              ? "Editar la barra de anuncio"
              : "Agregar una barra de anuncio"}
          </Link>
        </p>
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
      {tab === "historial" ? (
        <ThemeHistory
          key={formKey}
          storeHandle={ctx.store.handle}
          revision={revision}
          versions={versions}
          hasDraft={hasDraft}
        />
      ) : null}
      {tab === "historial" ? (
        <MoveDesign
          key={`m${formKey}`}
          storeHandle={ctx.store.handle}
          revision={revision}
          stores={siblingStores}
        />
      ) : null}
      {tab === "presentacion" ? (
        <PresentationForm
          key={formKey}
          storeHandle={ctx.store.handle}
          revision={revision}
          settings={settings}
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
          storeUrl={domain?.hostname ? `https://${domain.hostname}` : `https://${ctx.store.handle}`}
        />
      ) : null}
    </section>
  );
}

/** Lo que se puede elegir en la portada: imágenes, categorías, marcas y objetivos. */

/** Versiones publicadas (ADR-034 §4), con un resumen legible de cada una. */
async function loadVersions(storeId: string): Promise<ThemeVersionRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("store_theme_versions")
    .select("id, number, published_at, home_sections, settings")
    .eq("store_id", storeId)
    .order("number", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []).map((v) => {
    const sections = Array.isArray(v.home_sections) ? (v.home_sections as { type: string }[]) : [];
    const hero = sections.find((s) => s.type === "hero") as
      { props?: { heading?: string } } | undefined;
    const colors = (v.settings as { colors?: { primary?: string } } | null)?.colors;
    const parts = [
      sections.length === 0
        ? "portada de la plantilla"
        : `${sections.length} ${sections.length === 1 ? "bloque" : "bloques"} en la portada`,
      hero?.props?.heading ? `«${hero.props.heading}»` : null,
      colors?.primary ? `color principal ${colors.primary}` : null,
    ].filter(Boolean);
    return {
      id: v.id as string,
      number: v.number as number,
      publishedAt: v.published_at as string,
      summary: parts.join(" · "),
    };
  });
}

/** Otras tiendas de la misma organización a las que esta persona tiene acceso. */
