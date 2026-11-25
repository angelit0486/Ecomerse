import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { promotionRules, describePromotion } from "@/lib/promotions/rules";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { EmptyState } from "@/ui/primitives/empty-state";

import { linkButton } from "../productos/styles";
import { loadPromotionLimit, loadPromotions, type PromotionRow } from "./data";
import { PromotionStatusButtons } from "./forms";
import { PlanLimitNote, STATUS_LABEL, scopeText, windowText } from "./shared";

export const metadata: Metadata = { title: "Promociones" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<{ archivada?: string }>;
};

export default async function PromotionsPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const { archivada } = await searchParams;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "discounts.read")) notFound();
  const canEdit = hasPermission(ctx, "discounts.manage");
  const [rows, limit] = await Promise.all([loadPromotions(ctx.store.id), loadPromotionLimit(ctx)]);
  const base = `/admin/${ctx.store.handle}/promociones`;
  const { currency, timezone } = ctx.store;
  const describe = (r: PromotionRow) => {
    const p = promotionRules.safeParse({ type: r.type, rules: r.rules });
    return p.success ? describePromotion(p.data, currency) : "Regla no reconocida";
  };
  const activeHere = rows.filter((r) => r.status === "active").length;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="mr-auto space-y-1">
          <h1 className="text-xl font-semibold">Promociones</h1>
          <p className="max-w-2xl text-sm text-fg-muted">
            Ofertas que se aplican solas en el carrito, sin código: 3×2, la segunda al 50 % o precio
            de mayoreo. Cada pieza recibe una sola promoción: la que más le ahorra al cliente. Los
            cupones de «Descuentos» no se suman, salvo los que marques «Se combina con promociones».
          </p>
        </div>
        <Link href={`${base}/reporte`} className={`${linkButton} border border-border`}>
          Reporte
        </Link>
        {canEdit ? (
          <Link
            href={`${base}/nueva`}
            className={`${linkButton} bg-accent text-accent-fg hover:bg-accent-hover`}
          >
            Nueva promoción
          </Link>
        ) : null}
      </header>

      <PlanLimitNote limit={limit} activeHere={activeHere} />
      {archivada ? (
        <p role="status" className="text-sm text-success">
          Promoción archivada.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="Aún no tienes promociones"
          description="Crea una para vender más: por ejemplo «3×2 en playeras» o «mayoreo desde 6 piezas»."
        />
      ) : (
        <ul className="space-y-4" aria-label="Promociones">
          {rows.map((r) => (
            <li key={r.id} className="space-y-3 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-base font-semibold">
                  <Link href={`${base}/${r.id}`} className="hover:underline">
                    {r.name}
                  </Link>
                </h2>
                <span className="rounded-full border border-border px-2 text-xs">
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </div>
              <p className="text-sm">
                <strong>{r.label}</strong> · {describe(r)}
              </p>
              <p className="text-sm text-fg-muted">
                {scopeText(r)} · {windowText(r, timezone)}
                {r.applies_to_sale_items ? " · también en productos en oferta" : ""}
              </p>
              {canEdit ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`${base}/${r.id}`} className={`${linkButton} border border-control`}>
                    Editar
                  </Link>
                  <PromotionStatusButtons
                    storeHandle={ctx.store.handle}
                    id={r.id}
                    status={r.status}
                    name={r.name}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
