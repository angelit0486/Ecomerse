import {
  isEmail,
  PermanentDeliveryError,
  safeDisplayName,
  type EmailChannel,
  type EmailMessage,
  type SendResult,
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

/** Resend (producción): API HTTP, sin SDK. */
export function resendChannel(apiKey: string, from: string, fetchImpl = fetch): EmailChannel {
  return {
    provider: "resend",
    async send(message: EmailMessage, options): Promise<SendResult> {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          ...(options?.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: message.fromName
            ? `${safeDisplayName(message.fromName)} <${parseFrom(from).email}>`
            : from,
          ...(isEmail(message.replyTo) ? { reply_to: message.replyTo } : {}),
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (!response.ok) await failure("resend", response);
      const body = (await response.json()) as { id?: string };
      return { providerMessageId: body.id ?? null };
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
