import Link from "next/link";

import { publishIssueMessage } from "../messages";
import { AutoRefresh } from "./auto-refresh";

export interface PublishTotals {
  candidates?: number;
  pending?: number;
  published?: number;
  already?: number;
  blocked?: number;
  skipped?: number;
  groups?: Record<string, number>;
}

export interface BlockedProduct {
  id: string;
  title: string;
  reasons: string[];
}

const GROUPS: [key: string, label: string][] = [
  ["compliance", "sin ficha de cumplimiento completa"],
  ["price", "con precio inválido"],
  ["variant", "sin presentación activa"],
  ["permission", "sin permiso para publicar"],
  ["other", "por otro motivo"],
];

const n = (value: number | undefined) => (value ?? 0).toLocaleString("es-MX");

/** Texto de un motivo: los de las reglas de publicación tienen su mensaje. */
function reasonText(code: string): string {
  if (code === "permission") return "Quien importó ya no puede publicar productos.";
  if (code === "deleted") return "El producto se borró.";
  return publishIssueMessage(code);
}

/**
 * Resumen de la publicación de los productos marcados para publicar en una
 * importación (Orden 10, mensaje 4): cuántos se publicaron y cuántos quedaron
 * pendientes y por qué. Nada se publica si no cumple las reglas.
 */
export function PublishSummary({
  status,
  totals,
  error,
  blocked,
  productsBase,
}: {
  status: string;
  totals: PublishTotals;
  error: string | null;
  blocked: BlockedProduct[];
  productsBase: string;
}) {
  const candidates = totals.candidates ?? 0;
  if (status === "queued" || status === "running") {
    const reviewed = candidates - (totals.pending ?? candidates);
    return (
      <p role="status" className="rounded-md border border-border p-3 text-sm">
        Publicando los productos marcados para publicar: {n(reviewed)} de {n(candidates)} revisados.
        Solo se publican los que cumplen las reglas. Puedes cerrar esta página.
        <AutoRefresh />
      </p>
    );
  }
  const pending = totals.blocked ?? 0;
  const groups = GROUPS.filter(([key]) => (totals.groups?.[key] ?? 0) > 0).map(
    ([key, label]) => `${n(totals.groups?.[key])} ${label}`,
  );
  return (
    <section
      aria-labelledby="publicacion"
      className={`space-y-2 rounded-md border p-4 text-sm ${pending > 0 || status === "failed" ? "border-warning" : "border-success"}`}
    >
      <h2 id="publicacion" className="font-semibold">
        Publicación
      </h2>
      <p role="status">
        {n(totals.published)} {totals.published === 1 ? "publicado" : "publicados"}.
        {(totals.already ?? 0) > 0 ? ` ${n(totals.already)} ya estaban publicados.` : null}
        {pending > 0
          ? ` ${n(pending)} ${pending === 1 ? "pendiente" : "pendientes"}: ${groups.join(", ")}.`
          : null}
        {(totals.skipped ?? 0) > 0
          ? ` ${n(totals.skipped)} no se publicaron porque cambiaron después (archivados o borrados).`
          : null}
      </p>
      {status === "failed" && error ? <p>{error}</p> : null}
      {blocked.length > 0 ? (
        <>
          <p className="text-fg-muted">
            Los pendientes siguen en borrador. Corrige lo que se indica y publícalos desde
            Productos.
          </p>
          <ul
            aria-label="Productos sin publicar"
            className="divide-y divide-border rounded-md border border-border"
          >
            {blocked.map((b) => (
              <li key={b.id} className="space-y-1 p-3">
                <Link href={`${productsBase}/${b.id}`} className="font-medium underline">
                  {b.title}
                </Link>
                <ul className="list-disc pl-5">
                  {b.reasons.map((r) => (
                    <li key={r}>{reasonText(r)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {pending > blocked.length ? (
            <p className="text-fg-muted">
              Se muestran {n(blocked.length)} de {n(pending)}.{" "}
              <Link href={`${productsBase}?estado=draft`} className="underline">
                Ver los borradores
              </Link>
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
