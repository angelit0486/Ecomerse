import { describe, expect, it } from "vitest";

import { signStandardWebhook, verifyStandardWebhook } from "./standard-webhooks";

const SECRET = `v1,whsec_${Buffer.from("s".repeat(32)).toString("base64")}`;
const NOW = 1_800_000_000;
const body = '{"user":{"email":"a@b.test"}}';

function headers(over: Record<string, string> = {}) {
  return new Headers({
    "webhook-id": "msg_1",
    "webhook-timestamp": String(NOW),
    "webhook-signature": signStandardWebhook(SECRET, "msg_1", NOW, body),
    ...over,
  });
}

describe("Standard Webhooks", () => {
  it("acepta una firma válida", () => {
    expect(
      verifyStandardWebhook({ secret: SECRET, headers: headers(), body, nowSeconds: NOW }),
    ).toEqual({ ok: true, id: "msg_1" });
  });

  it("acepta si alguna de varias firmas es válida (rotación)", () => {
    const sig = `v1,AAAA ${signStandardWebhook(SECRET, "msg_1", NOW, body)}`;
    expect(
      verifyStandardWebhook({
        secret: SECRET,
        headers: headers({ "webhook-signature": sig }),
        body,
        nowSeconds: NOW,
      }).ok,
    ).toBe(true);
  });

  it("rechaza cuerpo alterado, id cambiado y marca de tiempo vieja", () => {
    expect(
      verifyStandardWebhook({
        secret: SECRET,
        headers: headers(),
        body: `${body} `,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
    expect(
      verifyStandardWebhook({
        secret: SECRET,
        headers: headers({ "webhook-id": "msg_2" }),
        body,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
    expect(
      verifyStandardWebhook({ secret: SECRET, headers: headers(), body, nowSeconds: NOW + 301 }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("rechaza cabeceras ausentes y secretos mal formados", () => {
    expect(
      verifyStandardWebhook({ secret: SECRET, headers: new Headers(), body, nowSeconds: NOW }).ok,
    ).toBe(false);
    expect(
      verifyStandardWebhook({ secret: "whsec_x", headers: headers(), body, nowSeconds: NOW }),
    ).toEqual({ ok: false, reason: "malformed" });
  });
});
