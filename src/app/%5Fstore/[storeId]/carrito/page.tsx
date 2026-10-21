import type { Metadata } from "next";
import Link from "next/link";

import { GOAL_KEY } from "@/lib/catalog/attributes";
import { freeShippingProgress } from "@/lib/catalog/merchandising";
import { getCart, getCartLegends } from "@/server/storefront/cart";
import {
  getShippingPromo,
  listFacets,
  listProducts,
  mediaUrl,
  type ProductCard,
  type ShippingPromo,
} from "@/server/storefront/catalog";
import type { StorePublic } from "@/server/storefront/store-public";
import { getStorefront } from "@/server/storefront/context";

import { money } from "../_components/format";
import { GoalTiles } from "../_components/goal-chips";
import { ProductGrid } from "../_components/rated-product-grid";
import { PurchaseLegends } from "../_components/supplement-info";
import { Totals } from "../_components/totals";
import { DiscountForm, LineForm } from "./cart-forms";

export const metadata: Metadata = { title: "Carrito", robots: { index: false, follow: false } };

type Props = { params: Promise<{ storeId: string }> };

const STATE_NOTES = {
  unavailable: "Ya no está disponible: quítalo para continuar.",
  insufficient_stock: "No hay suficientes existencias para esta cantidad.",
} as const;

