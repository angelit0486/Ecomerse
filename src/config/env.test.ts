import { describe, expect, it } from "vitest";

import { EnvValidationError, parseServerEnv } from "./env";

const valid = {
  APP_ENV: "test",
  WORKER_DATABASE_URL: "postgres://system_worker:s3cr3t-value@localhost:5432/db",
  CRON_SECRET: "c".repeat(32),
  JOBS_HMAC_SECRET: "h".repeat(32),
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(40),
  GATEWAY_DATABASE_URL: "postgres://storefront_gateway:s3cr3t-value@localhost:5432/db",
  APP_HOSTNAME: "localhost:3000",
  PREVIEW_HMAC_SECRET: "p".repeat(32),
  ORDER_LINK_SECRET: "o".repeat(32),
  APP_URL: "http://localhost:3000",
  EMAIL_PROVIDER: "fake",
  EMAIL_FROM: "Plataforma <no-reply@example.test>",
};

describe("parseServerEnv", () => {
  it("acepta un entorno válido y aplica defaults", () => {
    const env = parseServerEnv(valid);
    expect(env.APP_ENV).toBe("test");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("falla si falta una variable requerida", () => {
    const { CRON_SECRET: _omit, ...rest } = valid;
    expect(() => parseServerEnv(rest)).toThrow(EnvValidationError);
    expect(() => parseServerEnv(rest)).toThrow(/CRON_SECRET: requerida/);
    const { APP_ENV: _app, ...withoutAppEnv } = valid;
    expect(() => parseServerEnv(withoutAppEnv)).toThrow(/APP_ENV: requerida/);
    expect(() => parseServerEnv({ ...valid, JOBS_HMAC_SECRET: "" })).toThrow(
      /JOBS_HMAC_SECRET: requerida/,
    );
  });

  it("rechaza secretos cortos y URLs que no son de Postgres", () => {
    expect(() => parseServerEnv({ ...valid, JOBS_HMAC_SECRET: "corto" })).toThrow(
      /JOBS_HMAC_SECRET: valor inválido/,
    );
    expect(() => parseServerEnv({ ...valid, WORKER_DATABASE_URL: "https://example.com" })).toThrow(
      /WORKER_DATABASE_URL: valor inválido/,
    );
  });

  it("nunca incluye valores en el mensaje de error", () => {
    try {
      parseServerEnv({ ...valid, CRON_SECRET: "valor-secreto-corto", APP_ENV: "otro" });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("valor-secreto-corto");
      expect(message).not.toContain("otro");
    }
  });

  it("producción exige Resend con clave y enlaces https (config inválida nunca llega a producción)", () => {
    const prod = { ...valid, APP_ENV: "production" };
    expect(() => parseServerEnv(prod)).toThrow(/EMAIL_PROVIDER: resend obligatorio/);
    expect(() => parseServerEnv(prod)).toThrow(/APP_URL: https obligatorio/);
    expect(() =>
      parseServerEnv({ ...prod, EMAIL_PROVIDER: "resend", APP_URL: "https://app.x.test" }),
    ).toThrow(/RESEND_API_KEY: requerida/);
    expect(
      parseServerEnv({
        ...prod,
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_0123456789", // gitleaks:allow (valor ficticio de prueba)
        SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
        APP_URL: "https://app.x.test",
      }).EMAIL_PROVIDER,
    ).toBe("resend");
  });

  it("el remitente debe tener formato 'Nombre <email>'", () => {
    expect(() => parseServerEnv({ ...valid, EMAIL_FROM: "no-reply@example.test" })).toThrow(
      /EMAIL_FROM/,
    );
  });
});
