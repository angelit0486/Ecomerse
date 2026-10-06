"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { saveTaxes } from "./actions";

export function TaxForm({
  storeHandle,
  initial,
  canEdit,
}: {
  storeHandle: string;
  initial: { rate: string; include: boolean; shipping: boolean };
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveTaxes.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="max-w-lg space-y-5" noValidate>
      <fieldset disabled={!canEdit} className="space-y-5">
        <Field
          label="Tasa de impuesto (%)"
          hint="Por ejemplo, 16 para IVA del 16 %."
          error={state.fields?.rate}
        >
          {(c) => (
            <Input
              {...c}
              name="rate"
              defaultValue={initial.rate}
              inputMode="decimal"
              maxLength={6}
            />
          )}
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium">Los precios de mis productos</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="prices_include_tax"
              value="1"
              defaultChecked={initial.include}
            />
            ya incluyen el impuesto
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="prices_include_tax"
              value="0"
              defaultChecked={!initial.include}
            />
            no lo incluyen (se suma en el checkout)
          </label>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="tax_applies_to_shipping"
            value="1"
            defaultChecked={initial.shipping}
          />
          El envío también paga impuesto
        </label>
        {canEdit ? (
          <div className="flex items-center gap-3">
            <Button type="submit" loading={pending}>
              Guardar
            </Button>
            <FormFeedback state={state} />
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
