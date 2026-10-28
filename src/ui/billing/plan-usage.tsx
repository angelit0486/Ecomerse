import {
  FEATURE_KEYS,
  FEATURE_LABELS,
  LIMIT_KEYS,
  LIMIT_LABELS,
  MEASURED_KEYS,
  usagePercent,
  type Billing,
} from "@/lib/billing/entitlements";

const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });

/**
 * Límites del plan con su uso en vivo (barras) y funciones incluidas. Lo usan
 * "Plan y uso" del panel y la ficha de la organización en la consola.
 */
export function PlanUsage({
  entitlements,
  showAll = false,
}: {
  entitlements: Billing["entitlements"];
  /** La consola ve también los límites que no se miden (almacenes, dominios…). */
  showAll?: boolean;
}) {
  const keys = showAll ? LIMIT_KEYS : MEASURED_KEYS;
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {keys.map((key) => {
          const e = entitlements[key];
          if (!e || typeof e.value !== "number") return null;
          const pct = usagePercent(e.used, e.value);
          const near = pct !== null && pct >= 90;
          return (
            <li key={key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span>
                  {LIMIT_LABELS[key]}
                  {e.override ? (
                    <span className="text-[13px] text-fg-muted">
                      {" "}
                      (excepción
                      {e.override_expires_at
                        ? ` hasta ${date.format(new Date(e.override_expires_at))}`
                        : ""}
                      )
                    </span>
                  ) : null}
                </span>
                <span className={`tabular-nums ${near ? "text-danger" : ""}`}>
                  {e.used != null ? `${e.used} de ${e.value}` : e.value}
                </span>
              </div>
              {pct !== null ? (
                <div
                  role="meter"
                  aria-label={`${LIMIT_LABELS[key]}: ${e.used} de ${e.value}`}
                  aria-valuemin={0}
                  aria-valuemax={e.value}
                  aria-valuenow={Math.min(e.used ?? 0, e.value)}
                  className="h-2 overflow-hidden rounded-full bg-canvas ring-1 ring-border"
                >
                  {/* SVG en vez de un ancho en `style`, que la CSP con nonce bloquea. */}
                  <svg
                    viewBox="0 0 100 2"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    className="block h-full w-full"
                  >
                    <rect
                      width={pct}
                      height="2"
                      className={near ? "fill-[var(--color-danger)]" : "fill-[var(--color-accent)]"}
                    />
                  </svg>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Funciones</h3>
        <ul className="flex flex-wrap gap-2 text-[13px]">
          {FEATURE_KEYS.map((key) => {
            const on = entitlements[key]?.value === true;
            return (
              <li
                key={key}
                className={`rounded-full border px-3 py-1 ${on ? "border-success" : "border-border text-fg-muted line-through"}`}
              >
                <span className="sr-only">{on ? "Incluida: " : "No incluida: "}</span>
                {FEATURE_LABELS[key]}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
