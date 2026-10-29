import type { Good } from "@/lib/storefront/goods";

/**
 * «Anaquel ilustrado» (misión vendible F2): cada objeto del giro dibujado en un
 * solo trazo de 24×24, en `currentColor`. Es código de la plataforma, no un SVG
 * del comerciante (CLAUDE.md regla 13). Lo usan el hero sin foto, las categorías
 * sin foto y los productos sin foto; con foto, nada de esto se dibuja.
 */
const PATHS: Record<Good, string[]> = {
  shirt: [
    "M8 3 4.5 5.2 2.5 9.6l3 1.5 1-1.6V21h11V9.5l1 1.6 3-1.5-2-4.4L16 3c-.7 1.6-2.2 2.6-4 2.6S8.7 4.6 8 3Z",
  ],
  pants: ["M6.5 3h11l1.5 18h-5l-2-10.5L10 21H5L6.5 3Z", "M6.3 6.2h11.4"],
  hoodie: [
    "M9 4.6C9 3.1 10.3 2 12 2s3 1.1 3 2.6",
    "M8.6 4.6 5 6.6 3 17h3l.8-6V21h10.4V11l.8 6h3L19 6.6l-3.6-2-1.4 2.2h-4L8.6 4.6Z",
    "M9.2 15.2h5.6v3.2H9.2z",
  ],
  cap: [
    "M3 15c0-5.2 3.8-8.5 8.5-8.5 4 0 7 2.5 7.5 7",
    "M19 13.5c1.8.3 3 1.1 3 2.1 0 .8-1 1.2-2.5 1L3 15",
    "M11.5 6.5c-1.5 2.5-1.9 5.5-1.7 8.7",
    "M11.5 6.5V5.4",
  ],
  dress: [
    "M9.5 2.5 9.8 6 7.5 9 4 21h16L16.5 9l-2.3-3 .3-3.5",
    "M9.8 6c.7.8 1.4 1.2 2.2 1.2s1.5-.4 2.2-1.2",
    "M7.5 9h9",
  ],
  shoe: ["M3 17.5V12l4-.6 2.4-3 2.6 1.6c1.5 1.4 4 2.4 7 2.9 1.3.2 2 1 2 2.6v2H3Z", "M3 17.5h18"],
  bag: ["M5 8h14l-1 13H6L5 8Z", "M9 8V6.5a3 3 0 0 1 6 0V8"],
  tub: ["M5.5 8h13v11a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V8Z", "M5 5h14v3H5z", "M8.5 12.5h7v4h-7z"],
  jar: ["M7 6.5h10V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V6.5Z", "M8 3h8v3.5H8z", "M7 11h10"],
  capsule: ["M5.6 13.6l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a3.4 3.4 0 0 1-4.8-4.8Z", "M9.6 9.6l4.8 4.8"],
  shaker: ["M7 7h10l-1.2 14H8.2L7 7Z", "M7.5 4h9v3h-9z", "M10.5 4V2.5h3V4", "M7.6 11h8.8"],
  dropper: [
    "M7 11h10v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-8Z",
    "M9.5 8h5v3h-5z",
    "M10.5 8V5a1.5 1.5 0 0 1 3 0v3",
  ],
  lipstick: ["M8 13h8v8H8z", "M9 9h6v4H9z", "M10 9V4.5l4-2V9"],
  comb: ["M3 7.5h18v3.5H3z", "M5 11v6M8 11v6M11 11v6M14 11v6M17 11v6M20 11v4"],
  bottle: ["M10 2.5h4v3l2 3V20a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8.5l2-3v-3Z", "M8 12h8v4H8"],
  spray: [
    "M7 10h7v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V10Z",
    "M8.5 6.5h4V10h-4z",
    "M8 3.5h7.5L17 5h-4v1.5",
    "M19 4h1.5M19 7h1.5",
  ],
  snack: [
    "M6 3.5h12l-1 3.5c.7 3.7.7 7.3 0 11l1 2.5H6l1-2.5c-.7-3.7-.7-7.3 0-11l-1-3.5Z",
    "M7 7h10M7 18h10",
  ],
  mug: [
    "M5 7h11v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7Z",
    "M16 9.5h2a2.5 2.5 0 0 1 0 5h-2",
    "M8.5 2.5v2M12 2.5v2",
  ],
  lamp: ["M7 3h10l2.5 8h-15L7 3Z", "M12 11v8.5", "M8.5 20.5h7"],
  plant: [
    "M7 14h10l-1.2 7H8.2L7 14Z",
    "M12 14V8",
    "M12 10c-3 0-5-2-5-5 3 0 5 2 5 5Z",
    "M12 8c0-3 2-5 5-5 0 3-2 5-5 5Z",
  ],
  candle: ["M8 10h8v11H8z", "M12 10V8", "M12 8c-1.7-1.5-1.2-3.7 0-5.2 1.2 1.5 1.7 3.7 0 5.2Z"],
  cushion: ["M4 6c5.3 1.3 10.7 1.3 16 0-1.3 4-1.3 8 0 12-5.3-1.3-10.7-1.3-16 0 1.3-4 1.3-8 0-12Z"],
  bowl: [
    "M3 12h18l-2 7H5l-2-7Z",
    "M7.5 10.2a1 1 0 1 0 2 0 1 1 0 1 0-2 0M11 9.2a1 1 0 1 0 2 0 1 1 0 1 0-2 0M14.5 10.2a1 1 0 1 0 2 0 1 1 0 1 0-2 0",
  ],
  ball: [
    "M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0",
    "M5.5 5.8c3 2.2 3 10.2 0 12.4M18.5 5.8c-3 2.2-3 10.2 0 12.4",
  ],
  collar: [
    "M3 10.5c0-1 .8-1.5 2-1.5h14c1.2 0 2 .5 2 1.5v3c0 1-.8 1.5-2 1.5H5c-1.2 0-2-.5-2-1.5v-3Z",
    "M15 8.5h3v7h-3z",
    "M6.5 12h.01M9 12h.01",
    "M10.5 15v1.5",
    "M8.7 18.8a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0",
  ],
  petbed: [
    "M2.5 15c0-3.3 2.2-5 4.5-5 1.6 0 2.4 1 5 1s3.4-1 5-1c2.3 0 4.5 1.7 4.5 5v2.5A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5V15Z",
    "M6 15.5c2 .8 10 .8 12 0",
  ],
  tag: ["M3 12 12 3h9v9l-9 9-9-9Z", "M15.5 8.5a1 1 0 1 0 2 0 1 1 0 1 0-2 0"],
  box: ["M3 8l9-4.5L21 8v8l-9 4.5L3 16V8Z", "M3 8l9 4.5L21 8M12 12.5v8"],
};

