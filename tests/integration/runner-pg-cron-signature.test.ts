import { readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { authorizeJobRunner } from "@/server/jobs/authorize";
import { signPayload } from "@/server/security/hmac";

/**
 * A1 (Orden 10, mensaje 5): la plantilla scripts/ops/cola/runner-cada-minuto.pg_cron.sql
 * firma la llamada al runner en SQL (pgcrypto). Aquí se evalúa ESA misma
 * expresión en PostgreSQL y se compara con la firma del servidor: si alguien
 * cambia una de las dos, el runner rechazaría cada minuto sin que nadie lo note.
 * pg_cron y pg_net no existen en local: la programación se prueba en Supabase.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });
afterAll(() => admin.end());

const template = readFileSync(
  join(process.cwd(), "scripts/ops/cola/runner-cada-minuto.pg_cron.sql"),
  "utf8",
);
const expression = /'x-jobs-signature', (encode\(extensions\.hmac\(.+?'hex'\))/.exec(template)?.[1];

describe("firma del runner desde pg_cron", () => {
  it("la plantilla firma igual que el servidor y el runner la acepta", async () => {
    expect(expression).toBeDefined();
    await admin`create extension if not exists pgcrypto with schema extensions`;
    const ts = 1_800_000_000;
    const secret = "s".repeat(40);
    const sql = expression!.replaceAll("f.ts", `'${ts}'`).replaceAll("f.secret", `'${secret}'`);
    const [row] = await admin.unsafe<{ sig: string }[]>(`select ${sql} as sig`);
    expect(row!.sig).toBe(signPayload(secret, ts, "{}"));
    expect(
      authorizeJobRunner({
        authorization: null,
        timestamp: String(ts),
        signature: row!.sig,
        rawBody: "{}",
        cronSecret: "c".repeat(40),
        hmacSecret: secret,
        nowSeconds: ts + 30,
      }),
    ).toEqual({ ok: true, method: "hmac" });
  });

  it("la plantilla no trae secretos ni URL reales y corre cada minuto", () => {
    expect(template).toContain(":APP_URL/api/jobs/run");
    expect(template).toContain("'* * * * *'");
    expect(template).not.toMatch(/https:\/\/[a-z0-9-]+\.(vercel\.app|supabase\.co)\/api/);
    expect(template).toMatch(/vault\.decrypted_secrets s where s\.name = 'jobs_hmac_secret'/);
  });
});
