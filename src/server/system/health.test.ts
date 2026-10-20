import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/env", () => ({ serverEnv: () => ({}) }));

import { issuesFor } from "./health";

describe("issuesFor", () => {
  it("sin clave de servicio: las fotos no se optimizan", () => {
    const keys = issuesFor({ SUPABASE_SERVICE_ROLE_KEY: undefined, EMAIL_PROVIDER: "resend" }).map(
      (i) => i.key,
    );
    expect(keys).toEqual(["image_processing"]);
  });

  it("correo falso: la tienda no envía correos", () => {
    const issues = issuesFor({ SUPABASE_SERVICE_ROLE_KEY: "x".repeat(40), EMAIL_PROVIDER: "fake" });
    expect(issues.map((i) => i.key)).toEqual(["store_email"]);
    expect(issues[0]!.fix).toMatch(/Resend/);
  });

  it("todo configurado: sin avisos", () => {
    expect(
      issuesFor({ SUPABASE_SERVICE_ROLE_KEY: "x".repeat(40), EMAIL_PROVIDER: "resend" }),
    ).toEqual([]);
  });

  it("nunca incluye el valor de la clave", () => {
    const secret = "s".repeat(40);
    const text = JSON.stringify(
      issuesFor({ SUPABASE_SERVICE_ROLE_KEY: secret, EMAIL_PROVIDER: "fake" }),
    );
    expect(text).not.toContain(secret);
  });
});
