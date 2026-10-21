"use client";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { saveNotifications } from "./actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

export function NotificationsForm({
  storeHandle,
  initial,
  contactEmail,
}: {
  storeHandle: string;
  initial: { staff_emails: string; notify_new_order: boolean; notify_paid: boolean };
  contactEmail: string | null;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    saveNotifications.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="max-w-lg space-y-4" noValidate>
      <Field
        label="Quién recibe los avisos de la tienda"
        hint={`Hasta 5 emails, uno por línea. Si lo dejas vacío, usamos el email de contacto${contactEmail ? ` (${contactEmail})` : ""}.`}
        error={state.fields?.staff_emails}
      >
        {(c) => (
          <textarea
            {...c}
            name="staff_emails"
            rows={4}
            defaultValue={state.values?.staff_emails ?? initial.staff_emails}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
          />
        )}
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium">Avisarme cuando</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="notify_new_order"
            value="1"
            defaultChecked={
              state.values ? state.values.notify_new_order === "1" : initial.notify_new_order
            }
          />
          llegue un pedido con pago por transferencia
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="notify_paid"
            value="1"
            defaultChecked={state.values ? state.values.notify_paid === "1" : initial.notify_paid}
          />
          un pedido quede pagado y listo para preparar
        </label>
      </fieldset>
      <p className="text-[13px] text-fg-muted">
        Los avisos de pagos que necesitan atención (por ejemplo, pagados sin existencias) siempre se
        envían.
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          Guardar
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}
