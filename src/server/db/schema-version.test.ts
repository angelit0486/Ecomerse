import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  checkSchemaVersion,
  compareSchemaVersion,
  EXPECTED_SCHEMA_VERSION,
} from "./schema-version";

describe("versión del esquema", () => {
  it("al día o adelante: sin aviso", () => {
    expect(compareSchemaVersion(EXPECTED_SCHEMA_VERSION)).toEqual({ ok: true });
    expect(compareSchemaVersion("29991231000000")).toEqual({ ok: true });
  });

  it("atrás o desconocida: aviso", () => {
    expect(compareSchemaVersion("20261023000400")).toEqual({
      ok: false,
      current: "20261023000400",
    });
    expect(compareSchemaVersion(null)).toEqual({ ok: false, current: null });
    expect(compareSchemaVersion("x")).toEqual({ ok: false, current: null });
  });

  it("la consulta distingue «falta la función» de un error de red", async () => {
    const client = (result: { data: unknown; error: unknown }) =>
      ({ rpc: async () => result }) as unknown as SupabaseClient;
    await expect(
      checkSchemaVersion(client({ data: null, error: { code: "PGRST202" } })),
    ).resolves.toEqual({ ok: false, current: null });
    await expect(
      checkSchemaVersion(client({ data: null, error: { code: "08006" } })),
    ).resolves.toEqual({ ok: true });
    await expect(
      checkSchemaVersion(client({ data: EXPECTED_SCHEMA_VERSION, error: null })),
    ).resolves.toEqual({ ok: true });
  });

  it("coincide con la última migración que define la función", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const defining = files.filter((f) =>
      readFileSync(join(dir, f), "utf8").includes("function public.app_schema_version()"),
    );
    const last = defining.at(-1)!;
    expect(last.slice(0, 14)).toBe(EXPECTED_SCHEMA_VERSION);
    expect(readFileSync(join(dir, last), "utf8")).toContain(`'${EXPECTED_SCHEMA_VERSION}'`);
  });
});
