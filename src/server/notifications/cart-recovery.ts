import type { Sql } from "@/server/db/role-clients";
import type { JobHandler } from "@/server/jobs/types";

import { oneClickUnsubscribeUrl, optoutPath, recoverPath } from "./cart-recovery-links";
import { sendNotification } from "./handlers";
import { escapeHtml } from "./templates";
import { isEmail, safeDisplayName, type EmailChannel, type EmailMessage } from "./types";

/**
 * ADR-048: un solo recordatorio por carrito dejado con correo (opción B, PENDIENTE
 * DE REVISIÓN legal). `system.cart_recovery_due` marca el carrito antes de entregar
 * el token, así que un reintento nunca manda un segundo correo: si un envío falla,
 * ese recordatorio se pierde (preferimos eso a escribir dos veces).
 */
export interface CartRecoveryDeps {
  db: Sql;
  channel: EmailChannel;
  linkSecret: string;
  storeOrigin: (store: { hostname: string | null; handle: string }) => string;
  /** Origen del panel: recibe la baja en un clic (List-Unsubscribe). */
  appUrl: string;
}

export interface CartRecoveryEmailData {
  storeName: string;
  items: { title: string; quantity: number }[];
  recoverUrl: string;
  optoutUrl: string;
  oneClickUrl?: string;
}

const MAX_LINES = 5;

export function cartRecoveryEmail(d: CartRecoveryEmailData, to: string): EmailMessage {
  const subject = `Tu carrito en ${safeDisplayName(d.storeName)} te espera`;
  const shown = d.items.slice(0, MAX_LINES);
  const more = d.items.length - shown.length;
  const lines = shown.map((i) => `${i.quantity} × ${i.title}`);
  if (more > 0) lines.push(`y ${more} producto${more === 1 ? "" : "s"} más`);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head><body style="font-family:system-ui,sans-serif;color:#1a1a1a;line-height:1.5;max-width:560px;margin:0 auto;padding:24px"><p><strong style="font-size:20px">${escapeHtml(d.storeName)}</strong></p><p>Hola:</p><p>Dejaste estos productos en tu carrito. Lo guardamos por si quieres terminar tu compra:</p><ul>${lines
    .map((l) => `<li>${escapeHtml(l)}</li>`)
    .join(
      "",
    )}</ul><p>Los precios y las existencias se confirman al pagar.</p><p><a href="${escapeHtml(d.recoverUrl)}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Volver a mi carrito</a></p><p style="color:#555;font-size:13px">Es el único recordatorio que te enviaremos de este carrito. Si no quieres recibir más recordatorios de ${escapeHtml(d.storeName)}, <a href="${escapeHtml(d.optoutUrl)}" style="color:#555">date de baja aquí</a>.</p></body></html>`;
  const text = [
    "Hola:",
    "",
    "Dejaste estos productos en tu carrito. Lo guardamos por si quieres terminar tu compra:",
    ...lines.map((l) => `- ${l}`),
    "",
    "Los precios y las existencias se confirman al pagar.",
    `Volver a mi carrito: ${d.recoverUrl}`,
    "",
    "Es el único recordatorio que te enviaremos de este carrito.",
    `Para no recibir más recordatorios de ${d.storeName}: ${d.optoutUrl}`,
    "",
    d.storeName,
  ].join("\n");
  return {
    to,
    subject,
    html,
    text,
    fromName: d.storeName,
    ...(d.oneClickUrl ? { listUnsubscribeUrl: d.oneClickUrl } : {}),
  };
}

interface DueCart {
  cart_id: string;
  store_id: string;
  email: string;
  token: string;
  store: { name: string; handle: string; organization_id: string; hostname: string | null };
  items: { title: string; quantity: number }[];
}

export function createCartRecoveryHandlers(deps: CartRecoveryDeps): Array<[string, JobHandler]> {
  const recover: JobHandler = async (_job, { log }) => {
    const due = await deps.db<DueCart[]>`
      select cart_id, store_id, email, token, store, items from system.cart_recovery_due(50)`;
    let sent = 0;
    let failed = 0;
    for (const c of due) {
      if (!isEmail(c.email)) continue;
      const origin = deps.storeOrigin({ hostname: c.store.hostname, handle: c.store.handle });
      const dedupeKey = `carts.recover:${c.cart_id}`;
      try {
        await sendNotification(deps, {
          dedupeKey,
          template: "cart_recovery",
          organizationId: c.store.organization_id,
          idempotencyKey: dedupeKey,
          message: cartRecoveryEmail(
            {
              storeName: c.store.name,
              items: c.items,
              recoverUrl: `${origin}${recoverPath(c.token)}`,
              optoutUrl: `${origin}${optoutPath(deps.linkSecret, c.store_id, c.email)}`,
              oneClickUrl: oneClickUnsubscribeUrl(
                deps.appUrl,
                deps.linkSecret,
                c.store_id,
                c.email,
              ),
            },
            c.email,
          ),
        });
        sent += 1;
      } catch (error) {
        // Ya está marcado: no se reintenta. Se sigue con los demás (sin datos personales en el log).
        failed += 1;
        log.warn("Recordatorio de carrito no enviado", {
          cart_id: c.cart_id,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    if (due.length > 0) log.info("Recordatorios de carrito", { sent, failed });
  };
  return [["carts.recover", recover]];
}
