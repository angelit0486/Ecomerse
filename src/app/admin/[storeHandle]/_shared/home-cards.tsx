import Link from "next/link";

import type { MetricComparison } from "@/lib/dashboard/home-insights";

/**
 * Piezas de las tarjetas de Inicio (Orden 1): estado de error con reintento y
 * línea de comparación. El error nunca se pinta como un cero.
 */
export function CardError({ what, retryHref }: { what: string; retryHref: string }) {
  return (
    <p role="status" className="text-sm text-fg-muted">
      No pudimos cargar {what}.{" "}
      <Link href={retryHref} className="inline-flex min-h-11 items-center underline md:min-h-0">
        Reintenta
      </Link>
    </p>
  );
}

const DIRECTION_STYLE: Record<MetricComparison["direction"], string> = {
  up: "text-success",
  down: "text-danger",
  flat: "text-fg-muted",
  none: "text-fg-muted",
};
const DIRECTION_MARK: Record<MetricComparison["direction"], string> = {
  up: "▲ ",
  down: "▼ ",
  flat: "",
  none: "",
};

/** Variación contra el periodo anterior (o por qué no la hay). */
export function ComparisonLine({ comparison }: { comparison: MetricComparison }) {
  return (
    <p className={`mt-1 text-[13px] ${DIRECTION_STYLE[comparison.direction]}`}>
      <span aria-hidden="true">{DIRECTION_MARK[comparison.direction]}</span>
      {comparison.text}
    </p>
  );
}
