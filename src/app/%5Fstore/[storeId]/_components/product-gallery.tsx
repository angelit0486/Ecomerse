"use client";

import { useEffect, useRef, useState } from "react";

import { goodFor } from "@/lib/storefront/goods";

import { GalleryZoom } from "./gallery-zoom";
import { GoodIcon } from "./goods-art";

/** Evento con el que el selector de variantes muestra su imagen (revisión M5). */
export const VARIANT_IMAGE_EVENT = "sf:variant-image";

/**
 * Galería de la ficha (F9-DESIGN §9): imagen principal, miniaturas como botones
 * y flechas anterior/siguiente. Nunca avanza sola (sin carrusel automático). La
 * primera imagen se pinta en el servidor con prioridad alta (LCP); sin
 * JavaScript se ve la primera y las miniaturas.
 */
export interface GalleryImage {
  src: string;
  /** Copias en varios tamaños (paso 8); sin ellas, solo `src`. */
  srcSet?: string | undefined;
  alt: string;
  width: number;
  height: number;
}

const ARROW =
  "absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] text-lg shadow-sm hover:bg-[var(--sf-surface)]";

export function ProductGallery({
  images,
  title,
  dots = false,
  enhanced = false,
}: {
  images: GalleryImage[];
  title: string;
  /** Tema v2 (ADR-034): puntos en lugar de miniaturas bajo la imagen. */
  dots?: boolean;
  /**
   * Plan de experiencia, fase 2 (solo con un look): deslizar con el dedo para
   * cambiar de foto y tocarla para verla ampliada.
   */
  enhanced?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  // Imagen de la variante elegida que no está en la galería (revisión de conversión, M5).
  const [extra, setExtra] = useState<string | null>(null);
  useEffect(() => {
    const onVariant = (event: Event) => {
      const src = (event as CustomEvent<string | null>).detail;
      if (!src) {
        setExtra(null);
        return;
      }
      const i = images.findIndex((image) => image.src === src);
      if (i >= 0) {
        setIndex(i);
        setExtra(null);
      } else {
        setExtra(src);
      }
    };
    window.addEventListener(VARIANT_IMAGE_EVENT, onVariant);
    return () => window.removeEventListener(VARIANT_IMAGE_EVENT, onVariant);
  }, [images]);
  const current = extra
    ? { src: extra, alt: title, width: images[0]?.width ?? 1024, height: images[0]?.height ?? 1024 }
    : images[index];
  if (!current) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] text-[var(--sf-muted)]">
        <GoodIcon good={goodFor(title, "bag")} strokeOpacity={0.6} className="size-1/3" />
      </div>
    );
  }
  const many = images.length > 1;
  const go = (next: number) => {
    setExtra(null);
    setIndex((next + images.length) % images.length);
  };

  const mainImage = (
    // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada servida por Storage
    <img
      src={current.src}
      srcSet={current.srcSet}
      // Media pantalla en escritorio (dos columnas); todo el ancho en el celular.
      sizes="(min-width: 768px) 50vw, 100vw"
      alt={current.alt}
      width={current.width}
      height={current.height}
      fetchPriority={index === 0 ? "high" : "auto"}
      decoding="async"
      className="aspect-square w-full object-contain p-4 [mix-blend-mode:var(--sf-photo-blend,multiply)] sm:p-8"
    />
  );

  return (
    <div className="space-y-3">
      {/* Anaquel (rediseño A+B): la foto sobre el gris de la tienda; multiplicar quita
          el blanco de fondo de una foto de producto. */}
      <div
        className={`relative overflow-hidden rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] ${enhanced && many ? "touch-pan-y" : ""}`}
        // Deslizar a los lados cambia de foto (fase 2); vertical sigue desplazando la página.
        onPointerDown={
          enhanced
            ? (event) => {
                swipeStart.current = { x: event.clientX, y: event.clientY };
                swiped.current = false;
              }
            : undefined
        }
        onPointerUp={
          enhanced
            ? (event) => {
                const start = swipeStart.current;
                swipeStart.current = null;
                if (!start || !many) return;
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
                  swiped.current = true;
                  go(index + (dx < 0 ? 1 : -1));
                }
              }
            : undefined
        }
      >
        {enhanced && !extra ? (
          <button
            type="button"
            onClick={() => {
              // Un deslizamiento no abre la foto ampliada.
              if (swiped.current) {
                swiped.current = false;
                return;
              }
              setZoomOpen(true);
            }}
            aria-label={many ? `Ampliar foto ${index + 1} de ${images.length}` : "Ampliar foto"}
            className="sf-zoom-trigger block w-full cursor-zoom-in"
          >
            {mainImage}
          </button>
        ) : (
          mainImage
        )}
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
      {many && dots ? (
        <ul className="flex justify-center gap-1" aria-label={`Imágenes de ${title}`}>
          {images.map((image, i) => (
            <li key={image.src}>
              <button
                type="button"
                onClick={() => {
                  setExtra(null);
                  setIndex(i);
                }}
                aria-label={`Ver imagen ${i + 1} de ${images.length}`}
                aria-pressed={!extra && i === index}
                className="flex h-11 w-11 items-center justify-center"
              >
                <span
                  aria-hidden="true"
                  className={`block h-2.5 w-2.5 rounded-full ${
                    !extra && i === index ? "bg-[var(--sf-fg)]" : "bg-[var(--sf-border-strong)]"
                  }`}
                />
              </button>
            </li>
          ))}
        </ul>
      ) : many ? (
        <ul className="grid grid-cols-5 gap-2" aria-label={`Imágenes de ${title}`}>
          {images.map((image, i) => (
            <li key={image.src}>
              <button
                type="button"
                onClick={() => {
                  setExtra(null);
                  setIndex(i);
                }}
                aria-label={`Ver imagen ${i + 1} de ${images.length}`}
                aria-pressed={!extra && i === index}
                className={`block w-full overflow-hidden rounded-[var(--sf-radius-control)] border-2 bg-[var(--sf-surface)] ${
                  !extra && i === index ? "border-[var(--sf-primary)]" : "border-transparent"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- miniatura re-codificada */}
                <img
                  src={image.src}
                  srcSet={image.srcSet}
                  sizes="96px"
                  alt=""
                  width={image.width}
                  height={image.height}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full object-contain p-1 [mix-blend-mode:var(--sf-photo-blend,multiply)]"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {enhanced && !extra ? (
        <GalleryZoom
          open={zoomOpen}
          onClose={() => setZoomOpen(false)}
          images={images}
          index={index}
          onIndex={(next) => setIndex(next)}
          title={title}
        />
      ) : null}
    </div>
  );
}
