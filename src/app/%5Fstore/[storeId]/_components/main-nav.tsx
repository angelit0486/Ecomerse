"use client";

import Link from "next/link";
import { useId, useState, type FocusEvent, type KeyboardEvent } from "react";

/**
 * Menú principal de 2 niveles (F9-T04, F9-DESIGN §10): patrón de navegación de
 * divulgación (enlaces y botones con `aria-expanded`), no menú de aplicación.
 * En móvil, un botón «Menú» muestra la lista con los subniveles abiertos; en
 * escritorio, cada entrada con hijos tiene su botón que abre el submenú (Escape
 * lo cierra y devuelve el foco). «Objetivos» es una entrada más del menú que
 * enlaza a `?objetivo=…`.
 */
export interface NavEntry {
  label: string;
  href: string;
  children: { label: string; href: string }[];
}

export function MainNav({ menu }: { menu: NavEntry[] }) {
  const id = useId();
  const [mobileOpen, setMobileOpen] = useState(false);
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
    <nav aria-label="Principal" className="mx-auto max-w-6xl px-4 pb-3 text-sm">
      <button
        type="button"
        aria-expanded={mobileOpen}
        aria-controls={`${id}-lista`}
        onClick={() => setMobileOpen((v) => !v)}
        className="inline-flex h-10 items-center gap-2 rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] px-3 font-medium sm:hidden"
      >
        <span aria-hidden="true">☰</span> Menú
      </button>
      <ul
        id={`${id}-lista`}
        className={`${mobileOpen ? "flex" : "hidden"} mt-3 flex-col gap-3 sm:mt-0 sm:flex sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2`}
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
                <Link
                  href={item.href}
                  onClick={closeAll}
                  className="py-1 font-medium hover:underline"
                >
                  {item.label}
                </Link>
                {hasChildren ? (
                  <button
                    id={`${id}-btn-${index}`}
                    type="button"
                    aria-expanded={open}
                    aria-controls={`${id}-sub-${index}`}
                    aria-label={`Más de ${item.label}`}
                    onClick={() => setOpenIndex(open ? null : index)}
                    className="hidden h-8 w-8 items-center justify-center rounded-[var(--sf-radius-control)] hover:bg-[var(--sf-surface)] sm:inline-flex"
                  >
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
                  {item.children.map((child) => (
                    <li key={child.href + child.label}>
                      <Link
                        href={child.href}
                        onClick={closeAll}
                        className="block rounded-[var(--sf-radius-control)] py-1 hover:underline sm:px-2 sm:py-1.5 sm:hover:bg-[var(--sf-surface)]"
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
