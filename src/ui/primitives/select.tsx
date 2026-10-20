"use client";

import { Select as S } from "radix-ui";

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
 * Selector (Radix) que se usa dentro de Field: recibe id y aria-* del campo.
 * Con `name` incluye un <select> nativo oculto, así funciona en formularios con
 * Server Actions.
 */
export function Select({
  options,
  placeholder = "Elige una opción",
  id,
  required,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
  ...rest
}: SelectProps) {
  return (
    <S.Root {...rest} {...(required ? { required: true } : {})}>
      <S.Trigger
        id={id}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel}
        className={cn(
          "flex h-11 w-full items-center md:h-9 justify-between rounded-[var(--radius-control)] border border-control",
          "bg-surface px-3 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2",
          "focus-visible:outline-focus aria-[invalid=true]:border-danger disabled:opacity-50",
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon aria-hidden="true">▾</S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface shadow-lg"
        >
          <S.Viewport className="max-h-[inherit] overflow-y-auto p-1">
            {options.map((option) => (
              <S.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled ?? false}
                className="cursor-default rounded px-2 py-1.5 text-sm text-fg outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-canvas"
              >
                <S.ItemText>{option.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
