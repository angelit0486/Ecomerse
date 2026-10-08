import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { centsToInput } from "@/lib/money/format";
import {
  getProduct,
  getProductAttributes,
  getProductRegulatory,
  mediaUrl,
  type Availability,
  type ProductDetail,
} from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";
import { canonicalUrl, excerpt, pageMetadata } from "@/server/storefront/seo";
import type { StorePublic } from "@/server/storefront/store-public";
import { SafeHtml } from "@/ui/safe-html";

import { Breadcrumb } from "../../_components/breadcrumb";
import { AVAILABILITY_LABELS, money } from "../../_components/format";
import { JsonLd } from "../../_components/json-ld";
import { ProductAttributes } from "../../_components/product-attributes";
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

function productJsonLd(store: StorePublic, product: ProductDetail) {
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

export default async function ProductPage({ params }: Props) {
  const { store, product } = await load(params);
  const [regulatory, attributes] = await Promise.all([
    getProductRegulatory(store.id, product.slug),
    getProductAttributes(store.id, product.slug),
  ]);
  const [cover, ...rest] = product.images;
  const single = product.options.length === 0 ? product.variants[0] : undefined;

  return (
    <div className="space-y-6">
      <JsonLd data={productJsonLd(store, product)} />
      <Breadcrumb
        items={[
          { label: "Inicio", href: "/" },
          ...product.breadcrumb.map((c) => ({ label: c.name, href: `/categoria/${c.path}` })),
          { label: product.title },
        ]}
      />
      <div className="grid gap-8 md:grid-cols-2">
        <section aria-label="Imágenes" className="space-y-3">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada servida por Storage
            <img
              src={mediaUrl(cover.path)}
              alt={cover.alt ?? product.title}
              width={cover.width ?? 1024}
              height={cover.height ?? 1024}
              fetchPriority="high"
              className="aspect-square w-full rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] object-cover"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] text-[var(--sf-muted)]">
              Sin imagen
            </div>
          )}
          {rest.length > 0 ? (
            <ul className="grid grid-cols-4 gap-2">
              {rest.map((image) => (
                <li key={image.path}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada */}
                  <img
                    src={mediaUrl(image.path)}
                    alt={image.alt ?? ""}
                    width={image.width ?? 320}
                    height={image.height ?? 320}
                    loading="lazy"
                    className="aspect-square w-full rounded object-cover"
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <section aria-labelledby="sf-producto" className="space-y-5">
          <header className="space-y-1">
            {product.brand ? (
              <p className="text-sm text-[var(--sf-muted)]">{product.brand.name}</p>
            ) : null}
            <h1 id="sf-producto" className="text-2xl font-semibold">
              {product.title}
            </h1>
          </header>
          {single ? (
            <div className="space-y-1">
              <p className="text-xl font-semibold">
                {money(single.price, store)}
                {single.compare_at_price ? (
                  <s className="ml-3 text-base font-normal text-[var(--sf-muted)]">
                    <span className="sr-only">Antes </span>
                    {money(single.compare_at_price, store)}
                  </s>
                ) : null}
              </p>
              <p className="text-sm">{AVAILABILITY_LABELS[single.availability]}</p>
              <AddToCart
                storeId={store.id}
                variantId={single.id}
                available={single.availability !== "out_of_stock"}
              />
            </div>
          ) : product.variants.length > 0 ? (
            <VariantSelector
              storeId={store.id}
              options={product.options}
              variants={product.variants.map((v) => ({
                id: v.id,
                options: parseSignature(v.signature),
                price: money(v.price, store),
                compareAt: v.compare_at_price ? money(v.compare_at_price, store) : null,
                availability: AVAILABILITY_LABELS[v.availability],
                available: v.availability !== "out_of_stock",
                imageUrl: v.image ? mediaUrl(v.image.path) : null,
              }))}
            />
          ) : (
            <p className="text-sm">{AVAILABILITY_LABELS.out_of_stock}</p>
          )}
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
    </div>
  );
}