export function GoodIcon({
  good,
  className,
  strokeWidth = 1.5,
  strokeOpacity,
}: {
  good: Good;
  className?: string;
  strokeWidth?: number;
  /** Transparencia en el trazo, no en el grupo: `opacity` crea una capa que deja un rectángulo visible. */
  strokeOpacity?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={strokeOpacity}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[good].map((d) => (
        <path key={d} d={d} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/**
 * Anaquel del hero sin foto: los objetos del giro, grandes y tenues, sobre una
 * línea de repisa en el borde inferior. Decorativo (aria-hidden); el texto del
 * hero no cambia y conserva su contraste porque los objetos van debajo de él.
 */
export function GoodsShelf({ goods }: { goods: readonly Good[] }) {
  return (
    <div
      aria-hidden="true"
      className="sf-goods-shelf pointer-events-none select-none px-5 sm:px-12"
    >
      <div className="flex items-end justify-center gap-5 sm:justify-between sm:gap-8">
        {goods.map((good, index) => (
          <GoodIcon
            key={good}
            good={good}
            strokeWidth={1.75}
            strokeOpacity={0.35}
            // Alturas alternas, como mercancía de distintos tamaños; en el celular solo 4.
            className={`shrink-0 ${index % 2 === 0 ? "size-16 sm:size-24" : "size-12 sm:size-20"} ${index > 3 ? "max-sm:hidden" : ""}`}
          />
        ))}
      </div>
      <div className="mt-1 h-px bg-current opacity-30" />
    </div>
  );
}
