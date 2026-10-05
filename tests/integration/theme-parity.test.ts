import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { contrastIssues, DEFAULT_COLORS, resolvePalette, type Palette } from "@/lib/theme/palette";

/** Las reglas de contraste de TS y de la base deben coincidir exactamente. */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await admin.end();
});

const samples: Array<Partial<Palette>> = [
  {},
  { foreground: "#aaaaaa" },
  { primary: "#ffff00" },
  { accent: "#fde68a", muted: "#d1d5db" },
  {
    background: "#0b1320",
    foreground: "#f8fafc",
    muted: "#94a3b8",
    primary: "#38bdf8",
    accent: "#fbbf24",
  },
  { background: "#000000" },
  { primary: "#767676" },
  { primary: "#777777" },
];

describe("paridad TS ↔ SQL de la paleta", () => {
  it("mismos colores por defecto", async () => {
    const [row] = await admin<{ colors: Palette }[]>`select app.theme_default_colors() as colors`;
    expect(row!.colors).toEqual(DEFAULT_COLORS);
  });

  it.each(samples.map((s) => [JSON.stringify(s), s] as const))(
    "mismas fallas para %s",
    async (_, colors) => {
      const [row] = await admin<{ issues: string[] }[]>`
      select app.theme_contrast_issues(${admin.json({ colors })}) as issues`;
      expect(contrastIssues(resolvePalette(colors)).map((i) => i.key)).toEqual(row!.issues);
    },
  );
});
