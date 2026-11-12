"use client";

import { useMemo, useRef, useState } from "react";

import { encodeQr, qrSvgPath, QrTooLongError } from "@/lib/qr/qr";
import { qrFileName, whatsappShareUrl } from "@/lib/share/share";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-control px-4 text-sm font-medium";

/**
 * Compartir un enlace público de la tienda (O10-03): copiar, WhatsApp y código
 * QR para imprimir o enviar. El QR se genera en el navegador, sin servicios de
 * terceros: el enlace no sale del dispositivo hasta que la persona lo comparte.
 */
export function ShareTools({
  id,
  title,
  description,
  url,
  shareText,
  fileBase,
  framed = true,
}: {
  id: string;
  title: string;
  description: string;
  url: string;
  shareText: string;
  fileBase: string;
  /** Sin marco propio cuando va dentro de otro contenedor (p. ej. un desplegable). */
  framed?: boolean;
}) {
  const [copied, setCopied] = useState<"ok" | "manual" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const qr = useMemo(() => {
    try {
      return encodeQr(url);
    } catch (e) {
      if (e instanceof QrTooLongError) return null;
      throw e;
    }
  }, [url]);
  const svg = qr ? qrSvgPath(qr) : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("ok");
    } catch {
      // Sin permiso del portapapeles: deja el enlace seleccionado para copiarlo a mano.
      inputRef.current?.select();
      setCopied("manual");
    }
  }

  function downloadPng() {
    if (!qr) return;
    const scale = 12;
    const quiet = 4;
    const side = (qr.length + quiet * 2) * scale;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Negro sobre blanco siempre: es lo que leen todas las cámaras.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = "#000000";
    qr.forEach((row, y) =>
      row.forEach((isDark, x) => {
        if (isDark) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }),
    );
    canvas.toBlob((blob) => {
      if (!blob) return;
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = qrFileName(fileBase);
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }, "image/png");
  }

  return (
    <section
      aria-labelledby={id}
      className={`space-y-3 text-sm ${framed ? "rounded-md border border-border p-4" : "p-4"}`}
    >
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      <p className="text-fg-muted">{description}</p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-3">
          <label className="block space-y-1">
            <span className="font-medium">Enlace</span>
            <input
              ref={inputRef}
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="block h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-control bg-transparent px-3"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className={BUTTON}>
              Copiar enlace
            </button>
            <a
              href={whatsappShareUrl(shareText)}
              target="_blank"
              rel="noopener noreferrer"
              className={BUTTON}
            >
              Compartir por WhatsApp
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
            {qr ? (
              <button type="button" onClick={downloadPng} className={BUTTON}>
                Descargar QR
              </button>
            ) : null}
          </div>
          <p role="status" aria-live="polite" className="min-h-5 text-success">
            {copied === "ok" ? "Enlace copiado." : null}
            {copied === "manual" ? "Enlace seleccionado: cópialo con tu teclado." : null}
          </p>
        </div>
        {svg ? (
          <svg
            role="img"
            aria-label={`Código QR que abre ${url}`}
            viewBox={`0 0 ${svg.size} ${svg.size}`}
            shapeRendering="crispEdges"
            className="h-40 w-40 shrink-0 self-center rounded-sm sm:self-start"
          >
            <rect width={svg.size} height={svg.size} fill="#ffffff" />
            <path d={svg.d} fill="#000000" />
          </svg>
        ) : (
          <p className="text-fg-muted">El enlace es muy largo para un código QR.</p>
        )}
      </div>
    </section>
  );
}
