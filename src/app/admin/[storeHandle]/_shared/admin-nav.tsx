"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export interface AdminNavItem {
  href: string;
  label: string;
}

export interface AdminNavGroup {
  /** Sin título: el grupo principal (Inicio, Configurar tienda). */
  title?: string;
  items: AdminNavItem[];
}

/**
 * Navegación del panel, agrupada (misión panel, F4; antes 17 entradas sueltas).
 * En escritorio, columna lateral por grupos. En el celular, los accesos de todos
 * los días (Inicio, Pedidos, Productos) a la vista y «Menú» con el resto. Marca
 * la sección actual.
 */
export function AdminNav({
  groups,
  base,
  primary,
}: {
  groups: AdminNavGroup[];
  base: string;
  /** Rutas que se ven siempre en el celular. */
  primary: string[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const all = groups.flatMap((g) => g.items);
  // La sección actual es la de prefijo más largo (Inicio solo en la raíz exacta).
  const current = all
    .filter((i) => (i.href === base ? pathname === base : pathname.startsWith(i.href)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const quick = all.filter((i) => primary.includes(i.href));

  const link = (item: AdminNavItem, pill: boolean) => {
    const active = item.href === current;
    return (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        // Al elegir una sección el menú del celular se cierra.
        onClick={() => setOpen(false)}
        className={`flex min-h-11 items-center gap-2 whitespace-nowrap text-sm ${
          pill ? "rounded-full px-3.5" : "rounded-md px-3 md:min-h-9"
        } ${
          active
            ? "bg-fg font-medium text-canvas"
            : pill
              ? "border border-border hover:bg-canvas"
              : "hover:bg-canvas"
        }`}
      >
        {item.label}
        <PendingMark />
      </Link>
    );
  };

  return (
    <nav aria-label="Secciones de la tienda">
      {/* Celular: lo de todos los días y «Menú». */}
      <div className="flex flex-wrap items-center gap-1 md:hidden">
        {quick.map((item) => (
          <span key={item.href}>{link(item, true)}</span>
        ))}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="menu-secciones"
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 items-center rounded-full border border-border px-3.5 text-sm font-medium"
        >
          {open ? "Cerrar menú" : "Menú"}
        </button>
      </div>
      <div
        id="menu-secciones"
        className={`${open ? "mt-3 block" : "hidden"} space-y-3 md:mt-0 md:block`}
      >
        {groups.map((group, i) => (
          <div key={group.title ?? i}>
            {group.title ? (
              <p className="px-3 pb-1 text-[13px] font-semibold text-fg-muted">{group.title}</p>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>{link(item, false)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/**
 * Mientras llega la sección elegida, un indicador junto a su nombre. Sustituye a
 * un esqueleto de página: `loading.tsx` bajaba el Lighthouse de la ficha de 96 a
 * 89–94 (el título se pintaba en streaming) y la carga inicial no lo necesita.
 */
function PendingMark() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span
      aria-hidden="true"
      className="size-3 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin"
    />
  ) : null;
}
