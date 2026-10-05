"use client";

import { useId, type ReactNode } from "react";

/** Props que Field entrega al control para asociar etiqueta, ayuda y error. */
export interface FieldControlProps {
  id: string;
  required?: boolean;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  id?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Campo de formulario accesible (GATE0 §32.5): etiqueta siempre visible, ayuda y
 * error asociados por aria-describedby, aria-invalid cuando hay error.
 */
export function Field({ label, hint, error, required, id, children }: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={controlId} className="text-[13px] font-medium text-fg">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-[13px] text-fg-muted">
          {hint}
        </p>
      ) : null}
      {children({
        id: controlId,
        ...(required ? { required: true } : {}),
        ...(error ? { "aria-invalid": true as const } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      })}
      {error ? (
        <p id={errorId} className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
