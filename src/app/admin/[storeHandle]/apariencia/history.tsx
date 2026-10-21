"use client";

import { useActionState } from "react";

import { ConfirmButton } from "@/ui/primitives/confirm-button";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { restoreThemeVersion } from "./actions";

export interface ThemeVersionRow {
  id: string;
  number: number;
  publishedAt: string;
  summary: string;
}

/**
 * Historial del diseño (ADR-034 §4): las últimas 30 publicaciones. «Restaurar»
 * copia la versión al borrador; lo publicado no cambia hasta publicar.
 */
export function ThemeHistory({
  storeHandle,
  revision,
  versions,
  hasDraft,
}: {
  storeHandle: string;
  revision: number;
  versions: ThemeVersionRow[];
  hasDraft: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    restoreThemeVersion.bind(null, storeHandle),
    {},
  );
  if (versions.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
        Todavía no hay versiones. Cada vez que publiques tu diseño se guardará una aquí para que
        puedas volver a ella.
      </p>
    );
  }
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        Se guardan las últimas 30 publicaciones. Restaurar copia esa versión al borrador
        {hasDraft ? " y reemplaza los cambios que tengas sin publicar" : ""}; tus clientes siguen
        viendo lo publicado hasta que publiques.
      </p>
      <FormFeedback state={state} />
      <ol className="space-y-2" aria-label="Versiones publicadas">
        {versions.map((v, i) => (
          <li
            key={v.id}
            className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
          >
            <div className="mr-auto">
              <p className="text-sm font-semibold">
                Versión {v.number}
                {i === 0 ? (
                  <span className="font-normal text-fg-muted"> (publicada ahora)</span>
                ) : null}
              </p>
              <p className="text-[13px] text-fg-muted">
                {fmt(v.publishedAt)} · {v.summary}
              </p>
            </div>
            {i === 0 ? null : (
              <form action={action}>
                <input type="hidden" name="version_id" value={v.id} />
                <input type="hidden" name="revision" value={revision} />
                <ConfirmButton
                  variant={hasDraft ? "danger" : "secondary"}
                  size="sm"
                  loading={pending}
                  question={`¿Restaurar la versión ${v.number} al borrador?`}
                  confirmLabel="Sí, restaurar"
                  detail={
                    hasDraft
                      ? "Reemplaza los cambios que tengas sin publicar. Lo publicado no cambia hasta que publiques."
                      : "Lo publicado no cambia hasta que publiques."
                  }
                >
                  {`Restaurar la versión ${v.number} al borrador`}
                </ConfirmButton>
              </form>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
