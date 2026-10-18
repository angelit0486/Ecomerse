/**
 * Borradores en la vista previa de la tienda (ADR-032): solo la dueña los ve, y
 * nunca se pueden comprar. La insignia va en la tarjeta y en la ficha; el aviso
 * ocupa el lugar de los botones de compra.
 */
export function UnpublishedBadge() {
  return (
    <p className="inline-block rounded-[min(var(--sf-radius),6px)] border border-dashed border-[var(--sf-fg)] bg-[var(--sf-bg)] px-2 py-0.5 text-xs font-bold text-[var(--sf-fg)]">
      Sin publicar
    </p>
  );
}

export function UnpublishedNotice() {
  return (
    <div
      role="note"
      className="rounded-[var(--sf-radius-card)] border-2 border-dashed border-[var(--sf-border-strong)] p-4 text-sm"
    >
      <p className="font-semibold">Sin publicar</p>
      <p className="mt-1 text-[var(--sf-muted)]">
        Solo tú ves este producto en la vista previa. Tus clientes no lo ven ni lo pueden comprar
        hasta que lo publiques desde el panel.
      </p>
    </div>
  );
}
