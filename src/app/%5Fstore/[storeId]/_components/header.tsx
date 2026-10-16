import Link from "next/link";

import type { SocialNetwork } from "@/lib/theme/links";
import type { ResolvedTheme } from "@/lib/theme/resolve-theme";
import type { PaymentMethod, ThemeSettings } from "@/lib/theme/schema";
import { mediaUrl, type MenuEntry } from "@/server/storefront/catalog";
import type { StorePublic } from "@/server/storefront/store-public";

import { MainNav, MenuButton, NavProvider } from "./main-nav";
import { SearchBox } from "./search-box";
import { ThemeLink } from "./theme-link";

/** Barra de anuncio (§20.2): colores validados con contraste ≥ 4.5:1 al guardar. */
export function AnnouncementBar({ announcement }: { announcement: ResolvedTheme["announcement"] }) {
  if (!announcement) return null;
  return (
    // Región con nombre: ningún contenido queda fuera de un landmark (axe `region`).
    <aside
      aria-label="Aviso de la tienda"
      className="bg-[var(--sf-announce-bg)] px-4 py-2 text-center text-sm text-[var(--sf-announce-fg)]"
    >
      {announcement.link ? (
        <ThemeLink href={announcement.link} className="underline underline-offset-2">
          {announcement.text}
        </ThemeLink>
      ) : (
        <p>{announcement.text}</p>
      )}
    </aside>
  );
}

/**
 * Encabezado (revisión de conversión, A4): en móvil, fila 1 con menú, nombre,
 * cuenta y carrito; fila 2 con el buscador (≈ 110 px en lugar de 233 px). Fijo
 * arriba para que el carrito siempre esté a la vista.
 */
export function StoreHeader({
  store,
  menu,
  discovery = [],
  cartCount,
  logoPosition = "left",
}: {
  store: StorePublic;
  menu: MenuEntry[];
  /** Accesos con contenido real: «Marcas» y «Ofertas». */
  discovery?: { label: string; href: string }[];
  cartCount: number;
  logoPosition?: "left" | "center";
}) {
  const centered = logoPosition === "center";
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--sf-border)] bg-[var(--sf-bg)]">
      <NavProvider>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-2 py-2 sm:gap-x-6 sm:px-4 sm:py-4">
          <MenuButton />
          <Link
            href="/"
            className={`flex min-w-0 flex-1 items-center gap-2 font-semibold ${
              centered ? "justify-center sm:w-full sm:flex-none" : "sm:flex-none"
            }`}
          >
            {store.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- logo re-codificado servido por Storage
              <img
                src={mediaUrl(store.logo.path)}
                alt={store.name}
                width={store.logo.width ?? 160}
                height={store.logo.height ?? 48}
                className="h-9 w-auto max-w-36 object-contain sm:h-10 sm:max-w-40"
              />
            ) : (
              // Un nombre largo pasa a 2 líneas en lugar de cortarse.
              <span className="line-clamp-2 text-base leading-tight sm:text-lg">{store.name}</span>
            )}
          </Link>
          <SearchBox />
          <Link
            href="/cuenta"
            className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-[var(--sf-radius-control)] text-sm font-medium sm:h-auto sm:min-w-0 sm:underline"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-6 w-6 sm:hidden"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
            </svg>
            <span className="sr-only sm:not-sr-only">Mi cuenta</span>
          </Link>
          <Link
            href="/carrito"
            className="inline-flex h-11 shrink-0 items-center gap-1 rounded-[var(--sf-radius-btn)] px-2 text-sm font-medium sm:h-10 sm:border sm:border-[var(--sf-border-strong)] sm:px-4"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-6 w-6 sm:hidden"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            >
              <path d="M5 8h14l-1.2 12H6.2L5 8Z" />
              <path d="M9 8V6a3 3 0 0 1 6 0v2" />
            </svg>
            <span className="sr-only sm:not-sr-only">Carrito</span>
            <span className="sr-only">, productos:</span>
            <span className="rounded-full bg-[var(--sf-fg)] px-2 text-xs text-[var(--sf-bg)] sm:ml-1">
              {cartCount}
            </span>
          </Link>
        </div>
        <MainNav menu={menu} discovery={discovery} />
      </NavProvider>
    </header>
  );
}

const NETWORK_LABELS: Record<SocialNetwork, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  whatsapp: "WhatsApp",
  pinterest: "Pinterest",
  linkedin: "LinkedIn",
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  oxxo: "OXXO",
  spei: "SPEI",
  paypal: "PayPal",
  mercado_pago: "Mercado Pago",
  cash_on_delivery: "Pago contra entrega",
};

/** Texto multilínea (sin HTML): un salto de línea por renglón. */
function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <span key={i}>
          {i > 0 ? <br /> : null}
          {line}
        </span>
      ))}
    </>
  );
}

/**
 * Pie de la tienda (§20.2): menú `footer`, contacto, redes, medios de pago y
 * texto legal. Todo es texto escapado por React; los enlaces se revalidan al
 * mostrarse.
 */
