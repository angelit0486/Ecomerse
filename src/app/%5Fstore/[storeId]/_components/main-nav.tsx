"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/**
 * Menú principal de 2 niveles (F9-T04, F9-DESIGN §10): patrón de navegación de
 * divulgación (enlaces y botones con `aria-expanded`), no menú de aplicación.
 * Escritorio: una fila donde cada entrada con hijos abre su submenú con su nombre
 * (Escape lo cierra y devuelve el foco). Móvil (rediseño A+B): el botón «Menú»
 * de la primera fila abre un panel a pantalla completa con los subniveles
 * abiertos, la cuenta, el carrito y el WhatsApp; Escape o «Cerrar» lo cierran.
 */
export interface NavEntry {
  label: string;
  href: string;
  children: { label: string; href: string }[];
}

interface MobileMenu {
  id: string;
  open: boolean;
  setOpen: (open: boolean | ((v: boolean) => boolean)) => void;
}

const MobileMenuContext = createContext<MobileMenu | null>(null);

/** Comparte el estado del menú de móvil entre su botón y el panel. */
export function NavProvider({ children }: { children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Escape cierra el panel desde cualquier parte y devuelve el foco al botón.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      document.getElementById(`${id}-menu`)?.focus();
    };
    document.addEventListener("keydown", onKey);
    // Con el panel abierto, la página de atrás no se desplaza.
    document.documentElement.classList.add("overflow-hidden");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("overflow-hidden");
    };
  }, [open, id]);
  return (
    <MobileMenuContext.Provider value={{ id, open, setOpen }}>
      {children}
    </MobileMenuContext.Provider>
  );
}

function useMobileMenu(): MobileMenu {
  const menu = useContext(MobileMenuContext);
  if (!menu) throw new Error("MainNav y MenuButton van dentro de NavProvider");
  return menu;
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

/** Botón «☰ Menú» de móvil. */
export function MenuButton() {
  const { id, open, setOpen } = useMobileMenu();
  return (
    <button
      id={`${id}-menu`}
      type="button"
      aria-expanded={open}
      aria-controls={`${id}-panel`}
      onClick={() => setOpen((v) => !v)}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--sf-radius-control)] sm:hidden"
    >
      <svg {...ICON} className="h-6 w-6">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
      <span className="sr-only">Menú</span>
    </button>
  );
}

/**
 * «Todos los productos», «Ofertas» (si hay; arriba, es de lo más buscado), el
 * menú de la tienda y los demás accesos que no estén ya en él.
 */
function navEntries(menu: NavEntry[], discovery: { label: string; href: string }[]): NavEntry[] {
  const inMenu = new Set(menu.flatMap((m) => [m.href, ...m.children.map((c) => c.href)]));
  const extra = discovery.filter((d) => !inMenu.has(d.href)).map((d) => ({ ...d, children: [] }));
  return [
    { label: "Todos los productos", href: "/productos", children: [] },
    ...extra.filter((d) => d.href === "/ofertas"),
    ...menu,
    ...extra.filter((d) => d.href !== "/ofertas"),
  ];
}

/** «Ofertas» va en el color de ahorro (§15 reserva el acento para ofertas). */
const offerClass = (href: string) => (href === "/ofertas" ? "text-[var(--sf-sale-text)]" : "");

