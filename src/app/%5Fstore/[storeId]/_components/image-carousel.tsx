"use client";

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from "react";

/**
 * Portada de solo imágenes (interruptor `hero_image_carousel`).
 *
 * - Avanza sola cada `interval` segundos, en bucle; al deslizar (dedo o mouse)
 *   o usar puntos y flechas, el temporizador vuelve a empezar y sigue.
 * - Botón discreto de pausa y reproducción (WCAG 2.2.2). Con «reducir
 *   movimiento» no avanza sola ni anima.
 * - Se detiene mientras el foco del teclado está dentro (no cambia lo que se
 *   está por activar).
 * - Sin estilos en línea en el HTML (la CSP solo admite estilos con nonce): las
 *   posiciones son clases y el arrastre se mueve desde JavaScript.
 * - La primera imagen se pide con prioridad alta; las demás, diferidas, se
 *   piden después del primer pintado para que no aparezcan en blanco.
 */
export interface CarouselSlide {
  key: string;
  src: string;
  srcSet?: string;
  width: number;
  height: number;
  mobileSrc?: string;
  mobileSrcSet?: string;
  alt: string;
  href?: string;
  /** Punto focal (%). En la tienda también llega por `<style>` con nonce, sin JS. */
  focal?: { x: number; y: number } | null;
  mobileFocal?: { x: number; y: number } | null;
}

const ASPECT_MOBILE = {
  "4:5": "aspect-[4/5]",
  "1:1": "aspect-square",
  "3:4": "aspect-[3/4]",
} as const;
const ASPECT_DESKTOP = {
  "21:9": "sm:aspect-[21/9]",
  "16:9": "sm:aspect-video",
  "3:1": "sm:aspect-[3/1]",
} as const;
/** Vista previa de computadora en el panel (clases completas: Tailwind solo genera las que ve). */
const ASPECT_DESKTOP_PREVIEW = {
  "21:9": "aspect-[21/9]",
  "16:9": "aspect-video",
  "3:1": "aspect-[3/1]",
} as const;
const SWIPE_PX = 40;

