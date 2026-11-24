"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Un dato del pago (CLABE, número de pedido) con su botón «Copiar»: en el celular
 * se copia de un toque y se pega en la app del banco, sin errores de dedo.
 * Si el navegador no deja usar el portapapeles, el dato queda seleccionado para
 * copiarlo a mano y se dice así (nunca se anuncia «copiado» sin haberlo hecho).
 */
export function CopyField({
  label,
  value,
  display = value,
  copied = "Copiado",
}: {
  label: string;
  /** «Copiada» para la CLABE, «Copiado» para el número: concuerda con el dato. */
  copied?: string;
  /** Lo que se copia (la CLABE sin espacios). */
  value: string;
  /** Lo que se ve (la CLABE agrupada para leerla). */
  display?: string;
}) {
  const [state, setState] = useState<"idle" | "ok" | "manual">("idle");
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (state !== "ok") return;
    const t = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("ok");
    } catch {
      const el = textRef.current;
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (el && sel) sel.selectAllChildren(el);
      setState("manual");
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--sf-radius-control)] border border-[var(--sf-border)] px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-[var(--sf-muted)]">{label}</p>
        <span ref={textRef} data-copy-value={value} className="block font-semibold tabular-nums">
          {display}
        </span>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copiar ${label}`}
        className="inline-flex min-h-11 shrink-0 items-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-4 text-sm font-medium text-[var(--sf-btn-fg)]"
      >
        {state === "ok" ? `${copied} ✓` : "Copiar"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "ok"
          ? `${label}: ${copied.toLowerCase()}`
          : state === "manual"
            ? `${label} seleccionada: cópiala manteniéndola presionada`
            : ""}
      </span>
    </div>
  );
}
