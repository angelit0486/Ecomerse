import type { Reviewable } from "@/server/storefront/reviews";

import type { ReviewActionState } from "./review-actions";
import { ReviewForm } from "./review-form";

type Action = (state: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;

/**
 * «¿Qué te pareció tu compra?» (ADR-029): solo aparece si la base dice que el
 * pedido ya se puede opinar (pagado y entregado). Compartido por la página del
 * enlace del pedido y la de «Mi cuenta»; cada una liga su propia acción.
 */
export function OrderReviews({
  reviewables,
  actionFor,
}: {
  reviewables: Reviewable[];
  actionFor: (productId: string) => Action;
}) {
  if (reviewables.length === 0) return null;
  return (
    <section aria-labelledby="opinar" className="space-y-4 border-t border-[var(--sf-border)] pt-5">
      <h2 id="opinar" className="font-semibold">
        ¿Qué te pareció tu compra?
      </h2>
      <p className="text-sm text-[var(--sf-muted)]">
        Tu opinión ayuda a otros clientes. Se publica con tu nombre y la inicial de tu apellido,
        después de que la tienda la revise.
      </p>
      <ul className="space-y-6">
        {reviewables.map((r) => (
          <li key={r.product_id} className="space-y-2">
            <h3 className="text-sm font-semibold">{r.title}</h3>
            {r.reviewed ? (
              <p className="text-sm">Ya enviaste tu opinión de este producto. ¡Gracias!</p>
            ) : (
              <ReviewForm action={actionFor(r.product_id)} title={r.title} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
