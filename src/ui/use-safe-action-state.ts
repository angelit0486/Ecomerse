"use client";

import { useActionState } from "react";

// Sin respuesta no se sabe si el cambio llegó: el texto no promete que no se
// guardó, para no provocar un segundo reembolso o un pedido repetido.
export const OFFLINE_MESSAGE =
  "Sin conexión a internet: no pudimos confirmar si se guardó. Cuando vuelva la conexión, revisa y vuelve a intentarlo.";
export const UNREACHABLE_MESSAGE =
  "El servidor no respondió y no pudimos confirmar si se guardó. Revisa en un momento y, si no quedó, vuelve a intentarlo.";

/** redirect() y notFound() de Next viajan como errores con `digest` «NEXT_…». */
function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

// No se devuelven al formulario: una contraseña o un código no deben quedar escritos.
const SENSITIVE = /password|contrasena|token|secret|code|otp|totp/i;

function submittedValues(payload: unknown): Record<string, string> | undefined {
  if (!(payload instanceof FormData)) return undefined;
  const values: Record<string, string> = {};
  for (const [key, value] of payload.entries()) {
    if (typeof value === "string" && !(key in values) && !SENSITIVE.test(key)) values[key] = value;
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
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        const values = submittedValues(payload);
        return {
          ...(state as object),
          ok: false,
          message: undefined,
          error: offline ? OFFLINE_MESSAGE : UNREACHABLE_MESSAGE,
          ...(values ? { values } : {}),
        } as State;
      }
    },
    initialState,
    permalink,
  );
}
