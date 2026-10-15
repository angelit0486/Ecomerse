import { BADGE_LABELS, type Badge } from "@/lib/catalog/merchandising";

/** Insignias estructurales de un producto (F9-DESIGN §9). */
const BADGE_STYLE: Record<Badge, string> = {
  // Colores con contraste garantizado (≥ 4.5:1): el del botón, y texto sobre fondo.
  sale: "bg-[var(--sf-btn-bg)] text-[var(--sf-btn-fg)]",
  new: "bg-[var(--sf-fg)] text-[var(--sf-bg)]",
  low_stock: "border border-[var(--sf-fg)] bg-[var(--sf-bg)] text-[var(--sf-fg)]",
  sold_out: "border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] text-[var(--sf-fg)]",
};

export function Badges({ badges, label = "Destacados" }: { badges: Badge[]; label?: string }) {
  if (badges.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {badges.map((b) => (
        <li
          key={b}
          className={`rounded-[var(--sf-radius-control)] px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${BADGE_STYLE[b]}`}
        >
          {BADGE_LABELS[b]}
        </li>
      ))}
    </ul>
  );
}
