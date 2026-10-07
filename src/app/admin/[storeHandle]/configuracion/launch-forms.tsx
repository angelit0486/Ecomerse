"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import { FormFeedback } from "../_shared/form-feedback";
import { launchStore, saveManualPayment, type StepState } from "./actions";

export function ManualPaymentForm({
  storeHandle,
  initial,
}: {
  storeHandle: string;
  initial: { display_name: string; instructions: string; active: boolean };
}) {
  const [state, action, pending] = useActionState<StepState, FormData>(
    saveManualPayment.bind(null, storeHandle),
    {},
  );
  const values = { ...initial, ...state.values };
  return (
    <form action={action} className="max-w-lg space-y-4" noValidate>
      <Field
        label="Nombre que ve el comprador"
        hint="Por ejemplo, «Transferencia bancaria»."
        error={state.fields?.display_name}
      >
        {(c) => (
          <Input {...c} name="display_name" defaultValue={values.display_name} maxLength={80} />
        )}
      </Field>
      <Field
        label="Instrucciones de pago"
        hint="Banco, CLABE y titular. Se muestran al comprador y en su email."
        error={state.fields?.instructions}
      >
        {(c) => (
          <textarea
            {...c}
            name="instructions"
            defaultValue={values.instructions}
            maxLength={2000}
            rows={4}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
          />
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          value="1"
          defaultChecked={state.values ? state.values.active === "1" : initial.active}
        />
        Aceptar pagos por transferencia
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          Guardar pago
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function LaunchButton({ storeHandle, ready }: { storeHandle: string; ready: boolean }) {
  const [state, action, pending] = useActionState<StepState>(
    launchStore.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex items-center gap-3">
      <Button type="submit" loading={pending} disabled={!ready}>
        Publicar tienda
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}
