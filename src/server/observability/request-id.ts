export const REQUEST_ID_HEADER = "x-request-id";
/**
 * `x-request-id` original de Mercado Pago: forma parte de lo que firma su webhook
 * y el proxy sobrescribe `x-request-id`. El proxy lo copia aquí solo para esa
 * ruta (y descarta cualquier valor que mande el cliente en esta cabecera).
 */
export const UPSTREAM_REQUEST_ID_HEADER = "x-upstream-request-id";
export const MERCADOPAGO_WEBHOOK_PATH = "/api/webhooks/payments/mercadopago";

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
