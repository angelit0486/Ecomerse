"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { brandInitialsOf } from "@/lib/catalog/brand-initials";
import { activeNavIndex, type NavBarConfig, type NavBarItem } from "@/lib/theme/nav-bar";

/**
 * Barra de categorías del encabezado (misión Panel, Paso D). Corrige el primer
 * elemento cortado en el celular («dos» en vez de «Todos»): la lista empieza en
 * el margen de la página (relleno y `scroll-padding` iguales), el elemento
 * activo se centra al llegar a su página y un degradado a la derecha avisa que
 * hay más. Cada enlace mide al menos 44 px y tiene foco visible por dentro (no
 * lo corta el desplazamiento).
 */
type Props = {
  items: NavBarItem[];
  /** Foto de cada categoría por enlace (estilo «con foto»). */
  thumbs?: Record<string, string>;
  config?: Pick<NavBarConfig, "style" | "align" | "size" | "visibility">;
};

export function NavBar(props: Props) {
  // Los parámetros (`?objetivo=…`) deciden el activo entre enlaces de la misma
  // ruta. useSearchParams necesita su propio Suspense: mientras tanto (y en el
  // HTML estático) cuenta solo la ruta. Así el activo se actualiza también al
  // navegar con <Link>, que no dispara `popstate`.
  return (
    <Suspense fallback={<NavBarView {...props} search="" />}>
      <NavBarWithParams {...props} />
    </Suspense>
  );
}

function NavBarWithParams(props: Props) {
  const params = useSearchParams();
  const query = params.toString();
  return <NavBarView {...props} search={query ? `?${query}` : ""} />;
}

function NavBarView({ items, thumbs = {}, config = {}, search }: Props & { search: string }) {
  const pathname = usePathname();
  const list = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState(false);
  const active = activeNavIndex(items, pathname ?? "/", search);
  const style = config.style ?? "text";

  // El activo, centrado; y si hay más a la derecha, el degradado.
  useEffect(() => {
    const ul = list.current;
    if (!ul) return;
    const li = active >= 0 ? (ul.children[active] as HTMLElement | undefined) : undefined;
    if (li && ul.scrollWidth > ul.clientWidth) {
      ul.scrollLeft = Math.max(0, li.offsetLeft - (ul.clientWidth - li.offsetWidth) / 2);
    }
    const update = () => setMore(ul.scrollLeft + ul.clientWidth < ul.scrollWidth - 4);
    update();
    ul.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      ul.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [active]);

  if (items.length === 0) return null;
  const text = config.size === "md" ? "text-base" : "text-sm";
  const centered = config.align === "center";
  return (
    <nav
      aria-label="Categorías"
      className={`sf-el-nav border-b border-[var(--sf-nav-border,var(--sf-border))] bg-[var(--sf-bg)] text-[var(--sf-fg)] ${
        config.visibility === "all" ? "" : "sm:hidden"
      }`}
    >
      <ul
        ref={list}
        className={`mx-auto flex max-w-6xl gap-1 overflow-x-auto scroll-px-1.5 px-1.5 py-1 sm:px-4 sm:scroll-px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          centered ? "[&>li:first-child]:ms-auto [&>li:last-child]:me-auto" : ""
        } ${more ? "[mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)] focus-within:[mask-image:none]" : ""}`}
      >
        {items.map((item, index) => {
          const current = index === active;
          const shown =
            item.visibility === "mobile"
              ? "sm:hidden"
              : item.visibility === "desktop"
                ? "max-sm:hidden"
                : "";
          const thumb = Object.hasOwn(thumbs, item.href) ? thumbs[item.href] : undefined;
          return (
            // Dos enlaces pueden repetir ruta y nombre: el índice desambigua.
            <li key={`${index}:${item.href}`} className={`shrink-0 ${shown}`}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={linkClass(style, current, text)}
              >
                {style === "photos" ? (
                  thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada
                    <img
                      src={thumb}
                      alt=""
                      width={40}
                      height={40}
                      loading="lazy"
                      decoding="async"
                      className={`size-10 rounded-full object-cover ${current ? "ring-2 ring-[var(--sf-nav-active,var(--sf-link))]" : ""}`}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={`flex size-10 items-center justify-center rounded-full bg-[var(--sf-surface)] text-xs font-bold ${current ? "ring-2 ring-[var(--sf-nav-active,var(--sf-link))]" : ""}`}
                    >
                      {brandInitialsOf(item.label)}
                    </span>
                  )
                ) : null}
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function linkClass(style: NonNullable<NavBarConfig["style"]>, current: boolean, text: string) {
  const base = `inline-flex min-h-11 items-center whitespace-nowrap font-semibold outline-offset-[-3px] ${text}`;
  const activeText = current ? "text-[var(--sf-nav-active,var(--sf-link))]" : "";
  if (style === "pills") {
    return `${base} my-0.5 rounded-full border px-4 ${
      current
        ? "border-2 border-[var(--sf-nav-active,var(--sf-link))] font-bold"
        : "border-[var(--sf-border)]"
    } ${activeText}`;
  }
  if (style === "photos") {
    return `${base} min-w-16 flex-col justify-center gap-1 px-2 py-1 text-center text-xs ${activeText}`;
  }
  return `${base} px-2.5 ${
    current ? "underline decoration-2 underline-offset-[6px] font-bold" : ""
  } ${activeText}`;
}
