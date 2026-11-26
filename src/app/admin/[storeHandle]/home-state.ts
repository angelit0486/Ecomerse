import { launchSummary, type LaunchProgress } from "@/lib/onboarding/launch-steps";

/**
 * Inicio: distinguir «la consulta falló» de «el resultado es cero». supabase-js
 * no lanza: devuelve `{ data: null, error }` o `{ count: null, error }`, y un
 * `?? 0` convertía el fallo en «Ya tiene todo lo necesario» o «Todo funciona».
 */

type Result<T> = { data?: T | null; count?: number | null; error: unknown };

/**
 * Texto y acción de la tarjeta «Tu tienda aún no está publicada», con la misma
 * cuenta que «Configura tu tienda» (launch-steps). "error": no se pudo revisar.
 */
export function launchCopy(progress: LaunchProgress | "error"): {
  message: string;
  cta: string;
  next: string | null;
} {
  if (progress === "error") {
    return {
      message: "No pudimos revisar qué le falta.",
      cta: "Revisar configuración",
      next: null,
    };
  }
  const steps = `Llevas ${progress.done} de ${progress.total} pasos.`;
  if (progress.blocking === 0) {
    return {
      message: `${launchSummary(progress)} ${steps}`,
      cta: "Publicar mi tienda",
      next: null,
    };
  }
  return {
    message: `${launchSummary(progress)} ${steps}`,
    cta: "Terminar de configurar",
    next: progress.next?.title ?? null,
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
