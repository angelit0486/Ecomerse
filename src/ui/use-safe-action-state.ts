"use client";

import { useActionState } from "react";

// Sin respuesta no se sabe si el cambio llegó: el texto no promete que no se
// guardó, para no provocar un segundo reembolso o un pedido repetido.
export const OFFLINE_MESSAGE =
  "Sin conexión a internet: no pudimos confirmar si se guardó. Cuando vuelva la conexión, revisa y vuelve a intentarlo.";
export const UNREACHABLE_MESSAGE =
  "El servidor no respondió y no pudimos confirmar si se guardó. Revisa en un momento y, si no quedó, vuelve a intentarlo.";

/** redirect() y notFound() de Next viajan como errores con `digest` «NEXT_…». */
export function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

/** Aviso cuando la acción no llegó o no respondió (sin red o servidor caído). */
export function unreachableMessage(): string {
  return typeof navigator !== "undefined" && navigator.onLine === false
    ? OFFLINE_MESSAGE
    : UNREACHABLE_MESSAGE;
}

// No se devuelven al formulario. Por segmento del nombre: `code` (cupón) o
// `postal_code` sí se conservan (revisión del Paso 1, H3).
const SENSITIVE = /(^|_)(password|contrasena|token|secret|otp|totp)(_|$)/i;

function submittedValues(payload: unknown): Record<string, string> | undefined {
  if (!(payload instanceof FormData)) return undefined;
  const values: Record<string, string> = {};
  // Gana el último valor: una casilla va después de su `hidden` con «0» (H5).
  for (const [key, value] of payload.entries()) {
    if (typeof value === "string" && !SENSITIVE.test(key)) values[key] = value;
  }
  return values;
}

/**
 * `useActionState` del panel (auditoría de detalles, D-9). Si la acción no llega
 * al servidor (sin red, servidor caído), devuelve un error accionable y lo que
 * se envió en `values`, en lugar de lanzar y cambiar la pantalla por la de
 * error, que desmontaba el formulario y perdía lo escrito. Los errores de la
 * propia acción ya llegan como estado (`reportActionError`) y pasan tal cual.
 */
export function useSafeActionState<State>(
  action: (state: Awaited<State>) => State | Promise<State>,
  initialState: Awaited<State>,
  permalink?: string,
): [state: Awaited<State>, dispatch: () => void, isPending: boolean];
export function useSafeActionState<State, Payload>(
  action: (state: Awaited<State>, payload: Payload) => State | Promise<State>,
  initialState: Awaited<State>,
  permalink?: string,
): [state: Awaited<State>, dispatch: (payload: Payload) => void, isPending: boolean];
export function useSafeActionState<State, Payload>(
  action: (state: Awaited<State>, payload: Payload) => State | Promise<State>,
  initialState: Awaited<State>,
  permalink?: string,
) {
  return useActionState<State, Payload>(
    async (state, payload) => {
      try {
        const next = await action(state, payload);
        // Con error y sin `values` (p. ej. sesión vencida), se devuelve lo enviado
        // para que el formulario no pierda lo escrito al reiniciarse.
        const result = next as { error?: unknown; values?: unknown } | null;
        if (result && typeof result === "object" && result.error && !result.values) {
          const values = submittedValues(payload);
          if (values) return { ...result, values } as State;
        }
        return next;
      } catch (error) {
        if (isNextControlFlow(error)) throw error;
        // Sin causa en la pantalla, al menos en la consola del navegador (H6).
        console.error(error);
        const values = submittedValues(payload);
        // Sin el estado anterior: sus errores de campo ya no aplican (H7).
        return { ok: false, error: unreachableMessage(), ...(values ? { values } : {}) } as State;
      }
    },
    initialState,
    permalink,
  );
}