export function ImageCarousel({
  id,
  slides,
  interval,
  transition,
  showArrows,
  aspectMobile,
  aspectDesktop,
  priority,
  device,
}: {
  /**
   * Solo el editor del panel: dibuja como en ese dispositivo aunque la pantalla
   * sea otra (vista previa de celular y de computadora).
   */
  device?: "mobile" | "desktop";
  /** Identificador del bloque (el `<style>` del punto focal lo usa). */
  id: string;
  slides: CarouselSlide[];
  interval: number;
  transition: "slide" | "fade";
  showArrows: boolean;
  aspectMobile: keyof typeof ASPECT_MOBILE;
  aspectDesktop: keyof typeof ASPECT_DESKTOP;
  /** Primer bloque de la página: su primera imagen es el LCP. */
  priority: boolean;
}) {
  const count = slides.length;
  const domId = useId();
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [warm, setWarm] = useState(false);
  // Cambia con cada interacción: reinicia el temporizador aunque `current` no cambie.
  const [tick, setTick] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; dx: number; active: boolean; moved: boolean } | null>(
    null,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Las demás imágenes se piden después del primer pintado.
  useEffect(() => {
    const timer = window.setTimeout(() => setWarm(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  // Punto focal desde JavaScript (CSSOM, permitido por la CSP): necesario en la
  // vista previa del panel; en la tienda repite lo que ya dice el <style>.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const query = window.matchMedia("(max-width: 639px)");
    const apply = () => {
      const mobile = device ? device === "mobile" : query.matches;
      el.querySelectorAll<HTMLImageElement>("[data-slide] img").forEach((img, i) => {
        const slide = slides[i];
        const f = mobile
          ? (slide?.mobileFocal ?? (slide?.mobileSrc ? null : slide?.focal))
          : slide?.focal;
        img.style.objectPosition = f ? `${f.x}% ${f.y}%` : "";
      });
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [slides, device]);

  const go = useCallback(
    (index: number, dir: 1 | -1) => {
      setDirection(dir);
      setCurrent(((index % count) + count) % count);
      setTick((t) => t + 1);
    },
    [count],
  );

  const rotating = count > 1 && !paused && !focused && !reduced;
  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => {
      setDirection(1);
      setCurrent((c) => (c + 1) % count);
    }, interval * 1000);
    return () => window.clearTimeout(timer);
  }, [rotating, current, tick, interval, count]);

  const setOffset = (px: number) => {
    if (track.current) track.current.style.setProperty("--drag", `${px}px`);
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (count < 2 || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, active: true, moved: false };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d?.active) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // Un desplazamiento vertical es la página que se mueve: no es un deslizamiento.
    if (!d.moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
      drag.current = null;
      return;
    }
    if (Math.abs(dx) > 6) {
      d.moved = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    d.dx = dx;
    if (transition === "slide" && !reduced) setOffset(dx);
  }
  function onPointerEnd() {
    const d = drag.current;
    if (!d) return;
    setOffset(0);
    if (d.moved && Math.abs(d.dx) >= SWIPE_PX) {
      if (d.dx < 0) go(current + 1, 1);
      else go(current - 1, -1);
    } else if (d.moved) {
      setTick((t) => t + 1);
    }
    // El clic que sigue a un arrastre no abre el enlace.
    window.setTimeout(() => {
      drag.current = null;
    }, 0);
  }

  const animate = !reduced;
  return (
    <div
      role="region"
      aria-roledescription="carrusel"
      aria-label="Portada"
      ref={root}
      data-carousel={id}
      className={`group relative overflow-hidden ${
        device === "mobile"
          ? ASPECT_MOBILE[aspectMobile]
          : device === "desktop"
            ? ASPECT_DESKTOP_PREVIEW[aspectDesktop]
            : `${ASPECT_MOBILE[aspectMobile]} ${ASPECT_DESKTOP[aspectDesktop]}`
      } bg-[var(--sf-surface)]`}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div
        ref={track}
        className="absolute inset-0 touch-pan-y select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {slides.map((slide, index) => {
          const offset = (index - current + count) % count;
          const isCurrent = offset === 0;
          const position =
            transition === "fade"
              ? isCurrent
                ? "opacity-100"
                : "opacity-0"
              : isCurrent
                ? "translate-x-[var(--drag,0px)]"
                : offset === 1 && (direction === 1 || count === 2)
                  ? "translate-x-[calc(100%+var(--drag,0px))]"
                  : offset === count - 1
                    ? "-translate-x-[calc(100%-var(--drag,0px))]"
                    : "invisible translate-x-full";
          const moving =
            animate && (isCurrent || offset === 1 || offset === count - 1)
              ? transition === "fade"
                ? "transition-opacity duration-700 ease-out"
                : "transition-transform duration-500 ease-out"
              : "";
          const eager = index === 0 && priority;
          const picture = (
            <picture className="contents">
              {slide.mobileSrc && !device ? (
                <source
                  media="(max-width: 639px)"
                  srcSet={slide.mobileSrcSet ?? slide.mobileSrc}
                  sizes="100vw"
                />
              ) : null}
              <img
                src={device === "mobile" && slide.mobileSrc ? slide.mobileSrc : slide.src}
                srcSet={device === "mobile" && slide.mobileSrc ? undefined : slide.srcSet}
                sizes="100vw"
                alt={slide.alt}
                width={slide.width}
                height={slide.height}
                draggable={false}
                fetchPriority={eager ? "high" : undefined}
                loading={
                  eager || (warm && (offset === 1 || offset === count - 1)) ? "eager" : "lazy"
                }
                decoding={eager ? "sync" : "async"}
                className="size-full object-cover"
              />
            </picture>
          );
          return (
            <div
              key={slide.key}
              id={`${domId}-${index}`}
              role="group"
              aria-roledescription="diapositiva"
              aria-label={`${index + 1} de ${count}`}
              aria-hidden={isCurrent ? undefined : true}
              inert={!isCurrent}
              data-slide={index}
              className={`absolute inset-0 ${position} ${moving}`}
            >
              {slide.href ? (
                <a href={slide.href} className="block size-full" draggable={false}>
                  {picture}
                </a>
              ) : (
                picture
              )}
            </div>
          );
        })}
      </div>

      {count > 1 ? (
        <>
          {showArrows ? (
            <>
              <button
                type="button"
                onClick={() => go(current - 1, -1)}
                aria-label="Imagen anterior"
                className="absolute left-2 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-2xl leading-none text-white backdrop-blur-sm hover:bg-black/60"
              >
                <span aria-hidden="true">‹</span>
              </button>
              <button
                type="button"
                onClick={() => go(current + 1, 1)}
                aria-label="Imagen siguiente"
                className="absolute right-2 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-2xl leading-none text-white backdrop-blur-sm hover:bg-black/60"
              >
                <span aria-hidden="true">›</span>
              </button>
            </>
          ) : null}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center pb-1">
            {slides.map((slide, index) => (
              <button
                key={slide.key}
                type="button"
                onClick={() => go(index, index >= current ? 1 : -1)}
                aria-label={`Ver imagen ${index + 1}`}
                aria-current={index === current ? "true" : undefined}
                aria-controls={`${domId}-${index}`}
                className="inline-flex size-11 items-center justify-center"
              >
                <span
                  aria-hidden="true"
                  className={`block h-2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)] transition-all ${
                    index === current ? "w-5" : "w-2 opacity-70"
                  }`}
                />
              </button>
            ))}
          </div>
          {reduced ? null : (
            <button
              type="button"
              onClick={() => {
                setPaused((p) => !p);
                setTick((t) => t + 1);
              }}
              aria-label={paused ? "Reanudar el avance automático" : "Pausar el avance automático"}
              aria-pressed={paused}
              className="absolute bottom-1 right-1 inline-flex size-11 items-center justify-center text-white"
            >
              <span
                aria-hidden="true"
                className="inline-flex size-7 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm"
              >
                {paused ? (
                  <svg viewBox="0 0 16 16" className="size-3.5 fill-current">
                    <path d="M4 2.5v11l9-5.5z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" className="size-3.5 fill-current">
                    <path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" />
                  </svg>
                )}
              </span>
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}
