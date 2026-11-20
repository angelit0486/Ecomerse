"use client";

import { useEffect, useRef, useState } from "react";

import type { GalleryImage } from "./product-gallery";

/**
 * Foto ampliada de la ficha (plan de experiencia, fase 2): `<dialog>` modal a
 * pantalla completa. Un toque en la foto la amplía al doble y se recorre
 * deslizando (el contenedor se desplaza, sin estilos en línea: la CSP no los
 * permite); otro toque la regresa. Flechas, ← → del teclado y Esc para cerrar;
 * al cerrar el foco vuelve a la foto de la ficha.
 */
export function GalleryZoom({
  open,
  onClose,
  images,
  index,
  onIndex,
  title,
}: {
  open: boolean;
  onClose: () => void;
  images: GalleryImage[];
  index: number;
  onIndex: (next: number) => void;
  title: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const target = useRef<{ x: number; y: number } | null>(null);
  const many = images.length > 1;
  const current = images.at(index) ?? images.at(0);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Al ampliar, lleva la vista al punto tocado.
  useEffect(() => {
    const box = stage.current;
    const point = target.current;
    if (!zoomed || !box || !point) return;
    box.scrollLeft = point.x * (box.scrollWidth - box.clientWidth);
    box.scrollTop = point.y * (box.scrollHeight - box.clientHeight);
  }, [zoomed]);

  const go = (step: number) => {
    setZoomed(false);
    onIndex((index + step + images.length) % images.length);
  };

  if (!current) return null;
  return (
    <dialog
      ref={dialog}
      aria-label={`Foto ampliada de ${title}`}
      onClose={() => {
        setZoomed(false);
        onClose();
      }}
      onKeyDown={(event) => {
        if (!many) return;
        if (event.key === "ArrowRight") go(1);
        if (event.key === "ArrowLeft") go(-1);
      }}
      className="sf-zoom m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-black p-0 text-white backdrop:bg-black"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-4 px-4 py-2">
          <p className="text-sm" aria-live="polite">
            {many ? `${index + 1} de ${images.length}` : title}
          </p>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Cerrar"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div ref={stage} className="relative min-h-0 flex-1 overflow-auto">
          <button
            type="button"
            aria-label={zoomed ? "Alejar la foto" : "Acercar la foto"}
            aria-pressed={zoomed}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              target.current = {
                x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
                y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
              };
              setZoomed((z) => !z);
            }}
            className={
              zoomed
                ? "block h-[200%] w-[200%] cursor-zoom-out"
                : "flex h-full w-full cursor-zoom-in items-center justify-center"
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- original re-codificado servido por Storage */}
            <img
              src={current.src}
              srcSet={current.srcSet}
              sizes={zoomed ? "200vw" : "100vw"}
              alt={current.alt}
              width={current.width}
              height={current.height}
              decoding="async"
              className={
                zoomed ? "h-full w-full object-contain" : "max-h-full max-w-full object-contain"
              }
            />
          </button>
        </div>
        {many ? (
          <div className="flex items-center justify-center gap-6 py-3">
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Foto anterior"
              className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/40 text-xl"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Foto siguiente"
              className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/40 text-xl"
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
