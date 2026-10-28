import { createHash, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  authorizeUrl,
  createPkce,
  exchangeCode,
  newPending,
  refreshTokens,
  signPending,
  verifyPending,
  type MercadoPagoOAuthConfig,
} from "./mercadopago-oauth";

const key = randomBytes(32);
const cfg: MercadoPagoOAuthConfig = {
  clientId: "1234567890",
  clientSecret: "secretodeaplicacion0001",
  redirectUri: "https://app.test/api/payments/mercadopago/callback",
  apiBase: "https://mp.test",
};

function fakeToken(body: unknown, status = 200) {
  const calls: { url: string; body: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, cfg: { ...cfg, fetchImpl } };
}

const goodToken = {
  access_token: "APP_USR-1234567890123456-102812-abcdefabcdef-55512345",
  refresh_token: "TG-abcdef123456",
  user_id: 55512345,
  expires_in: 15552000,
  live_mode: false,
};

describe("PKCE y URL de autorización", () => {
  it("el challenge es el SHA-256 del verificador", () => {
    const { verifier, challenge } = createPkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("lleva cliente, state, regreso y PKCE S256", () => {
    const u = new URL(authorizeUrl(cfg, "estado", "reto"));
    expect(u.origin).toBe("https://auth.mercadopago.com");
    expect(u.searchParams.get("client_id")).toBe(cfg.clientId);
    expect(u.searchParams.get("state")).toBe("estado");
    expect(u.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("cookie del regreso", () => {
  const pending = newPending(
    { storeId: "s1", storeHandle: "tienda", userId: "u1", verifier: "v" },
    1_000,
  );
  const cookie = signPending(key, pending);

  it("vale solo con el mismo usuario, el mismo state y a tiempo", () => {
    expect(verifyPending(key, cookie, { state: pending.nonce, userId: "u1", now: 2_000 })).toEqual(
      pending,
    );
    expect(
      verifyPending(key, cookie, { state: pending.nonce, userId: "otro", now: 2_000 }),
    ).toBeNull();
    expect(verifyPending(key, cookie, { state: "otro", userId: "u1", now: 2_000 })).toBeNull();
    expect(
      verifyPending(key, cookie, { state: pending.nonce, userId: "u1", now: 10 * 60_000 + 1_001 }),
    ).toBeNull();
  });

  it("una cookie alterada o firmada con otra clave no vale", () => {
    const [body] = cookie.split(".");
    const forged = Buffer.from(JSON.stringify({ ...pending, storeId: "ajena" })).toString(
      "base64url",
    );
    expect(
      verifyPending(key, `${forged}.${cookie.split(".")[1]}`, {
        state: pending.nonce,
        userId: "u1",
        now: 2_000,
      }),
    ).toBeNull();
    expect(
      verifyPending(randomBytes(32), cookie, { state: pending.nonce, userId: "u1", now: 2_000 }),
    ).toBeNull();
    expect(verifyPending(key, body, { state: pending.nonce, userId: "u1", now: 2_000 })).toBeNull();
    expect(verifyPending(key, undefined, { state: pending.nonce, userId: "u1" })).toBeNull();
  });
});

describe("intercambio de llaves", () => {
  it("cambia el código con el verificador y calcula el vencimiento", async () => {
    const { calls, cfg: c } = fakeToken(goodToken);
    const now = new Date("2026-10-28T00:00:00Z");
    const t = await exchangeCode(c, { code: "TG-codigo-12345", verifier: "ver", now });
    expect(calls[0]!.url).toBe("https://mp.test/oauth/token");
    expect(calls[0]!.body).toMatchObject({
      grant_type: "authorization_code",
      code: "TG-codigo-12345",
      code_verifier: "ver",
      redirect_uri: cfg.redirectUri,
    });
    expect(t.userId).toBe("55512345");
    expect(t.expiresAt.toISOString()).toBe("2027-04-26T00:00:00.000Z");
    expect(t.liveMode).toBe(false);
  });

  it("rechaza respuestas raras y no lee el cuerpo de un error", async () => {
    await expect(
      exchangeCode(fakeToken({ ...goodToken, access_token: "x" }).cfg, {
        code: "TG-codigo-1",
        verifier: "v",
      }),
    ).rejects.toThrow();
    await expect(
      exchangeCode(fakeToken({ ...goodToken, user_id: "abc" }).cfg, {
        code: "TG-codigo-1",
        verifier: "v",
      }),
    ).rejects.toThrow();
    await expect(
      exchangeCode(fakeToken({ error: "invalid_grant" }, 400).cfg, {
        code: "TG-codigo-1",
        verifier: "v",
      }),
    ).rejects.toThrow();
    await expect(exchangeCode(cfg, { code: "con espacios", verifier: "v" })).rejects.toThrow();
  });

  it("renueva con el refresh token", async () => {
    const { calls, cfg: c } = fakeToken(goodToken);
    await refreshTokens(c, "TG-abcdef123456");
    expect(calls[0]!.body).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "TG-abcdef123456",
    });
  });
});
