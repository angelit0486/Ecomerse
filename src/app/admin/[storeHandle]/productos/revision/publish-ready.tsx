"use client";

import { Button } from "@/ui/primitives/button";

import { publishReadyDraftsAction, type CatalogActionState } from "../actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

/**
 * Publica de una vez los borradores completos (D-PANEL-07). La base decide cuál
 * está completo; aquí solo se pide y se muestra el resultado.
 */
export function PublishReady({ storeHandle, drafts }: { storeHandle: string; drafts: number }) {
  const [state, action, pending] = useSafeActionState<CatalogActionState, FormData>(
    (previous) => publishReadyDraftsAction(storeHandle, previous),
    {},
  );
  if (drafts === 0 && !state.message && !state.error) return null;
  return (
    <form action={action} className="space-y-2 rounded-md border border-border p-4">
      {drafts === 0 ? (
        <p className="text-sm">No quedan productos nuevos sin publicar.</p>
      ) : (
        <p className="text-sm">
          {drafts === 1
            ? "Tienes 1 producto nuevo sin publicar."
            : `Tienes ${drafts} productos nuevos sin publicar.`}{" "}
          Publica de una vez los que ya están completos; los que tengan algo pendiente siguen en
          borrador. Los que pausaste no se tocan.
        </p>
      )}
      {drafts > 0 ? (
        <Button type="submit" disabled={pending}>
          {pending ? "Publicando…" : "Publicar los completos"}
        </Button>
      ) : null}
      {state.message ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
