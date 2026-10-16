import { Fragment } from "react";

import { SUPPLEMENT_FIELD_LABELS } from "@/lib/compliance/labels";
import type { ProductRegulatory } from "@/server/storefront/catalog";

const TEXTS = [
  "ingredients",
  "usage",
  "warnings",
  "storage",
  "allergens",
  "sanitary_notice",
] as const;

/**
 * Ficha sanitaria del producto (R-T03, ADR-021): los datos los escribe la tienda y
 * las leyendas salen de las reglas vigentes de su país. Todo como texto (React lo
 * escapa); nunca HTML.
 */
export function SupplementInfo({ info }: { info: ProductRegulatory }) {
  const d = info.data;
  const facts = (
    [
      ["form", d.form],
      ["net_content", d.net_content],
      ["serving_size", d.serving_size],
      ["servings_per_container", d.servings_per_container?.toString()],
    ] as const
  ).filter(([, value]) => value);
  const nutrition = d.nutrition ?? [];
  const hasDv = nutrition.some((row) => row.dv);
  return (
    <section
      aria-labelledby="sf-ficha"
      className="space-y-4 border-t border-[var(--sf-border)] pt-5"
    >
      <h2 id="sf-ficha" className="text-lg font-semibold">
        Información del {info.category_name.toLowerCase()}
      </h2>
      {info.legends.length > 0 ? (
        <div
          role="note"
          aria-label="Leyendas sanitarias"
          className="space-y-2 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-4 text-sm font-medium"
        >
          {info.legends.map((legend) => (
            <p key={legend.key} className="whitespace-pre-line">
              {legend.text}
            </p>
          ))}
        </div>
      ) : null}
      {facts.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {facts.map(([key, value]) => (
            <Fragment key={key}>
              <dt className="text-[var(--sf-muted)]">{SUPPLEMENT_FIELD_LABELS[key]}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
      {nutrition.length > 0 ? (
        <table className="w-full text-left text-sm">
          <caption className="pb-2 text-left font-semibold">
            {SUPPLEMENT_FIELD_LABELS.nutrition}
          </caption>
          <thead className="text-[var(--sf-muted)]">
            <tr className="border-b border-[var(--sf-border)]">
              <th scope="col" className="py-1 pr-3 font-medium">
                Nutrimento
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Cantidad
              </th>
              {hasDv ? (
                <th scope="col" className="py-1 font-medium">
                  <abbr title="Porcentaje del valor nutrimental de referencia">%VNR</abbr>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--sf-border)]">
            {nutrition.map((row, i) => (
              <tr key={i}>
                <th scope="row" className="py-1 pr-3 font-normal">
                  {row.name}
                </th>
                <td className="py-1 pr-3">
                  {row.amount}
                  {row.unit ? ` ${row.unit}` : ""}
                </td>
                {hasDv ? <td className="py-1">{row.dv ?? ""}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {TEXTS.filter((key) => d[key]).map((key) => (
        <div key={key} className="space-y-1">
          <h3 className="text-sm font-semibold">{SUPPLEMENT_FIELD_LABELS[key]}</h3>
          <p className="whitespace-pre-line text-sm">{d[key]}</p>
        </div>
      ))}
    </section>
  );
}

/** Leyendas sanitarias del carrito o del checkout (ADR-021). */
export function PurchaseLegends({ legends }: { legends: { key: string; text: string }[] }) {
  if (legends.length === 0) return null;
  return (
    <div
      role="note"
      aria-label="Leyendas sanitarias"
      className="space-y-1 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-3 text-[13px]"
    >
      {legends.map((legend) => (
        <p key={legend.key} className="whitespace-pre-line">
          {legend.text}
        </p>
      ))}
    </div>
  );
}
