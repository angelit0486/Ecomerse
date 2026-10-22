import type { ReactNode } from "react";
import Link from "next/link";

import type { SocialNetwork } from "@/lib/theme/links";
import { announcementActive, type ResolvedTheme } from "@/lib/theme/resolve-theme";
import type { PaymentMethod, ThemeSettings } from "@/lib/theme/schema";
import { mediaUrl, type MenuEntry } from "@/server/storefront/catalog";
import type { StorePublic } from "@/server/storefront/store-public";

import { MainNav, MenuButton, MobileMenu, NavProvider } from "./main-nav";
import { SearchBox } from "./search-box";
import { ThemeLink } from "./theme-link";

/** Barra de anuncio (§20.2): colores validados con contraste ≥ 4.5:1 al guardar. */
export function AnnouncementBar({ announcement }: { announcement: ResolvedTheme["announcement"] }) {
  // Vigencia del anuncio (ADR-034): el layout es dinámico, se evalúa en cada request.
  if (!announcement || !announcementActive(announcement)) return null;
  return (
    // Región con nombre: ningún contenido queda fuera de un landmark (axe `region`).
    <aside
      aria-label="Aviso de la tienda"
      className="bg-[var(--sf-announce-bg)] px-4 py-2 text-center text-[0.8125rem] font-semibold text-[var(--sf-announce-fg)] [&_:focus-visible]:outline-[var(--sf-announce-fg)]"
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

const ICON = {
  "aria-hidden": true,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/**
 * Tira de accesos rápidos en el celular: empieza en el margen de la página
 * (nada cortado al inicio, DIAGNOSTICO-PORTADA) y se difumina a la derecha para
 * decir «hay más» en vez de mostrar una palabra cortada.
 */
/**
 * Encabezado (rediseño A+B, revisión de conversión A4): en móvil, fila 1 con
 * menú, nombre, cuenta y carrito; fila 2 con el buscador (≤ 120 px en total).
 * Fijo arriba para que el carrito siempre esté a la vista. En escritorio, una
 * fila con el buscador ancho y debajo el menú.
 */
export function StoreHeader({
  store,
  menu,
  discovery = [],
  cartCount,
  logoPosition = "left",
  whatsapp,
  thumbs,
  below,
}: {
  store: StorePublic;
  menu: MenuEntry[];
  /** Accesos con contenido real: «Marcas» y «Ofertas». */
  discovery?: { label: string; href: string }[];
  cartCount: number;
  logoPosition?: "left" | "center";
  /** WhatsApp de la tienda, para el panel del menú en móvil. */
  whatsapp?: string | undefined;
  /** Foto de cada categoría por enlace, para el menú del celular. */
  thumbs?: Record<string, string>;
  /** Barra de categorías fija (tema v4): va dentro del encabezado. */
  below?: ReactNode;
}) {
  const centered = logoPosition === "center";
  return (
    <header className="sf-el-header sticky top-0 z-30 border-b border-[var(--sf-border)] bg-[var(--sf-bg)]">
      <NavProvider>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1 gap-y-2 px-2 pb-2.5 pt-1.5 sm:gap-x-5 sm:px-4 sm:py-3">
          <MenuButton />
          <Link
            href="/"
            className={`flex min-w-0 flex-1 items-center gap-2 ${
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
                className="h-9 w-auto max-w-36 object-contain sm:h-11 sm:max-w-44"
              />
            ) : (
              // Sin logo, el nombre funciona como logotipo: fuente de títulos del tema,
              // en el color de compra. Un nombre largo pasa a 2 líneas en lugar de cortarse.
              <span className="line-clamp-2 text-xl font-extrabold leading-[1.05] tracking-tight text-[var(--sf-link)] [font-family:var(--sf-font-heading),system-ui,sans-serif] sm:text-2xl">
                {store.name}
              </span>
            )}
          </Link>
          <SearchBox />
          <Link
            href="/cuenta"
            className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-[var(--sf-radius-control)] text-sm font-semibold sm:px-1"
          >
            <svg {...ICON} className="h-6 w-6">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
            </svg>
            <span className="sr-only lg:not-sr-only">Mi cuenta</span>
          </Link>
          <Link
            href="/carrito"
            className="relative inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-[var(--sf-radius-control)] text-sm font-semibold sm:px-1"
          >
            <span className="relative">
              <svg {...ICON} className="h-6 w-6">
                <path d="M5 8h14l-1.2 12H6.2L5 8Z" />
                <path d="M9 8V6a3 3 0 0 1 6 0v2" />
              </svg>
              {cartCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-2 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--sf-btn-bg)] px-1 text-[0.6875rem] font-bold tabular-nums text-[var(--sf-btn-fg)] ring-2 ring-[var(--sf-bg)]"
                >
                  {cartCount}
                </span>
              ) : null}
            </span>
            <span className="sr-only lg:not-sr-only">Carrito</span>
            {/* El número también para el lector de pantalla (y sin productos, «0»). */}
            <span className="sr-only">, productos: {cartCount}</span>
          </Link>
        </div>
        <MainNav menu={menu} discovery={discovery} />
        <MobileMenu
          menu={menu}
          discovery={discovery}
          cartCount={cartCount}
          whatsapp={whatsapp}
          thumbs={thumbs}
        />
      </NavProvider>
      {below}
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
 * Pie de la tienda (§20.2; rediseño A+B): menú `footer`, contacto, redes, medios
 * de pago y texto legal sobre el color del pie (primario oscurecido o tema
 * invertido, ≥ 4.5:1, ver footerColors). Sin grises mezclados en el texto: la
 * jerarquía la dan tamaño y peso. Todo es texto escapado por React; los enlaces
 * se revalidan al mostrarse.
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
  const hasContact = Boolean(email || phone || contact.address || contact.hours);
  const social = settings.social ?? [];
  const payments = settings.footer?.payment_methods ?? [];
  const legal = settings.footer?.legal_text;
  const help = menu.flatMap((item) => [item, ...item.children]);
  const heading = "text-sm font-bold";
  return (
    <footer className="mt-16 bg-[var(--sf-footer-bg)] text-[var(--sf-footer-fg)] [--sf-footer-rule:color-mix(in_srgb,var(--sf-footer-fg)_28%,var(--sf-footer-bg))] [&_:focus-visible]:outline-[var(--sf-footer-fg)]">
      <div className="mx-auto max-w-6xl space-y-8 px-4 pb-8 pt-10 sm:pt-14">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-3xl font-extrabold leading-none tracking-tight text-balance [font-family:var(--sf-font-heading),system-ui,sans-serif] sm:text-4xl">
            {store.name}
          </p>
          {contact.whatsapp ? (
            <a
              href={`https://wa.me/${contact.whatsapp.slice(1)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-[var(--sf-radius-card)] border border-[var(--sf-footer-rule)] px-4 py-3 sm:min-w-80"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-7 w-7 shrink-0"
                fill="currentColor"
              >
                <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Z" />
              </svg>
              <span className="text-sm">
                <span className="block font-bold">¿Dudas con tu pedido?</span>
                Escríbenos al WhatsApp {contact.whatsapp}
              </span>
            </a>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 text-sm lg:grid-cols-4">
          {/* Accesos que toda tienda tiene (pulido visual): el pie nunca queda vacío. */}
          <nav aria-labelledby="sf-pie-comprar" className="space-y-3">
            <h2 id="sf-pie-comprar" className={heading}>
              Comprar
            </h2>
            <ul className="flex flex-col gap-2.5">
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
          {help.length > 0 ? (
            <nav aria-labelledby="sf-pie-ayuda" className="space-y-3">
              <h2 id="sf-pie-ayuda" className={heading}>
                Ayuda
              </h2>
              <ul className="flex flex-col gap-2.5">
                {help.map((item) => (
                  <li key={item.href + item.label}>
                    <Link href={item.href} className="hover:underline">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          {hasContact ? (
            <section aria-labelledby="sf-contacto" className="space-y-3">
              <h2 id="sf-contacto" className={heading}>
                Contacto
              </h2>
              <address className="flex flex-col gap-1.5 not-italic">
                {email ? (
                  <a href={`mailto:${email}`} className="break-all hover:underline">
                    {email}
                  </a>
                ) : null}
                {phone ? (
                  <a href={`tel:${phone.replace(/[^+0-9]/g, "")}`} className="hover:underline">
                    {phone}
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
            <section aria-labelledby="sf-redes" className="space-y-3">
              <h2 id="sf-redes" className={heading}>
                Síguenos
              </h2>
              <ul className="flex flex-wrap gap-2">
                {social.map((s) => (
                  <li key={s.network}>
                    <a
                      href={s.url}
                      rel="noopener noreferrer"
                      className="inline-flex min-h-10 items-center rounded-full border border-[var(--sf-footer-rule)] px-4 hover:border-[var(--sf-footer-fg)]"
                    >
                      {NETWORK_LABELS[s.network]}
                      <span className="sr-only"> de {store.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        {payments.length > 0 ? (
          <section aria-labelledby="sf-pagos" className="space-y-3">
            <h2 id="sf-pagos" className={heading}>
              Formas de pago
            </h2>
            {/* Fichas con el par del pie invertido: mismo contraste que el texto. */}
            <ul className="flex flex-wrap gap-2">
              {payments.map((m) => (
                <li
                  key={m}
                  className="rounded-[min(var(--sf-radius),6px)] bg-[var(--sf-footer-fg)] px-2.5 py-1 text-xs font-bold text-[var(--sf-footer-bg)]"
                >
                  {PAYMENT_LABELS[m]}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <div className="border-t border-[var(--sf-footer-rule)]">
        <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-xs leading-relaxed">
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
