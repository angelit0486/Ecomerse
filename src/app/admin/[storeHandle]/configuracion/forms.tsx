"use client";

import { hasUnrenderedFieldError } from "@/lib/form-values";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { Select } from "@/ui/primitives/select";

import { saveStoreProfile, type StepState } from "./actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

function Feedback({ state, rendered = [] }: { state: StepState; rendered?: readonly string[] }) {
  if (state.ok) {
    return (
      <p role="status" className="text-sm text-success">
        {state.message}
      </p>
    );
  }
  if (state.error && hasUnrenderedFieldError(state.fields, rendered)) {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  }
  return null;
}

/** Nombres que la dueña reconoce (México primero); el valor sigue siendo la zona IANA. */
const TIMEZONE_LABELS: Record<string, string> = {
  "America/Mexico_City": "Centro de México (Ciudad de México, Guadalajara)",
  "America/Monterrey": "Monterrey",
  "America/Cancun": "Quintana Roo (Cancún)",
  "America/Mazatlan": "Pacífico (Baja California Sur, Sinaloa, Nayarit)",
  "America/Hermosillo": "Sonora (Hermosillo)",
  "America/Chihuahua": "Chihuahua",
  "America/Tijuana": "Baja California (Tijuana)",
};

export function ProfileForm({
  storeHandle,
  initial,
  timezones,
}: {
  storeHandle: string;
  initial: { name: string; contact_email: string; contact_phone: string; timezone: string };
  timezones: string[];
}) {
  const [state, action, pending] = useSafeActionState(saveStoreProfile.bind(null, storeHandle), {});
  return (
    <form action={action} className="grid max-w-lg gap-4" noValidate>
      <Field label="Nombre de la tienda" required error={state.fields?.name}>
        {(c) => <Input {...c} name="name" defaultValue={state.values?.name ?? initial.name} />}
      </Field>
      <Field
        label="Email de contacto"
        hint="Lo verán tus clientes y es obligatorio para lanzar."
        required
        error={state.fields?.contact_email}
      >
        {(c) => (
          <Input
            {...c}
            name="contact_email"
            type="email"
            defaultValue={state.values?.contact_email ?? initial.contact_email}
          />
        )}
      </Field>
      <Field label="Teléfono" error={state.fields?.contact_phone}>
        {(c) => (
          <Input
            {...c}
            name="contact_phone"
            type="tel"
            defaultValue={state.values?.contact_phone ?? initial.contact_phone}
          />
        )}
      </Field>
      <Field label="Zona horaria" required error={state.fields?.timezone}>
        {(c) => (
          <Select
            {...c}
            name="timezone"
            defaultValue={state.values?.timezone ?? initial.timezone}
            options={timezones.map((tz) => ({
              value: tz,
              label: TIMEZONE_LABELS[tz] ?? tz.replace(/_/g, " "),
            }))}
          />
        )}
      </Field>
      <Feedback state={state} rendered={["name", "contact_email", "contact_phone", "timezone"]} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar datos"}
        </Button>
      </div>
    </form>
  );
}
