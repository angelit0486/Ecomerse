const STAR = "m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z";

/**
 * Cinco estrellas decorativas (aria-hidden): la calificación siempre va también
 * en texto junto a ellas. Redondeo a la estrella más cercana, como el promedio
 * publicado de las opiniones (ADR-029).
 */
export function Stars({ value, className = "" }: { value: number; className?: string }) {
  const full = Math.min(5, Math.max(0, Math.round(value)));
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 gap-px ${className}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          className={`h-[1em] w-[1em] ${i < full ? "fill-[#f2a900]" : "fill-[var(--sf-border)]"}`}
        >
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}
