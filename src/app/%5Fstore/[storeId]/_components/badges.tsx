import { BADGE_LABELS, type Badge } from "@/lib/catalog/merchandising";

/** Insignias estructurales de un producto (F9-DESIGN §9). */
const BADGE_STYLE: Record<Badge, string> = {
  // Colores con contraste garantizado (≥ 4.5:1). «Oferta» con el acento cuando su
  // texto llega a 4.5:1; si no, el del botón (saleColors, revisión M8).
  sale: "bg-[var(--sf-sale-bg)] text-[var(--sf-sale-fg)]",
  new: "bg-[var(--sf-fg)] text-[var(--sf-bg)]",
  low_stock: "border border-[var(--sf-fg)] bg-[var(--sf-bg)] text-[var(--sf-fg)]",
  sold_out: "border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] text-[var(--sf-fg)]",
};

/**
 * Con `salePercent` (tarjetas, rediseño A+B), la oferta se ve como «−20 %»; el
 * lector de pantalla oye «Oferta −20 %». El porcentaje es el redondeado hacia
 * abajo de `savings`: nunca exagera el descuento.
 */
export function Badges({
  badges,
  label = "Destacados",
  salePercent,
}: {
  badges: Badge[];
  label?: string;
  salePercent?: number | null;
}) {
  if (badges.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {badges.map((b) => (
        <li
          key={b}
          className={`rounded-[min(var(--sf-radius),6px)] px-2 py-0.5 text-xs font-bold tabular-nums ${BADGE_STYLE[b]}`}
        >
          {b === "sale" && salePercent && salePercent >= 1 ? (
            <>
              <span className="sr-only">{BADGE_LABELS.sale} </span>−{salePercent}&nbsp;%
            </>
          ) : (
            BADGE_LABELS[b]
          )}
        </li>
      ))}
    </ul>
  );
}
