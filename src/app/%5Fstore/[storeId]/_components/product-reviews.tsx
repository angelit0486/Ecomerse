import type { ProductReviews as Reviews } from "@/server/storefront/catalog";
import type { StorePublic } from "@/server/storefront/store-public";

import { Stars } from "./stars";

const dateLabel = (iso: string, store: StorePublic) =>
  new Date(iso).toLocaleDateString(store.locale ?? "es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: store.timezone,
  });

/**
 * Opiniones verificadas (ADR-029): solo compradores con pedido entregado, cada una
 * revisada por la tienda antes de publicarse. Sin opiniones no se muestra nada.
 */
export function ProductReviews({ reviews, store }: { reviews: Reviews; store: StorePublic }) {
  if (reviews.count === 0 || reviews.average == null) return null;
  const average = reviews.average.toLocaleString("es-MX", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return (
    <section aria-labelledby="sf-opiniones" className="space-y-6">
      <h2
        id="sf-opiniones"
        className="border-t border-[var(--sf-fg)] pt-3 text-2xl font-semibold leading-none tracking-tight sm:text-4xl"
      >
        Opiniones
      </h2>
      <div className="grid gap-8 md:grid-cols-[16rem_1fr]">
        <div className="space-y-3">
          <p className="flex items-baseline gap-2">
            <span className="text-5xl font-semibold tabular-nums leading-none">{average}</span>
            <span className="text-sm text-[var(--sf-muted)]">de 5</span>
          </p>
          <Stars value={reviews.average} className="text-xl" />
          <p className="text-sm text-[var(--sf-muted)]">
            {reviews.count === 1 ? "1 opinión" : `${reviews.count} opiniones`} de compradores
            verificados
          </p>
          <dl className="space-y-1 text-sm">
            {(["5", "4", "3", "2", "1"] as const).map((n) => {
              const count = reviews.distribution[n] ?? 0;
              const pct = Math.round((count / reviews.count) * 100);
              return (
                <div key={n} className="flex items-center gap-2">
                  <dt className="w-16 shrink-0 tabular-nums">
                    {n} {n === "1" ? "estrella" : "estrellas"}
                  </dt>
                  <dd className="flex flex-1 items-center gap-2">
                    {/* SVG y no `style` en línea: la CSP no permite estilos en atributos. */}
                    <svg
                      aria-hidden
                      viewBox="0 0 100 6"
                      preserveAspectRatio="none"
                      className="h-1.5 flex-1"
                    >
                      <rect width="100" height="6" className="fill-[var(--sf-border)]" />
                      <rect width={pct} height="6" className="fill-[var(--sf-fg)]" />
                    </svg>
                    <span className="w-6 text-right tabular-nums text-[var(--sf-muted)]">
                      {count}
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
        <ul className="divide-y divide-[var(--sf-border)] border-y border-[var(--sf-border)]">
          {reviews.items.map((r, i) => (
            <li key={i} className="space-y-2 py-5">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <Stars value={r.rating} />
                <span className="sr-only">
                  {r.rating === 1 ? "1 estrella de 5" : `${r.rating} estrellas de 5`}
                </span>
                <span className="font-medium">{r.author_name}</span>
                <span className="text-[var(--sf-muted)]">
                  Compra verificada · {dateLabel(r.created_at, store)}
                </span>
              </p>
              {r.title ? <h3 className="font-semibold">{r.title}</h3> : null}
              <p className="whitespace-pre-line text-sm leading-relaxed">{r.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
