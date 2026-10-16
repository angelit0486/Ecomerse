"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/**
 * Menú principal de 2 niveles (F9-T04, F9-DESIGN §10): patrón de navegación de
 * divulgación (enlaces y botones con `aria-expanded`), no menú de aplicación.
 * En móvil, un botón «Menú» (en la primera fila del encabezado, revisión de
 * conversión A4) muestra la lista con los subniveles abiertos; en
 * escritorio, cada entrada con hijos tiene su botón que abre el submenú (Escape
 * lo cierra y devuelve el foco). «Objetivos» es una entrada más del menú que
 * enlaza a `?objetivo=…`.
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

/** Comparte el estado del menú de móvil entre su botón y la lista. */
export function NavProvider({ children }: { children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Escape cierra la lista de móvil desde cualquier parte y devuelve el foco al botón.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      document.getElementById(`${id}-menu`)?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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

/** Botón «☰ Menú» de móvil. */
export function MenuButton() {
  const { id, open, setOpen } = useMobileMenu();
  return (
    <button
      id={`${id}-menu`}
      type="button"
      aria-expanded={open}
      aria-controls={`${id}-lista`}
      onClick={() => setOpen((v) => !v)}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--sf-radius-control)] sm:hidden"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
      </svg>
      <span className="sr-only">Menú</span>
    </button>
  );
}

export function MainNav({ menu }: { menu: NavEntry[] }) {
  const { id, open: mobileOpen, setOpen: setMobileOpen } = useMobileMenu();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Al elegir un enlace se cierra todo.
  const closeAll = () => {
    setMobileOpen(false);
    setOpenIndex(null);
  };

  const entries: NavEntry[] = [
    { label: "Todos los productos", href: "/productos", children: [] },
    ...menu,
  ];

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
    <nav aria-label="Principal" className="mx-auto max-w-6xl px-4 text-sm">
      <ul
        id={`${id}-lista`}
        className={`${mobileOpen ? "flex" : "hidden"} max-h-[60vh] flex-col gap-1 overflow-y-auto pb-3 sm:flex sm:max-h-none sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2 sm:overflow-visible`}
      >
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
              <div className="flex items-center gap-1">
                {/* Escritorio (revisión de conversión, B2): una entrada con hijos abre su
                    submenú con su propio nombre, no solo con una flecha pequeña; el
                    destino de la entrada queda como «Ver todo» dentro del submenú. */}
                <Link
                  href={item.href}
                  onClick={closeAll}
                  className={`flex min-h-11 items-center font-medium hover:underline sm:min-h-0 sm:py-1 ${hasChildren ? "sm:hidden" : ""}`}
                >
                  {item.label}
                </Link>
                {hasChildren ? (
                  <button
                    id={`${id}-btn-${index}`}
                    type="button"
                    aria-expanded={open}
                    aria-controls={`${id}-sub-${index}`}
                    onClick={() => setOpenIndex(open ? null : index)}
                    className="hidden items-center gap-1 py-1 font-medium hover:underline sm:inline-flex"
                  >
                    {item.label}
                    <span aria-hidden="true" className={open ? "rotate-180" : ""}>
                      ▾
                    </span>
                  </button>
                ) : null}
              </div>
              {hasChildren ? (
                <ul
                  id={`${id}-sub-${index}`}
                  className={`mt-1 flex flex-col gap-2 border-l border-[var(--sf-border)] pl-3 sm:absolute sm:left-0 sm:z-20 sm:mt-1 sm:min-w-52 sm:gap-1 sm:rounded-[var(--sf-radius-card)] sm:border sm:bg-[var(--sf-bg)] sm:p-2 sm:shadow-lg ${
                    open ? "sm:flex" : "sm:hidden"
                  }`}
                >
                  <li className="hidden sm:block">
                    <Link
                      href={item.href}
                      onClick={closeAll}
                      className="flex items-center rounded-[var(--sf-radius-control)] font-semibold hover:underline sm:px-2 sm:py-1.5 sm:hover:bg-[var(--sf-surface)]"
                    >
                      Ver todo en {item.label}
                    </Link>
                  </li>
                  {item.children.map((child) => (
                    <li key={child.href + child.label}>
                      <Link
                        href={child.href}
                        onClick={closeAll}
                        className="flex min-h-11 items-center rounded-[var(--sf-radius-control)] hover:underline sm:min-h-0 sm:px-2 sm:py-1.5 sm:hover:bg-[var(--sf-surface)]"
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
