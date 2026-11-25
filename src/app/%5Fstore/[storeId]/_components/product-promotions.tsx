import { promotionDetails, type StorefrontPromotion } from "@/lib/promotions/storefront";

/**
 * Promociones de la ficha (ADR-070, fase 3): la leyenda de la tienda, qué pide
 * la regla y, en mayoreo, cada escalón. Solo explica: el descuento lo calcula el
 * carrito con lo que el comprador lleva. Colores del texto y del borde del tema
 * (sin acentos), para que se lea igual en cualquier look, también Nocturno.
 */
export function ProductPromotions({
  promotions,
  currency,
}: {
  promotions: StorefrontPromotion[] | undefined;
  currency: string;
}) {
  const details = promotionDetails(promotions, currency);
  if (details.length === 0) return null;
  return (
    <section
      aria-labelledby="sf-promociones"
      className="sf-pdp-promos space-y-2 rounded-[var(--sf-radius-card)] border border-[var(--sf-border-strong)] p-3 text-[var(--sf-fg)]"
    >
      <h2 id="sf-promociones" className="text-sm font-bold">
        {details.length === 1 ? "Promoción" : "Promociones"}
      </h2>
      <ul className="space-y-2 text-sm">
        {details.map((d) => (
          <li key={d.id}>
            <p className="font-semibold">{d.label}</p>
            {d.summary !== d.label ? <p>{d.summary}</p> : null}
            {d.tiers.length > 0 ? (
              <ul
                aria-label={`Escalones de ${d.label}`}
                className="mt-1 list-disc pl-5 tabular-nums"
              >
                {d.tiers.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-xs text-[var(--sf-muted)]">
        El descuento se aplica solo en el carrito al llevar las piezas.
        {details.length > 1 ? " Si aplican varias, te damos la que más te ahorra." : ""}
      </p>
    </section>
  );
}
