"use client";

import { Checkbox as C } from "radix-ui";
import { useId } from "react";

import { cn } from "@/lib/cn";

export interface CheckboxProps {
  label: string;
  name?: string;
  value?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/** Casilla con etiqueta siempre visible (GATE0 §32.5). */
export function Checkbox({ label, onCheckedChange, ...rest }: CheckboxProps) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <C.Root
        id={id}
        {...rest}
        onCheckedChange={(state) => onCheckedChange?.(state === true)}
        className={cn(
          "flex size-4 items-center justify-center rounded-[4px] border border-control bg-surface",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          "data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50",
        )}
      >
        <C.Indicator className="text-accent-fg">
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M2 6.5 5 9l5-6" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </C.Indicator>
      </C.Root>
      <label htmlFor={id} className="text-sm text-fg">
        {label}
      </label>
    </div>
  );
}
