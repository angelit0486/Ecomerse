import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseEmailEvent, verifySvixSignature } from "./email-events";

const KEY = Buffer.from("clave-de-prueba-de-32-bytes-0000").toString("base64");
const SECRET = `whsec_${KEY}`;

function sign(id: string, ts: string, body: string, key = KEY) {
  return `v1,${createHmac("sha256", Buffer.from(key, "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;
}

describe("webhook de rebotes y quejas", () => {
  const body = JSON.stringify({ type: "email.bounced", data: { to: ["ana@cliente.test"] } });
  const now = new Date("2026-10-29T12:00:00Z");
  const ts = String(now.getTime() / 1000);

  it("acepta la firma correcta (entre varias)", () => {
    const signature = `v1,AAAA ${sign("msg_1", ts, body)}`;
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: "msg_1",
        timestamp: ts,
        signature,
        rawBody: body,
        now,
      }),
    ).toBe(true);
  });

  it("rechaza cuerpo alterado, otra clave, sin cabeceras y firmas viejas", () => {
    const signature = sign("msg_1", ts, body);
    const base = { secret: SECRET, id: "msg_1", timestamp: ts, signature, rawBody: body, now };
    expect(verifySvixSignature({ ...base, rawBody: body.replace("ana", "eva") })).toBe(false);
    expect(
      verifySvixSignature({
        ...base,
        signature: sign(
          "msg_1",
          ts,
          body,
          Buffer.from("otra-clave-distinta-de-32-bytes!").toString("base64"),
        ),
      }),
    ).toBe(false);
    expect(verifySvixSignature({ ...base, id: null })).toBe(false);
    expect(verifySvixSignature({ ...base, now: new Date(now.getTime() + 10 * 60_000) })).toBe(
      false,
    );
  });

  it("solo rebotes y quejas suprimen", () => {
    expect(parseEmailEvent(body, "msg_1")).toEqual({
      kind: "bounce",
      emails: ["ana@cliente.test"],
      eventId: "msg_1",
    });
    expect(
      parseEmailEvent(
        JSON.stringify({ type: "email.complained", data: { to: ["b@x.test"] } }),
        "m2",
      )?.kind,
    ).toBe("complaint");
    expect(
      parseEmailEvent(
        JSON.stringify({ type: "email.delivery_delayed", data: { to: ["b@x.test"] } }),
        "m3",
      ),
    ).toBeNull();
    expect(parseEmailEvent("no es json", "m4")).toBeNull();
  });
});
