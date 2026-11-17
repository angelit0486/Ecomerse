import { Resend, type CreateEmailOptions } from "resend";

import {
  isEmail,
  PermanentDeliveryError,
  safeDisplayName,
  type EmailChannel,
  type EmailMessage,
  type SendResult,
  unsubscribeHeaders,
} from "./types";

/** "Nombre <email>" → partes (validado por el esquema de entorno). */
function parseFrom(from: string): { name: string; email: string } {
  const match = /^(.*) <(.+)>$/.exec(from);
  return { name: match?.[1]?.trim() ?? "", email: match?.[2] ?? from };
}

async function failure(provider: string, response: Response): Promise<never> {
  // Sin el cuerpo de la respuesta: podría contener el destinatario.
  const message = `${provider} respondió ${response.status}`;
  if (response.status === 429 || response.status >= 500) throw new Error(message);
  throw new PermanentDeliveryError(message);
}

/** Lo mínimo del SDK oficial que usa el canal (inyectable en pruebas). */
export interface ResendEmailsClient {
  emails: {
    send(
      payload: CreateEmailOptions,
      options?: { idempotencyKey?: string },
    ): Promise<{
      data: { id: string } | null;
      error: { message: string; statusCode: number | null; name: string } | null;
    }>;
  };
}

/**
 * Errores de configuración de la cuenta o de la plataforma (clave, dominio remitente,
 * cuota, idempotencia): NO son culpa del destinatario, así que nunca se suprime su
 * dirección; el trabajo se reintenta y la salud lo muestra.
 */
const RESEND_CONFIG_ERRORS = new Set([
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "invalid_from_address",
  "invalid_access",
  "invalid_region",
  "security_error",
  "monthly_quota_exceeded",
  "daily_quota_exceeded",
  "rate_limit_exceeded",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "concurrent_idempotent_requests",
  "application_error",
  "internal_server_error",
]);

/** Rechazo definitivo solo si Resend dice que el MENSAJE es inválido (400/422 de validación). */
export function isPermanentResendError(error: { statusCode: number | null; name: string }) {
  if (RESEND_CONFIG_ERRORS.has(error.name)) return false;
  return error.statusCode === 400 || error.statusCode === 422;
}

/**
 * Resend (producción) con el SDK oficial `resend`. `replyTo` por defecto
 * (EMAIL_REPLY_TO) solo si el mensaje no trae el de la tienda.
 */
export function resendChannel(
  apiKey: string,
  from: string,
  options: { client?: ResendEmailsClient; replyTo?: string } = {},
): EmailChannel {
  const client: ResendEmailsClient = options.client ?? (new Resend(apiKey) as ResendEmailsClient);
  return {
    provider: "resend",
    async send(message: EmailMessage, sendOptions): Promise<SendResult> {
      const replyTo = isEmail(message.replyTo)
        ? message.replyTo
        : isEmail(options.replyTo)
          ? options.replyTo
          : undefined;
      const headers = unsubscribeHeaders(message);
      let result: Awaited<ReturnType<ResendEmailsClient["emails"]["send"]>>;
      try {
        result = await client.emails.send(
          {
            from: message.fromName
              ? `"${safeDisplayName(message.fromName)}" <${parseFrom(from).email}>`
              : from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            ...(replyTo ? { replyTo } : {}),
            ...(Object.keys(headers).length ? { headers } : {}),
          },
          sendOptions?.idempotencyKey ? { idempotencyKey: sendOptions.idempotencyKey } : undefined,
        );
      } catch {
        // Red o excepción del SDK: transitorio, sin detalles (podrían traer datos).
        throw new Error("resend no respondió");
      }
      if (result.error) {
        // Solo estado y código de Resend: el texto podría contener el destinatario.
        const text = `resend respondió ${result.error.statusCode ?? "sin estado"} (${result.error.name})`;
        if (isPermanentResendError(result.error)) throw new PermanentDeliveryError(text);
        throw new Error(text);
      }
      return { providerMessageId: result.data?.id ?? null };
    },
  };
}

/** Mailpit (desarrollo y CI): API HTTP de envío; los correos se ven en su UI. */
export function mailpitChannel(baseUrl: string, from: string, fetchImpl = fetch): EmailChannel {
  const sender = parseFrom(from);
  return {
    provider: "mailpit",
    async send(message: EmailMessage): Promise<SendResult> {
      const response = await fetchImpl(new URL("/api/v1/send", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          From: {
            Email: sender.email,
            Name: message.fromName ? safeDisplayName(message.fromName) : sender.name,
          },
          ...(isEmail(message.replyTo) ? { ReplyTo: [{ Email: message.replyTo }] } : {}),
          To: [{ Email: message.to }],
          Subject: message.subject,
          HTML: message.html,
          Text: message.text,
          ...(Object.keys(unsubscribeHeaders(message)).length
            ? { Headers: unsubscribeHeaders(message) }
            : {}),
        }),
      });
      if (!response.ok) await failure("mailpit", response);
      const body = (await response.json()) as { ID?: string };
      return { providerMessageId: body.ID ?? null };
    },
  };
}

/** Canal en memoria para pruebas. */
export function fakeChannel(): EmailChannel & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    provider: "fake",
    sent,
    async send(message: EmailMessage): Promise<SendResult> {
      sent.push(message);
      return { providerMessageId: `fake-${sent.length}` };
    },
  };
}
