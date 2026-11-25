import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { migrationDecision } from "../../scripts/deploy/migrate-guard.mjs";

/**
 * T-10 / S-05: el build solo migra en el despliegue de producción de Vercel o
 * fuera de Vercel. Una vista previa (cualquier rama, Dependabot incluido) nunca,
 * aunque alguien defina MIGRATION_DATABASE_URL en Preview.
 */
const URL = "postgres://migrator:x@127.0.0.1:1/postgres";

describe("migrationDecision", () => {
  it("sin MIGRATION_DATABASE_URL no migra (local y CI, como siempre)", () => {
    expect(migrationDecision({}).run).toBe(false);
    expect(migrationDecision({ VERCEL: "1", VERCEL_ENV: "production" }).run).toBe(false);
  });

  it("vista previa de Vercel: no migra, diga lo que diga la rama", () => {
    for (const branch of ["fix/algo", "dependabot/npm_and_yarn/x", "feat/y", "main"]) {
      const d = migrationDecision({
        MIGRATION_DATABASE_URL: URL,
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: branch,
      });
      expect(d.run).toBe(false);
      expect(d.reason).toContain(branch);
    }
  });

  it("en Vercel sin VERCEL_ENV o con un entorno propio: no migra (falla hacia lo seguro)", () => {
    expect(migrationDecision({ MIGRATION_DATABASE_URL: URL, VERCEL: "1" }).run).toBe(false);
    expect(migrationDecision({ MIGRATION_DATABASE_URL: URL, VERCEL_URL: "x.vercel.app" }).run).toBe(
      false,
    );
    expect(
      migrationDecision({ MIGRATION_DATABASE_URL: URL, VERCEL: "1", VERCEL_ENV: "staging" }).run,
    ).toBe(false);
  });

  it("despliegue de producción de Vercel: migra", () => {
    expect(
      migrationDecision({ MIGRATION_DATABASE_URL: URL, VERCEL: "1", VERCEL_ENV: "production" }).run,
    ).toBe(true);
  });

  it("fuera de Vercel (pnpm deploy:migrate desde una máquina de confianza): migra", () => {
    expect(migrationDecision({ MIGRATION_DATABASE_URL: URL }).run).toBe(true);
  });

  it("el motivo nunca incluye la cadena de conexión", () => {
    const cases = [
      { MIGRATION_DATABASE_URL: URL },
      { MIGRATION_DATABASE_URL: URL, VERCEL: "1", VERCEL_ENV: "preview" },
      { MIGRATION_DATABASE_URL: URL, VERCEL: "1", VERCEL_ENV: "production" },
    ];
    for (const env of cases) expect(migrationDecision(env).reason).not.toContain("migrator:x");
  });
});

describe("migrate.mjs respeta la guarda", () => {
  const run = (extra: Record<string, string>) =>
    spawnSync(process.execPath, ["scripts/deploy/migrate.mjs"], {
      env: {
        PATH: process.env.PATH ?? "",
        MIGRATION_DATABASE_URL: URL,
        ...extra,
      } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 20_000,
    });

  it("en una vista previa sale en 0 sin intentar conectarse", () => {
    const r = run({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "fix/x" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no se aplican migraciones");
    expect(r.stderr).not.toContain("Migración fallida");
  });

  it("en producción sí intenta conectarse (aquí falla porque no hay base en el puerto 1)", () => {
    const r = run({ VERCEL: "1", VERCEL_ENV: "production" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Migración fallida");
    expect(r.stderr).not.toContain("migrator:x");
  });
});
