import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { pricePerServing, productBadges, savings } from "@/lib/catalog/merchandising";
import { leadTimeLabel } from "@/lib/catalog/lead-time";

import { centsToInput } from "@/lib/money/format";
import {
  getProduct,
  getProductAttributes,
  getProductRegulatory,
  getProductReviews,
  getRelatedProducts,
  getShippingPromo,
  mediaUrl,
  type ProductReviews as ProductReviewsData,
  type ShippingPromo,
  type Availability,
  type ProductDetail,
} from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";
import { canonicalUrl, excerpt, pageMetadata } from "@/server/storefront/seo";
import type { StorePublic } from "@/server/storefront/store-public";
import { ThemeSettingsV1, type PaymentMethod } from "@/lib/theme/schema";
import { SafeHtml } from "@/ui/safe-html";

import { Badges } from "../../_components/badges";
import { Breadcrumb } from "../../_components/breadcrumb";
import { AVAILABILITY_LABELS, money } from "../../_components/format";
import { PAYMENT_LABELS } from "../../_components/header";
import { JsonLd } from "../../_components/json-ld";
import { ProductGallery } from "../../_components/product-gallery";
import { ProductGrid } from "../../_components/rated-product-grid";
import { ProductAttributes } from "../../_components/product-attributes";
import { ProductReviews } from "../../_components/product-reviews";
import { SupplementInfo } from "../../_components/supplement-info";
import { AddToCart } from "../../_components/add-to-cart";
import { VariantSelector } from "../../_components/variant-selector";

type Props = { params: Promise<{ storeId: string; slug: string }> };

async function load(params: Props["params"]) {
  const { storeId, slug } = await params;
  const { store, preview } = await getStorefront(storeId);
  const product = await getProduct(store.id, slug);
  if (!product) notFound();
  return { store, preview, product };
}

/** "Color=Negro|Talla=M" → { Color: "Negro", Talla: "M" }. */
function parseSignature(signature: string): Record<string, string> {
  if (!signature) return {};
  return Object.fromEntries(
    signature
      .split("|")
      .map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]),
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, preview, product } = await load(params);
  return pageMetadata({
    store,
    preview,
    path: `/productos/${product.slug}`,
    title: product.seo_title ?? product.title,
    description: product.seo_description ?? excerpt(product.description_html),
    image: product.images[0],
    type: "product",
  });
}

const SCHEMA_AVAILABILITY: Record<Availability, string> = {
  in_stock: "https://schema.org/InStock",
  low_stock: "https://schema.org/LimitedAvailability",
  backorder: "https://schema.org/BackOrder",
  out_of_stock: "https://schema.org/OutOfStock",
};

/** GTIN solo si el código de barras tiene una longitud GTIN válida (8, 12, 13 o 14 dígitos). */
function gtin(barcode: string | null): string | undefined {
  return barcode && /^(\d{8}|\d{12,14})$/.test(barcode) ? barcode : undefined;
}

