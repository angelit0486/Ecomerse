import Link from "next/link";

import { LEVEL_LABEL, type StoreAlert } from "@/lib/store-alerts/alerts";

import { ALERTS_ERROR_TEXT } from "./home-state";

const LEVEL_STYLE: Record<StoreAlert["level"], string> = {
  alta: "border-danger",
  media: "border-warning",
  baja: "border-border",
};

/**
 * «Qué atender hoy»: cada alerta con su conteo, su urgencia y la lista para
 * resolverla. Si no se pudieron calcular lo dice (antes la sección desaparecía).
 */
export function StoreAlertsPanel({
  alerts,
  healthHref,
}: {
  alerts: StoreAlert[] | "error";
  /** Enlace a «Salud de tu tienda», solo si quien mira puede abrirla. */
  healthHref?: string | null;
}) {
  return (
    <section aria-labelledby="alertas" className="space-y-2">
      <h2 id="alertas" className="font-semibold">
        Qué atender hoy
      </h2>
      {alerts === "error" ? (
        <p role="status" className="text-sm">
          {ALERTS_ERROR_TEXT}
          {healthHref ? (
            <>
              {" "}
              <Link href={healthHref} className="underline">
                Ver la salud de la tienda
              </Link>
            </>
          ) : null}
        </p>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-success">
          Todo en orden: tus productos publicados tienen foto, categoría y existencias.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {alerts.map((alert) => (
            <li
              key={alert.key}
              className={`space-y-1 rounded-md border p-3 text-sm ${LEVEL_STYLE[alert.level]}`}
            >
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {alert.title}:{" "}
                  <span className="tabular-nums">{alert.count.toLocaleString("es-MX")}</span>
                </span>
                <span className="text-[13px] text-fg-muted">{LEVEL_LABEL[alert.level]}</span>
              </p>
              <p className="text-fg-muted">{alert.description}</p>
              <p>{alert.action}</p>
              <Link
                href={alert.href}
                className="inline-flex min-h-11 items-center font-medium underline"
              >
                Ver {alert.count === 1 ? "el producto" : "los productos"}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
