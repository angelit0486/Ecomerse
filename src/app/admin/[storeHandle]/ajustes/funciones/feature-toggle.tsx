"use client";

import { Button } from "@/ui/primitives/button";
import { useSafeActionState } from "@/ui/use-safe-action-state";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { setStoreFeature } from "./actions";

export function FeatureToggle({
  storeHandle,
  featureKey,
  title,
  description,
  where,
  enabled,
  locked,
  canEdit,
}: {
  storeHandle: string;
  featureKey: string;
  title: string;
  description: string;
  where: string;
  enabled: boolean;
  locked: boolean;
  canEdit: boolean;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    setStoreFeature.bind(null, storeHandle),
    {},
  );
  const id = `feature-${featureKey}`;
  return (
    <form
      action={action}
      aria-labelledby={id}
      className="space-y-2 rounded-lg border border-border p-4"
    >
      <input type="hidden" name="key" value={featureKey} />
      <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          <p className="text-sm">{description}</p>
          <p className="text-[13px] text-fg-muted">Dónde se nota: {where}</p>
        </div>
        <p
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-medium ${
            enabled ? "bg-success/15 text-success" : "bg-canvas text-fg-muted"
          }`}
        >
          {enabled ? "Encendida" : "Apagada"}
        </p>
      </div>
      {locked ? (
        <p className="text-sm text-fg-muted">
          La plataforma administra esta función por ahora (mantenimiento o una revisión de tu
          tienda). Si necesitas cambiarla, escríbenos.
        </p>
      ) : canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant={enabled ? "secondary" : "primary"} loading={pending}>
            {enabled ? `Apagar ${title.toLowerCase()}` : `Encender ${title.toLowerCase()}`}
          </Button>
          <FormFeedback state={state} />
        </div>
      ) : null}
    </form>
  );
}
