"use client";

import { Button } from "@/ui/primitives/button";
import { useSafeActionState } from "@/ui/use-safe-action-state";

import { FormFeedback } from "../_shared/form-feedback";
import { copyStoreStructure, type StepState } from "./actions";

/** Copiar la estructura de otra tienda de la organización (D-PUL-02). */
export function CopyStructureForm({
  storeHandle,
  stores,
  parts,
}: {
  storeHandle: string;
  stores: { id: string; name: string }[];
  parts: { key: string; label: string }[];
}) {
  const [state, action, pending] = useSafeActionState<StepState, FormData>(
    copyStoreStructure.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <label className="flex max-w-sm flex-col gap-1.5 text-[13px] font-medium">
        Copiar de
        <select
          name="source_store_id"
          defaultValue={state.values?.source_store_id ?? stores[0]?.id}
          className="h-11 rounded-[var(--radius-control)] border border-control bg-surface px-3 text-sm font-normal md:h-9"
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-1">
        <legend className="text-[13px] font-medium">Qué copiar</legend>
        {parts.map((p) => (
          <label key={p.key} className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
            <input type="checkbox" name="parts" value={p.key} defaultChecked />
            {p.label}
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-fg-muted">
        No borra nada de esta tienda: lo que ya existe se respeta. Los productos, las fotos y los
        pedidos no se copian.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" loading={pending}>
          Copiar a esta tienda
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}
