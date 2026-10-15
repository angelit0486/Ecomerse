import Link from "next/link";

import { productBadges } from "@/lib/catalog/merchandising";
import { mediaUrl, type ProductCard as Card } from "@/server/storefront/catalog";

import { Badges } from "./badges";
import { AVAILABILITY_LABELS, money } from "./format";

export function ProductGrid({
  products,
  store,
  eager = 0,
}: {
  products: Card[];
  store: { currency: string; locale: string };
  /** Cuántas imágenes cargar sin lazy (las de arriba, para el LCP). */
  eager?: number;
}) {
  const now = new Date();
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard product={product} store={store} eager={index < eager} now={now} />
        </li>
      ))}
    </ul>
  );
}

function ProductCard({
  product,
  store,
  eager,
  now,
}: {
  product: Card;
  store: { currency: string; locale: string };
  eager: boolean;
  now: Date;
}) {
  // Las mismas insignias que la ficha (F9-T04): una sola función.
  const badges = productBadges({
    price: product.min_price,
    compareAt: product.compare_at_price,
    availability: product.availability,
    publishedAt: product.published_at,
    now,
  });
  const ranged =
    product.min_price !== null &&
    product.max_price !== null &&
    product.max_price > product.min_price;
  return (
    <article className="group flex h-full flex-col gap-2">
      <Link
        href={`/productos/${product.slug}`}
        className="flex flex-col gap-2 focus-visible:outline-2 focus-visible:outline-[var(--sf-primary)]"
      >
        <div className="relative aspect-square overflow-hidden rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)]">
          {badges.length > 0 ? (
            <div className="absolute left-2 top-2 z-[1]">
              <Badges badges={badges} label={`Destacados de ${product.title}`} />
            </div>
          ) : null}
          {product.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada servida por Storage
            <img
              src={mediaUrl(product.image.path)}
              alt={product.image.alt ?? product.title}
              width={product.image.width ?? 640}
              height={product.image.height ?? 640}
              loading={eager ? "eager" : "lazy"}
              decoding="async"
              {...(eager ? { fetchPriority: "high" as const } : {})}
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-full items-center justify-center text-sm text-[var(--sf-muted)]"
            >
              Sin imagen
            </div>
          )}
        </div>
        <h3 className="sf-text-font text-sm font-medium leading-snug">{product.title}</h3>
      </Link>
      {product.brand ? <p className="text-xs text-[var(--sf-muted)]">{product.brand}</p> : null}
      <p className="mt-auto text-sm">
        {product.min_price !== null ? (
          <>
            {ranged ? "Desde " : null}
            <span className="font-semibold">{money(product.min_price, store)}</span>
            {product.compare_at_price ? (
              <s className="ml-2 text-[var(--sf-muted)]">
                <span className="sr-only">Antes </span>
                {money(product.compare_at_price, store)}
              </s>
            ) : null}
          </>
        ) : null}
      </p>
      {product.availability === "backorder" ? (
        <p className="text-xs text-[var(--sf-muted)]">
          {AVAILABILITY_LABELS[product.availability]}
        </p>
      ) : null}
    </article>
  );
}
