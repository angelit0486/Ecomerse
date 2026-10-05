import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const config = readFileSync(
  fileURLToPath(new URL("../../supabase/config.toml", import.meta.url)),
  "utf8",
);

function section(name: string): string {
  const start = config.indexOf(`[${name}]`);
  if (start === -1) throw new Error(`Sección [${name}] no encontrada`);
  const rest = config.slice(start + name.length + 2);
  const next = rest.search(/^\[/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("supabase/config.toml", () => {
  it("la Data API expone solo public y graphql_public (GATE0 L8)", () => {
    const match = section("api").match(/^schemas\s*=\s*\[([^\]]*)\]/m);
    expect(match).not.toBeNull();
    const schemas = match![1]!
      .split(",")
      .map((s) => s.trim().replace(/"/g, ""))
      .filter(Boolean);
    expect(schemas.sort()).toEqual(["graphql_public", "public"]);
    for (const internal of ["app", "audit", "private", "storefront", "system"]) {
      expect(schemas).not.toContain(internal);
    }
  });

  it("el proyecto se identifica como pruva", () => {
    expect(config).toMatch(/^project_id = "pruva"$/m);
  });
});
