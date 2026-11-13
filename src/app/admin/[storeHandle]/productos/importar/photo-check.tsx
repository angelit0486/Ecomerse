"use client";

import { useActionState } from "react";

import { checkImportPhotos, type PhotoCheckState } from "./photo-check-actions";

function ago(minutes: number): string {
  if (minutes < 1) return "hace menos de un minuto";
  return minutes === 1 ? "hace 1 minuto" : `hace ${minutes} minutos`;
}

/**
 * «Revisar los enlaces de las fotos» en la vista previa de una importación
 * (O10-04). D3: el resultado se guarda y se reutiliza; volver a revisar a
 * pedido solo se permite pasados 10 minutos (la base lo decide).
 */
export function PhotoCheck({ storeHandle, jobId }: { storeHandle: string; jobId: string }) {
  const [state, action, pending] = useActionState<PhotoCheckState, FormData>(
    async (_, form) => checkImportPhotos(storeHandle, jobId, form.get("force") === "1"),
    { state: "idle" },
  );
  const done = state.state === "done" ? state : null;
  return (
    <section
      aria-labelledby="revisar-fotos"
      className="space-y-2 rounded-md border border-border p-4 text-sm"
    >
      <h2 id="revisar-fotos" className="font-semibold">
        Revisar los enlaces de las fotos
      </h2>
      <p className="text-fg-muted">
        Antes de confirmar, comprobamos que cada enlace abre y lleva a una foto. No se cambia nada
        en tu tienda.
      </p>
      <form action={action} className="flex flex-wrap gap-2">
        {done ? (
          <button
            type="submit"
            name="force"
            value="1"
            disabled={pending}
            className="inline-flex h-11 items-center rounded-[var(--radius-control)] border border-control px-4 font-medium disabled:opacity-60"
          >
            {pending ? "Revisando…" : "Revisar otra vez"}
          </button>
        ) : (
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-11 items-center rounded-[var(--radius-control)] border border-control px-4 font-medium disabled:opacity-60"
          >
            {pending ? "Revisando…" : "Revisar los enlaces"}
          </button>
        )}
      </form>
      <div role="status" aria-live="polite" className="space-y-2">
        {state.state === "error" ? <p>{state.message}</p> : null}
        {done ? (
          <>
            <p>
              <strong>
                {done.ok.toLocaleString("es-MX")} de {done.total.toLocaleString("es-MX")}
              </strong>{" "}
              {done.total === 1 ? "enlace funciona" : "enlaces funcionan"}.
              {done.checked < done.total
                ? ` Se revisaron ${done.checked.toLocaleString("es-MX")}; los demás quedaron sin revisar.`
                : null}
            </p>
            <p className="text-fg-muted">
              {done.reused
                ? `Resultado guardado de la revisión de ${ago(done.minutesAgo)}.`
                : "Revisión recién hecha."}{" "}
              {done.retryAfterSeconds > 0
                ? `Podrás revisar otra vez en ${Math.ceil(done.retryAfterSeconds / 60)} min.`
                : "Puedes revisar otra vez."}
            </p>
            {done.problems.length === 0 ? (
              <p className="text-success">Todos los enlaces revisados llevan a una foto.</p>
            ) : (
              <ul
                aria-label="Enlaces con problema"
                className="divide-y divide-border rounded-md border border-border"
              >
                {done.problems.map((p) => (
                  <li key={`${p.row}-${p.link}`} className="space-y-1 p-3">
                    <p className="font-medium">
                      Fila {p.row} · {p.handle}
                    </p>
                    <p className="break-all text-[13px] text-fg-muted">{p.link}</p>
                    <p>{p.label}</p>
                  </li>
                ))}
              </ul>
            )}
            {done.more > 0 ? (
              <p className="text-fg-muted">
                Y {done.more.toLocaleString("es-MX")} más con problema o sin revisar.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
