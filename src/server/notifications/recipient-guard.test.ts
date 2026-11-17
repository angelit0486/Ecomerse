import { describe, expect, it } from "vitest";

import { guardedChannel } from "./channel";
import { fakeChannel } from "./channels";
import { isRecipientAllowed, parseAllowlist, RecipientNotAllowedError } from "./recipient-guard";

const message = { to: "cliente@gmail.test", subject: "Hola", html: "<p>Hola</p>", text: "Hola" };

describe("guardia de destinatarios fuera de producción", () => {
  it("acepta emails completos y @dominios; ignora basura", () => {
    const list = parseAllowlist(" Ana@Equipo.test , @pruva.test, nada, @, x@y ");
    expect([...list.emails]).toEqual(["ana@equipo.test"]);
    expect([...list.domains]).toEqual(["pruva.test"]);
    expect(isRecipientAllowed("ANA@equipo.test", list)).toBe(true);
    expect(isRecipientAllowed("quien@pruva.test", list)).toBe(true);
    expect(isRecipientAllowed("quien@sub.pruva.test", list)).toBe(false);
    expect(isRecipientAllowed("cliente@gmail.test", list)).toBe(false);
    expect(isRecipientAllowed("no-es-email", list)).toBe(false);
  });

  it("lista vacía: no sale nada", () => {
    expect(isRecipientAllowed("ana@equipo.test", parseAllowlist(undefined))).toBe(false);
  });

  it("el canal protegido no llama al proveedor con un destinatario no permitido", async () => {
    const inner = fakeChannel();
    const channel = guardedChannel(inner, "@pruva.test");
    await expect(channel.send(message)).rejects.toBeInstanceOf(RecipientNotAllowedError);
    expect(inner.sent).toHaveLength(0);
    await expect(channel.send({ ...message, to: "qa@pruva.test" })).resolves.toEqual({
      providerMessageId: "fake-1",
    });
    expect(channel.provider).toBe("fake");
  });
});
