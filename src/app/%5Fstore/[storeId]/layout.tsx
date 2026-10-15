import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { resolveTheme, themeCss } from "@/lib/theme/resolve-theme";
import { ThemeSettingsV1 } from "@/lib/theme/schema";
import { getCart } from "@/server/storefront/cart";
import { getMenus } from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";
import { iconVersion } from "@/server/storefront/icons";

import { fontVariableClasses } from "./_components/fonts";
import { AnnouncementBar, StoreFooter, StoreHeader } from "./_components/header";

/**
 * Marco del storefront (F5-T03): tema de la tienda como variables CSS (lista
 * blanca de valores, nunca CSS del comerciante), header, footer y barra de
 * vista previa. La tienda llega verificada por la firma del proxy.
 */
type Props = { children: ReactNode; params: Promise<{ storeId: string }> };

// Derivados fijos de la paleta (no editables): superficies, bordes y radios.
const BASE_CSS = [
  "--sf-surface:color-mix(in srgb,var(--sf-fg) 5%,var(--sf-bg))",
  "--sf-border:color-mix(in srgb,var(--sf-fg) 15%,var(--sf-bg))",
  "--sf-border-strong:color-mix(in srgb,var(--sf-fg) 55%,var(--sf-bg))",
  "--sf-radius-card:min(var(--sf-radius),12px)",
  "--sf-radius-control:min(var(--sf-radius),8px)",
  "--sf-radius-btn:var(--sf-radius)",
  "font-family:var(--sf-font-body),system-ui,sans-serif",
].join(";");

// Títulos con la fuente de títulos del tema (lista curada, D-F9-01).
const HEADING_CSS =
  ".sf-root :is(h1,h2,h3,h4){font-family:var(--sf-font-heading),system-ui,sans-serif}";

/** Favicon, ícono de Apple y manifiesto de la tienda (§20.2, D-F9-06). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store } = await getStorefront((await params).storeId);
  const v = iconVersion(store);
  return {
    icons: {
      icon: [{ url: `/icon.svg?v=${v}`, type: "image/svg+xml" }],
      apple: [{ url: `/apple-touch-icon.png?v=${v}`, sizes: "180x180" }],
    },
    manifest: `/manifest.webmanifest?v=${v}`,
  };
}

export default async function StoreLayout({ children, params }: Props) {
  const { storeId } = await params;
  const { store, preview } = await getStorefront(storeId);
  const [menus, nonce, cart] = await Promise.all([
    getMenus(store.id),
    headers().then((h) => h.get("x-nonce") ?? undefined),
    // Sin caché: depende de la cookie del comprador (§44.7).
    getCart(store.id).catch(() => null),
  ]);
  const theme = resolveTheme(store.theme?.settings);
  // Se vuelve a validar al mostrar (F9-DESIGN §13 H2): un valor fuera del esquema
  // no llega a la página.
  const parsed = ThemeSettingsV1.safeParse(store.theme?.settings ?? {});
  const settings = parsed.success ? parsed.data : {};
  const fonts = fontVariableClasses([theme.fonts.heading, theme.fonts.body]);

  return (
    <div
      className={`sf-root ${fonts} flex min-h-dvh flex-col bg-[var(--sf-bg)] text-[var(--sf-fg)]`}
    >
      <style nonce={nonce}>{`.sf-root{${themeCss(theme)};${BASE_CSS}}${HEADING_CSS}`}</style>
      {preview ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-[var(--sf-fg)] px-4 py-2 text-center text-sm text-[var(--sf-bg)]"
        >
          <p>
            {store.status === "active"
              ? "Vista previa del borrador: tus clientes ven la versión publicada."
              : "Vista previa: solo tú puedes ver esta tienda. Los compradores aún no tienen acceso."}
          </p>
          <form method="post" action="/_preview/salir">
            <button type="submit" className="underline underline-offset-2">
              Salir de la vista previa
            </button>
          </form>
        </div>
      ) : null}
      <AnnouncementBar announcement={theme.announcement} />
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-[var(--sf-bg)] focus:p-2"
      >
        Saltar al contenido
      </a>
      <StoreHeader
        store={store}
        menu={menus.main}
        cartCount={cart?.item_count ?? 0}
        logoPosition={theme.logoPosition}
      />
      <main id="contenido" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
      <StoreFooter store={store} menu={menus.footer} settings={settings} />
    </div>
  );
}
