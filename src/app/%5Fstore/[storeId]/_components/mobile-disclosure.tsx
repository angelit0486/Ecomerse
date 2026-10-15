"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Filtros plegables en móvil (F9-T05, revisión de diseño): en pantallas chicas
 * los productos quedan arriba y los filtros detrás de «Filtros». Nace abierto
 * (sin JavaScript se ve todo) y se pliega al cargar solo en móvil; en
 * escritorio el resumen no se muestra y queda siempre abierto.
 */
export function MobileDisclosure({ summary, children }: { summary: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && window.matchMedia("(max-width: 767px)").matches) ref.current.open = false;
  }, []);
  return (
    <details ref={ref} open className="group">
      <summary className="mb-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] px-4 text-sm font-medium md:hidden">
        {summary}
      </summary>
      {children}
    </details>
  );
}
