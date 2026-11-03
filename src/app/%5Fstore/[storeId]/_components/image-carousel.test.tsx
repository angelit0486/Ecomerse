// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImageCarousel, type CarouselSlide } from "./image-carousel";

const slides: CarouselSlide[] = [1, 2, 3].map((n) => ({
  key: `s${n}`,
  src: `/img-${n}.webp`,
  width: 2400,
  height: 1028,
  alt: `Imagen ${n}`,
  ...(n === 1 ? { href: "/categoria/proteinas" } : {}),
}));

let reduced = false;
beforeEach(() => {
  reduced = false;
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: reduced,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function view(overrides: Partial<Parameters<typeof ImageCarousel>[0]> = {}) {
  return render(
    <ImageCarousel
      id="00000000-0000-4000-8000-0000000000c1"
      slides={slides}
      interval={4}
      transition="slide"
      showArrows
      aspectMobile="4:5"
      aspectDesktop="21:9"
      priority
      {...overrides}
    />,
  );
}

const currentDot = () =>
  screen
    .getAllByRole("button", { name: /^Ver imagen/ })
    .findIndex((b) => b.getAttribute("aria-current"));

describe("ImageCarousel", () => {
  it("sin texto visible: cada imagen tiene su texto alternativo y la primera va con prioridad", () => {
    view();
    const imgs = screen.getAllByRole("img", { hidden: true });
    expect(imgs.map((i) => i.getAttribute("alt"))).toEqual(["Imagen 1", "Imagen 2", "Imagen 3"]);
    expect(imgs[0]!.getAttribute("fetchpriority")).toBe("high");
    expect(imgs[1]!.getAttribute("loading")).toBe("lazy");
    expect(screen.getByRole("link").getAttribute("href")).toBe("/categoria/proteinas");
  });

  it("avanza sola cada 4 s y vuelve a la primera (bucle)", () => {
    view();
    expect(currentDot()).toBe(0);
    act(() => vi.advanceTimersByTime(4000));
    expect(currentDot()).toBe(1);
    act(() => vi.advanceTimersByTime(4000));
    expect(currentDot()).toBe(2);
    act(() => vi.advanceTimersByTime(4000));
    expect(currentDot()).toBe(0);
  });

  it("el avance es configurable", () => {
    view({ interval: 6 });
    act(() => vi.advanceTimersByTime(4000));
    expect(currentDot()).toBe(0);
    act(() => vi.advanceTimersByTime(2000));
    expect(currentDot()).toBe(1);
  });

  it("deslizar cambia de imagen y reinicia el temporizador, que sigue corriendo", () => {
    const { container } = view();
    act(() => vi.advanceTimersByTime(3000));
    const track = container.querySelector("[data-carousel] > div")!;
    fireEvent.pointerDown(track, { clientX: 300, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(track, { clientX: 200, clientY: 102, pointerType: "touch" });
    fireEvent.pointerUp(track, { clientX: 200, clientY: 102, pointerType: "touch" });
    expect(currentDot()).toBe(1);
    // A los 3 s del deslizamiento todavía no avanza (se reinició)...
    act(() => vi.advanceTimersByTime(3000));
    expect(currentDot()).toBe(1);
    // ...y a los 4 s sí: el avance automático sigue.
    act(() => vi.advanceTimersByTime(1000));
    expect(currentDot()).toBe(2);
  });

  it("deslizar a la derecha regresa; desde la primera va a la última", () => {
    const { container } = view();
    const track = container.querySelector("[data-carousel] > div")!;
    fireEvent.pointerDown(track, { clientX: 100, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(track, { clientX: 220, clientY: 100, pointerType: "touch" });
    fireEvent.pointerUp(track, { clientX: 220, clientY: 100, pointerType: "touch" });
    expect(currentDot()).toBe(2);
  });

  it("un movimiento vertical es desplazar la página, no deslizar", () => {
    const { container } = view();
    const track = container.querySelector("[data-carousel] > div")!;
    fireEvent.pointerDown(track, { clientX: 100, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(track, { clientX: 105, clientY: 200, pointerType: "touch" });
    fireEvent.pointerUp(track, { clientX: 105, clientY: 200, pointerType: "touch" });
    expect(currentDot()).toBe(0);
  });

  it("pausa y reanuda con el botón discreto", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Pausar el avance automático" }));
    act(() => vi.advanceTimersByTime(12000));
    expect(currentDot()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Reanudar el avance automático" }));
    act(() => vi.advanceTimersByTime(4000));
    expect(currentDot()).toBe(1);
  });

  it("con «reducir movimiento» no avanza sola", () => {
    reduced = true;
    view();
    act(() => vi.advanceTimersByTime(12000));
    expect(currentDot()).toBe(0);
    expect(screen.queryByRole("button", { name: /avance automático/ })).toBeNull();
    // Se puede seguir navegando a mano.
    fireEvent.click(screen.getByRole("button", { name: "Imagen siguiente" }));
    expect(currentDot()).toBe(1);
  });

  it("con una sola imagen no hay puntos, flechas ni temporizador", () => {
    view({ slides: slides.slice(0, 1) });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("las imágenes ocultas no reciben foco ni las lee el lector de pantalla", () => {
    const { container } = view();
    const groups = container.querySelectorAll('[aria-roledescription="diapositiva"]');
    expect(groups[0]!.getAttribute("aria-hidden")).toBeNull();
    expect(groups[1]!.getAttribute("aria-hidden")).toBe("true");
    expect(groups[1]!.hasAttribute("inert")).toBe(true);
  });
});
