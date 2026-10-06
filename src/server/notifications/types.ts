/**
 * Contrato de canal de notificaciones (GATE0 §27.1). MVP: solo email.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Nombre visible del remitente (p. ej. la tienda); la dirección es siempre la de la plataforma. */
  fromName?: string;
  /** Respuestas al contacto de la tienda (GATE0 §27: marca de la tienda). */
  replyTo?: string;
}

/** Nombre de remitente seguro: sin comillas, ángulos ni saltos de línea (cabecera From). */
export function safeDisplayName(name: string): string {
  return name
    .replace(/["<>\r\n\\]/g, "")
    .trim()
    .slice(0, 60);
}

export function isEmail(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(value)
  );
}

export interface SendResult {
  providerMessageId: string | null;
}

export interface EmailChannel {
  readonly provider: "resend" | "mailpit" | "fake";
  send(message: EmailMessage, options?: { idempotencyKey?: string }): Promise<SendResult>;
}

/** Rechazo definitivo del proveedor (email inválido, rebote duro): sin reintento. */
export class PermanentDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentDeliveryError";
  }
}
