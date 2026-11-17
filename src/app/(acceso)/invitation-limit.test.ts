import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn();
const sql = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/auth/security-events", () => ({ recordSecurityEvent: vi.fn() }));
vi.mock("@/server/actions/report", () => ({ reportActionError: vi.fn() }));
vi.mock("@/server/db/rpc", () => ({ callRpc: vi.fn() }));
vi.mock("@/server/invitations/peek", () => ({
  peekInvitation: async () => ({ email: "invitada@tienda.mx" }),
}));
vi.mock("@/server/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ APP_ENV: "test" }) }));
vi.mock("@/server/db/role-clients", () => ({ workerDb: () => sql }));
vi.mock("@/server/storefront/cart", () => ({ clientIpHash: async () => "iphash" }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithOtp } }),
}));

import { startInvitationLogin } from "./actions";

describe("login por invitación: límite propio de intentos", () => {
  beforeEach(() => {
    signInWithOtp.mockReset();
    sql.mockReset();
  });

  it("sin presupuesto no pide el código a Auth", async () => {
    sql.mockResolvedValue([{ ok: false }]);
    const r = await startInvitationLogin("a".repeat(64));
    expect(r).toEqual({ error: "Demasiados intentos. Espera unos minutos." });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("con presupuesto sí pide el código", async () => {
    sql.mockResolvedValue([{ ok: true }]);
    signInWithOtp.mockResolvedValue({ error: { status: 500 } });
    await startInvitationLogin("a".repeat(64));
    expect(signInWithOtp).toHaveBeenCalledOnce();
  });
});
