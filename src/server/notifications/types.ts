/**
 * Contrato de canal de notificaciones (GATE0 §27.1). MVP: solo email.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
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
