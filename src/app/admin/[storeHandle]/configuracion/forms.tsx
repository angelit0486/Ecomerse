"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import {
  buttonTextColor,
  COLOR_KEYS,
  contrastIssues,
  type ColorKey,
  type Palette,
} from "@/lib/theme/palette";
import { hasUnrenderedFieldError } from "@/lib/form-values";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { Select } from "@/ui/primitives/select";

import { saveBranding, saveStoreProfile, type StepState } from "./actions";

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

export function ProfileForm({
  storeHandle,
  initial,
  timezones,
}: {
  storeHandle: string;
  initial: { name: string; contact_email: string; contact_phone: string; timezone: string };
  timezones: string[];
}) {
  const [state, action, pending] = useActionState(saveStoreProfile.bind(null, storeHandle), {});
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
            options={timezones.map((tz) => ({ value: tz, label: tz.replace(/_/g, " ") }))}
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

const COLOR_LABELS: Record<ColorKey, string> = {
  primary: "Color principal (botones)",
  accent: "Color de acento (enlaces y detalles)",
  background: "Fondo",
  foreground: "Texto",
  muted: "Texto secundario",
};

const ISSUE_TEXT: Record<ColorKey, string> = {
  foreground: "El texto no se lee bien sobre el fondo",
  muted: "El texto secundario no se lee bien sobre el fondo",
  primary: "Los botones no se distinguen del fondo",
  accent: "El acento no se distingue del fondo",
  background: "",
};

export function BrandingForm({
  storeHandle,
  storeName,
  initial,
  radius,
  buttonStyle,
}: {
  storeHandle: string;
  storeName: string;
  initial: Palette;
  radius: string;
  buttonStyle: string;
}) {
  const [palette, setPalette] = useState<Palette>(initial);
  const [state, action, pending] = useActionState(saveBranding.bind(null, storeHandle), {});
  const issues = useMemo(() => contrastIssues(palette), [palette]);
  const failing = new Set(issues.map((i) => i.key));

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-2" noValidate>
      <div className="grid gap-4">
        {COLOR_KEYS.map((key) => (
          <Field
            key={key}
            label={COLOR_LABELS[key]}
            error={failing.has(key) ? ISSUE_TEXT[key] : undefined}
          >
            {(c) => (
              <Input
                {...c}
                name={key}
                type="color"
                value={palette[key]}
                onChange={(e) => setPalette((p) => ({ ...p, [key]: e.target.value.toLowerCase() }))}
                className="h-10 w-24 p-1"
              />
            )}
          </Field>
        ))}
        <Field label="Esquinas de los botones">
          {(c) => (
            <Select
              {...c}
              name="radius"
              defaultValue={radius}
              options={[
                { value: "none", label: "Rectas" },
                { value: "sm", label: "Poco redondeadas" },
                { value: "md", label: "Redondeadas" },
                { value: "full", label: "Píldora" },
              ]}
            />
          )}
        </Field>
        <Field label="Estilo de los botones">
          {(c) => (
            <Select
              {...c}
              name="button_style"
              defaultValue={buttonStyle}
              options={[
                { value: "solid", label: "Relleno" },
                { value: "outline", label: "Contorno" },
              ]}
            />
          )}
        </Field>
      </div>
      <div className="space-y-4">
        <Preview palette={palette} storeName={storeName} />
        {issues.length > 0 ? (
          <p role="alert" className="text-sm text-danger">
            Ajusta los colores marcados: el contraste no es suficiente para leerse bien (WCAG AA).
          </p>
        ) : null}
        <Feedback state={state} />
        <Button type="submit" disabled={pending || issues.length > 0}>
          {pending ? "Guardando…" : "Guardar marca en borrador"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Vista previa con los colores elegidos. Los estilos se aplican por CSSOM tras el
 * montaje (la CSP con nonce bloquea atributos style en el HTML).
 */
function Preview({ palette, storeName }: { palette: Palette; storeName: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--p-bg", palette.background);
    el.style.setProperty("--p-fg", palette.foreground);
    el.style.setProperty("--p-muted", palette.muted);
    el.style.setProperty("--p-primary", palette.primary);
    el.style.setProperty("--p-primary-fg", buttonTextColor(palette.primary));
    el.style.setProperty("--p-accent", palette.accent);
  }, [palette]);
  return (
    <div
      ref={ref}
      aria-label="Vista previa de la marca"
      role="img"
      className="rounded-md border border-border bg-[var(--p-bg)] p-5"
    >
      <p className="text-lg font-semibold text-[var(--p-fg)]">{storeName}</p>
      <p className="mt-1 text-sm text-[var(--p-muted)]">
        Así verán tus clientes los textos secundarios.
      </p>
      <p className="mt-2 text-sm text-[var(--p-accent)] underline">Un enlace de ejemplo</p>
      <span className="mt-4 inline-block rounded-md bg-[var(--p-primary)] px-4 py-2 text-sm text-[var(--p-primary-fg)]">
        Agregar al carrito
      </span>
    </div>
  );
}
