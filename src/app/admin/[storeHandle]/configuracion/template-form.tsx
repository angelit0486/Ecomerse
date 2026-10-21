"use client";

import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";

import { FormFeedback } from "../_shared/form-feedback";
import { applyStoreTemplate, removeSampleProducts, type StepState } from "./actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

export interface TemplateOption {
  key: string;
  name: string;
  description: string;
  colors: { primary: string; accent: string; background: string; foreground: string };
}

/** Elegir plantilla por giro (ADR-034 §5): todo va al borrador. */
export function TemplateForm({
  storeHandle,
  revision,
  templates,
}: {
  storeHandle: string;
  revision: number;
  templates: TemplateOption[];
}) {
  const [state, action, pending] = useSafeActionState<StepState, FormData>(
    applyStoreTemplate.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="revision" value={revision} />
      <fieldset>
        <legend className="sr-only">Plantilla</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t, i) => (
            <label
              key={t.key}
              className="flex min-h-11 cursor-pointer gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-fg has-[:checked]:ring-1 has-[:checked]:ring-fg"
            >
              <input
                type="radio"
                name="template"
                value={t.key}
                defaultChecked={i === 0}
                className="mt-1 size-4 shrink-0"
              />
              <span className="space-y-1">
                <span className="flex items-center gap-2 font-medium">
                  {t.name}
                  {/* SVG con fill: la CSP no permite atributos style en el HTML. */}
                  <svg aria-hidden="true" width="40" height="16" viewBox="0 0 40 16">
                    {[t.colors.primary, t.colors.accent, t.colors.background].map((c, k) => (
                      <circle key={k} cx={8 + k * 12} cy="8" r="7" fill={c} stroke="#d0d5dd" />
                    ))}
                  </svg>
                </span>
                <span className="block text-fg-muted">{t.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-sm text-fg-muted">
        Cambia los colores y la portada del borrador. Las plantillas por giro también crean
        categorías y productos de ejemplo (no se venden y solo se ven en la vista previa); «En
        blanco» no crea nada. Lo que ya tengas no se borra.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          Aplicar plantilla
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

/**
 * Aviso de productos de ejemplo con su botón. Se queda montado aunque ya no haya
 * ejemplos, para que el mensaje de «se quitaron» siga a la vista.
 */
export function SamplesNotice({
  storeHandle,
  count,
  canDelete,
}: {
  storeHandle: string;
  count: number;
  canDelete: boolean;
}) {
  const [state, action, pending] = useSafeActionState<StepState>(
    removeSampleProducts.bind(null, storeHandle),
    {},
  );
  if (count === 0) return state.ok ? <FormFeedback state={state} /> : null;
  return (
    <div className="space-y-2 rounded-md border border-border bg-canvas p-3 text-sm">
      <p>
        Tu tienda tiene {count === 1 ? "1 producto de ejemplo" : `${count} productos de ejemplo`}{" "}
        (etiqueta «ejemplo»). Úsalos como guía y quítalos antes de publicar.
      </p>
      {canDelete ? (
        <form action={action} className="flex flex-wrap items-center gap-3">
          <ConfirmButton
            loading={pending}
            question={
              count === 1
                ? "¿Quitar el producto de ejemplo?"
                : `¿Quitar los ${count} productos de ejemplo?`
            }
            detail="Se pueden restaurar desde «Ver eliminados» en Productos."
          >
            {count === 1
              ? "Quitar el producto de ejemplo"
              : `Quitar los ${count} productos de ejemplo`}
          </ConfirmButton>
          <FormFeedback state={state} />
        </form>
      ) : null}
    </div>
  );
}
