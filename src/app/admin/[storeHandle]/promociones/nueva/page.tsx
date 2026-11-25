import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EMPTY_PROMOTION } from "@/lib/promotions/form";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";

import { loadPromotionLimit, loadPromotions, loadTargetOptions } from "../data";
import { PromotionForm } from "../forms";
import { PlanLimitNote } from "../shared";

export const metadata: Metadata = { title: "Nueva promoción" };

type Props = { params: Promise<{ storeHandle: string }> };

export default async function NewPromotionPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "discounts.manage")) notFound();
  const [options, limit, rows] = await Promise.all([
    loadTargetOptions(ctx.store.id),
    loadPromotionLimit(ctx),
    loadPromotions(ctx.store.id),
  ]);
  const base = `/admin/${ctx.store.handle}/promociones`;
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href={base} className="text-fg-muted hover:underline">
            ← Promociones
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Nueva promoción</h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Elige el tipo, a qué productos aplica y, si quieres, las fechas. Abajo ves un ejemplo de
          cuánto paga el cliente antes de guardar.
        </p>
      </header>
      <PlanLimitNote limit={limit} activeHere={rows.filter((r) => r.status === "active").length} />
      <PromotionForm
        storeHandle={ctx.store.handle}
        initial={EMPTY_PROMOTION}
        currency={ctx.store.currency}
        products={options.products}
        categories={options.categories}
        productsTruncated={options.truncated}
      />
    </section>
  );
}
