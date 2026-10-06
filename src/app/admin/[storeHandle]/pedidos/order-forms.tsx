"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { confirmManualPayment, saveStaffNote } from "./actions";

export function ConfirmPaymentForm({
  storeHandle,
  orderId,
}: {
  storeHandle: string;
  orderId: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    confirmManualPayment.bind(null, storeHandle, orderId),
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Referencia del pago (opcional)
        <input
          name="note"
          maxLength={200}
          className="h-9 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-sm"
        />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" loading={pending}>
          Confirmar pago recibido
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function StaffNoteForm({
  storeHandle,
  orderId,
  note,
}: {
  storeHandle: string;
  orderId: string;
  note: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveStaffNote.bind(null, storeHandle, orderId),
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Nota interna
        <textarea
          name="staff_note"
          defaultValue={note}
          maxLength={4000}
          rows={3}
          className="rounded-[var(--radius-control)] border border-control bg-surface p-2 text-sm"
        />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Guardar nota
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}
