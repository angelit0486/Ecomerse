/**
 * Inicio: distinguir «la consulta falló» de «el resultado es cero». supabase-js
 * no lanza: devuelve `{ data: null, error }` o `{ count: null, error }`, y un
 * `?? 0` convertía el fallo en «Ya tiene todo lo necesario» o «Todo funciona».
 */

type Result<T> = { data?: T | null; count?: number | null; error: unknown };

/** Pasos que le faltan a la tienda para publicarse; "error" si no se pudo revisar. */
export function launchPendingFrom(result: Result<unknown>): number | "error" {
  if (result.error) return "error";
  const issues = (result.data as { issues?: unknown[] } | null | undefined)?.issues;
  return (issues ?? []).length;
}

/** Texto y acción de la tarjeta «Tu tienda aún no está publicada». */
export function launchCopy(pending: number | "error"): { message: string; cta: string } {
  if (pending === "error") {
    return { message: "No pudimos revisar qué le falta.", cta: "Revisar configuración" };
  }
  if (pending === 0) return { message: "Ya tiene todo lo necesario.", cta: "Publicar mi tienda" };
  return {
    message: pending === 1 ? "Le falta 1 paso." : `Le faltan ${pending} pasos.`,
    cta: "Terminar de configurar",
  };
}

/** Trabajos en espera (fotos e importaciones); "error" si alguno no se pudo contar. */
export function queueWaitingFrom(
  photos: Result<unknown>,
  imports: Result<unknown>,
): { photos: number; imports: number } | "error" {
  if (photos.error || imports.error) return "error";
  return { photos: photos.count ?? 0, imports: imports.count ?? 0 };
}

export const QUEUE_ERROR_TEXT =
  "No pudimos revisar los trabajos en espera. Recarga la página en unos segundos.";
export const QUEUE_OK_TEXT = "Todo funciona: no hay trabajos en espera.";
export const ALERTS_ERROR_TEXT = "No pudimos calcular las alertas ahora.";

/** Opiniones por revisar; null si la consulta falló (la tarjeta no se muestra). */
export function pendingReviewsFrom(result: Result<unknown>): number | null {
  if (result.error) return null;
  return result.count ?? 0;
}
