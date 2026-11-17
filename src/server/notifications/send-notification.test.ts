import { afterEach, describe, expect, it, vi } from "vitest";

import { log } from "@/server/observability/logger";
import { sqlRecorder } from "../../../tests/support/sql-recorder";

import { fakeChannel } from "./channels";
import { alreadyDelivered, sendNotification } from "./handlers";
import { RecipientNotAllowedError } from "./recipient-guard";
import { PermanentDeliveryError, type EmailChannel } from "./types";

const message = { to: "ana@cliente.test", subject: "Hola", html: "<p>Hola</p>", text: "Hola" };
const input = {
  dedupeKey: "order.paid:o1:order_confirmation:abc",
  template: "order_confirmation",
  organizationId: null,
  idempotencyKey: "order.paid:o1:order_confirmation:abc",
  message,
};

function respondSuppressed(suppressed: boolean) {
  return (q: string) => (q.includes("email_suppressed") ? [{ suppressed }] : []);
}

function failing(error: Error): EmailChannel {
  return {
    provider: "resend",
    send: async () => {
      throw error;
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("sendNotification: servicio central de envío", () => {
  it("envía, registra 'sent' con el id del proveedor y loguea sin el destinatario", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    const { db, queries } = sqlRecorder(respondSuppressed(false));
    const channel = fakeChannel();
    await sendNotification({ db, channel }, input);
    expect(channel.sent).toHaveLength(1);
    expect(queries.at(-1)).toContain("record_notification_delivery");
    expect(queries.at(-1)).toContain("'sent'");
    expect(info).toHaveBeenCalledWith("email.accepted", {
      template: "order_confirmation",
      dedupe_key: input.dedupeKey,
      provider: "fake",
      provider_message_id: "fake-1",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("ana@cliente.test");
  });

  it("dirección suprimida (rebote o queja previos): no envía y registra 'suppressed'", async () => {
    const { db, queries } = sqlRecorder(respondSuppressed(true));
    const channel = fakeChannel();
    await sendNotification({ db, channel }, input);
    expect(channel.sent).toHaveLength(0);
    expect(queries.at(-1)).toContain("'suppressed'");
  });

  it("guardia de vista previa: se omite sin registrar nada (no suprime ni consume el dedupe)", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { db, queries } = sqlRecorder(respondSuppressed(false));
    await sendNotification({ db, channel: failing(new RecipientNotAllowedError()) }, input);
    expect(queries.some((q) => q.includes("record_notification_delivery"))).toBe(false);
    expect(queries.some((q) => q.includes("email_suppress("))).toBe(false);
  });

  it("rechazo definitivo: suprime la dirección y no lanza (el trabajo no se reintenta)", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { db, queries } = sqlRecorder(respondSuppressed(false));
    await sendNotification(
      { db, channel: failing(new PermanentDeliveryError("resend respondió 422")) },
      input,
    );
    expect(queries.some((q) => q.includes("email_suppress("))).toBe(true);
    expect(queries.at(-1)).toContain("'suppressed'");
  });

  it("falla transitoria: lanza para que la cola reintente, sin registrar envío", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { db, queries } = sqlRecorder(respondSuppressed(false));
    await expect(
      sendNotification({ db, channel: failing(new Error("resend respondió 503")) }, input),
    ).rejects.toThrow("503");
    expect(queries.some((q) => q.includes("record_notification_delivery"))).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "email.failed",
      expect.objectContaining({ permanent: false, template: "order_confirmation" }),
    );
  });

  it("alreadyDelivered consulta el registro por clave de deduplicación", async () => {
    const { db, queries } = sqlRecorder((q) =>
      q.includes("notification_delivered") ? [{ delivered: true }] : [],
    );
    await expect(alreadyDelivered(db, "k")).resolves.toBe(true);
    expect(queries[0]).toContain("system.notification_delivered");
  });
});
