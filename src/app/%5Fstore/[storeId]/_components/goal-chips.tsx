import Link from "next/link";

import { GOAL_KEY } from "@/lib/catalog/attributes";
import { goalColors, type GoalColor } from "@/lib/theme/goal-colors";
import { mediaUrl, type ImageRef } from "@/server/storefront/catalog";

export interface GoalTile {
  key: string;
  label: string;
  /** Productos publicados con este objetivo. */
  count: number;
  /** Portada de su producto más vendido (opcional). */
  image?: ImageRef | null;
}

const goalHref = (key: string) => `/productos?${new URLSearchParams([[GOAL_KEY, key]])}`;

/**
 * Clases fijas por color de la paleta (la CSP no permite estilos en línea y
 * Tailwind necesita las clases escritas). goal-chips.test.tsx comprueba que todos
 * los colores de la paleta tengan las suyas.
 */
export const GOAL_CLASSES: Record<string, string> = {
  "#cf4410": "bg-[#cf4410] text-[#ffffff]",
  "#f5c400": "bg-[#f5c400] text-[#2b2300]",
  "#7c3aed": "bg-[#7c3aed] text-[#ffffff]",
  "#108556": "bg-[#108556] text-[#ffffff]",
  "#0e7490": "bg-[#0e7490] text-[#ffffff]",
  "#be185d": "bg-[#be185d] text-[#ffffff]",
  "#334155": "bg-[#334155] text-[#ffffff]",
};

const tileClass = (color: GoalColor) => GOAL_CLASSES[color.bg] ?? GOAL_CLASSES["#334155"]!;

/**
 * «¿Qué quieres lograr?» (rediseño A+B, bloques de la propuesta B): un bloque de
 * color por objetivo con productos publicados, su conteo real y la foto de su
 * producto más vendido. Lleva al listado filtrado por ese objetivo.
 */
export function GoalTiles({
  goals,
  compact = false,
  headingId = "sf-objetivos",
}: {
  goals: GoalTile[];
  /** Sin título ni fotos y más bajos (p. ej. el carrito vacío). */
  compact?: boolean;
  headingId?: string;
}) {
  if (goals.length === 0) return null;
  const colors = goalColors(goals.map((g) => g.key));
  // En 2 columnas de celular, «Recuperación» a 22 px no cabe: si algún objetivo es
  // largo, todos bajan un poco (mismo tamaño en todos los bloques).
  const long = goals.some((g) => g.label.length > 10);
  const list = (
    <nav aria-label="Comprar por objetivo">
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {goals.slice(0, 8).map((goal, i) => (
          <li key={goal.key}>
            <Link
              href={goalHref(goal.key)}
              className={`group relative flex flex-col overflow-hidden rounded-[var(--sf-radius-panel)] p-4 focus-visible:outline-offset-4 sm:p-5 ${tileClass(colors[i]!)} ${compact ? "min-h-24 text-left" : "h-48 sm:h-56"}`}
            >
              <span
                className={`font-extrabold leading-[1.05] tracking-tight [font-family:var(--sf-font-heading),system-ui,sans-serif] ${
                  compact
                    ? "text-lg"
                    : long
                      ? "text-[1.1875rem] sm:text-2xl"
                      : "text-[1.375rem] sm:text-[1.75rem]"
                }`}
              >
                {goal.label}
              </span>
              <span className="mt-1 text-sm font-medium">
                {goal.count} {goal.count === 1 ? "producto" : "productos"}
              </span>
              {!compact && goal.image ? (
                // La foto asoma por la esquina, sobre una ficha blanca: una foto con
                // fondo propio se ve intencional sobre cualquier color.
                <span
                  aria-hidden="true"
                  className="absolute -bottom-3 -right-3 flex h-[7.5rem] w-[7.5rem] rotate-[-8deg] items-center justify-center rounded-[var(--sf-radius-card)] bg-white p-1 shadow-[0_8px_24px_rgb(0_0_0/0.2)] motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:-rotate-3 sm:h-36 sm:w-36"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada */}
                  <img
                    src={mediaUrl(goal.image.path)}
                    alt=""
                    width={goal.image.width ?? 320}
                    height={goal.image.height ?? 320}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-contain [mix-blend-mode:var(--sf-photo-blend,multiply)]"
                  />
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
  if (compact) return list;
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="space-y-1">
        <h2
          id={headingId}
          className="text-[1.75rem] font-extrabold leading-[1.05] tracking-tight sm:text-4xl"
        >
          ¿Qué quieres lograr?
        </h2>
        <p className="text-[var(--sf-muted)]">
          Elige tu objetivo y te mostramos los productos para eso.
        </p>
      </div>
      {list}
    </section>
  );
}
