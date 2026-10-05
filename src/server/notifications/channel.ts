import "server-only";

import { serverEnv } from "@/server/env";

import { fakeChannel, mailpitChannel, resendChannel } from "./channels";
import type { EmailChannel } from "./types";

let channel: EmailChannel | undefined;

/** Canal configurado (el esquema de entorno garantiza Resend en producción). */
export function emailChannel(): EmailChannel {
  if (channel) return channel;
  const env = serverEnv();
  switch (env.EMAIL_PROVIDER) {
    case "resend":
      channel = resendChannel(env.RESEND_API_KEY!, env.EMAIL_FROM);
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
