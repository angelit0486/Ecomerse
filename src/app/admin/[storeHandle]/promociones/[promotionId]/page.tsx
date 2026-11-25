import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { promotionToFormValues } from "@/lib/promotions/form";
import { describePromotion, promotionRules } from "@/lib/promotions/rules";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";

import { loadPromotion, loadTargetOptions } from "../data";
import { PromotionForm, PromotionStatusButtons } from "../forms";
import { STATUS_LABEL, day, scopeText, windowText } from "../shared";

export const metadata: Metadata = { title: "Promoción" };

type Props = {
  params: Promise<{ storeHandle: string; promotionId: string }>;
  searchParams: Promise<{ creada?: string }>;
};

export default async function PromotionPage({ params, searchParams }: Props) {
  const { storeHandle, promotionId } = await params;
  const { creada } = await searchParams;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "discounts.read")) notFound();
  const canEdit = hasPermission(ctx, "discounts.manage");
  const row = await loadPromotion(ctx.store.id, promotionId);
  if (!row) notFound();
  const base = `/admin/${ctx.store.handle}/promociones`;
  const { currency, timezone } = ctx.store;
  const parsed = promotionRules.safeParse({ type: row.type, rules: row.rules });

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm">
          <Link href={base} className="text-fg-muted hover:underline">
            ← Promociones
          </Link>
        </p>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl font-semibold">{row.name}</h1>
          <span className="rounded-full border border-border px-2 text-xs">
            {STATUS_LABEL[row.status] ?? row.status}
          </span>
        </div>
        <p className="text-sm">
          <strong>{row.label}</strong> ·{" "}
          {parsed.success ? describePromotion(parsed.data, currency) : "Regla no reconocida"}
        </p>
        <p className="text-sm text-fg-muted">
          {scopeText(row)} · {windowText(row, timezone)}
        </p>
        {creada ? (
          <p role="status" className="text-sm text-success">
            Promoción creada en borrador. Revísala y toca «Activar» cuando quieras que se aplique.
          </p>
        ) : null}
        {canEdit ? (
          <PromotionStatusButtons
            storeHandle={ctx.store.handle}
            id={row.id}
            status={row.status}
            name={row.name}
            from="detail"
          />
        ) : null}
      </header>
      {canEdit ? (
        <EditForm
          row={row}
          storeId={ctx.store.id}
          storeHandle={ctx.store.handle}
          currency={currency}
          timezone={timezone}
        />
      ) : null}
    </section>
  );
}

async function EditForm({
  row,
  storeId,
  storeHandle,
  currency,
  timezone,
}: {
  row: NonNullable<Awaited<ReturnType<typeof loadPromotion>>>;
  storeId: string;
  storeHandle: string;
  currency: string;
  timezone: string;
}) {
  const options = await loadTargetOptions(storeId);
  const initial = promotionToFormValues({
    ...row,
    product_ids: row.promotion_targets.flatMap((t) => (t.product_id ? [t.product_id] : [])),
    category_ids: row.promotion_targets.flatMap((t) => (t.category_id ? [t.category_id] : [])),
    starts_at: day(row.starts_at, timezone),
    ends_at: day(row.ends_at, timezone, true),
  });
  return (
    <PromotionForm
      storeHandle={storeHandle}
      initial={initial}
      currency={currency}
      products={options.products}
      categories={options.categories}
      productsTruncated={options.truncated}
    />
  );
}
