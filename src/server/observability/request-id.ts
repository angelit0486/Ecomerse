export const REQUEST_ID_HEADER = "x-request-id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Lee el request_id que el proxy asignó. El proxy SIEMPRE lo sobrescribe (no se
 * confía en el valor del cliente); si falta o es inválido, se genera uno nuevo.
 */
export function requestIdFrom(headers: Headers): string {
  const value = headers.get(REQUEST_ID_HEADER);
  return value && UUID_RE.test(value) ? value : generateRequestId();
}
