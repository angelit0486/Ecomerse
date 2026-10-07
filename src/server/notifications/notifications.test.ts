import { describe, expect, it, vi } from "vitest";

import { mailpitChannel, resendChannel } from "./channels";
import { escapeHtml, staffInvitationEmail, supportAccessNoticeEmail } from "./templates";
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

  it("escapeHtml cubre comillas", () => {
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });
});

describe("canal Resend", () => {
  it("envía con clave de idempotencia y devuelve el id", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: "re_1" }));
    const channel = resendChannel("re_key", "Plataforma <no-reply@x.test>", fetchImpl);
    await expect(channel.send(message, { idempotencyKey: "k1" })).resolves.toEqual({
      providerMessageId: "re_1",
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("k1");
    expect(JSON.parse(init.body as string)).toMatchObject({ to: ["ana@example.test"] });
  });

  it("nombre de la tienda como quoted-string: comas, @ o paréntesis no rompen el From", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: "re_2" }));
    const channel = resendChannel("re_key", "Plataforma <no-reply@x.test>", fetchImpl);
    await channel.send({ ...message, fromName: 'Café, Pan & Más (Moda@Casa) "x"\r\nBcc: y' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).from).toBe(
      '"Café, Pan & Más (Moda@Casa) xBcc: y" <no-reply@x.test>',
    );
  });

  it("422 es definitivo; 429 y 5xx se reintentan", async () => {
    const reject = (status: number) =>
      resendChannel("k", "P <a@x.test>", async () => new Response("{}", { status })).send(message);
    await expect(reject(422)).rejects.toBeInstanceOf(PermanentDeliveryError);
    await expect(reject(429)).rejects.not.toBeInstanceOf(PermanentDeliveryError);
    await expect(reject(503)).rejects.not.toBeInstanceOf(PermanentDeliveryError);
  });

  it("el error no incluye el cuerpo de la respuesta (podría tener el destinatario)", async () => {
    const channel = resendChannel("k", "P <a@x.test>", async () =>
      Response.json({ message: "ana@example.test inválido" }, { status: 422 }),
    );
    await expect(channel.send(message)).rejects.toThrow(/^resend respondió 422$/);
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
