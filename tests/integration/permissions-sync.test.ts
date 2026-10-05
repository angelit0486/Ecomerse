import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { ORG_PERMISSIONS, STORE_PERMISSIONS } from "@/server/auth/permissions";

/** El espejo TS de permisos debe coincidir exactamente con `public.permissions`. */
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error("Falta TEST_ADMIN_DATABASE_URL. Ejecuta `pnpm db:test`.");
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await admin.end();
});

describe("sincronización de permisos", () => {
  it("permisos de tienda", async () => {
    const rows = await admin<{ key: string }[]>`
      select key from public.permissions where module <> 'org' order by key`;
    expect(rows.map((r) => r.key)).toEqual([...STORE_PERMISSIONS].sort());
  });

  it("permisos de organización", async () => {
    const rows = await admin<{ key: string }[]>`
      select key from public.permissions where module = 'org' order by key`;
    expect(rows.map((r) => r.key)).toEqual([...ORG_PERMISSIONS].sort());
  });
});
