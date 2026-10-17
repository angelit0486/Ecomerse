import { formatMoney } from "@/lib/money/format";

import { AUDIT_ACTIONS } from "../ajustes/actividad/labels";
import { publishIssueMessage } from "./messages";

export interface HistoryEvent {
  occurred_at: string;
  actor_type: string;
  actor_label: string | null;
  via_support: boolean;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

type PriceChange = { id: string; price: number; compare_at_price: number | null };

/**
 * Historial de un producto en su ficha (tanda 6): quién cambió qué y cuándo,
 * desde la auditoría (catalog_product_history, exige audit.read).
 */
export function ProductHistory({
  events,
  variantLabels,
  currency,
  timeZone,
  activityHref,
}: {
  events: HistoryEvent[];
  /** id de la presentación → «Vainilla / 1 kg». */
  variantLabels: Record<string, string>;
  currency: string;
  timeZone: string;
  activityHref: string;
}) {
  const when = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  const money = (cents: number | null | undefined) =>
    typeof cents === "number" ? formatMoney(cents, currency) : "sin precio antes";

  function details(e: HistoryEvent): string[] {
    const before = e.before ?? {};
    const after = e.after ?? {};
    if (e.action === "product.prices_updated") {
      const old = new Map(
        ((before.variants as PriceChange[] | undefined) ?? []).map((v) => [v.id, v]),
      );
      return ((after.variants as PriceChange[] | undefined) ?? []).map((v) => {
        const prev = old.get(v.id);
        const label = variantLabels[v.id] ?? "Presentación";
        const compare =
          prev && prev.compare_at_price !== v.compare_at_price
            ? ` (precio antes: ${money(prev.compare_at_price)} → ${money(v.compare_at_price)})`
            : "";
        return `${label}: ${money(prev?.price)} → ${money(v.price)}${compare}`;
      });
    }
    if (e.action === "product.publish_failed") {
      return ((after.codes as string[] | undefined) ?? []).map(publishIssueMessage);
    }
    if (e.action === "product.publish_scheduled" && typeof after.publish_at === "string") {
      return [`Para el ${when.format(new Date(after.publish_at))}`];
    }
    const lines: string[] = [];
    if ("title" in after && before.title && before.title !== after.title) {
      lines.push(`Título: «${String(before.title)}» → «${String(after.title)}»`);
    }
    if ("brand_id" in after) lines.push(after.brand_id ? "Marca cambiada" : "Marca quitada");
    if ("category_id" in after) {
      lines.push(after.mode === "remove" ? "Quitado de una categoría" : "Agregado a una categoría");
    }
    if ("tags" in after) {
      const tags = (after.tags as string[] | null) ?? [];
      lines.push(tags.length ? `Etiquetas: ${tags.join(", ")}` : "Sin etiquetas");
    }
    if (e.metadata?.bulk) lines.push("Desde una acción en bloque");
    if (e.metadata?.scheduled) lines.push("A la hora programada");
    return lines;
  }

  return (
    <section aria-labelledby="historial-titulo" className="space-y-3">
      <h2 id="historial-titulo" className="text-base font-semibold">
        Historial
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-fg-muted">Todavía no hay cambios registrados.</p>
      ) : (
        <ol className="space-y-2">
          {events.map((e, i) => (
            <li key={`${e.occurred_at}-${i}`} className="rounded border border-control p-3 text-sm">
              <p>
                <span className="font-medium">{AUDIT_ACTIONS[e.action] ?? e.action}</span>
                <span className="text-fg-muted">
                  {" · "}
                  {e.via_support
                    ? "Soporte de la plataforma"
                    : (e.actor_label ?? (e.actor_type === "system" ? "Sistema" : "Equipo"))}
                  {" · "}
                  <time dateTime={e.occurred_at}>{when.format(new Date(e.occurred_at))}</time>
                </span>
              </p>
              {details(e).length ? (
                <ul className="mt-1 list-disc pl-5 text-[13px] text-fg-muted">
                  {details(e).map((line, j) => (
                    <li key={`${j}-${line}`}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <p className="text-[13px] text-fg-muted">
        Se muestran los últimos 30 cambios. Toda la actividad de la tienda está en{" "}
        <a href={activityHref} className="underline">
          Ajustes → Actividad
        </a>
        .
      </p>
    </section>
  );
}
