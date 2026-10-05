"use client";

import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Diálogo modal accesible (Radix, A-04): foco atrapado, Escape cierra, título y
 * descripción obligatorios (lectores de pantalla). Para confirmaciones y
 * formularios cortos; para paneles largos, Drawer.
 */
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export interface DialogContentProps {
  title: string;
  description: string;
  children?: ReactNode;
  className?: string;
}

export function DialogContent({ title, description, children, className }: DialogContentProps) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
          "rounded-[var(--radius-container)] bg-surface p-6 shadow-xl focus:outline-none",
          className,
        )}
      >
        <D.Title className="text-base font-semibold text-fg">{title}</D.Title>
        <D.Description className="mt-1 text-sm text-fg-muted">{description}</D.Description>
        <div className="mt-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
