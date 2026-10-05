import { constantTimeEqual, verifySignedPayload } from "@/server/security/hmac";

export interface JobRunnerAuthInput {
  authorization: string | null;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  cronSecret: string;
  hmacSecret: string;
  nowSeconds: number;
}

export type JobRunnerAuthResult = { ok: true; method: "cron" | "hmac" } | { ok: false };

/**
 * Autoriza una invocación del runner de jobs. Dos mecanismos:
 *  - Vercel Cron: `Authorization: Bearer <CRON_SECRET>`.
 *  - Disparo firmado (pg_cron + pg_net): `x-jobs-timestamp` + `x-jobs-signature`
 *    = HMAC-SHA256(`${timestamp}.${body}`), tolerancia ±60 s.
 */
export function authorizeJobRunner(input: JobRunnerAuthInput): JobRunnerAuthResult {
  if (input.authorization?.startsWith("Bearer ")) {
    const token = input.authorization.slice("Bearer ".length);
    if (constantTimeEqual(token, input.cronSecret)) return { ok: true, method: "cron" };
    return { ok: false };
  }
  if (
    verifySignedPayload({
      secret: input.hmacSecret,
      timestamp: input.timestamp,
      signature: input.signature,
      body: input.rawBody,
      nowSeconds: input.nowSeconds,
      toleranceSeconds: 60,
    })
  ) {
    return { ok: true, method: "hmac" };
  }
  return { ok: false };
}
