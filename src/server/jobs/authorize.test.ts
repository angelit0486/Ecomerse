import { describe, expect, it } from "vitest";

import { signPayload } from "@/server/security/hmac";

import { authorizeJobRunner } from "./authorize";

const cronSecret = "c".repeat(40);
const hmacSecret = "h".repeat(40);
const now = 1_790_000_000;
const base = {
  authorization: null,
  timestamp: null,
  signature: null,
  rawBody: "",
  cronSecret,
  hmacSecret,
  nowSeconds: now,
};

describe("authorizeJobRunner", () => {
  it("acepta Vercel Cron con el Bearer correcto", () => {
    expect(authorizeJobRunner({ ...base, authorization: `Bearer ${cronSecret}` })).toEqual({
      ok: true,
      method: "cron",
    });
  });

  it("rechaza un Bearer incorrecto sin caer al mecanismo HMAC", () => {
    const signature = signPayload(hmacSecret, now, "{}");
    expect(
      authorizeJobRunner({
        ...base,
        authorization: "Bearer incorrecto",
        timestamp: String(now),
        signature,
        rawBody: "{}",
      }),
    ).toEqual({ ok: false });
  });

  it("acepta un disparo firmado válido", () => {
    const signature = signPayload(hmacSecret, now, "{}");
    expect(
      authorizeJobRunner({ ...base, timestamp: String(now), signature, rawBody: "{}" }),
    ).toEqual({ ok: true, method: "hmac" });
  });

  it("rechaza firmas con el secreto de cron, vencidas o ausentes", () => {
    const wrongKey = signPayload(cronSecret, now, "{}");
    expect(
      authorizeJobRunner({ ...base, timestamp: String(now), signature: wrongKey, rawBody: "{}" }),
    ).toEqual({ ok: false });
    const stale = signPayload(hmacSecret, now - 120, "{}");
    expect(
      authorizeJobRunner({
        ...base,
        timestamp: String(now - 120),
        signature: stale,
        rawBody: "{}",
      }),
    ).toEqual({ ok: false });
    expect(authorizeJobRunner(base)).toEqual({ ok: false });
  });
});
