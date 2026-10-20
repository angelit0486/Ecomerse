import { AppError, ERROR_STATUS, type ErrorCode } from "@/server/errors";

/**
 * Traduce errores de la base (PostgREST vía supabase-js o postgres.js) a
 * `AppError` (GATE0 §31.2). Contrato con las RPC (migraciones de la Fase 2):
 *
 * - `42501` + message ∈ {unauthenticated, mfa_required, forbidden}
 * - `P0001` + message = código de negocio + detail (campo o motivo)
 *
 * Cualquier otro error es `internal`: su mensaje original nunca llega al cliente.
 */

/** Forma común de PostgrestError y PostgresError. */
export interface DbErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
  detail?: string;
}

/** Códigos de negocio propios de una RPC que no existen en `ErrorCode`. */
const BUSINESS_ALIASES: Record<string, { code: ErrorCode; message: string }> = {
  invitation_invalid: {
    code: "not_found",
    message: "La invitación no es válida o caducó. Pide una nueva.",
  },
  member_org_suspended: {
    code: "conflict",
    message: "Está suspendido en toda la organización. Reactívalo desde la organización.",
  },
  invitation_email_mismatch: {
    code: "forbidden",
    message: "Esta invitación es para otro email. Entra con la cuenta invitada.",
  },
};

const AUTH_CODES = new Set<ErrorCode>(["unauthenticated", "mfa_required", "forbidden"]);

/**
 * Función, columna o tabla que el código espera y la base no tiene: falta aplicar
 * una migración (D-EST-04). Sigue siendo `internal` (los códigos son estables,
 * §43), pero con un mensaje que dice qué hacer en vez de «error inesperado».
 */
const SCHEMA_OUTDATED_CODES = new Set([
  "42883",
  "42703",
  "42P01",
  "PGRST202",
  "PGRST204",
  "PGRST205",
]);
export const SCHEMA_OUTDATED_MESSAGE =
  "La base de datos de la tienda no está actualizada. Avísale al equipo técnico para que aplique la última actualización; tus datos no se perdieron.";

function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_STATUS, value);
}

export function isDbErrorLike(value: unknown): value is DbErrorLike {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (!isDbErrorLike(error)) return new AppError("internal", undefined, { cause: error });

  const code = error.code ?? "";
  const message = error.message ?? "";
  const detail = error.details ?? error.detail ?? undefined;

  if (code === "42501") {
    // Nuestros RAISE llevan el código en el mensaje; "permission denied for …" es
    // un privilegio ausente (p. ej. una tabla sin grant): para el cliente, forbidden.
    const authCode = isErrorCode(message) && AUTH_CODES.has(message) ? message : "forbidden";
    return new AppError(authCode, undefined, { cause: error });
  }

  if (code === "P0001") {
    const alias = BUSINESS_ALIASES[message];
    if (alias) return new AppError(alias.code, alias.message, { cause: error });
    if (isErrorCode(message) && message !== "internal") {
      const fields =
        message === "validation_failed" && detail && /^[a-z_]{1,40}$/.test(detail)
          ? { [detail]: "invalid" }
          : undefined;
      return new AppError(message, undefined, { fields, cause: error });
    }
  }

  // JWT caducado o inválido (PostgREST).
  if (code === "PGRST301" || code === "PGRST302" || code === "PGRST303") {
    return new AppError("unauthenticated", undefined, { cause: error });
  }
  // Restricciones de integridad que el cliente puede provocar.
  if (code === "23505") return new AppError("conflict", undefined, { cause: error });
  if (code === "23514" || code === "22023" || code === "22P02") {
    return new AppError("validation_failed", undefined, { cause: error });
  }

  if (SCHEMA_OUTDATED_CODES.has(code)) {
    return new AppError("internal", SCHEMA_OUTDATED_MESSAGE, { cause: error });
  }

  return new AppError("internal", undefined, { cause: error });
}
