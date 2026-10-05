"use client";

import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Panel lateral modal (mismo comportamiento accesible que Dialog). */
export const Drawer = D.Root;
export const DrawerTrigger = D.Trigger;
export const DrawerClose = D.Close;

export function DrawerContent({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <D.Content
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-surface shadow-xl focus:outline-none",
          className,
        )}
      >
        <header className="border-b border-border p-4">
          <D.Title className="text-base font-semibold text-fg">{title}</D.Title>
          <D.Description className="mt-1 text-sm text-fg-muted">{description}</D.Description>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
