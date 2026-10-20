"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { panelNotices, type PanelNotice } from "./notice-actions";

/**
 * Botón «Avisos» con lo que requiere acción (misión panel, F3). Se actualiza al
 * cambiar de pantalla; sin avisos dice que no hay pendientes.
 */
export function NoticesButton({ storeHandle }: { storeHandle: string }) {
  const pathname = usePathname();
  const [notices, setNotices] = useState<PanelNotice[] | null>(null);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    panelNotices(storeHandle)
      .catch(() => [])
      .then((list) => {
        if (alive) setNotices(list);
      });
    return () => {
      alive = false;
    };
  }, [storeHandle, pathname]);

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent | KeyboardEvent) {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !ref.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const total = notices?.length ?? 0;
  const urgent = notices?.some((n) => n.urgent) ?? false;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm font-medium ${
          urgent ? "border-danger" : "border-control"
        }`}
      >
        Avisos
        {total > 0 ? (
          <span
            className={`inline-flex min-w-6 justify-center rounded-full px-1.5 text-[13px] ${
              urgent ? "bg-danger text-danger-fg" : "bg-accent text-accent-fg"
            }`}
          >
            {total}
            <span className="sr-only"> {total === 1 ? "aviso" : "avisos"}</span>
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          className="absolute right-0 top-12 z-30 w-72 rounded-md border border-border bg-surface p-2 shadow-lg"
        >
          {notices === null ? (
            <p className="px-2 py-2 text-sm text-fg-muted">Revisando…</p>
          ) : total === 0 ? (
            <p className="px-2 py-2 text-sm">No hay nada pendiente. Todo al día.</p>
          ) : (
            <ul aria-label="Avisos del panel">
              {notices.map((n) => (
                <li key={n.key}>
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center gap-2 rounded px-2 text-sm hover:bg-canvas"
                  >
                    <span
                      aria-hidden="true"
                      className={`size-2 shrink-0 rounded-full ${n.urgent ? "bg-danger" : "bg-accent"}`}
                    />
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
