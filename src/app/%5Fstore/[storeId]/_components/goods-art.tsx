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
  ring: ["M6 15a6 6 0 1 0 12 0 6 6 0 1 0-12 0", "M9 2.5h6l2 3-5 3-5-3 2-3Z", "M7 5.5h10"],
  necklace: ["M4 4c0 8 3.5 13 8 13s8-5 8-13", "M12 17l-2.2 2.8L12 22l2.2-2.2L12 17Z"],
  headphones: [
    "M4 14v-2a8 8 0 0 1 16 0v2",
    "M4 14h3.5v6H5.5A1.5 1.5 0 0 1 4 18.5V14Z",
    "M20 14h-3.5v6h2a1.5 1.5 0 0 0 1.5-1.5V14Z",
  ],
  plug: ["M7 9h10v5a5 5 0 0 1-10 0V9Z", "M10 9V3.5M14 9V3.5", "M12 19v2.5"],
  phone: [
    "M8 2.5h8A1.5 1.5 0 0 1 17.5 4v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5Z",
    "M10.5 18.5h3",
  ],
  bulb: [
    "M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z",
    "M9.5 18.5h5M10.5 21h3",
  ],
  notebook: [
    "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z",
    "M9 3v18",
    "M12 8h4M12 12h4",
  ],
  pen: ["M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19l-4 1Z", "M14.5 6.5l3 3"],
  book: [
    "M12 6.5C10.5 5 8 4.5 4 4.5V18c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2V4.5c-4 0-6.5.5-8 2Z",
    "M12 6.5V20",
  ],
  flower: [
    "M12 21v-8",
    "M12 13c-3.5 0-5-2.6-5-6.5 2 .2 3.6 1 5 2.7 1.4-1.7 3-2.5 5-2.7 0 3.9-1.5 6.5-5 6.5Z",
    "M12 18c-2.5 0-4-1-5-3",
  ],
  teddy: [
    "M6 13a6 6 0 1 0 12 0 6 6 0 1 0-12 0",
    "M5 7a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0",
    "M14 7a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0",
    "M9.5 12h.01M14.5 12h.01",
    "M10.5 15.5h3",
    "M12 14v1.5",
  ],
  blocks: ["M3 21v-6h7v6H3Z", "M10 21v-6h7v6h-7Z", "M6.5 15V9h7v6h-7Z", "M17 15h4v6h-4"],
  balloon: [
    "M12 3a5.5 6.5 0 0 0-5.5 6.5C6.5 13 9 15.5 12 15.5s5.5-2.5 5.5-6A5.5 6.5 0 0 0 12 3Z",
    "M11 15.5l1 1.5 1-1.5",
    "M12 17c-1.5 1.5 1.5 2.5 0 4.5",
  ],
  gift: [
    "M4 10h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V10Z",
    "M3 7h18v3H3z",
    "M12 7v14",
    "M12 7C9 7 7.5 5.8 7.5 4.6S9 3 10 3.5C11 4 12 5.5 12 7Zm0 0c3 0 4.5-1.2 4.5-2.4S15 3 14 3.5C13 4 12 5.5 12 7Z",
  ],
  card: ["M3 6h18v12H3z", "M3 7l9 6 9-6"],
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
