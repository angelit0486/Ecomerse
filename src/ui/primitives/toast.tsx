"use client";

import { Toast as T } from "radix-ui";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Avisos breves (Radix Toast): se anuncian en una región aria-live; los de error
 * con prioridad alta. No sustituyen al error junto al campo.
 */
type Tone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

const ToastContext = createContext<((toast: Omit<ToastItem, "id">) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((toast: Omit<ToastItem, "id">) => {
    setItems((current) => [...current, { ...toast, id: Date.now() + Math.random() }]);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      <T.Provider swipeDirection="right" duration={6000} label="Notificación">
        {children}
        {items.map((item) => (
          <T.Root
            key={item.id}
            type={item.tone === "error" ? "foreground" : "background"}
            onOpenChange={(open) => {
              if (!open) setItems((current) => current.filter((i) => i.id !== item.id));
            }}
            className={cn(
              "rounded-[var(--radius-container)] border bg-surface p-4 shadow-lg",
              item.tone === "error" ? "border-danger" : "border-border",
            )}
          >
            <T.Title className="text-sm font-semibold text-fg">{item.title}</T.Title>
            {item.description ? (
              <T.Description className="mt-1 text-sm text-fg-muted">
                {item.description}
              </T.Description>
            ) : null}
            <T.Close aria-label="Cerrar aviso" className="absolute right-2 top-2 text-fg-muted">
              ×
            </T.Close>
          </T.Root>
        ))}
        <T.Viewport
          label="Notificaciones ({hotkey})"
          className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100%-2rem)] flex-col gap-2"
        />
      </T.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast requiere <ToastProvider>");
  return show;
}
