"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { anonymizeCustomer, updateCustomer } from "./actions";

const inputClass =
  "h-11 md:h-9 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-sm";

export function CustomerForm({
  storeHandle,
  customerId,
  initial,
}: {
  storeHandle: string;
  customerId: string;
  initial: {
    first_name: string;
    last_name: string;
    phone: string;
    note: string;
    accepts_marketing: boolean;
  };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    updateCustomer.bind(null, storeHandle, customerId),
    {},
  );
  const v = { ...initial, ...state.values };
  return (
    <form action={action} className="grid max-w-lg gap-3 sm:grid-cols-2" noValidate>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Nombre
        <input
          name="first_name"
          maxLength={80}
          defaultValue={v.first_name}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Apellidos
        <input name="last_name" maxLength={80} defaultValue={v.last_name} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Teléfono
        <input name="phone" maxLength={20} defaultValue={v.phone} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
        Nota interna (el cliente no la ve)
        <textarea
          name="note"
          maxLength={2000}
          rows={3}
          defaultValue={v.note}
          className="rounded-[var(--radius-control)] border border-control bg-surface p-2 text-sm"
        />
      </label>
      {initial.accepts_marketing ? (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="accepts_marketing"
            value="1"
            defaultChecked={state.values?.accepts_marketing !== "0"}
          />
          Acepta recibir publicidad (desmarca para retirarlo)
        </label>
      ) : null}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" loading={pending}>
          Guardar
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function AnonymizeForm({
  storeHandle,
  customerId,
}: {
  storeHandle: string;
  customerId: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    anonymizeCustomer.bind(null, storeHandle, customerId),
    {},
  );
  return (
    <form action={action} className="max-w-lg space-y-3" noValidate>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Motivo
        <input
          name="reason"
          maxLength={500}
          defaultValue={state.values?.reason}
          placeholder="Por ejemplo: el cliente pidió eliminar sus datos"
          aria-describedby="reason-hint"
          className={inputClass}
        />
        <span id="reason-hint" className="text-[13px] font-normal text-fg-muted">
          Queda en la actividad de la tienda: no escribas datos personales del cliente.
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="confirm"
          value="1"
          defaultChecked={state.values?.confirm === "1"}
        />
        Entiendo que no se puede deshacer
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="danger" loading={pending}>
          Eliminar datos personales
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}
