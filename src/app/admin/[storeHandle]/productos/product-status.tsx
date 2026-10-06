"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";

import { productStatusAction, type CatalogActionState } from "./actions";

/** Publicar, despublicar, archivar, duplicar, eliminar y restaurar (cada uno valida en la base). */
export function ProductStatusPanel({
  storeHandle,
  productId,
  status,
  deleted,
  can,
  warnings,
}: {
  storeHandle: string;
  productId: string;
  status: "draft" | "active" | "archived";
  deleted: boolean;
  can: { publish: boolean; delete: boolean; create: boolean };
  warnings: string[];
}) {
  const [state, action, pending] = useActionState<CatalogActionState, FormData>(
    productStatusAction.bind(null, storeHandle, productId),
    {},
  );
  const button = (
    value: string,
    label: string,
    variant: "primary" | "secondary" | "danger" = "secondary",
  ) => (
    <Button
      type="submit"
      name="action"
      value={value}
      variant={variant}
      size="sm"
      disabled={pending}
    >
      {label}
    </Button>
  );

  return (
    <section
      aria-labelledby="estado-titulo"
      className="space-y-3 rounded-[var(--radius-container)] border border-border p-4"
    >
      <h2 id="estado-titulo" className="text-base font-semibold">
        Estado
      </h2>
      <form action={action} className="flex flex-wrap gap-2">
        {deleted ? (
          can.delete ? (
            button("restore", "Restaurar")
          ) : null
        ) : (
          <>
            {can.publish && status !== "active" ? button("publish", "Publicar", "primary") : null}
            {can.publish && status === "active" ? button("draft", "Despublicar") : null}
            {can.publish && status !== "archived" ? button("archive", "Archivar") : null}
            {can.create ? button("duplicate", "Duplicar") : null}
            {can.delete ? button("delete", "Eliminar", "danger") : null}
          </>
        )}
      </form>
      <div aria-live="polite">
        {state.ok ? (
          <p role="status" className="text-sm text-success">
            {state.message}
          </p>
        ) : null}
        {state.error ? (
          <div role="alert" className="text-sm text-danger">
            <p>{state.error}</p>
            {state.issues ? (
              <ul className="list-disc pl-5">
                {state.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      {warnings.length > 0 && !deleted ? (
        <ul className="list-disc pl-5 text-sm text-fg-muted" aria-label="Recomendaciones">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
