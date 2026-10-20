"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { searchPanel, type SearchHit, type SearchResults } from "./search-actions";

const GROUPS: { key: keyof SearchResults; label: string }[] = [
  { key: "products", label: "Productos" },
  { key: "orders", label: "Pedidos" },
  { key: "customers", label: "Clientes" },
];

/**
 * Buscador del panel (misión panel, F3): productos, pedidos y clientes. La
 * tecla «/» lo enfoca desde cualquier pantalla; Esc lo cierra.
 */
export function GlobalSearch({ storeHandle }: { storeHandle: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const resultsId = useId();
  const latest = useRef(0);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      setLoading(true);
      searchPanel(storeHandle, q)
        .catch(() => null)
        .then((r) => {
          // Solo la última búsqueda escrita pinta resultados.
          if (ticket !== latest.current) return;
          setResults(r);
          setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, storeHandle]);

  const short = query.trim().length < 2;
  const total = results ? GROUPS.reduce((n, g) => n + results[g.key].length, 0) : 0;
  const open = !short;

  return (
    <div role="search" aria-label="Buscar en el panel" className="relative w-full md:max-w-sm">
      <label htmlFor="busqueda-panel" className="sr-only">
        Buscar productos, pedidos o clientes
      </label>
      <input
        ref={inputRef}
        id="busqueda-panel"
        type="search"
        value={query}
        autoComplete="off"
        placeholder="Buscar… (tecla /)"
        aria-controls={open ? resultsId : undefined}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
        }}
        className="h-11 w-full rounded-[var(--radius-control)] border border-control bg-surface px-3 text-base text-fg sm:text-sm"
      />
      {open ? (
        <div
          id={resultsId}
          className="absolute inset-x-0 top-12 z-30 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-surface p-2 shadow-lg"
        >
          <p aria-live="polite" className="px-2 py-1 text-[13px] text-fg-muted">
            {loading || !results
              ? "Buscando…"
              : total === 0
                ? "Sin resultados. Prueba con otro nombre, SKU o número de pedido."
                : `${total} ${total === 1 ? "resultado" : "resultados"}`}
          </p>
          {results
            ? GROUPS.filter((g) => results[g.key].length > 0).map((g) => (
                <section key={g.key} aria-label={g.label} className="py-1">
                  <h2 className="px-2 text-[13px] font-semibold text-fg-muted">{g.label}</h2>
                  <ul>
                    {results[g.key].map((hit: SearchHit) => (
                      <li key={hit.href}>
                        <Link
                          href={hit.href}
                          onClick={() => setQuery("")}
                          className="flex min-h-11 flex-col justify-center rounded px-2 py-1 hover:bg-canvas"
                        >
                          <span className="text-sm">{hit.label}</span>
                          <span className="text-[13px] text-fg-muted">{hit.detail}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
