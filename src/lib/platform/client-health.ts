import { z } from "zod";

/**
 * Consola → «Mis clientes»: forma de `platform_store_overview()` y las reglas del
 * semáforo de cada tienda. La base solo cuenta; aquí se decide qué significa
 * cada cifra y se explica en español, para que la plataforma ayude al comercio
 * antes de que se queje.
 *
 * Rojo: algo que ya afecta a sus compradores o a su cuenta (hay que actuar hoy).
 * Amarillo: señal de que la tienda se está enfriando o de que viene un cambio.
 * Verde: sin señales.
 */
const ts = z.string().nullable();

export const storeOverviewRow = z.object({
  store_id: z.string(),
  store_name: z.string(),
  handle: z.string(),
  store_status: z.string(),
  store_created_at: z.string(),
  launched_at: ts,
  organization_id: z.string(),
  organization_name: z.string(),
  organization_status: z.string(),
  owner_email: z.string().nullable(),
  plan_key: z.string().nullable(),
  subscription_status: z.string().nullable(),
  trial_ends_at: ts,
  grace_ends_at: ts,
  products_active: z.number(),
  paid_orders_30d: z.number(),
  last_paid_at: ts,
  stale_pending_payments: z.number(),
  unshipped_paid: z.number(),
  orders_need_attention: z.number(),
  dead_jobs_7d: z.number(),
  last_staff_sign_in_at: ts,
  // Visitantes de 7 días (null = la tienda aún no tiene conteo de visitas).
  visitors_7d: z.number().nullable(),
  // Cuántas tiendas coinciden en total (la base devuelve las más urgentes primero).
  total_count: z.number(),
});
export type StoreOverviewRow = z.infer<typeof storeOverviewRow>;
export const storeOverview = z.array(storeOverviewRow);

export type Light = "red" | "amber" | "green";
export interface Signal {
  code: string;
  level: "red" | "amber";
  text: string;
}

/** Días para considerar que el equipo dejó de entrar o que una tienda se estancó. */
export const QUIET_DAYS = 14;
export const TRIAL_WARNING_DAYS = 7;

const DAY = 86_400_000;
const daysSince = (iso: string, now: Date) => Math.floor((now.getTime() - Date.parse(iso)) / DAY);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(iso),
  );

export function clientSignals(row: StoreOverviewRow, now: Date): Signal[] {
  const s: Signal[] = [];
  const red = (code: string, text: string) => s.push({ code, level: "red", text });
  const amber = (code: string, text: string) => s.push({ code, level: "amber", text });
  const live = row.store_status === "active";

  // ── Rojo: afecta hoy a compradores o a la cuenta ────────────────────────
  if (row.organization_status === "suspended") red("org_suspended", "Organización suspendida");
  if (row.subscription_status === "past_due") {
    red(
      "plan_past_due",
      row.grace_ends_at
        ? `Pago del plan vencido (gracia hasta el ${shortDate(row.grace_ends_at)})`
        : "Pago del plan vencido",
    );
  }
  if (row.stale_pending_payments > 0) {
    red(
      "stale_payments",
      `${plural(row.stale_pending_payments, "transferencia", "transferencias")} sin confirmar desde hace más de 24 h`,
    );
  }
  if (row.unshipped_paid > 0) {
    red(
      "unshipped",
      `${plural(row.unshipped_paid, "pedido pagado", "pedidos pagados")} sin enviar desde hace más de 3 días`,
    );
  }
  if (row.orders_need_attention > 0) {
    red(
      "needs_attention",
      `${plural(row.orders_need_attention, "pedido marcado", "pedidos marcados")} para revisión`,
    );
  }
  if (row.dead_jobs_7d > 0) {
    red(
      "dead_jobs",
      `${plural(row.dead_jobs_7d, "trabajo en segundo plano falló", "trabajos en segundo plano fallaron")} esta semana (fotos, importaciones o correos)`,
    );
  }
  if (live && row.products_active === 0)
    red("no_products", "Tienda publicada sin productos a la venta");

  // ── Amarillo: se enfría o viene un cambio ────────────────────────────────
  if (live && row.paid_orders_30d === 0) {
    const launched = row.launched_at ? daysSince(row.launched_at, now) : null;
    // Recién lanzada: todavía no se espera la primera venta.
    if (launched === null || launched >= QUIET_DAYS) amber("no_sales", "Sin ventas en 30 días");
  }
  if (row.last_staff_sign_in_at === null) {
    amber("never_signed_in", "Nadie del equipo ha entrado al panel");
  } else {
    const quiet = daysSince(row.last_staff_sign_in_at, now);
    if (quiet >= QUIET_DAYS)
      amber("quiet_team", `Nadie del equipo entra al panel desde hace ${quiet} días`);
  }
  if (row.store_status === "draft") {
    const age = daysSince(row.store_created_at, now);
    if (age >= QUIET_DAYS)
      amber("stuck_draft", `En preparación desde hace ${age} días sin lanzarse`);
  }
  if (row.subscription_status === "trialing" && row.trial_ends_at) {
    const left = Math.ceil((Date.parse(row.trial_ends_at) - now.getTime()) / DAY);
    if (left >= 0 && left <= TRIAL_WARNING_DAYS) {
      amber("trial_ending", `La prueba termina el ${shortDate(row.trial_ends_at)}`);
    }
  }
  if (!row.plan_key) amber("no_plan", "Sin plan asignado");
  return s;
}

export function lightOf(signals: readonly Signal[]): Light {
  if (signals.some((x) => x.level === "red")) return "red";
  return signals.length > 0 ? "amber" : "green";
}

export const LIGHT_LABEL: Record<Light, string> = {
  red: "Atender hoy",
  amber: "En observación",
  green: "Al día",
};

export interface ClientStatus {
  row: StoreOverviewRow;
  signals: Signal[];
  light: Light;
}

/**
 * Todas las tiendas con su semáforo; primero las rojas (más motivos primero),
 * luego las amarillas y al final las verdes, cada grupo por nombre.
 */
export function clientStatuses(rows: readonly StoreOverviewRow[], now: Date): ClientStatus[] {
  const rank: Record<Light, number> = { red: 0, amber: 1, green: 2 };
  return rows
    .map((row) => {
      const signals = clientSignals(row, now);
      return { row, signals, light: lightOf(signals) };
    })
    .sort(
      (a, b) =>
        rank[a.light] - rank[b.light] ||
        b.signals.filter((x) => x.level === "red").length -
          a.signals.filter((x) => x.level === "red").length ||
        a.row.store_name.localeCompare(b.row.store_name, "es"),
    );
}
