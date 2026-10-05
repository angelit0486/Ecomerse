import "server-only";

import { unstable_rethrow } from "next/navigation";

import { toAppError } from "@/server/db/errors";
import type { AppError } from "@/server/errors";
import { createLogger } from "@/server/observability/logger";

const log = createLogger();

/**
 * Traduce el error de un Server Action (tras dejar pasar las redirecciones) para el usuario y, si es inesperado
 * (`internal`), registra la causa redactada para diagnosticarlo.
 */
export function reportActionError(scope: string, error: unknown): AppError {
  // redirect()/notFound() de Next no son errores: se propagan.
  unstable_rethrow(error);
  const appError = toAppError(error);
  if (appError.code === "internal") log.error("action.failed", { scope, err: error });
  return appError;
}
