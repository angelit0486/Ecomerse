import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { resolveTheme, themeCss } from "@/lib/theme/resolve-theme";
import { ThemeSettingsV1 } from "@/lib/theme/schema";
import { getCart } from "@/server/storefront/cart";
import { getDiscoverySummary, getMenus } from "@/server/storefront/catalog";
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

// Títulos con la fuente de títulos del tema (lista curada, D-F9-01), solo de
// 20 px para arriba (h1 y títulos text-xl o mayores): una condensada a 14–16 px
// se lee peor, así que «Resumen», «Ingredientes» o «Contacto» van con la de
// texto (revisión de conversión, B1). `.sf-text-font` la excluye siempre.
const HEADING_CSS =
  ".sf-root :is(h1,:is(h2,h3,h4):is([class*=text-xl],[class*=text-2xl],[class*=text-3xl],[class*=text-4xl],[class*=text-5xl])):not(.sf-text-font){font-family:var(--sf-font-heading),system-ui,sans-serif}";

/**
 * Favicon, ícono de Apple y manifiesto de la tienda (§20.2, D-F9-06). La
 * plantilla del título lleva el nombre de la tienda: las páginas con título fijo
 * (carrito, checkout, cuenta) nunca muestran el nombre de la plataforma (white-label).
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store } = await getStorefront((await params).storeId);
  const v = iconVersion(store);
  return {
    title: { default: store.name, template: `%s · ${store.name}` },
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
  const [menus, nonce, cart, discovery] = await Promise.all([
    getMenus(store.id),
    headers().then((h) => h.get("x-nonce") ?? undefined),
    // Sin caché: depende de la cookie del comprador (§44.7).
    getCart(store.id).catch(() => null),
    getDiscoverySummary(store.id),
  ]);
  // «Marcas» con al menos dos (una sola no ayuda a explorar) y «Ofertas» con
  // descuentos reales (super prompt §5 y §8).
  const discoveryLinks = [
    ...(discovery.brands >= 2 ? [{ label: "Marcas", href: "/marcas" }] : []),
    ...(discovery.offers > 0 ? [{ label: "Ofertas", href: "/ofertas" }] : []),
  ];
  const theme = resolveTheme(store.theme?.settings);
  // Se vuelve a validar al mostrar (F9-DESIGN §13 H2): un valor fuera del esquema
  // no llega a la página.
  const parsed = ThemeSettingsV1.safeParse(store.theme?.settings ?? {});
  const settings = parsed.success ? parsed.data : {};
  const fonts = fontVariableClasses([theme.fonts.heading, theme.fonts.body]);

  return (
    <div
      className={`sf-root relative ${fonts} flex min-h-dvh flex-col bg-[var(--sf-bg)] text-[var(--sf-fg)]`}
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
        discovery={discoveryLinks}
        cartCount={cart?.item_count ?? 0}
        logoPosition={theme.logoPosition}
      />
      <main id="contenido" className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:py-8">
        {children}
      </main>
      <StoreFooter
        store={store}
        menu={menus.footer}
        settings={settings}
        discovery={discoveryLinks}
      />
      {/* Botón flotante de WhatsApp solo si la tienda lo configuró (las tres tiendas
          de referencia lo tienen; pulido visual). Sube cuando hay barra de compra. */}
      {settings.contact?.whatsapp ? (
        <a
          href={`https://wa.me/${settings.contact.whatsapp.slice(1)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="sf-whatsapp fixed bottom-4 right-4 z-20 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25d366] text-[#0b141a] shadow-lg"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
            <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .2-1.2c-.1-.1-.3-.2-.5-.3Z" />
          </svg>
          <span className="sr-only">Abrir chat de WhatsApp con la tienda</span>
        </a>
      ) : null}
    </div>
  );
}
