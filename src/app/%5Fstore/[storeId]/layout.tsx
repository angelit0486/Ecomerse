import { headers } from "next/headers";
import type { ReactNode } from "react";

import { resolveTheme, themeCss } from "@/lib/theme/resolve-theme";
import { getMenus } from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";

import { StoreFooter, StoreHeader } from "./_components/header";

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
].join(";");

export default async function StoreLayout({ children, params }: Props) {
  const { storeId } = await params;
  const { store, preview } = await getStorefront(storeId);
  const [menus, nonce] = await Promise.all([
    getMenus(store.id),
    headers().then((h) => h.get("x-nonce") ?? undefined),
  ]);
  const theme = resolveTheme(store.theme?.settings);

  return (
    <div className="sf-root flex min-h-dvh flex-col bg-[var(--sf-bg)] text-[var(--sf-fg)]">
      <style nonce={nonce}>{`.sf-root{${themeCss(theme)};${BASE_CSS}}`}</style>
      {preview ? (
        <p
          role="status"
          className="bg-[var(--sf-fg)] px-4 py-2 text-center text-sm text-[var(--sf-bg)]"
        >
          Vista previa: solo tú puedes ver esta tienda. Los compradores aún no tienen acceso.
        </p>
      ) : null}
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-[var(--sf-bg)] focus:p-2"
      >
        Saltar al contenido
      </a>
      <StoreHeader store={store} menu={menus.main} />
      <main id="contenido" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
      <StoreFooter store={store} menu={menus.footer} />
    </div>
  );
}
