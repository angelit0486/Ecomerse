/**
 * Errores tipados y formato de error estable (GATE0 §31.2, contrato crítico §43).
 */

export const ERROR_STATUS = {
  unauthenticated: 401,
  mfa_required: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  insufficient_stock: 409,
  price_changed: 409,
  cart_invalid: 422,
  discount_invalid: 422,
  limit_reached: 403,
  read_only_mode: 403,
  rate_limited: 429,
  provider_error: 502,
  internal: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  unauthenticated:
    "Tu sesión terminó. Inicia sesión de nuevo en otra pestaña y vuelve a guardar aquí.",
  mfa_required: "Completa la verificación en dos pasos para continuar.",
  forbidden: "No tienes permiso para realizar esta acción.",
  not_found: "No encontramos lo que buscas.",
  validation_failed: "Revisa los datos marcados.",
  conflict: "Otra persona modificó este registro. Recarga e inténtalo de nuevo.",
  insufficient_stock: "No hay existencias suficientes.",
  price_changed: "El precio cambió. Revisa el nuevo total.",
  cart_invalid: "Algunos productos de tu carrito ya no están disponibles.",
  discount_invalid: "El código de descuento no es válido.",
  limit_reached: "Alcanzaste el límite de tu plan.",
  read_only_mode: "Tu cuenta está en modo de solo lectura.",
  rate_limited: "Demasiados intentos. Espera un momento.",
  provider_error: "El proveedor externo no respondió. Inténtalo de nuevo.",
  internal: "Ocurrió un error inesperado.",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fields: Readonly<Record<string, string>> | undefined;

  constructor(
    code: ErrorCode,
    message?: string,
    options?: { fields?: Record<string, string>; cause?: unknown },
  ) {
    super(message ?? DEFAULT_MESSAGES[code], { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.fields = options?.fields;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
    request_id: string;
  };
}

/**
 * Convierte cualquier error en el formato público. Un error que no es AppError
 * se reporta como `internal` con mensaje genérico: nunca se filtran detalles internos.
 */
export function toErrorEnvelope(
  error: unknown,
  requestId: string,
): { status: number; body: ErrorEnvelope } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: { ...error.fields } } : {}),
          request_id: requestId,
        },
      },
    };
  }
  return {
    status: ERROR_STATUS.internal,
    body: {
      ok: false,
      error: { code: "internal", message: DEFAULT_MESSAGES.internal, request_id: requestId },
    },
  };
}

export function errorResponse(error: unknown, requestId: string): Response {
  const { status, body } = toErrorEnvelope(error, requestId);
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
