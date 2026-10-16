import Link from "next/link";

import { GOAL_KEY } from "@/lib/catalog/attributes";

/**
 * «Comprar por objetivo» como fila de chips de 44 px (revisión de conversión,
 * M9; F9-DESIGN §14): solo los objetivos con productos publicados. En móvil se
 * desplaza en horizontal en lugar de ocupar varias filas.
 */
export function GoalChips({
  goals,
  centered = false,
}: {
  goals: { key: string; label: string }[];
  /** Centrados y en varias filas (p. ej. el carrito vacío) en lugar de una fila desplazable. */
  centered?: boolean;
}) {
  if (goals.length === 0) return null;
  return (
    <nav aria-label="Comprar por objetivo">
      <ul
        className={
          centered
            ? "flex flex-wrap justify-center gap-2"
            : "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        }
      >
        {goals.map((goal) => (
          <li key={goal.key} className="shrink-0">
            <Link
              href={`/productos?${new URLSearchParams([[GOAL_KEY, goal.key]])}`}
              className="inline-flex min-h-11 items-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-5 text-sm font-semibold hover:bg-[var(--sf-surface)]"
            >
              {goal.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
