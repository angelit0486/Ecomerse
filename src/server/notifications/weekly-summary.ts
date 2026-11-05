import { createHash } from "node:crypto";

import type { Sql } from "@/server/db/role-clients";
import type { JobHandler } from "@/server/jobs/types";
import { formatMoney } from "@/lib/money/format";

import { alreadyDelivered, sendNotification } from "./handlers";
import { escapeHtml } from "./templates";
import { isEmail, safeDisplayName, type EmailChannel, type EmailMessage } from "./types";

/**
 * Auditoría global, paso 19: resumen semanal a la dueña (interruptor
 * `weekly_summary`). La base calcula las cifras (`system.weekly_summaries`, solo
 * worker); aquí solo se arma y se manda. Una vez por semana ISO, tienda y
 * destinatario: la clave única de `notification_deliveries` impide repetirlo.
 */
export interface WeeklySummary {
  store: { id: string; name: string; handle: string; organization_id: string; currency: string };
  recipients: string[];
  sales: number;
  orders: number;
  sales_prev: number;
  refunds: number;
  to_fulfill: number;
  needs_attention: number;
  pending_payment: number;
  abandoned_carts: number;
  low_stock: { title: string; sku: string | null; available: number }[];
  top_products: { title: string; quantity: number }[];
}

/** «+25 %», «−10 %», «igual» o null si la semana anterior no tuvo ventas. */
export function weekChange(current: number, previous: number): string | null {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return "igual que la semana anterior";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)} % contra la semana anterior`;
}

export function weeklySummaryEmail(d: WeeklySummary, to: string, panelUrl: string): EmailMessage {
  const m = (cents: number) => formatMoney(Number(cents), d.store.currency);
  const net = Number(d.sales) - Number(d.refunds);
  const change = weekChange(Number(d.sales), Number(d.sales_prev));
  const subject = `Tu semana en ${safeDisplayName(d.store.name)}: ${m(d.sales)} en ventas`;
  const todo = [
    d.to_fulfill > 0 ? `${d.to_fulfill} pedido(s) por surtir` : null,
    d.needs_attention > 0 ? `${d.needs_attention} pedido(s) que requieren atención` : null,
    d.pending_payment > 0 ? `${d.pending_payment} pedido(s) pendientes de pago` : null,
    d.low_stock.length > 0 ? `${d.low_stock.length} producto(s) con stock bajo` : null,
  ].filter((t): t is string => t !== null);
  const facts: [string, string][] = [
    ["Ventas (7 días)", `${m(d.sales)}${change ? ` · ${change}` : ""}`],
    ["Pedidos pagados", String(d.orders)],
    ["Reembolsos", m(d.refunds)],
    ["Ventas netas", m(net)],
    ["Carritos abandonados", String(d.abandoned_carts)],
  ];
  const row = ([k, v]: [string, string]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#555">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:600">${escapeHtml(v)}</td></tr>`;
  const list = (items: string[]) =>
    items.length ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "";
  const top = d.top_products.map((p) => `${p.quantity} × ${p.title}`);
  const low = d.low_stock.map(
    (s) => `${s.title}${s.sku ? ` (${s.sku})` : ""}: quedan ${s.available}`,
  );
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head><body style="font-family:system-ui,sans-serif;color:#1a1a1a;line-height:1.5;max-width:560px;margin:0 auto;padding:24px"><p><strong style="font-size:20px">${escapeHtml(d.store.name)}</strong></p><p>Así te fue en los últimos 7 días:</p><table style="border-collapse:collapse">${facts.map(row).join("")}</table>${
    todo.length
      ? `<p style="margin-top:16px"><strong>Para atender:</strong></p>${list(todo)}`
      : `<p style="margin-top:16px">No tienes nada pendiente. ¡Buen trabajo!</p>`
  }${top.length ? `<p><strong>Lo más vendido:</strong></p>${list(top)}` : ""}${
    low.length ? `<p><strong>Stock bajo:</strong></p>${list(low)}` : ""
  }<p><a href="${escapeHtml(panelUrl)}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Abrir mi panel</a></p><p style="color:#555;font-size:13px">Recibes este resumen porque se activó en Ajustes → Funciones. Para dejar de recibirlo, apágalo ahí.</p></body></html>`;
  const text = [
    `${d.store.name}: así te fue en los últimos 7 días`,
    "",
    ...facts.map(([k, v]) => `${k}: ${v}`),
    "",
    ...(todo.length
      ? ["Para atender:", ...todo.map((t) => `- ${t}`)]
      : ["No tienes nada pendiente."]),
    ...(top.length ? ["", "Lo más vendido:", ...top.map((t) => `- ${t}`)] : []),
    ...(low.length ? ["", "Stock bajo:", ...low.map((t) => `- ${t}`)] : []),
    "",
    `Abrir mi panel: ${panelUrl}`,
    "",
    "Para dejar de recibir este resumen, apágalo en Ajustes → Funciones.",
  ].join("\n");
  return { to, subject, html, text };
}

export interface WeeklySummaryDeps {
  db: Sql;
  channel: EmailChannel;
  appUrl: string;
}

const PAGE = 50;

export function createWeeklySummaryHandlers(deps: WeeklySummaryDeps): Array<[string, JobHandler]> {
  const send: JobHandler = async (job, { log }) => {
    const week = typeof job.payload.week === "string" ? job.payload.week : "";
    if (!/^\d{4}-S\d{2}$/.test(week)) return log.warn("Resumen semanal sin semana válida");
    let after: string | null = null;
    let sent = 0;
    for (;;) {
      const rows: { s: WeeklySummary }[] = await deps.db<{ s: WeeklySummary }[]>`
        select s from system.weekly_summaries(${after}, ${PAGE}) s`;
      for (const { s } of rows) {
        const panelUrl = new URL(
          `/admin/${encodeURIComponent(s.store.handle)}`,
          deps.appUrl,
        ).toString();
        for (const to of s.recipients.filter(isEmail)) {
          const hash = createHash("sha256").update(to.toLowerCase()).digest("hex").slice(0, 16);
          const dedupeKey = `stores.weekly_summary:${week}:${s.store.id}:${hash}`;
          // Reintento del trabajo: lo ya enviado esta semana no se repite.
          if (await alreadyDelivered(deps.db, dedupeKey)) continue;
          await sendNotification(deps, {
            dedupeKey,
            template: "weekly_summary",
            organizationId: s.store.organization_id,
            idempotencyKey: dedupeKey,
            message: weeklySummaryEmail(s, to, panelUrl),
          });
          sent += 1;
        }
      }
      if (rows.length < PAGE) break;
      after = rows.at(-1)!.s.store.id;
    }
    log.info("Resúmenes semanales", { week, sent });
  };
  return [["stores.weekly_summary", send]];
}
