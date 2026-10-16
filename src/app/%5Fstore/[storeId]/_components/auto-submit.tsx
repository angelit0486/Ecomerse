"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore, type ComponentProps, type FormEvent } from "react";

const noSubscribe = () => () => {};

/** true solo en el navegador con JavaScript ya hidratado. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Formulario GET que con JavaScript se aplica al cambiar un campo (revisión de
 * conversión, M6): sin «Aplicar» ni recarga completa, y sin saltar al inicio de
 * la página. Sin JavaScript es un formulario normal con su botón.
 */
export function AutoSubmitForm({
  action,
  children,
  ...props
}: Omit<ComponentProps<"form">, "action" | "method" | "onChange"> & { action: string }) {
  const router = useRouter();
  function apply(form: HTMLFormElement) {
    const params = new URLSearchParams();
    for (const [name, value] of new FormData(form)) {
      if (typeof value === "string") params.append(name, value);
    }
    const qs = params.toString();
    router.push(qs ? `${action}?${qs}` : action, { scroll: false });
  }
  return (
    <form
      {...props}
      method="get"
      action={action}
      onChange={(e: FormEvent<HTMLFormElement>) => apply(e.currentTarget)}
    >
      {children}
    </form>
  );
}

/** Botón de envío que solo se ve sin JavaScript (con JS el formulario se aplica solo). */
export function NoJsSubmit({ className, ...props }: ComponentProps<"button">) {
  const hydrated = useHydrated();
  return (
    <button type="submit" {...props} className={`${className ?? ""} ${hydrated ? "hidden" : ""}`} />
  );
}
