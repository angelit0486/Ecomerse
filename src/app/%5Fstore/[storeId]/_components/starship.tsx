/**
 * Nave del look Nocturno sobre el título de la portada (dirección «Alien Demon
 * Exotics»). Ilustración SVG en línea, sin imágenes ni JS: ~2 KB en el HTML,
 * ninguna petición extra. Decorativa (`aria-hidden`, fuera del orden de foco).
 *
 * - Sin colores propios: cada pieza lleva una clase `sf-ship-*` y el CSS del look
 *   le da color desde su paleta (así la prueba de «solo colores de la paleta»
 *   también la cubre). Sin el look, no se dibuja.
 * - Tamaño fijo por `width`/`height` + `viewBox`: el título no se mueve al cargar.
 * - El movimiento vive en el CSS del look (solo `transform` y `opacity`, dentro
 *   de «sin preferencia de movimiento reducido»).
 * - Solo existe una por página (la primera portada): los `id` de los degradados
 *   no se repiten.
 */
export function Starship() {
  return (
    <svg
      className="sf-ship"
      viewBox="0 0 160 104"
      width="160"
      height="104"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="sf-ship-chrome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="sf-ship-c1" />
          <stop offset=".45" className="sf-ship-c2" />
          <stop offset=".62" className="sf-ship-c3" />
          <stop offset="1" className="sf-ship-c4" />
        </linearGradient>
        <linearGradient id="sf-ship-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="sf-ship-g1" />
          <stop offset="1" className="sf-ship-g2" />
        </linearGradient>
        <linearGradient id="sf-ship-ray" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="sf-ship-r1" />
          <stop offset="1" className="sf-ship-r2" />
        </linearGradient>
      </defs>
      {/* Haz: cae hacia el título, muy tenue. */}
      <path className="sf-ship-beam" d="M68 66h24l26 38H42z" fill="url(#sf-ship-ray)" />
      <g className="sf-ship-craft">
        {/* Panza y anillo del motor. */}
        <ellipse className="sf-ship-belly" cx="80" cy="62" rx="42" ry="10" />
        <ellipse className="sf-ship-engine" cx="80" cy="66" rx="17" ry="4.5" />
        {/* Disco principal en cromo, con su filo. */}
        <ellipse cx="80" cy="54" rx="74" ry="14" fill="url(#sf-ship-chrome)" />
        <ellipse className="sf-ship-rim" cx="80" cy="54" rx="74" ry="14" />
        {/* Paneles del casco. */}
        <path
          className="sf-ship-panel"
          d="M24 50c4 7 13 11 22 13M62 66v-6M80 68v-7M98 66v-6M136 50c-4 7-13 11-22 13"
        />
        {/* Cubierta superior. */}
        <ellipse cx="80" cy="46" rx="46" ry="9" fill="url(#sf-ship-chrome)" />
        {/* Cúpula de cristal con su piloto. */}
        <path d="M54 46a26 24 0 0 1 52 0z" fill="url(#sf-ship-glass)" className="sf-ship-dome" />
        <ellipse className="sf-ship-pilot" cx="80" cy="35" rx="7.5" ry="9" />
        <ellipse
          className="sf-ship-eye"
          cx="76.6"
          cy="35"
          rx="2.4"
          ry="1.2"
          transform="rotate(20 76.6 35)"
        />
        <ellipse
          className="sf-ship-eye"
          cx="83.4"
          cy="35"
          rx="2.4"
          ry="1.2"
          transform="rotate(-20 83.4 35)"
        />
        <path className="sf-ship-glint" d="M62 38c3-8 10-13 18-14" />
        {/* Luces de posición a lo largo del disco. */}
        <circle className="sf-ship-light" cx="22" cy="55" r="2.6" />
        <circle className="sf-ship-light" cx="41" cy="61" r="2.6" />
        <circle className="sf-ship-light" cx="60" cy="64.5" r="2.6" />
        <circle className="sf-ship-light" cx="80" cy="65.5" r="2.6" />
        <circle className="sf-ship-light" cx="100" cy="64.5" r="2.6" />
        <circle className="sf-ship-light" cx="119" cy="61" r="2.6" />
        <circle className="sf-ship-light" cx="138" cy="55" r="2.6" />
      </g>
    </svg>
  );
}
