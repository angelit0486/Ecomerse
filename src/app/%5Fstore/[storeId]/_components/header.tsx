import Link from "next/link";

import type { SocialNetwork } from "@/lib/theme/links";
import type { ResolvedTheme } from "@/lib/theme/resolve-theme";
import type { PaymentMethod, ThemeSettings } from "@/lib/theme/schema";
import { mediaUrl, type MenuEntry } from "@/server/storefront/catalog";
import type { StorePublic } from "@/server/storefront/store-public";

import { MainNav } from "./main-nav";
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

export function StoreHeader({
  store,
  menu,
  cartCount,
  logoPosition = "left",
}: {
  store: StorePublic;
  menu: MenuEntry[];
  cartCount: number;
  logoPosition?: "left" | "center";
}) {
  const centered = logoPosition === "center";
  return (
    <header className="border-b border-[var(--sf-border)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:gap-x-6">
        <Link
          href="/"
          className={
            centered
              ? "flex w-full items-center justify-center gap-2 text-lg font-semibold"
              : "flex min-w-0 flex-1 items-center gap-2 text-lg font-semibold sm:flex-none"
          }
        >
          {store.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo re-codificado servido por Storage
            <img
              src={mediaUrl(store.logo.path)}
              alt={store.name}
              width={store.logo.width ?? 160}
              height={store.logo.height ?? 48}
              className="h-10 w-auto max-w-40 object-contain"
            />
          ) : null}
          {/* En móvil, un nombre largo se recorta: cuenta y carrito caben en el renglón. */}
          {store.logo ? null : <span className="truncate">{store.name}</span>}
        </Link>
        <SearchBox />
        <Link href="/cuenta" className="shrink-0 text-sm font-medium underline">
          Mi cuenta
        </Link>
        <Link
          href="/carrito"
          className="inline-flex h-10 shrink-0 items-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-border-strong)] px-4 text-sm font-medium"
        >
          Carrito<span className="sr-only">, productos:</span>
          <span className="ml-2 rounded-full bg-[var(--sf-fg)] px-2 text-xs text-[var(--sf-bg)]">
            {cartCount}
          </span>
        </Link>
      </div>
      <MainNav menu={menu} />
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
}: {
  store: StorePublic;
  menu: MenuEntry[];
  settings: ThemeSettings;
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
    <footer className="mt-16 border-t border-[var(--sf-border)]">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <p className="font-medium">{store.name}</p>
          {menu.length > 0 ? (
            <nav aria-label="Pie de página">
              <ul className="flex flex-col gap-2 text-[var(--sf-muted)]">
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
            <h2 id="sf-contacto" className="font-semibold">
              Contacto
            </h2>
            <address className="flex flex-col gap-1 not-italic text-[var(--sf-muted)]">
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
            <h2 id="sf-redes" className="font-semibold">
              Síguenos
            </h2>
            <ul className="flex flex-wrap gap-2">
              {social.map((s) => (
                <li key={s.network}>
                  <a
                    href={s.url}
                    rel="noopener noreferrer"
                    className="inline-flex min-h-10 items-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-border)] px-3 hover:bg-[var(--sf-surface)]"
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
            <h2 id="sf-pagos" className="font-semibold">
              Formas de pago
            </h2>
            <ul className="flex flex-wrap gap-2 text-[var(--sf-muted)]">
              {payments.map((m) => (
                <li
                  key={m}
                  className="rounded-[var(--sf-radius-control)] border border-[var(--sf-border)] px-2 py-1"
                >
                  {PAYMENT_LABELS[m]}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <div className="border-t border-[var(--sf-border)]">
        <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-xs text-[var(--sf-muted)]">
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
