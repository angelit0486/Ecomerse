import { money } from "./format";

/**
 * Ahorro por promociones de una línea del carrito o de una partida del pedido
 * (ADR-070): leyenda y monto calculados por la base. Color de «oferta» del tema
 * (contraste garantizado en cada look, también Nocturno).
 */
export function LinePromotions({
  notes,
  store,
  className = "",
}: {
  notes: { label: string; amount: number }[];
  store: { currency: string; locale: string };
  className?: string;
}) {
  if (notes.length === 0) return null;
  return (
    <ul className={`text-sm font-semibold text-[var(--sf-sale-text)] ${className}`}>
      {notes.map((n, i) => (
        <li key={`${n.label}-${i}`}>
          {n.label}: −{money(n.amount, store)}
        </li>
      ))}
    </ul>
  );
}

/** Partida de un pedido: sus leyendas (copia del pedido) y su ahorro total. */
export function orderItemPromotionNotes(item: {
  promotion_allocation?: number | null;
  promotion_labels?: string[] | null;
}): { label: string; amount: number }[] {
  const amount = item.promotion_allocation ?? 0;
  if (!Number.isSafeInteger(amount) || amount <= 0) return [];
  const labels = (item.promotion_labels ?? []).filter(Boolean);
  return [{ label: labels.length > 0 ? labels.join(" + ") : "Promoción", amount }];
}
