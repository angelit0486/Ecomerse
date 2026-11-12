"use client";

import { useActionState } from "react";

import { checkImportPhotos, type PhotoCheckState } from "./photo-check-actions";

/** «Revisar los enlaces de las fotos» en la vista previa de una importación (O10-04). */
export function PhotoCheck({ storeHandle, jobId }: { storeHandle: string; jobId: string }) {
  const [state, action, pending] = useActionState<PhotoCheckState, FormData>(
    async () => checkImportPhotos(storeHandle, jobId),
    { state: "idle" },
  );
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
      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 items-center rounded-[var(--radius-control)] border border-control px-4 font-medium disabled:opacity-60"
        >
          {pending ? "Revisando…" : "Revisar los enlaces"}
        </button>
      </form>
      <div role="status" aria-live="polite" className="space-y-2">
        {state.state === "error" ? <p>{state.message}</p> : null}
        {state.state === "done" ? (
          <>
            <p>
              <strong>
                {state.ok.toLocaleString("es-MX")} de {state.total.toLocaleString("es-MX")}
              </strong>{" "}
              {state.total === 1 ? "enlace funciona" : "enlaces funcionan"}.
              {state.checked < state.total
                ? ` Se revisaron ${state.checked.toLocaleString("es-MX")}; los demás quedaron sin revisar.`
                : null}
            </p>
            {state.problems.length === 0 ? (
              <p className="text-success">Todos los enlaces llevan a una foto.</p>
            ) : (
              <ul
                aria-label="Enlaces con problema"
                className="divide-y divide-border rounded-md border border-border"
              >
                {state.problems.map((p) => (
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
            {state.more > 0 ? (
              <p className="text-fg-muted">Y {state.more.toLocaleString("es-MX")} más.</p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
