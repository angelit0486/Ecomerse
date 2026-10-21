"use client";

import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { deleteRedirect, saveRedirect } from "./actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

export function RedirectForm({ storeHandle }: { storeHandle: string }) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    saveRedirect.bind(null, storeHandle),
    {},
  );
  const values = state.ok ? {} : (state.values ?? {});
  return (
    <form action={action} className="grid max-w-2xl gap-3 sm:grid-cols-2" noValidate>
      <Field
        label="Dirección vieja"
        hint="Por ejemplo /productos/proteina-2024"
        error={state.fields?.from_path}
      >
        {(c) => <Input {...c} name="from_path" defaultValue={values.from_path} maxLength={500} />}
      </Field>
      <Field label="Llevar a" hint="Por ejemplo /productos/proteina" error={state.fields?.to_path}>
        {(c) => <Input {...c} name="to_path" defaultValue={values.to_path} maxLength={500} />}
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>
          Guardar redirección
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function DeleteRedirect({
  storeHandle,
  id,
  from,
}: {
  storeHandle: string;
  id: string;
  from: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    deleteRedirect.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="redirect_id" value={id} />
      <ConfirmButton
        size="sm"
        loading={pending}
        aria-label={`Quitar ${from}`}
        question={`¿Quitar la redirección de ${from}?`}
        detail="Quien abra esa dirección ya no se enviará a la nueva."
      >
        Quitar
      </ConfirmButton>
      <FormFeedback state={state} />
    </form>
  );
}
