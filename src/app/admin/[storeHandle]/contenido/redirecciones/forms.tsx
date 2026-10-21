"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { deleteRedirect, saveRedirect } from "./actions";

export function RedirectForm({ storeHandle }: { storeHandle: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
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
  const [state, action, pending] = useActionState<FormState, FormData>(
    deleteRedirect.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="redirect_id" value={id} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        loading={pending}
        aria-label={`Quitar ${from}`}
      >
        Quitar
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}
