"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export interface AdminNavItem {
  href: string;
  label: string;
}

/**
 * Navegación del panel. En móvil, una fila desplazable (la dueña trabaja desde el
 * celular: 16 secciones en lista empujaban el contenido media pantalla hacia
 * abajo); en escritorio, la columna lateral. Marca la sección actual.
 */
export function AdminNav({ items, base }: { items: AdminNavItem[]; base: string }) {
  const pathname = usePathname();
  // La sección actual es la de prefijo más largo (Inicio solo en la raíz exacta).
  const current = items
    .filter((i) => (i.href === base ? pathname === base : pathname.startsWith(i.href)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  // En móvil la fila se desplaza: la sección actual queda a la vista (sin mover la página).
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2;
  }, [current]);
  return (
    <nav aria-label="Secciones de la tienda">
      <ul
        ref={listRef}
        className="relative -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0 md:pb-0"
      >
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-10 items-center whitespace-nowrap rounded-full px-3.5 text-sm md:min-h-9 md:rounded-md md:px-3 ${
                  active
                    ? "bg-fg font-medium text-canvas"
                    : "border border-border hover:bg-canvas md:border-transparent"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