export function StoreFooter({
  store,
  menu,
  settings,
  discovery = [],
}: {
  store: StorePublic;
  menu: MenuEntry[];
  settings: ThemeSettings;
  discovery?: { label: string; href: string }[];
}) {
  const contact = settings.contact ?? {};
  const email = store.contact?.email;
  const phone = store.contact?.phone;
  const hasContact = Boolean(
    email || phone || contact.whatsapp || contact.address || contact.hours,
  );
  const social = settings.social ?? [];
  const payments = settings.footer?.payment_methods ?? [];
  const legal = settings.footer?.legal_text;
  return (
    // Pie invertido (texto del tema sobre su color de texto): el contraste es el
    // mismo par fg/bg que ya valida el tema; el gris sale de mezclar ambos.
    <footer className="mt-24 bg-[var(--sf-fg)] text-[var(--sf-bg)] [--sf-footer-muted:color-mix(in_srgb,var(--sf-bg)_72%,var(--sf-fg))] [--sf-footer-rule:color-mix(in_srgb,var(--sf-bg)_22%,var(--sf-fg))]">
      <div className="mx-auto max-w-6xl px-4 pt-14">
        <p className="text-4xl font-bold leading-none tracking-tight text-balance [font-family:var(--sf-font-heading),system-ui,sans-serif] sm:text-6xl">
          {store.name}
        </p>
      </div>
      <div className="mx-auto mt-10 grid max-w-6xl gap-10 px-4 py-10 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          {/* Accesos que toda tienda tiene (pulido visual): el pie nunca queda vacío. */}
          <nav aria-label="Tienda">
            <ul className="flex flex-col gap-2.5 text-base">
              <li>
                <Link href="/productos" className="hover:underline">
                  Ver el catálogo
                </Link>
              </li>
              {discovery.map((d) => (
                <li key={d.href}>
                  <Link href={d.href} className="hover:underline">
                    {d.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/cuenta" className="hover:underline">
                  Tus pedidos
                </Link>
              </li>
              <li>
                <Link href="/carrito" className="hover:underline">
                  Tu carrito
                </Link>
              </li>
            </ul>
          </nav>
          {menu.length > 0 ? (
            <nav aria-label="Pie de página">
              <ul className="flex flex-col gap-2.5 text-base">
                {menu
                  .flatMap((item) => [item, ...item.children])
                  .map((item) => (
                    <li key={item.href + item.label}>
                      <Link href={item.href} className="hover:underline">
                        {item.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </nav>
          ) : null}
        </div>
        {hasContact ? (
          <section aria-labelledby="sf-contacto" className="space-y-2">
            <h2
              id="sf-contacto"
              className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--sf-footer-muted)]"
            >
              Contacto
            </h2>
            <address className="flex flex-col gap-1 not-italic text-[var(--sf-footer-muted)]">
              {email ? (
                <a href={`mailto:${email}`} className="hover:underline">
                  {email}
                </a>
              ) : null}
              {phone ? (
                <a href={`tel:${phone.replace(/[^+0-9]/g, "")}`} className="hover:underline">
                  {phone}
                </a>
              ) : null}
              {contact.whatsapp ? (
                <a
                  href={`https://wa.me/${contact.whatsapp.slice(1)}`}
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  WhatsApp {contact.whatsapp}
                </a>
              ) : null}
              {contact.address ? (
                <span>
                  <Lines text={contact.address} />
                </span>
              ) : null}
              {contact.hours ? (
                <span>
                  <Lines text={contact.hours} />
                </span>
              ) : null}
            </address>
          </section>
        ) : null}
        {social.length > 0 ? (
          <section aria-labelledby="sf-redes" className="space-y-2">
            <h2
              id="sf-redes"
              className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--sf-footer-muted)]"
            >
              Síguenos
            </h2>
            <ul className="flex flex-wrap gap-2">
              {social.map((s) => (
                <li key={s.network}>
                  <a
                    href={s.url}
                    rel="noopener noreferrer"
                    className="inline-flex min-h-10 items-center rounded-full border border-[var(--sf-footer-rule)] px-4 hover:border-[var(--sf-bg)]"
                  >
                    {NETWORK_LABELS[s.network]}
                    <span className="sr-only"> de {store.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {payments.length > 0 ? (
          <section aria-labelledby="sf-pagos" className="space-y-2">
            <h2
              id="sf-pagos"
              className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--sf-footer-muted)]"
            >
              Formas de pago
            </h2>
            <ul className="flex flex-wrap gap-2">
              {payments.map((m) => (
                <li
                  key={m}
                  className="rounded-[var(--sf-radius-control)] border border-[var(--sf-footer-rule)] px-2.5 py-1 text-xs font-semibold"
                >
                  {PAYMENT_LABELS[m]}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <div className="border-t border-[var(--sf-footer-rule)]">
        <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-xs text-[var(--sf-footer-muted)]">
          {legal ? (
            <p>
              <Lines text={legal} />
            </p>
          ) : null}
          <p>
            © {new Date().getFullYear()} {store.name}
          </p>
        </div>
      </div>
    </footer>
  );
}