function productJsonLd(
  store: StorePublic,
  product: ProductDetail,
  reviews: ProductReviewsData | null,
) {
  const url = canonicalUrl(store, `/productos/${product.slug}`);
  const prices = product.variants.map((v) => v.price);
  const single = product.variants.length === 1 ? product.variants[0] : undefined;
  // Sin variantes vendibles no hay oferta (Math.min de [] = Infinity rompería BigInt).
  const offers = !prices.length
    ? undefined
    : single
      ? {
          "@type": "Offer",
          price: centsToInput(single.price),
          priceCurrency: store.currency,
          availability: SCHEMA_AVAILABILITY[single.availability],
          itemCondition: "https://schema.org/NewCondition",
          url,
        }
      : {
          "@type": "AggregateOffer",
          lowPrice: centsToInput(Math.min(...prices)),
          highPrice: centsToInput(Math.max(...prices)),
          offerCount: product.variants.length,
          priceCurrency: store.currency,
          availability: SCHEMA_AVAILABILITY[product.availability],
          url,
        };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name: product.title,
        url,
        ...(product.images.length > 0
          ? { image: product.images.map((i) => mediaUrl(i.path)) }
          : {}),
        ...(excerpt(product.description_html, 5000)
          ? { description: excerpt(product.description_html, 5000) }
          : {}),
        ...(single?.sku ? { sku: single.sku } : {}),
        ...(gtin(single?.barcode ?? null) ? { gtin: gtin(single?.barcode ?? null) } : {}),
        ...(product.brand ? { brand: { "@type": "Brand", name: product.brand.name } } : {}),
        ...(offers ? { offers } : {}),
        // Solo con opiniones reales y publicadas (GATE0 §25; ADR-029).
        ...(reviews && reviews.count > 0 && reviews.average != null
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: reviews.average,
                reviewCount: reviews.count,
                bestRating: 5,
                worstRating: 1,
              },
              review: reviews.items.map((r) => ({
                "@type": "Review",
                author: { "@type": "Person", name: r.author_name },
                datePublished: r.created_at.slice(0, 10),
                reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 },
                ...(r.title ? { name: r.title } : {}),
                reviewBody: r.body,
              })),
            }
          : {}),
      },
      ...(product.breadcrumb.length > 0
        ? [
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                ...product.breadcrumb.map((c, i) => ({
                  "@type": "ListItem",
                  position: i + 1,
                  name: c.name,
                  item: canonicalUrl(store, `/categoria/${c.path}`),
                })),
                {
                  "@type": "ListItem",
                  position: product.breadcrumb.length + 1,
                  name: product.title,
                  item: url,
                },
              ],
            },
          ]
        : []),
    ],
  };
}

/** "Ahorras $200.00 (20 %)"; sin el porcentaje si es menor a 1 %. */
function savingText(price: number, compareAt: number | null, store: StorePublic): string | null {
  const s = savings(price, compareAt);
  if (!s) return null;
  return `Ahorras ${money(s.amount, store)}${s.percent >= 1 ? ` (${s.percent} %)` : ""}`;
}

/** Espacio para contenido que la tienda aún no tiene (D-F9-09): solo en la vista previa. */
function PendingContent({ title, text }: { title: string; text: string }) {
  return (
    <section
      aria-label={title}
      className="rounded-[var(--sf-radius-card)] border-2 border-dashed border-[var(--sf-border-strong)] p-5 text-sm"
    >
      <p className="font-semibold">{title}: pendiente de contenido real</p>
      <p className="text-[var(--sf-muted)]">{text}</p>
    </section>
  );
}

