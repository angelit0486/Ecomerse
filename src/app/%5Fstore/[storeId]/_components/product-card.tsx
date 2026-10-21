import Link from "next/link";

import { pricePerServing, productBadges, savings } from "@/lib/catalog/merchandising";
import {
  mediaUrl,
  type CardVariants,
  type ProductCard as Card,
  type RatingSummaries,
} from "@/server/storefront/catalog";

import { Badges } from "./badges";
import { AVAILABILITY_LABELS, money } from "./format";
import { QuickAdd } from "./quick-add";
import { Stars } from "./stars";
import { UnpublishedBadge } from "./unpublished";

export function ProductGrid({
  products,
  store,
  eager = 0,
  carousel = false,
  ratings = {},
  quickAdd = {},
}: {
  products: Card[];
  /** Calificaciones reales por producto (opiniones publicadas, ADR-029). */
  ratings?: RatingSummaries;
  /** Variante de «Agregar» por producto (rediseño A+B); sin clave, sin botón. */
  quickAdd?: CardVariants;
  store: { id?: string; currency: string; locale: string; launched_at?: string | null };
  /** Cuántas imágenes cargar sin lazy (las de arriba, para el LCP). */
  eager?: number;
  /**
   * En móvil, una fila que se desplaza en horizontal (portada, revisión M9): sin
   * tarjetas huérfanas cuando el número de productos es impar.
   */
  carousel?: boolean | "always";
}) {
  const now = new Date();
  // Siempre 4 columnas en escritorio: con 3 productos, tarjetas gigantes se ven peor que un hueco.
  const desktop = "sm:grid-cols-3 lg:grid-cols-4";
  return (
    <ul
      className={
        carousel === "always"
          ? "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:gap-4"
          : carousel
            ? `-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 ${desktop}`
            : `sf-grid grid grid-cols-2 gap-3 sm:gap-4 ${desktop}`
      }
    >
      {products.map((product, index) => (
        <li
          key={product.id}
          className={
            carousel === "always"
              ? "w-[46%] shrink-0 snap-start sm:w-[30%] lg:w-[23%]"
              : carousel
                ? "w-[46%] shrink-0 snap-start sm:w-auto"
                : undefined
          }
        >
          <ProductCard
            product={product}
            store={store}
            eager={index < eager}
            now={now}
            rating={ratings[product.id]}
            variant={quickAdd[product.id]}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Tarjeta de anaquel (rediseño A+B): foto sobre gris de anaquel, una insignia,
 * marca, nombre, calificación real, precio (rojo solo con descuento real) y
 * «Agregar». Con opciones, «Elegir opción» lleva a la ficha. Un borrador (solo
 * en la vista previa, ADR-032) lleva «Sin publicar» y ningún botón de compra.
 */
function ProductCard({
  product,
  store,
  eager,
  now,
  rating,
  variant,
}: {
  product: Card;
  store: { id?: string; currency: string; locale: string; launched_at?: string | null };
  eager: boolean;
  now: Date;
  rating?: { average: number; count: number } | undefined;
  /** string: se agrega directo; null: hay que elegir opción; undefined: sin botón. */
  variant: string | null | undefined;
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
  const soldOut = product.availability === "out_of_stock";
  const href = `/productos/${product.slug}`;
  return (
    // `relative`: los textos sr-only (absolutos) quedan dentro de la tarjeta y del
    // carrusel; sin él escapaban al viewport y abrían scroll horizontal en móvil.
    <article className="group relative flex h-full flex-col rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] bg-[var(--sf-bg)] p-2.5 shadow-[var(--sf-shadow-card)] sm:p-3">
      <Link
        href={href}
        className="flex flex-col rounded-[var(--sf-radius-control)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-primary)]"
      >
        <div className="relative aspect-square overflow-hidden rounded-[var(--sf-radius-control)] bg-[var(--sf-surface)]">
          {product.unpublished || badges.length > 0 ? (
            <div className="absolute left-2 top-2 z-[1] flex flex-col items-start gap-1.5">
              {product.unpublished ? <UnpublishedBadge /> : null}
              <Badges
                badges={badges}
                label={`Destacados de ${product.title}`}
                salePercent={sale?.percent ?? null}
              />
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
              // Multiplicar: el fondo blanco de una foto de producto toma el gris del anaquel.
              className={`h-full w-full object-contain p-1.5 [mix-blend-mode:var(--sf-photo-blend,multiply)] motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out motion-safe:group-hover:scale-[1.04] ${soldOut ? "opacity-55 grayscale" : ""}`}
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
        {product.brand ? (
          <p className="sf-card-brand mt-2.5 truncate text-xs text-[var(--sf-muted)]">
            {product.brand}
          </p>
        ) : null}
        <h3
          className={`sf-text-font line-clamp-2 text-[0.9375rem] font-semibold leading-snug decoration-1 underline-offset-4 group-hover:underline ${product.brand ? "mt-0.5" : "mt-2.5"}`}
        >
          {product.title}
        </h3>
        {(product.servings ?? 0) > 1 ? (
          <p className="mt-0.5 text-xs text-[var(--sf-muted)]">{product.servings} porciones</p>
        ) : null}
      </Link>
      {rating && rating.count > 0 ? (
        <p className="mt-1 flex items-center gap-1 text-xs tabular-nums">
          <Stars value={rating.average} className="text-[0.8125rem]" />
          <span className="font-medium">
            {rating.average.toLocaleString("es-MX", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}
          </span>
          <span className="text-[var(--sf-muted)]">
            ({rating.count}
            <span className="sr-only"> {rating.count === 1 ? "opinión" : "opiniones"}</span>)
          </span>
        </p>
      ) : null}
      {product.min_price !== null ? (
        // Partes separadas con flex-wrap: sin espacios entre elementos JSX la línea
        // no se puede partir y desbordaba la tarjeta en móvil.
        <p className="mt-auto flex flex-wrap items-baseline gap-x-2 pt-2 tabular-nums">
          <span
            className={`text-lg font-extrabold leading-tight tracking-tight [font-family:var(--sf-font-heading),system-ui,sans-serif] ${sale ? "text-[var(--sf-sale-text)]" : ""}`}
          >
            {ranged ? <span className="text-sm font-semibold">Desde </span> : null}
            {money(product.min_price, store)}
          </span>
          {product.compare_at_price ? (
            <s className="text-xs text-[var(--sf-muted)]">
              <span className="sr-only">Antes </span>
              {money(product.compare_at_price, store)}
            </s>
          ) : null}
        </p>
      ) : null}
      {perServing !== null ? (
        <p className="mt-0.5 text-xs tabular-nums text-[var(--sf-muted)]">
          {money(perServing, store)} por porción
        </p>
      ) : null}
      {product.availability === "backorder" ? (
        <p className="mt-0.5 text-xs text-[var(--sf-muted)]">
          {AVAILABILITY_LABELS[product.availability]}
        </p>
      ) : null}
      {product.unpublished || soldOut || variant === undefined || !store.id ? null : variant ? (
        <QuickAdd storeId={store.id} variantId={variant} title={product.title} />
      ) : (
        // Mismo destino que el enlace de la tarjeta: para el lector de pantalla y el
        // teclado sería un enlace repetido, así que solo es una ayuda visual.
        <Link
          href={href}
          aria-hidden="true"
          tabIndex={-1}
          className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-[var(--sf-radius-btn)] border-2 border-[var(--sf-primary)] px-3 text-sm font-semibold text-[var(--sf-link)]"
        >
          Elegir opción
        </Link>
      )}
    </article>
  );
}
