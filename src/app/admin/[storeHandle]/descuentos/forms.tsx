"use client";

import { useActionState, useState } from "react";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { nativeControl } from "../productos/styles";
import { saveDiscount, setDiscountStatus } from "./actions";

export interface DiscountValues {
  id: string;
  code: string;
  type: "percentage" | "fixed_amount" | "free_shipping";
  value: string;
  min_subtotal: string;
  starts_at: string;
  ends_at: string;
  usage_limit: string;
  usage_limit_per_customer: string;
}

export function DiscountForm({
  storeHandle,
  discount,
  currency,
}: {
  storeHandle: string;
  discount?: DiscountValues;
  currency: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveDiscount.bind(null, storeHandle),
    {},
  );
  const [type, setType] = useState(discount?.type ?? "percentage");
  const v = (k: keyof DiscountValues) => state.values?.[k] ?? discount?.[k] ?? "";
  const p = discount ? `d-${discount.id}` : "d-new";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3 sm:items-end" noValidate>
      {discount ? <input type="hidden" name="id" value={discount.id} /> : null}
      <Field
        label="Código"
        id={`${p}-code`}
        required
        error={state.fields?.code ?? state.fields?.code_taken ?? state.fields?.code_locked}
      >
        {(c) => (
          <Input
            {...c}
            name="code"
            defaultValue={v("code")}
            maxLength={32}
            autoCapitalize="characters"
          />
        )}
      </Field>
      <Field label="Tipo" id={`${p}-type`}>
        {(c) => (
          <select
            {...c}
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as DiscountValues["type"])}
            className={nativeControl}
          >
            <option value="percentage">Porcentaje</option>
            <option value="fixed_amount">Monto fijo</option>
            <option value="free_shipping">Envío gratis</option>
          </select>
        )}
      </Field>
      {type !== "free_shipping" ? (
        <Field
          label={type === "percentage" ? "Porcentaje (%)" : `Monto (${currency})`}
          id={`${p}-value`}
          error={state.fields?.value}
        >
          {(c) => <Input {...c} name="value" defaultValue={v("value")} inputMode="decimal" />}
        </Field>
      ) : null}
      <Field label={`Compra mínima (${currency}, opcional)`} id={`${p}-min`}>
        {(c) => (
          <Input {...c} name="min_subtotal" defaultValue={v("min_subtotal")} inputMode="decimal" />
        )}
      </Field>
      <Field label="Desde (opcional)" id={`${p}-start`}>
        {(c) => <Input {...c} type="date" name="starts_at" defaultValue={v("starts_at")} />}
      </Field>
      <Field label="Hasta (opcional)" id={`${p}-end`}>
        {(c) => <Input {...c} type="date" name="ends_at" defaultValue={v("ends_at")} />}
      </Field>
      <Field label="Usos totales (opcional)" id={`${p}-limit`}>
        {(c) => (
          <Input {...c} name="usage_limit" defaultValue={v("usage_limit")} inputMode="numeric" />
        )}
      </Field>
      <Field label="Usos por cliente (opcional)" id={`${p}-limit-c`}>
        {(c) => (
          <Input
            {...c}
            name="usage_limit_per_customer"
            defaultValue={v("usage_limit_per_customer")}
            inputMode="numeric"
          />
        )}
      </Field>
      <Button
        type="submit"
        size="sm"
        variant={discount ? "secondary" : "primary"}
        loading={pending}
      >
        {discount ? "Guardar" : "Crear descuento"}
      </Button>
      <div className="sm:col-span-3">
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function StatusButtons({
  storeHandle,
  id,
  status,
  code,
}: {
  storeHandle: string;
  id: string;
  status: string;
  code: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    setDiscountStatus.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {status === "active" ? (
        <Button
          type="submit"
          name="status"
          value="disabled"
          size="sm"
          variant="secondary"
          loading={pending}
          aria-label={`Desactivar ${code}`}
        >
          Desactivar
        </Button>
      ) : (
        <Button
          type="submit"
          name="status"
          value="active"
          size="sm"
          variant="secondary"
          loading={pending}
          aria-label={`Activar ${code}`}
        >
          Activar
        </Button>
      )}
      <Button
        type="submit"
        name="status"
        value="archived"
        size="sm"
        variant="ghost"
        disabled={pending}
        aria-label={`Archivar ${code}`}
      >
        Archivar
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}
