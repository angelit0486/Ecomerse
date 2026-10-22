"use client";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { useSafeActionState } from "@/ui/use-safe-action-state";

import { createStore, type NewStoreState } from "./actions";

/** ADR-038: nombre y dirección; lo demás se configura después, en borrador. */
export function NewStoreForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useSafeActionState(createStore.bind(null, organizationId), {
    values: {},
  } as NewStoreState);
  const unrendered = state.error && !state.fields;
  return (
    <form action={action} className="grid max-w-lg gap-4" noValidate>
      <Field label="Nombre de la tienda" required error={state.fields?.store_name}>
        {(c) => (
          <Input
            {...c}
            name="store_name"
            maxLength={80}
            defaultValue={state.values?.store_name}
            autoComplete="off"
          />
        )}
      </Field>
      <Field
        label="Dirección de la tienda"
        hint="Minúsculas, números y guiones; por ejemplo «pruva-mujer». Será su subdominio mientras no tenga dominio propio y no se puede cambiar después."
        required
        error={state.fields?.store_handle}
      >
        {(c) => (
          <Input
            {...c}
            name="store_handle"
            maxLength={40}
            defaultValue={state.values?.store_handle}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </Field>
      {unrendered ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creando…" : "Crear tienda"}
        </Button>
      </div>
    </form>
  );
}
