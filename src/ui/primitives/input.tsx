import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, type = "text", ...rest }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        "h-9 w-full rounded-[var(--radius-control)] border border-control bg-surface px-3 text-sm text-fg",
        "placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-60",
        "aria-[invalid=true]:border-danger",
        className,
      )}
      {...rest}
    />
  );
}
