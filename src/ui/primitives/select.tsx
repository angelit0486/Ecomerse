"use client";

import { cn } from "@/lib/cn";

import type { FieldControlProps } from "./field";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Partial<FieldControlProps> {
  options: readonly SelectOption[];
  name?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Nombre accesible cuando no hay etiqueta visible (p. ej. dentro de una tabla). */
  "aria-label"?: string;
  onValueChange?: (value: string) => void;
}

/**
 * Selector nativo que se usa dentro de Field: recibe id y aria-* del campo y
 * funciona en formularios con Server Actions sin JavaScript. Antes era el Select
 * de Radix, que escribe atributos `style` en el HTML del servidor: la CSP con
 * nonce los bloquea (GATE0 §44.13) y cada pantalla dejaba errores en la consola.
 */
export function Select({
  options,
  placeholder = "Elige una opción",
  value,
  defaultValue,
  onValueChange,
  ...rest
}: SelectProps) {
  // Sin valor inicial, una opción vacía pide elegir (y `required` la rechaza).
  const empty = value === undefined && !options.some((o) => o.value === defaultValue);
  return (
    <div className="relative">
      <select
        {...rest}
        {...(value !== undefined ? { value } : { defaultValue: empty ? "" : defaultValue })}
        onChange={onValueChange ? (e) => onValueChange(e.target.value) : undefined}
        className={cn(
          "flex h-11 w-full appearance-none items-center md:h-9 rounded-[var(--radius-control)] border border-control",
          "bg-surface pl-3 pr-8 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2",
          "focus-visible:outline-focus aria-[invalid=true]:border-danger disabled:opacity-50",
        )}
      >
        {empty ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled ?? false}>
            {option.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-fg"
      >
        ▾
      </span>
    </div>
  );
}
