import { describe, expect, it } from "vitest";

import { EnvValidationError, parseServerEnv } from "./env";

const valid = {
  APP_ENV: "test",
  WORKER_DATABASE_URL: "postgres://system_worker:s3cr3t-value@localhost:5432/db",
  CRON_SECRET: "c".repeat(32),
  JOBS_HMAC_SECRET: "h".repeat(32),
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
});
