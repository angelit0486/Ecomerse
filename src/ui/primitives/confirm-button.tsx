"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button, type ButtonProps } from "./button";

export interface ConfirmButtonProps extends Omit<ButtonProps, "type" | "children"> {
  /**
   * Lo que se pregunta antes de actuar, p. ej. «¿Eliminar «Termo»?». Como función,
   * se calcula al abrir la pregunta con el formulario de ese momento (el monto de
   * un reembolso, por ejemplo).
   */
  question: string | ((form: HTMLFormElement | null) => string);
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
 *
 * La pregunta no se queda armada (revisión del Paso 1, H1 y H2): se cierra
 * cuando la acción termina (`loading` pasa a falso) y cuando cambia cualquier
 * campo del formulario, para que «Sí» siempre confirme lo que se ve.
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
  // La pregunta abierta, ya calculada; null = cerrada.
  const [asking, setAsking] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  const group = useRef<HTMLSpanElement>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const returnFocus = useRef(false);
  const wasLoading = useRef(false);

  useEffect(() => {
    if (asking !== null) yes.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [asking]);

  // Terminó la acción (con éxito o error): se cierra; para repetirla hay que
  // volver a confirmar.
  useEffect(() => {
    if (wasLoading.current && !loading && asking !== null) {
      returnFocus.current = true;
      setAsking(null);
    }
    wasLoading.current = Boolean(loading);
  }, [loading, asking]);

  // Un campo cambió con la pregunta abierta: lo que se confirmaría ya no es lo
  // que se preguntó.
  useEffect(() => {
    const target = form.current;
    if (asking === null || !target) return;
    const close = (event: Event) => {
      if (group.current?.contains(event.target as Node)) return;
      setAsking(null);
    };
    target.addEventListener("input", close);
    target.addEventListener("change", close);
    return () => {
      target.removeEventListener("input", close);
      target.removeEventListener("change", close);
    };
  }, [asking]);

  const open = () => {
    form.current = trigger.current?.form ?? null;
    setAsking(typeof question === "function" ? question(form.current) : question);
  };

  const cancel = () => {
    returnFocus.current = true;
    setAsking(null);
  };

  if (asking === null) {
    return (
      <Button
        ref={trigger}
        variant={variant === "danger" ? "secondary" : variant}
        size={size}
        loading={loading}
        disabled={disabled}
        className={className}
        onClick={open}
        {...rest}
      >
        {children}
      </Button>
    );
  }
  return (
    <span
      ref={group}
      role="group"
      aria-label={asking}
      className="inline-flex flex-wrap items-center gap-2 rounded-md border border-danger/40 bg-surface p-2 text-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape") cancel();
      }}
    >
      <span className="font-medium">{asking}</span>
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