export function MainNav({
  menu,
  discovery = [],
}: {
  menu: NavEntry[];
  /** «Marcas» y «Ofertas», si no están ya en el menú de la tienda. */
  discovery?: { label: string; href: string }[];
}) {
  const { id } = useMobileMenu();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // Un clic fuera cierra el submenú (Safari no da foco a los botones al hacer
  // clic, así que onBlur no basta).
  useEffect(() => {
    if (openIndex === null) return;
    const onPointer = (event: PointerEvent) => {
      const item = document.getElementById(`${id}-btn-${openIndex}`)?.closest("li");
      if (item && !item.contains(event.target as Node)) setOpenIndex(null);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [openIndex, id]);

  const entries = navEntries(menu, discovery);

  function closeOnEscape(event: KeyboardEvent<HTMLLIElement>, index: number) {
    if (event.key !== "Escape" || openIndex !== index) return;
    setOpenIndex(null);
    document.getElementById(`${id}-btn-${index}`)?.focus();
  }

  function closeOnLeave(event: FocusEvent<HTMLLIElement>, index: number) {
    if (openIndex === index && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpenIndex(null);
    }
  }

  return (
    <nav aria-label="Principal" className="mx-auto hidden max-w-6xl px-4 text-sm sm:block">
      <ul className="flex flex-wrap items-center gap-x-7">
        {entries.map((item, index) => {
          const hasChildren = item.children.length > 0;
          const open = openIndex === index;
          return (
            <li
              key={item.href + item.label}
              className="relative"
              onKeyDown={(e) => closeOnEscape(e, index)}
              onBlur={(e) => closeOnLeave(e, index)}
            >
              {/* Una entrada con hijos abre su submenú con su propio nombre (revisión de
                  conversión, B2); su destino queda como «Ver todo» dentro del submenú. */}
              {hasChildren ? (
                <button
                  id={`${id}-btn-${index}`}
                  type="button"
                  aria-expanded={open}
                  aria-controls={`${id}-sub-${index}`}
                  onClick={() => setOpenIndex(open ? null : index)}
                  className="inline-flex h-11 items-center gap-1 font-semibold hover:text-[var(--sf-link)]"
                >
                  {item.label}
                  <svg {...ICON} className={`h-4 w-4 ${open ? "rotate-180" : ""}`}>
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              ) : (
                <Link
                  href={item.href}
                  onClick={() => setOpenIndex(null)}
                  className={`inline-flex h-11 items-center font-semibold hover:underline ${offerClass(item.href)}`}
                >
                  {item.label}
                </Link>
              )}
              {hasChildren ? (
                <ul
                  id={`${id}-sub-${index}`}
                  className={`absolute left-0 top-full z-20 min-w-56 flex-col gap-0.5 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] bg-[var(--sf-bg)] p-2 shadow-lg ${
                    open ? "flex" : "hidden"
                  }`}
                >
                  <li>
                    <Link
                      href={item.href}
                      onClick={() => setOpenIndex(null)}
                      className="flex rounded-[var(--sf-radius-control)] px-3 py-2 font-semibold hover:bg-[var(--sf-surface)]"
                    >
                      Ver todo en {item.label}
                    </Link>
                  </li>
                  {item.children.map((child) => (
                    <li key={child.href + child.label}>
                      <Link
                        href={child.href}
                        onClick={() => setOpenIndex(null)}
                        className="flex rounded-[var(--sf-radius-control)] px-3 py-2 hover:bg-[var(--sf-surface)]"
                      >
                        {child.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Panel del menú en móvil (rediseño A+B): ocupa la pantalla, retiene el foco
 * mientras está abierto y lo devuelve al botón «Menú» al cerrarse.
 */
/** Miniatura decorativa de la categoría (el nombre ya está escrito al lado). */
function Thumb({ url }: { url: string | undefined }) {
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada
    <img
      src={url}
      alt=""
      width={28}
      height={28}
      loading="lazy"
      decoding="async"
      className="mr-2 size-7 shrink-0 rounded-full object-cover"
    />
  );
}

export function MobileMenu({
  menu,
  discovery = [],
  cartCount,
  whatsapp,
  thumbs = {},
}: {
  menu: NavEntry[];
  discovery?: { label: string; href: string }[];
  cartCount: number;
  whatsapp?: string | undefined;
  /** Foto de cada categoría por enlace (misión Panel, Paso A). */
  thumbs?: Record<string, string>;
}) {
  const { id, open, setOpen } = useMobileMenu();
  const panel = useRef<HTMLDivElement>(null);
  const entries = navEntries(menu, discovery);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) document.getElementById(`${id}-menu`)?.focus();
  }

  // Tab no sale del panel mientras está abierto.
  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !panel.current) return;
    const items = panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  const row = "flex min-h-14 items-center text-lg font-semibold";
  return (
    <div
      ref={panel}
      id={`${id}-panel`}
      role="dialog"
      aria-modal="true"
      aria-label="Menú"
      hidden={!open}
      onKeyDown={trapFocus}
      className={`fixed inset-0 z-50 flex-col overflow-y-auto overscroll-contain bg-[var(--sf-bg)] sm:hidden ${open ? "flex" : "hidden"}`}
    >
      <div className="sticky top-0 flex items-center justify-between border-b border-[var(--sf-border)] bg-[var(--sf-bg)] py-1.5 pl-4 pr-2">
        <p className="text-lg font-bold">Menú</p>
        <button
          type="button"
          data-autofocus
          onClick={() => close(true)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--sf-radius-control)]"
        >
          <svg {...ICON} className="h-6 w-6">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
          <span className="sr-only">Cerrar</span>
        </button>
      </div>
      <nav aria-label="Principal" className="px-4 pb-2">
        <ul className="divide-y divide-[var(--sf-border)]">
          {entries.map((item) => (
            <li key={item.href + item.label} className="py-1">
              <Link
                href={item.href}
                onClick={() => close(false)}
                className={
                  item.children.length > 0
                    ? "flex min-h-11 items-center pt-2 text-sm font-semibold text-[var(--sf-muted)]"
                    : `${row} ${offerClass(item.href)}`
                }
              >
                <Thumb url={thumbs[item.href]} />
                {item.label}
              </Link>
              {item.children.length > 0 ? (
                <ul className="pb-2">
                  {item.children.map((child) => (
                    <li key={child.href + child.label}>
                      <Link href={child.href} onClick={() => close(false)} className={row}>
                        <Thumb url={thumbs[child.href]} />
                        {child.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto grid grid-cols-2 gap-2 border-t border-[var(--sf-border)] p-4">
        <Link
          href="/cuenta"
          onClick={() => close(false)}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-[var(--sf-radius-btn)] border border-[var(--sf-border-strong)] font-semibold"
        >
          Mi cuenta
        </Link>
        <Link
          href="/carrito"
          onClick={() => close(false)}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] font-semibold text-[var(--sf-btn-fg)]"
        >
          Ver carrito ({cartCount})
        </Link>
        {whatsapp ? (
          <a
            href={`https://wa.me/${whatsapp.slice(1)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="col-span-2 inline-flex min-h-12 items-center justify-center rounded-[var(--sf-radius-btn)] bg-[var(--sf-surface)] px-4 text-center text-sm font-semibold"
          >
            ¿Dudas? Escríbenos por WhatsApp
          </a>
        ) : null}
      </div>
    </div>
  );
}
