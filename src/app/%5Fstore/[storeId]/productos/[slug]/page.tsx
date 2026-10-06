import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getProduct, mediaUrl } from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";
import { SafeHtml } from "@/ui/safe-html";

import { Breadcrumb } from "../../_components/breadcrumb";
import { AVAILABILITY_LABELS, money } from "../../_components/format";
import { VariantSelector } from "../../_components/variant-selector";

type Props = { params: Promise<{ storeId: string; slug: string }> };

async function load(params: Props["params"]) {
  const { storeId, slug } = await params;
  const { store } = await getStorefront(storeId);
  const product = await getProduct(store.id, slug);
  if (!product) notFound();
  return { store, product };
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
  const { store, product } = await load(params);
  return {
    title: { absolute: `${product.seo_title ?? product.title} · ${store.name}` },
    ...(product.seo_description ? { description: product.seo_description } : {}),
  };
}

export default async function ProductPage({ params }: Props) {
  const { store, product } = await load(params);
  const [cover, ...rest] = product.images;
  const single = product.options.length === 0 ? product.variants[0] : undefined;

  return (
    <div className="space-y-6">
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
            </div>
          ) : product.variants.length > 0 ? (
            <VariantSelector
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
          <p className="text-sm text-[var(--sf-muted)]">
            La compra en línea estará disponible muy pronto.
          </p>
          {product.description_html ? (
            <section aria-label="Descripción" className="border-t border-[var(--sf-border)] pt-5">
              <SafeHtml
                html={product.description_html}
                className="sf-prose space-y-3 text-sm leading-relaxed"
              />
            </section>
          ) : null}
        </section>
      </div>
    </div>
  );
}