export default async function CartPage({ params }: Props) {
  const { store } = await getStorefront((await params).storeId);
  const [cart, legends, promo] = await Promise.all([
    getCart(store.id),
    getCartLegends(store.id, "cart"),
    getShippingPromo(store.id),
  ]);

  if (!cart || cart.lines.length === 0) {
    // Carrito vacío con salida clara (revisión de conversión, M10).
    const facets = await listFacets(store.id, {});
    const goals = (facets.find((f) => f.key === GOAL_KEY)?.values ?? [])
      .filter((v) => v.count > 0)
      .map(({ key, label, count }) => ({ key, label, count }));
    return (
      <section className="mx-auto max-w-2xl space-y-5 py-4 text-center">
        <h1 className="text-3xl font-extrabold leading-[1.05] tracking-tight text-balance sm:text-5xl">
          Tu carrito está vacío
        </h1>
        <p className="text-[var(--sf-muted)]">Encuentra lo que necesitas para tu objetivo.</p>
        <Link
          href="/productos"
          className="inline-flex h-12 items-center justify-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-8 font-bold text-[var(--sf-btn-fg)]"
        >
          Ver productos
        </Link>
        <div className="pt-4">
          <GoalTiles goals={goals} compact />
        </div>
      </section>
    );
  }

  // Sugerencias para alcanzar el envío gratis (revisión de conversión, M10): los
  // productos disponibles más baratos que cubren lo que falta y no están en el carrito.
  const progress =
    promo && cart.requires_shipping
      ? freeShippingProgress(cart.subtotal, cart.discount_total, promo.free_over)
      : null;
  const suggestions =
    progress && !progress.reached
      ? await shippingSuggestions(
          store.id,
          progress.remaining,
          new Set(cart.lines.map((l) => l.product_slug)),
        )
      : [];

  return (
    <section className="grid grid-cols-1 gap-6 md:grid-cols-[2fr_1fr] md:gap-8">
      {/* min-w-0: un nombre largo no ensancha la columna en móvil (sin scroll horizontal). */}
      <div className="min-w-0 space-y-4">
        <h1 className="text-3xl font-extrabold leading-[1.05] tracking-tight text-balance sm:text-4xl">
          Tu carrito
        </h1>
        {promo && cart.requires_shipping ? (
          <FreeShippingBar
            promo={promo}
            subtotal={cart.subtotal}
            discountTotal={cart.discount_total}
            store={store}
          />
        ) : null}
        <ul className="space-y-3" aria-label="Productos en el carrito">
          {cart.lines.map((line) => (
            <li
              key={line.variant_id}
              className="flex gap-3 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-3 sm:gap-4"
            >
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-[var(--sf-radius-control)] bg-[var(--sf-surface)] sm:h-24 sm:w-24">
                {line.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada
                  <img
                    src={mediaUrl(line.image.path)}
                    alt=""
                    width={96}
                    height={96}
                    className="h-full w-full object-contain p-1 [mix-blend-mode:var(--sf-photo-blend,multiply)]"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/productos/${line.product_slug}`}
                      className="font-semibold leading-snug hover:underline"
                    >
                      {line.product_title}
                    </Link>
                    {line.variant_title ? (
                      <p className="text-sm text-[var(--sf-muted)]">{line.variant_title}</p>
                    ) : null}
                    <p className="text-sm text-[var(--sf-muted)]">
                      {money(line.unit_price, store)} c/u
                    </p>
                  </div>
                  <p className="shrink-0 font-extrabold tabular-nums [font-family:var(--sf-font-heading),system-ui,sans-serif]">
                    {money(line.line_subtotal ?? line.unit_price * line.quantity, store)}
                  </p>
                </div>
                {line.state !== "ok" ? (
                  <p role="alert" className="text-sm text-[var(--sf-danger)]">
                    {STATE_NOTES[line.state]}
                  </p>
                ) : null}
                <LineForm
                  storeId={store.id}
                  variantId={line.variant_id}
                  title={line.product_title}
                  quantity={line.quantity}
                />
              </div>
            </li>
          ))}
        </ul>
        {suggestions.length > 0 ? (
          <section aria-labelledby="sf-completa" className="space-y-3 pt-4">
            <h2 id="sf-completa" className="text-xl font-extrabold tracking-tight">
              Completa tu envío gratis
            </h2>
            <ProductGrid products={suggestions} store={store} carousel />
          </section>
        ) : null}
      </div>
      <aside
        aria-label="Resumen"
        className="h-fit space-y-5 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-5 md:sticky md:top-36 md:max-h-[calc(100dvh-10rem)] md:self-start md:overflow-y-auto"
      >
        <h2 className="text-lg font-extrabold">Resumen</h2>
        <Totals
          cart={{
            ...cart,
            shippingKnown: cart.shipping.status === "ok" || cart.shipping.status === "not_required",
          }}
          store={store}
        />
        {cart.has_unavailable ? (
          <p className="text-sm">Quita los productos no disponibles para continuar.</p>
        ) : (
          <Link
            href="/checkout"
            className="flex h-12 items-center justify-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] font-bold text-[var(--sf-btn-fg)]"
          >
            Continuar al pago
          </Link>
        )}
        <DiscountForm storeId={store.id} code={cart.discount_code} />
        <PurchaseLegends legends={legends} />
      </aside>
    </section>
  );
}

async function shippingSuggestions(
  storeId: string,
  remaining: number,
  inCart: Set<string>,
): Promise<ProductCard[]> {
  const page = await listProducts(storeId, { sort: "price_asc", available: true, limit: 48 });
  return page.items
    .filter((p) => !inCart.has(p.slug) && p.min_price !== null && p.min_price >= remaining)
    .slice(0, 3);
}

/**
 * «Te faltan $X para el envío gratis» (F9-T04): sale de la regla `free_over`
 * real de la tienda y del subtotal descontado del carrito; sin regla no se
 * muestra. Informativa: el envío lo calcula la base en el pago.
 */
function FreeShippingBar({
  promo,
  subtotal,
  discountTotal,
  store,
}: {
  promo: ShippingPromo;
  subtotal: number;
  discountTotal: number;
  store: StorePublic;
}) {
  const progress = freeShippingProgress(subtotal, discountTotal, promo.free_over);
  if (!progress) return null;
  const where = promo.conditional ? " (según destino)" : "";
  return (
    <div className="space-y-2 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-4 text-sm">
      <p id="sf-envio-gratis" className="font-semibold">
        {progress.reached
          ? `Tu pedido tiene envío gratis${where}.`
          : `Te faltan ${money(progress.remaining, store)} para el envío gratis${where}.`}
      </p>
      {/* <progress> nativo: sin atributo style (la CSP no permite estilos en línea). */}
      <progress
        aria-labelledby="sf-envio-gratis"
        max={100}
        value={progress.percent}
        className="block h-2 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-[var(--sf-btn-bg)] [&::-webkit-progress-bar]:bg-[var(--sf-surface)] [&::-webkit-progress-value]:bg-[var(--sf-btn-bg)]"
      />
    </div>
  );
}
