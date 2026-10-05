import "server-only";

import { toAppError } from "@/server/db/errors";
import type { AppError } from "@/server/errors";
import { createLogger } from "@/server/observability/logger";

const log = createLogger();

/**
 * Traduce el error de un Server Action para el usuario y, si es inesperado
 * (`internal`), registra la causa redactada para diagnosticarlo.
 */
export function reportActionError(scope: string, error: unknown): AppError {
  const appError = toAppError(error);
  if (appError.code === "internal") log.error("action.failed", { scope, err: error });
  return appError;
}
