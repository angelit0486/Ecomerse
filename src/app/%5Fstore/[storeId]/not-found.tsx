import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Página no encontrada" };

/** 404 dentro de una tienda (producto, categoría o página inexistente o no publicada). */
export default function StoreNotFound() {
  return (
    <div className="mx-auto max-w-prose space-y-5 py-16 sm:py-24">
      <p
        aria-hidden="true"
        className="text-7xl font-bold leading-none tracking-tight text-[var(--sf-border-strong)] [font-family:var(--sf-font-heading),system-ui,sans-serif] sm:text-9xl"
      >
        404
      </p>
      <h1 className="text-3xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-4xl">
        No encontramos esta página
      </h1>
      <p className="text-[var(--sf-muted)]">
        Puede que el producto ya no esté disponible o que el enlace haya cambiado.
      </p>
      {/* Búsqueda sin JS (GET a /buscar): la salida más corta a lo que se buscaba. */}
      <form action="/buscar" method="get" role="search" className="flex max-w-md gap-2">
        <label htmlFor="nf-q" className="sr-only">
          Buscar en la tienda
        </label>
        <input
          id="nf-q"
          name="q"
          type="search"
          placeholder="Busca un producto"
          className="h-11 min-w-0 flex-1 rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-3"
        />
        <button
          type="submit"
          className="h-11 rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-4 font-medium text-[var(--sf-btn-fg)]"
        >
          Buscar
        </button>
      </form>
      <p className="flex flex-wrap gap-x-6">
        <Link
          prefetch={false}
          href="/productos"
          className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
        >
          Ver todos los productos
        </Link>
        <Link
          prefetch={false}
          href="/"
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          Ir al inicio
        </Link>
      </p>
    </div>
  );
}
