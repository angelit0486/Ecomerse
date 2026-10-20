"use client";

import { useActionState, useState } from "react";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import { adjustInventory, setLowStockThreshold, type InventoryActionState } from "./actions";

const control =
  "h-11 md:h-9 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-sm text-fg";

function Feedback({ state }: { state: InventoryActionState }) {
  if (state.ok) {
    return (
      <p role="status" className="text-[13px] text-success">
        {state.message}
      </p>
    );
  }
  return state.error ? (
    <p role="alert" className="text-[13px] text-danger">
      {state.error}
    </p>
  ) : null;
}

/** Ajuste con motivo obligatorio (§15.4). La clave de idempotencia cambia tras cada éxito. */
export function AdjustForm({
  storeHandle,
  variantId,
  label,
}: {
  storeHandle: string;
  variantId: string;
  label: string;
}) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [type, setType] = useState("adjustment");
  const [state, action, pending] = useActionState<InventoryActionState, FormData>(
    async (previous: InventoryActionState, formData: FormData) => {
      const result = await adjustInventory(storeHandle, previous, formData);
      // Ajuste aplicado: el siguiente envío es un ajuste nuevo.
      if (result.ok) setKey(crypto.randomUUID());
      return result;
    },
    {},
  );

  return (
    <form
      action={action}
      className="grid gap-3 sm:grid-cols-[auto_auto_8rem_1fr_auto] sm:items-end"
      noValidate
    >
      <input type="hidden" name="variant_id" value={variantId} />
      <input type="hidden" name="idempotency_key" value={key} />
      <Field label="Tipo" id={`type-${variantId}`} error={state.fields?.type}>
        {(c) => (
          <select
            {...c}
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={control}
          >
            <option value="adjustment">Ajuste</option>
            <option value="damage">Daño</option>
            <option value="loss">Pérdida</option>
          </select>
        )}
      </Field>
      <Field label="Cómo" id={`mode-${variantId}`} error={state.fields?.mode}>
        {(c) => (
          <select
            {...c}
            name="mode"
            defaultValue="delta"
            className={control}
            disabled={type !== "adjustment"}
          >
            <option value="delta">Sumar o restar</option>
            <option value="set">Fijar en</option>
          </select>
        )}
      </Field>
      {type !== "adjustment" ? <input type="hidden" name="mode" value="delta" /> : null}
      <Field
        label={`Cantidad de ${label}`}
        id={`qty-${variantId}`}
        hint={type === "adjustment" ? "Usa negativo para restar." : "Unidades que se restan."}
        error={state.fields?.quantity}
      >
        {(c) => (
          <Input
            {...c}
            name="quantity"
            inputMode="numeric"
            defaultValue={state.values?.quantity ?? ""}
            key={`q-${key}-${state.values?.quantity ?? ""}`}
            className="w-28"
          />
        )}
      </Field>
      <Field label="Motivo" id={`reason-${variantId}`} required error={state.fields?.reason}>
        {(c) => (
          <Input
            {...c}
            name="reason"
            maxLength={500}
            placeholder="Conteo físico, llegó dañado…"
            defaultValue={state.values?.reason ?? ""}
            key={`r-${key}-${state.values?.reason ?? ""}`}
          />
        )}
      </Field>
      <Button type="submit" size="sm" loading={pending}>
        Guardar ajuste
      </Button>
      <div className="sm:col-span-5" aria-live="polite">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function ThresholdForm({
  storeHandle,
  variantId,
  label,
  threshold,
}: {
  storeHandle: string;
  variantId: string;
  label: string;
  threshold: number | null;
}) {
  const [state, action, pending] = useActionState<InventoryActionState, FormData>(
    setLowStockThreshold.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="variant_id" value={variantId} />
      <Field
        label={`Avisar con stock bajo de ${label}`}
        id={`threshold-${variantId}`}
        hint="Vacío: sin aviso."
        error={state.fields?.threshold}
      >
        {(c) => (
          <Input
            {...c}
            name="threshold"
            inputMode="numeric"
            defaultValue={threshold ?? ""}
            className="w-24"
          />
        )}
      </Field>
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        Guardar aviso
      </Button>
      <div aria-live="polite">
        <Feedback state={state} />
      </div>
    </form>
  );
}
