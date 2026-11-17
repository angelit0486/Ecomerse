import { beforeEach, describe, expect, it, vi } from "vitest";

const challengeAndVerify = vi.fn();
const sql = vi.fn();
const USER_ID = "0190a7e2-1c3d-7a4b-8c5d-6e7f80910a1b";
const FACTOR_ID = "0190a7e2-1c3d-7a4b-8c5d-6e7f80910a2c";
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/auth/security-events", () => ({ recordSecurityEvent: vi.fn() }));
vi.mock("@/server/actions/report", () => ({ reportActionError: vi.fn() }));
vi.mock("@/server/db/rpc", () => ({ callRpc: vi.fn() }));
vi.mock("@/server/invitations/peek", () => ({ peekInvitation: vi.fn() }));
vi.mock("@/server/auth/session", () => ({
  getSession: async () => ({ userId: USER_ID, aal: "aal1" }),
}));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ APP_ENV: "test" }) }));
vi.mock("@/server/db/role-clients", () => ({ workerDb: () => sql }));
vi.mock("@/server/storefront/cart", () => ({ clientIpHash: async () => "iphash" }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { mfa: { challengeAndVerify } } }),
}));

import { verifyTotp } from "./actions";

function form(code = "123456", factorId = FACTOR_ID): FormData {
  const f = new FormData();
  f.set("code", code);
  f.set("factorId", factorId);
  return f;
}

const TOO_MANY = { error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." };

describe("TOTP: límite propio de intentos", () => {
  beforeEach(() => {
    challengeAndVerify.mockReset();
    sql.mockReset();
  });

  it("sin presupuesto no llama a Auth", async () => {
    sql.mockResolvedValue([{ ok: false }]);
    expect(await verifyTotp({}, form())).toEqual(TOO_MANY);
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("con presupuesto sí verifica el código", async () => {
    sql.mockResolvedValue([{ ok: true }]);
    challengeAndVerify.mockResolvedValue({ error: { status: 422 } });
    const r = await verifyTotp({}, form());
    expect(challengeAndVerify).toHaveBeenCalledOnce();
    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: FACTOR_ID, code: "123456" });
    expect(r.error).toMatch(/no es correcto/);
  });

  it("pasa el usuario de la sesión, el factor y el hash de la IP", async () => {
    sql.mockResolvedValue([{ ok: false }]);
    await verifyTotp({}, form());
    expect(sql).toHaveBeenCalledOnce();
    const [strings, ...values] = sql.mock.calls[0]!;
    expect((strings as string[]).join("?")).toMatch(/system\.take_staff_mfa_attempt\(/);
    expect(values).toEqual([USER_ID, FACTOR_ID, "iphash"]);
  });

  it("el límite de Auth (429) da el mismo mensaje", async () => {
    sql.mockResolvedValue([{ ok: true }]);
    challengeAndVerify.mockResolvedValue({ error: { status: 429 } });
    expect(await verifyTotp({}, form())).toEqual(TOO_MANY);
  });

  it("un código o un factor mal formados no gastan intentos", async () => {
    expect(await verifyTotp({}, form("12345"))).toEqual({ error: "El código tiene 6 dígitos." });
    expect(await verifyTotp({}, form("123456", "-".repeat(36)))).toEqual({
      error: "El código tiene 6 dígitos.",
    });
    expect(sql).not.toHaveBeenCalled();
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });
});
