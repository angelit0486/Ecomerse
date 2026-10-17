import Link from "next/link";

import { pricePerServing, productBadges, savings } from "@/lib/catalog/merchandising";
import { mediaUrl, type ProductCard as Card } from "@/server/storefront/catalog";

import { Badges } from "./badges";
import { AVAILABILITY_LABELS, money } from "./format";

export function ProductGrid({
  products,
  store,
  eager = 0,
  carousel = false,
}: {
  products: Card[];
  store: { currency: string; locale: string; launched_at?: string | null };
  /** Cuántas imágenes cargar sin lazy (las de arriba, para el LCP). */
  eager?: number;
  /**
   * En móvil, una fila que se desplaza en horizontal (portada, revisión M9): sin
   * tarjetas huérfanas cuando el número de productos es impar.
   */
  carousel?: boolean;
}) {
  const now = new Date();
  // Siempre 4 columnas en escritorio: con 3 productos, tarjetas gigantes se ven peor que un hueco.
  const desktop = "sm:grid-cols-3 lg:grid-cols-4";
  return (
    <ul
      className={
        carousel
          ? `-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:gap-x-5 sm:gap-y-10 sm:overflow-visible sm:px-0 sm:pb-0 ${desktop}`
          : `grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-5 ${desktop}`
      }
    >
      {products.map((product, index) => (
        <li
          key={product.id}
          className={carousel ? "w-[46%] shrink-0 snap-start sm:w-auto" : undefined}
        >
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
  store: { currency: string; locale: string; launched_at?: string | null };
  eager: boolean;
  now: Date;
}) {
  // Las mismas insignias que la ficha (F9-T04): una sola función.
  const badges = productBadges({
    price: product.min_price,
    compareAt: product.compare_at_price,
    availability: product.availability,
    publishedAt: product.published_at,
    launchedAt: store.launched_at,
    now,
  });
  const ranged =
    product.min_price !== null &&
    product.max_price !== null &&
    product.max_price > product.min_price;
  // Descuento y precio por porción solo con un precio único (como la ficha): con
  // variantes de distinto precio no hay un número honesto que mostrar.
  const price = !ranged ? product.min_price : null;
  const sale = price !== null ? savings(price, product.compare_at_price) : null;
  // Con una sola porción el «precio por porción» es el precio: no aporta nada.
  const perServing =
    price !== null && (product.servings ?? 0) > 1 ? pricePerServing(price, product.servings) : null;
  return (
    // `relative`: los textos sr-only (absolutos) quedan dentro de la tarjeta y del
    // carrusel; sin él escapaban al viewport y abrían scroll horizontal en móvil.
    <article className="group relative flex h-full flex-col">
      <Link
        href={`/productos/${product.slug}`}
        className="flex flex-col focus-visible:outline-2 focus-visible:outline-[var(--sf-primary)]"
      >
        <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)]">
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
              className={`h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] ${product.availability === "out_of_stock" ? "opacity-55 grayscale" : ""}`}
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
        {/* Marca como antetítulo: en suplementos es lo primero que se busca con la vista. */}
        {product.brand ? (
          <p className="mt-3 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[var(--sf-muted)]">
            {product.brand}
          </p>
        ) : null}
        <h3
          className={`sf-text-font text-[0.9375rem] font-medium leading-snug decoration-1 underline-offset-4 group-hover:underline ${product.brand ? "mt-1" : "mt-3"}`}
        >
          {product.title}
        </h3>
      </Link>
      {product.min_price !== null ? (
        // Partes separadas con flex-wrap: sin espacios entre elementos JSX la línea
        // no se puede partir y desbordaba la tarjeta en móvil.
        <p className="mt-auto flex flex-wrap items-baseline gap-x-2 pt-2 text-sm tabular-nums">
          <span className="font-semibold">
            {ranged ? "Desde " : null}
            {money(product.min_price, store)}
          </span>
          {product.compare_at_price ? (
            <s className="text-[var(--sf-muted)]">
              <span className="sr-only">Antes </span>
              {money(product.compare_at_price, store)}
            </s>
          ) : null}
          {sale && sale.percent >= 1 ? (
            <span className="whitespace-nowrap font-semibold text-[var(--sf-sale-text)]">
              <span className="sr-only">Ahorras </span>−{sale.percent}&nbsp;%
            </span>
          ) : null}
        </p>
      ) : null}
      {perServing !== null ? (
        <p className="mt-0.5 text-xs tabular-nums text-[var(--sf-muted)]">
          {money(perServing, store)} por porción · {product.servings} porciones
        </p>
      ) : null}
      {product.availability === "backorder" ? (
        <p className="text-xs text-[var(--sf-muted)]">
          {AVAILABILITY_LABELS[product.availability]}
        </p>
      ) : null}
    </article>
  );
}
