"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
  type FormEvent,
} from "react";

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
  const form = useRef<HTMLFormElement>(null);
  const query = useSearchParams().toString();
  // Los campos no son controlados: si la URL cambia por otro camino (quitar un
  // filtro activo, «Quitar filtros», Atrás), se vuelven a alinear con lo que
  // pintó el servidor; si no, un filtro quitado reaparecería al marcar otro.
  useEffect(() => {
    for (const el of Array.from(form.current?.elements ?? [])) {
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        el.checked = el.defaultChecked;
      } else if (el instanceof HTMLSelectElement) {
        for (const option of Array.from(el.options)) option.selected = option.defaultSelected;
      }
    }
  }, [query]);
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
      ref={form}
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
