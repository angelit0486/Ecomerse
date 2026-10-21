"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button, type ButtonProps } from "./button";

export interface ConfirmButtonProps extends Omit<ButtonProps, "type" | "children"> {
  /** Lo que se pregunta antes de actuar, p. ej. «¿Eliminar «Termo»?». */
  question: string;
  /** Texto del botón que confirma; por defecto «Sí, <acción en minúscula>». */
  confirmLabel?: string;
  children: string;
  /** Contexto opcional bajo la pregunta (qué se pierde, si se puede deshacer). */
  detail?: ReactNode;
}

/**
 * Acción destructiva en dos pasos dentro de la página (auditoría de detalles,
 * D-7): el primer clic pregunta y «Sí, …» envía el formulario con el `name`,
 * `value` y `formAction` del botón. Sin `window.confirm`: se lee con lector de
 * pantalla, se cancela con Escape y no bloquea la página.
 */
export function ConfirmButton({
  question,
  confirmLabel,
  children,
  detail,
  variant = "danger",
  size,
  loading,
  disabled,
  className,
  name,
  value,
  formAction,
  ...rest
}: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (asking) yes.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [asking]);

  const cancel = () => {
    returnFocus.current = true;
    setAsking(false);
  };

  if (!asking) {
    return (
      <Button
        ref={trigger}
        variant={variant === "danger" ? "secondary" : variant}
        size={size}
        loading={loading}
        disabled={disabled}
        className={className}
        onClick={() => setAsking(true)}
        {...rest}
      >
        {children}
      </Button>
    );
  }
  return (
    <span
      role="group"
      aria-label={question}
      className="inline-flex flex-wrap items-center gap-2 rounded-md border border-danger/40 bg-surface p-2 text-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape") cancel();
      }}
    >
      <span className="font-medium">{question}</span>
      {detail ? <span className="basis-full text-[13px] text-fg-muted">{detail}</span> : null}
      <Button
        ref={yes}
        type="submit"
        variant={variant}
        size={size}
        loading={loading}
        disabled={disabled}
        name={name}
        value={value}
        formAction={formAction}
      >
        {confirmLabel ?? `Sí, ${children.charAt(0).toLowerCase()}${children.slice(1)}`}
      </Button>
      <Button variant="ghost" size={size} onClick={cancel} disabled={loading}>
        No
      </Button>
    </span>
  );
}
