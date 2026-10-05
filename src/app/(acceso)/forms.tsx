"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import type { EnrollState, FormState } from "./actions";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export function EmailForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <Field label="Email" required error={state.error}>
        {(control) => (
          <Input
            {...control}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
          />
        )}
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Enviando…" : "Enviarme un código"}
      </Button>
    </form>
  );
}

export function CodeForm({
  action,
  label,
  hidden = {},
  submitLabel = "Continuar",
}: {
  action: Action;
  label: string;
  hidden?: Record<string, string>;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Field label={label} required error={state.error}>
        {(control) => (
          <Input
            {...control}
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoFocus
          />
        )}
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Verificando…" : submitLabel}
      </Button>
    </form>
  );
}

export function TotpEnrollment({
  start,
  verify,
}: {
  start: (state: EnrollState) => Promise<EnrollState>;
  verify: Action;
}) {
  const [state, startAction, pending] = useActionState(start, {});
  if (!state.factorId) {
    return (
      <form action={startAction} className="flex flex-col gap-3">
        {state.error ? (
          <p role="alert" className="text-[13px] text-danger">
            {state.error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Preparando…" : "Activar verificación en dos pasos"}
        </Button>
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-muted">
        <li>Abre tu app de autenticación (Google Authenticator, 1Password, Authy…).</li>
        <li>Escanea el código QR o escribe la clave.</li>
        <li>Escribe el código de 6 dígitos que muestra la app.</li>
      </ol>
      {/* QR en data URI (SVG) generado por Supabase Auth; no pasa por el optimizador. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={state.qrCode}
        alt="Código QR para tu app de autenticación"
        width={180}
        height={180}
        className="self-center rounded-md border bg-white p-2"
      />
      <p className="text-sm">
        Clave:{" "}
        <code data-testid="totp-secret" className="break-all font-mono">
          {state.secret}
        </code>
      </p>
      <CodeForm
        action={verify}
        label="Código de la app"
        hidden={{ factorId: state.factorId, enrolling: "1" }}
        submitLabel="Activar y entrar"
      />
    </div>
  );
}

/** Botón que ejecuta una acción sin campos y muestra su error. */
export function ActionButton({
  action,
  label,
}: {
  action: () => Promise<FormState>;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.error ? (
        <p role="alert" className="text-[13px] text-danger">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Un momento…" : label}
      </Button>
    </form>
  );
}
