"use client";

import { startTransition, useActionState } from "react";

import { Button } from "@/ui/primitives/button";

import { schedulePublishAction, type CatalogActionState } from "./actions";
import { nativeControl } from "./styles";

/**
 * Publicación programada de un borrador (tanda 7). La hora es la de la tienda;
 * al llegar, el producto se publica solo si pasa la misma revisión que al
 * publicarlo a mano.
 */
export function SchedulePublish({
  storeHandle,
  productId,
  scheduledLabel,
  timeZoneLabel,
}: {
  storeHandle: string;
  productId: string;
  /** «20 oct 2026, 10:00» o null sin programar. */
  scheduledLabel: string | null;
  timeZoneLabel: string;
}) {
  const [state, action, pending] = useActionState<CatalogActionState, FormData>(
    schedulePublishAction.bind(null, storeHandle, productId),
    {},
  );
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => action(data));
  };
  return (
    <section aria-labelledby="programar-titulo" className="space-y-2">
      <h2 id="programar-titulo" className="text-base font-semibold">
        Programar publicación
      </h2>
      {scheduledLabel ? (
        <p className="text-sm">
          Se publicará el <strong>{scheduledLabel}</strong> ({timeZoneLabel}).
        </p>
      ) : (
        <p className="text-sm text-fg-muted">
          Elige cuándo debe aparecer en la tienda. Hora de la tienda: {timeZoneLabel}.
        </p>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="grid gap-0.5 text-[12px]">
          Fecha y hora
          <input
            type="datetime-local"
            name="publish_at"
            aria-invalid={state.fields?.publish_at ? true : undefined}
            className={nativeControl}
          />
        </label>
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          {scheduledLabel ? "Cambiar fecha" : "Programar"}
        </Button>
        {scheduledLabel ? (
          <Button type="submit" name="clear" value="1" size="sm" variant="ghost" loading={pending}>
            Quitar programación
          </Button>
        ) : null}
      </form>
      <p aria-live="polite" className="text-[13px]">
        {state.error ? (
          <span role="alert" className="text-danger">
            {state.error} {Object.values(state.fields ?? {}).join(" ")}
          </span>
        ) : state.ok ? (
          <span role="status" className="text-success">
            {state.message}
          </span>
        ) : null}
      </p>
    </section>
  );
}
