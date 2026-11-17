import "server-only";

import { serverEnv } from "@/server/env";

import { fakeChannel, mailpitChannel, resendChannel } from "./channels";
import { isRecipientAllowed, parseAllowlist, RecipientNotAllowedError } from "./recipient-guard";
import type { EmailChannel } from "./types";

/**
 * Fuera de producción, Resend real solo escribe a la lista EMAIL_ALLOWED_RECIPIENTS
 * (el esquema de entorno la exige). Los demás destinatarios se omiten sin enviar.
 */
export function guardedChannel(
  inner: EmailChannel,
  allowlistRaw: string | undefined,
): EmailChannel {
  const list = parseAllowlist(allowlistRaw);
  return {
    provider: inner.provider,
    async send(message, options) {
      if (!isRecipientAllowed(message.to, list)) throw new RecipientNotAllowedError();
      return inner.send(message, options);
    },
  };
}

let channel: EmailChannel | undefined;

/** Canal configurado (el esquema de entorno garantiza Resend en producción). */
export function emailChannel(): EmailChannel {
  if (channel) return channel;
  const env = serverEnv();
  switch (env.EMAIL_PROVIDER) {
    case "resend":
      channel = resendChannel(env.RESEND_API_KEY!, env.EMAIL_FROM, {
        ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
      });
      if (env.APP_ENV !== "production") {
        channel = guardedChannel(channel, env.EMAIL_ALLOWED_RECIPIENTS);
      }
      break;
    case "mailpit":
      channel = mailpitChannel(env.MAILPIT_URL, env.EMAIL_FROM);
      break;
    case "fake":
      channel = fakeChannel();
      break;
  }
  return channel;
}
