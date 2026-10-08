import { AppError } from "@/server/errors";

/**
 * Detalle y pista de un error de las RPC regulatorias. Son códigos de nuestros
 * propios RAISE (p. ej. `unclassified_products`, o los códigos de publicación
 * separados por comas); se validan antes de usarlos y nunca se muestran tal cual.
 */
export function rpcDetail(error: unknown): { detail?: string; hint?: string } {
  const cause = error instanceof AppError ? error.cause : error;
  if (!cause || typeof cause !== "object") return {};
  const c = cause as { details?: unknown; detail?: unknown; hint?: unknown };
  const detail =
    typeof c.details === "string" ? c.details : typeof c.detail === "string" ? c.detail : undefined;
  const hint = typeof c.hint === "string" ? c.hint : undefined;
  return {
    ...(detail && /^[a-z_]{1,40}$/.test(detail) ? { detail } : {}),
    ...(hint && /^[a-z0-9_:,]{1,2000}$/.test(hint) ? { hint } : {}),
  };
}
