"use client";

import { useState } from "react";

/**
 * Galería de la ficha (F9-DESIGN §9): imagen principal, miniaturas como botones
 * y flechas anterior/siguiente. Nunca avanza sola (sin carrusel automático). La
 * primera imagen se pinta en el servidor con prioridad alta (LCP); sin
 * JavaScript se ve la primera y las miniaturas.
 */
export interface GalleryImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

const ARROW =
  "absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] text-lg shadow-sm hover:bg-[var(--sf-surface)]";

export function ProductGallery({ images, title }: { images: GalleryImage[]; title: string }) {
  const [index, setIndex] = useState(0);
  const current = images[index];
  if (!current) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] text-[var(--sf-muted)]">
        Sin imagen
      </div>
    );
  }
  const many = images.length > 1;
  const go = (next: number) => setIndex((next + images.length) % images.length);

  return (
    <div className="space-y-3">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada servida por Storage */}
        <img
          src={current.src}
          alt={current.alt}
          width={current.width}
          height={current.height}
          fetchPriority={index === 0 ? "high" : "auto"}
          decoding="async"
          className="aspect-square w-full rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] object-contain"
        />
        {many ? (
          <>
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label="Imagen anterior"
              className={`${ARROW} left-2`}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label="Imagen siguiente"
              className={`${ARROW} right-2`}
            >
              <span aria-hidden="true">›</span>
            </button>
            <p aria-live="polite" className="sr-only">
              Imagen {index + 1} de {images.length}
            </p>
          </>
        ) : null}
      </div>
      {many ? (
        <ul className="grid grid-cols-5 gap-2" aria-label={`Imágenes de ${title}`}>
          {images.map((image, i) => (
            <li key={image.src}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Ver imagen ${i + 1} de ${images.length}`}
                aria-pressed={i === index}
                className={`block w-full overflow-hidden rounded-[var(--sf-radius-control)] border-2 ${
                  i === index ? "border-[var(--sf-fg)]" : "border-transparent"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- miniatura re-codificada */}
                <img
                  src={image.src}
                  alt=""
                  width={image.width}
                  height={image.height}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