export default async function ProductPage({ params }: Props) {
  const { store, preview, product } = await load(params);
  const [regulatory, attributes, related, shipping, reviews] = await Promise.all([
    getProductRegulatory(store.id, product.slug),
    getProductAttributes(store.id, product.slug),
    getRelatedProducts(store.id, product.slug),
    getShippingPromo(store.id),
    getProductReviews(store.id, product.id),
  ]);
  const parsed = ThemeSettingsV1.safeParse(store.theme?.settings ?? {});
  const settings = parsed.success ? parsed.data : {};
  const payments = settings.footer?.payment_methods ?? [];
  const whatsapp = settings.contact?.whatsapp;
  const single = product.options.length === 0 ? product.variants[0] : undefined;
  const cheapest = product.variants.reduce<(typeof product.variants)[number] | undefined>(
    (min, v) => (!min || v.price < min.price ? v : min),
    undefined,
  );
  const badges = productBadges({
    price: cheapest?.price ?? null,
    compareAt: cheapest?.compare_at_price,
    availability: product.availability,
    publishedAt: product.published_at,
    launchedAt: store.launched_at,
    now: new Date(),
  });
  // Precio por porción: las porciones de la presentación (ADR-026) o, sin
  // variantes, las de la ficha sanitaria. Con una sola porción el precio por
  // porción es el precio: no se muestra.
  const singleServings =
    single?.servings_per_container ?? regulatory?.data.servings_per_container ?? null;
  const perServing =
    single && (singleServings ?? 0) > 1 ? pricePerServing(single.price, singleServings) : null;
  /** «2 kg · $15.15 por porción (66 porciones)» de una presentación; null sin datos. */
  const servingLine = (v: (typeof product.variants)[number]): string | null => {
    const per =
      (v.servings_per_container ?? 0) > 1
        ? pricePerServing(v.price, v.servings_per_container)
        : null;
    const parts = [
      v.net_content ?? null,
      per !== null
        ? `${money(per, store)} por porción (${v.servings_per_container} porciones)`
        : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : null;
  };
  const gallery = product.images.map((image) => ({
    src: mediaUrl(image.path),
    alt: image.alt ?? product.title,
    width: image.width ?? 1024,
    height: image.height ?? 1024,
  }));

  return (
    <div className="space-y-6 md:space-y-12">
      <JsonLd data={productJsonLd(store, product, reviews)} />
      <Breadcrumb
        items={[
          { label: "Inicio", href: "/" },
          ...product.breadcrumb.map((c) => ({ label: c.name, href: `/categoria/${c.path}` })),
          { label: product.title },
        ]}
      />
      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        {/* En escritorio la galería acompaña al bajar por la información (pulido visual). */}
        <section aria-label="Imágenes" className="md:sticky md:top-36 md:self-start">
          <ProductGallery images={gallery} title={product.title} />
        </section>
        <section aria-labelledby="sf-producto" className="space-y-5">
          <header className="space-y-2">
            <Badges badges={badges} />
            {product.brand ? (
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sf-muted)]">
                <Link
                  href={`/marca/${encodeURIComponent(product.brand.slug)}`}
                  className="hover:underline"
                >
                  {product.brand.name}
                </Link>
              </p>
            ) : null}
            <h1
              id="sf-producto"
              className="text-3xl font-bold leading-[1.05] tracking-tight text-balance sm:text-5xl"
            >
              {product.title}
            </h1>
            {reviews && reviews.count > 0 && reviews.average != null ? (
              <a
                href="#sf-opiniones"
                className="inline-flex min-h-11 items-center gap-2 text-sm underline-offset-4 hover:underline"
              >
                <span aria-hidden className="text-[var(--sf-fg)]">
                  ★
                </span>
                <span className="font-medium tabular-nums">
                  {reviews.average.toLocaleString("es-MX", {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                  <span className="sr-only"> de 5</span>
                </span>
                <span className="text-[var(--sf-muted)]">
                  ({reviews.count === 1 ? "1 opinión" : `${reviews.count} opiniones`})
                </span>
              </a>
            ) : null}
          </header>
          {single ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-3xl font-semibold tabular-nums tracking-tight">
                  {money(single.price, store)}
                  {single.compare_at_price && single.compare_at_price > single.price ? (
                    <s className="ml-3 text-base font-normal text-[var(--sf-muted)]">
                      <span className="sr-only">Antes </span>
                      {money(single.compare_at_price, store)}
                    </s>
                  ) : null}
                </p>
                {savingText(single.price, single.compare_at_price, store) ? (
                  <p className="text-sm font-semibold text-[var(--sf-sale-text)]">
                    {savingText(single.price, single.compare_at_price, store)}
                  </p>
                ) : null}
                {perServing !== null ? (
                  <p className="text-sm text-[var(--sf-muted)]">
                    {single.net_content ? `${single.net_content} · ` : ""}
                    {money(perServing, store)} por porción ({singleServings} porciones)
                  </p>
                ) : null}
                <p className="text-sm">
                  {availabilityText(single.availability, single.ships_in_days)}
                </p>
              </div>
              <AddToCart
                storeId={store.id}
                variantId={single.id}
                available={single.availability !== "out_of_stock"}
                title={product.title}
                price={money(single.price, store)}
              />
            </div>
          ) : product.variants.length > 0 ? (
            <VariantSelector
              storeId={store.id}
              title={product.title}
              options={product.options}
              variants={product.variants.map((v) => ({
                id: v.id,
                options: parseSignature(v.signature),
                price: money(v.price, store),
                compareAt:
                  v.compare_at_price && v.compare_at_price > v.price
                    ? money(v.compare_at_price, store)
                    : null,
                saving: savingText(v.price, v.compare_at_price, store),
                availability: availabilityText(v.availability, v.ships_in_days),
                available: v.availability !== "out_of_stock",
                imageUrl: v.image ? mediaUrl(v.image.path) : null,
                serving: servingLine(v),
              }))}
            />
          ) : (
            <p className="text-sm">{AVAILABILITY_LABELS.out_of_stock}</p>
          )}
          <PurchaseInfo
            store={store}
            shipping={shipping}
            payments={payments}
            whatsapp={whatsapp}
            productTitle={product.title}
          />
          <ProductAttributes attributes={attributes} />
          {product.description_html ? (
            <section aria-label="Descripción" className="border-t border-[var(--sf-border)] pt-5">
              <SafeHtml
                html={product.description_html}
                className="sf-prose space-y-3 text-sm leading-relaxed"
              />
            </section>
          ) : null}
          {regulatory ? <SupplementInfo info={regulatory} /> : null}
        </section>
      </div>
      {reviews && reviews.count > 0 ? (
        <ProductReviews reviews={reviews} store={store} />
      ) : preview ? (
        <PendingContent
          title="Opiniones"
          text="Aquí irán las opiniones verificadas de compradores reales. Solo tú ves este espacio en la vista previa; tus clientes no lo ven."
        />
      ) : null}
      {related.length > 0 ? (
        <section aria-labelledby="sf-relacionados" className="space-y-6">
          <h2
            id="sf-relacionados"
            className="border-t border-[var(--sf-fg)] pt-3 text-2xl font-semibold leading-none tracking-tight sm:text-4xl"
          >
            Más para tu objetivo
          </h2>
          <ProductGrid products={related} store={store} />
        </section>
      ) : null}
    </div>
  );
}

/** «Disponible · Se prepara en 2 a 4 días antes de enviarse» (ADR-025 §5). */
function availabilityText(
  availability: keyof typeof AVAILABILITY_LABELS,
  shipsIn: { min: number; max: number } | null | undefined,
): string {
  const lead = availability === "out_of_stock" ? null : leadTimeLabel(shipsIn);
  return lead
    ? `${AVAILABILITY_LABELS[availability]} · ${lead}`
    : AVAILABILITY_LABELS[availability];
}

/** «2–5 días» o «3 días» (mismo formato que el checkout). */
function deliveryDays(min: number, max: number): string {
  return min === max ? `${min} ${min === 1 ? "día" : "días"}` : `${min}–${max} días`;
}

/** Envío gratis real, formas de pago declaradas y WhatsApp (F9-DESIGN §9): nunca texto fijo. */
function PurchaseInfo({
  store,
  shipping,
  payments,
  whatsapp,
  productTitle,
}: {
  store: StorePublic;
  shipping: ShippingPromo | null;
  payments: PaymentMethod[];
  whatsapp: string | undefined;
  productTitle: string;
}) {
  if (!shipping && payments.length === 0 && !whatsapp) return null;
  const message = encodeURIComponent(`Hola, tengo una duda sobre ${productTitle}.`);
  return (
    <ul className="divide-y divide-[var(--sf-border)] border-y border-[var(--sf-border)] text-sm [&>li]:py-3">
      {shipping ? (
        <li>
          <span className="font-semibold">Envío gratis</span> en compras desde{" "}
          {money(shipping.free_over, store)}
          {shipping.conditional ? " (según destino)" : ""}.
          {/* Costo y tiempo de la misma tarifa (revisión de conversión, M3): datos de la tienda. */}
          {shipping.price > 0 ? ` Si no, ${money(shipping.price, store)}.` : null}
          {shipping.est_days_min != null && shipping.est_days_max != null
            ? ` Llega en ${deliveryDays(shipping.est_days_min, shipping.est_days_max)}.`
            : null}
        </li>
      ) : null}
      {payments.length > 0 ? (
        <li>
          <span className="font-semibold">Paga con</span>{" "}
          {payments.map((m) => PAYMENT_LABELS[m]).join(", ")}.
        </li>
      ) : null}
      {whatsapp ? (
        <li>
          ¿Dudas?{" "}
          <a
            href={`https://wa.me/${whatsapp.slice(1)}?text=${message}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-4"
          >
            Escríbenos por WhatsApp
          </a>
        </li>
      ) : null}
    </ul>
  );
}
