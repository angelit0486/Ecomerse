"use client";

import { Children, useEffect, useId, useState, type ReactNode } from "react";

const ROTATE_MS = 6000;

/**
 * Portadas que rotan (tema v3). Accesible (WCAG 2.2.2): se pausa con un botón,
 * al pasar el mouse o al enfocar algo dentro, y nunca rota si el sistema pide
 * reducir el movimiento. Las portadas ocultas siguen en el HTML (sin JS se ve
 * la primera) pero quedan `inert` para el teclado y el lector de pantalla.
 */
export function HeroCarousel({
  children,
  labels,
  autoplay,
}: {
  children: ReactNode;
  labels: string[];
  autoplay: boolean;
}) {
  const slides = Children.toArray(children);
  const count = slides.length;
  const id = useId();
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(!autoplay);
  const [hovered, setHovered] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const rotating = autoplay && !paused && !hovered && !reduced;
  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(() => setCurrent((c) => (c + 1) % count), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [rotating, count]);

  const go = (index: number) => setCurrent((index + count) % count);

  return (
    <div
      role="region"
      aria-roledescription="carrusel"
      aria-label="Portadas"
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovered(false);
      }}
    >
      <div aria-live={rotating ? "off" : "polite"}>
        {slides.map((slide, index) => (
          <div
            key={index}
            id={`${id}-${index}`}
            role="group"
            aria-roledescription="portada"
            aria-label={`${index + 1} de ${count}: ${labels[index] ?? ""}`}
            hidden={index !== current}
            inert={index !== current}
          >
            {slide}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1">
        {autoplay ? (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="inline-flex min-h-11 items-center rounded-[var(--sf-radius-control)] px-3 text-sm font-semibold underline underline-offset-2"
          >
            {paused ? "Reanudar portadas" : "Pausar portadas"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => go(current - 1)}
          aria-label="Portada anterior"
          className="inline-flex size-11 items-center justify-center rounded-full text-xl"
        >
          ‹
        </button>
        {slides.map((_, index) => (
          <button
            key={index}
            type="button"
            onClick={() => go(index)}
            aria-label={`Ver portada ${index + 1}`}
            aria-current={index === current ? "true" : undefined}
            aria-controls={`${id}-${index}`}
            className="inline-flex size-11 items-center justify-center"
          >
            <span
              aria-hidden="true"
              className={`block size-2.5 rounded-full border border-[var(--sf-fg)] ${
                index === current ? "bg-[var(--sf-fg)]" : ""
              }`}
            />
          </button>
        ))}
        <button
          type="button"
          onClick={() => go(current + 1)}
          aria-label="Portada siguiente"
          className="inline-flex size-11 items-center justify-center rounded-full text-xl"
        >
          ›
        </button>
      </div>
    </div>
  );
}
