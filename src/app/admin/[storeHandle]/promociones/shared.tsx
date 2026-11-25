import type { PromotionRow } from "./data";

export const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  active: "Activa",
  paused: "Pausada",
  archived: "Archivada",
};

/** Día en la zona de la tienda; «hasta» se guarda como el inicio del día siguiente. */
export const day = (iso: string | null, tz: string, end = false) =>
  iso
    ? new Date(Date.parse(iso) - (end ? 1 : 0)).toLocaleDateString("en-CA", { timeZone: tz })
    : "";

const longDay = (iso: string, tz: string, end = false) =>
  new Date(Date.parse(iso) - (end ? 1 : 0)).toLocaleDateString("es-MX", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function windowText(r: Pick<PromotionRow, "starts_at" | "ends_at">, tz: string): string {
  if (r.starts_at && r.ends_at)
    return `del ${longDay(r.starts_at, tz)} al ${longDay(r.ends_at, tz, true)}`;
  if (r.starts_at) return `desde el ${longDay(r.starts_at, tz)}`;
  if (r.ends_at) return `hasta el ${longDay(r.ends_at, tz, true)}`;
  return "sin fecha de fin";
}

export function scopeText(r: Pick<PromotionRow, "scope" | "promotion_targets">): string {
  const n = r.promotion_targets.length;
  if (r.scope === "products") return n === 1 ? "1 producto" : `${n} productos`;
  if (r.scope === "categories") return n === 1 ? "1 categoría" : `${n} categorías`;
  return "toda la tienda";
}

export function PlanLimitNote({
  limit,
  activeHere,
}: {
  limit: { limit: number; used: number; plan: string | null } | null;
  activeHere: number;
}) {
  if (!limit) {
    return (
      <p className="text-sm text-fg-muted">
        Activas en esta tienda: {activeHere}. Tu plan tiene un número máximo de promociones activas;
        si llegas a él, el panel te avisa al activar.
      </p>
    );
  }
  if (limit.limit <= 0) {
    return (
      <p role="note" className="rounded-md border border-warning p-3 text-sm">
        Tu plan{limit.plan ? ` (${limit.plan})` : ""} aún no incluye promociones activas: puedes
        crearlas y dejarlas en borrador. Para activarlas, pide a soporte que habilite promociones en
        tu plan.
      </p>
    );
  }
  if (limit.limit >= 1000) {
    return (
      <p role="note" className="rounded-md border border-border p-3 text-sm">
        Promociones activas: <strong>{limit.used}</strong>. Tu plan
        {limit.plan ? ` ${limit.plan}` : ""} no tiene tope práctico.
      </p>
    );
  }
  const full = limit.used >= limit.limit;
  return (
    <p
      role="note"
      className={`rounded-md border p-3 text-sm ${full ? "border-warning" : "border-border"}`}
    >
      Promociones activas: <strong>{limit.used}</strong> de <strong>{limit.limit}</strong>
      {limit.plan ? ` en tu plan ${limit.plan}` : ""} (cuentan todas tus tiendas).
      {full ? " Pausa una para activar otra, o cambia de plan en Ajustes → Plan y uso." : ""}
    </p>
  );
}
