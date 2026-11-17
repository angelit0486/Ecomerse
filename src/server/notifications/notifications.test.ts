import { describe, expect, it, vi } from "vitest";

import {
  isPermanentResendError,
  mailpitChannel,
  resendChannel,
  type ResendEmailsClient,
} from "./channels";
import {
  escapeHtml,
  ownerNoticeEmail,
  staffInvitationEmail,
  supportAccessNoticeEmail,
} from "./templates";
import { PermanentDeliveryError } from "./types";

const message = { to: "ana@example.test", subject: "Hola", html: "<p>Hola</p>", text: "Hola" };

describe("plantillas", () => {
  it("escapan todo dato variable (sin inyección de HTML)", () => {
    const email = staffInvitationEmail({
      to: "ana@example.test",
      organizationName: '<script>alert("x")</script>',
      storeName: null,
      link: "https://app.x.test/invitacion/abc",
      expiresAt: new Date("2026-10-12T18:00:00Z"),
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.text).toContain("https://app.x.test/invitacion/abc");
  });

  it("el aviso de soporte incluye motivo, duración y enlace al panel", () => {
    const email = supportAccessNoticeEmail({
      to: "duena@example.test",
      ownerName: "Ana",
      storeName: "Moda Ana",
      reason: "Ticket 9: <b>pedidos</b> que no aparecen",
      minutes: 30,
      expiresAt: new Date("2026-10-12T18:30:00Z"),
      panelLink: "https://app.x.test/admin",
    });
    expect(email.subject).toBe("Acceso de soporte a Moda Ana");
    expect(email.text).toContain("30 minutos");
    expect(email.html).toContain("&lt;b&gt;pedidos&lt;/b&gt;");
    expect(email.html).toContain('href="https://app.x.test/admin"');
  });

  it("avisos al dueño: escapan nombres y dicen qué pasó y qué sigue", () => {
    const base = {
      to: "duena@example.test",
      name: "Ana",
      organizationName: "Ana <Moda>",
      storeName: "<b>Moda Ana</b>",
      storeStatus: null,
      panelLink: "https://app.x.test/admin",
    };
    const suspended = ownerNoticeEmail({ ...base, kind: "suspended" });
    expect(suspended.subject).toBe("Suspendimos la tienda <b>Moda Ana</b>");
    expect(suspended.html).not.toContain("<b>Moda");
    expect(suspended.text).toContain("no pueden verla ni comprar");
    expect(ownerNoticeEmail({ ...base, kind: "reactivated", storeStatus: "draft" }).text).toContain(
      "quedó en borrador",
    );
    expect(ownerNoticeEmail({ ...base, storeName: null, kind: "closed" }).text).toContain(
      "definitivo",
    );
    const previous = ownerNoticeEmail({
      ...base,
      storeName: null,
      kind: "ownership_transferred",
      recipient: "previous",
    });
    expect(previous.text).toContain("Si no fuiste tú");
    expect(
      ownerNoticeEmail({
        ...base,
        storeName: null,
        kind: "ownership_transferred",
        recipient: "new",
      }).subject,
    ).toBe("Ahora la propiedad de Ana <Moda> es tuya");
  });

  it("escapeHtml cubre comillas", () => {
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });
});

type SendFn = ResendEmailsClient["emails"]["send"];
function fakeResend(impl?: SendFn) {
  const send = vi.fn<SendFn>(impl ?? (async () => ({ data: { id: "re_1" }, error: null })));
  return { client: { emails: { send } }, send };
}
const resendError = (statusCode: number | null, name: string) => async () => ({
  data: null,
  error: { statusCode, name, message: "ana@example.test inválido" },
});

describe("canal Resend (SDK oficial)", () => {
  it("envía con clave de idempotencia y devuelve el id", async () => {
    const { client, send } = fakeResend();
    const channel = resendChannel("re_key", "Plataforma <no-reply@x.test>", { client });
    await expect(channel.send(message, { idempotencyKey: "k1" })).resolves.toEqual({
      providerMessageId: "re_1",
    });
    expect(send.mock.calls[0]![1]).toEqual({ idempotencyKey: "k1" });
    expect(send.mock.calls[0]![0]).toMatchObject({ to: ["ana@example.test"], text: "Hola" });
  });

  it("nombre de la tienda como quoted-string: comas, @ o paréntesis no rompen el From", async () => {
    const { client, send } = fakeResend();
    const channel = resendChannel("re_key", "Plataforma <no-reply@x.test>", { client });
    await channel.send({ ...message, fromName: 'Café, Pan & Más (Moda@Casa) "x"\r\nBcc: y' });
    expect(send.mock.calls[0]![0].from).toBe(
      '"Café, Pan & Más (Moda@Casa) xBcc: y" <no-reply@x.test>',
    );
  });

  it("replyTo: el de la tienda manda; si no hay, EMAIL_REPLY_TO; si no, ninguno", async () => {
    const { client, send } = fakeResend();
    const withDefault = resendChannel("k", "P <a@x.test>", { client, replyTo: "hola@x.test" });
    await withDefault.send({ ...message, replyTo: "tienda@x.test" });
    await withDefault.send(message);
    await resendChannel("k", "P <a@x.test>", { client }).send(message);
    expect(send.mock.calls.map((c) => c[0].replyTo)).toEqual([
      "tienda@x.test",
      "hola@x.test",
      undefined,
    ]);
  });

  it("baja en un clic (RFC 8058) solo si el correo la trae y con una URL válida", async () => {
    const { client, send } = fakeResend();
    const channel = resendChannel("re_key", "Plataforma <no-reply@x.test>", { client });
    await channel.send({
      ...message,
      listUnsubscribeUrl: "https://panel.test/api/email/unsubscribe/cart?s=1",
    });
    await channel.send(message);
    await channel.send({ ...message, listUnsubscribeUrl: "https://x.test/a>\r\nBcc: y" });
    const bodies = send.mock.calls.map((c) => c[0]);
    expect(bodies[0]!.headers).toEqual({
      "List-Unsubscribe": "<https://panel.test/api/email/unsubscribe/cart?s=1>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(bodies[1]!.headers).toBeUndefined();
    expect(bodies[2]!.headers).toBeUndefined();
  });

  it("422 de validación es definitivo; 429, 5xx, red y errores de configuración se reintentan", async () => {
    const reject = (impl: SendFn) =>
      resendChannel("k", "P <a@x.test>", { client: fakeResend(impl).client }).send(message);
    await expect(reject(resendError(422, "validation_error"))).rejects.toBeInstanceOf(
      PermanentDeliveryError,
    );
    for (const [status, name] of [
      [429, "rate_limit_exceeded"],
      [500, "internal_server_error"],
      [403, "invalid_from_address"],
      [401, "invalid_api_key"],
      [null, "application_error"],
    ] as const) {
      await expect(reject(resendError(status, name))).rejects.not.toBeInstanceOf(
        PermanentDeliveryError,
      );
    }
    await expect(
      reject(async () => {
        throw new Error("ECONNRESET ana@example.test");
      }),
    ).rejects.toThrow(/^resend no respondió$/);
  });

  it("el error no incluye el texto de Resend (podría tener el destinatario)", async () => {
    const channel = resendChannel("k", "P <a@x.test>", {
      client: fakeResend(resendError(422, "validation_error")).client,
    });
    await expect(channel.send(message)).rejects.toThrow(
      /^resend respondió 422 \(validation_error\)$/,
    );
  });

  it("isPermanentResendError no suprime direcciones por fallas de la cuenta", () => {
    expect(isPermanentResendError({ statusCode: 422, name: "validation_error" })).toBe(true);
    expect(isPermanentResendError({ statusCode: 422, name: "invalid_from_address" })).toBe(false);
    expect(isPermanentResendError({ statusCode: 403, name: "validation_error" })).toBe(false);
  });
});

describe("canal Mailpit", () => {
  it("usa la API de envío con remitente separado", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ID: "m1" }));
    await mailpitChannel("http://127.0.0.1:8025", "Plataforma <no-reply@x.test>", fetchImpl).send(
      message,
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:8025/api/v1/send");
    expect(JSON.parse(init.body as string).From).toEqual({
      Email: "no-reply@x.test",
      Name: "Plataforma",
    });
  });
});
