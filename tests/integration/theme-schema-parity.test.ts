import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { isValidLink, isValidSocialUrl, type SocialNetwork } from "@/lib/theme/links";
import { themeContrastIssues } from "@/lib/theme/palette";
import { HomeSectionsV2, ThemeSettingsV2 } from "@/lib/theme/schema";
import {
  LINK_CASES,
  SECTIONS_CASES,
  SETTINGS_CASES,
  SOCIAL_CASES,
} from "@/lib/theme/theme-schema-cases";

/**
 * F9-DESIGN §2.2: cada regla del Theme schema v2 vive en Zod y en SQL. Los dos
 * deben dar el mismo veredicto en cada caso compartido, y ese veredicto debe ser
 * el esperado.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await admin.end();
});

describe("paridad Zod ↔ SQL del Theme schema v2", () => {
  it.each(LINK_CASES.map((c) => [c.value.slice(0, 60), c] as const))("enlace %s", async (_, c) => {
    const [row] = await admin<
      { ok: boolean }[]
    >`select app.theme_link_valid(to_jsonb(${c.value}::text)) as ok`;
    expect([isValidLink(c.value), row!.ok]).toEqual([c.valid, c.valid]);
  });

  it.each(SOCIAL_CASES.map((c) => [`${c.network} ${c.url}`, c] as const))(
    "red %s",
    async (_, c) => {
      const [row] = await admin<{ ok: boolean }[]>`
      select app.theme_social_url_valid(${c.network}, to_jsonb(${c.url}::text)) as ok`;
      expect([isValidSocialUrl(c.network as SocialNetwork, c.url), row!.ok]).toEqual([
        c.valid,
        c.valid,
      ]);
    },
  );

  it.each(SETTINGS_CASES.map((c) => [c.name, c] as const))("tema: %s", async (_, c) => {
    const [row] = await admin<{ ok: boolean }[]>`
      select app.theme_settings_valid(${admin.json(c.value as postgres.JSONValue)}) as ok`;
    expect([ThemeSettingsV2.safeParse(c.value).success, row!.ok]).toEqual([c.valid, c.valid]);
  });

  it.each(SECTIONS_CASES.map((c) => [c.name, c] as const))("portada: %s", async (_, c) => {
    const [row] = await admin<{ ok: boolean }[]>`
      select app.home_sections_valid(${admin.json(c.value as postgres.JSONValue)}) as ok`;
    expect([HomeSectionsV2.safeParse(c.value).success, row!.ok]).toEqual([c.valid, c.valid]);
  });
});

describe("paridad del contraste del tema", () => {
  const samples = [
    {},
    { header: { announcement: { text: "x", background: "#ffffff", foreground: "#767676" } } },
    { header: { announcement: { text: "x", background: "#ffffff", foreground: "#777777" } } },
    { colors: { primary: "#949494" } },
    { colors: { primary: "#949494" }, shape: { button_style: "outline" as const } },
    {
      colors: { foreground: "#aaaaaa", primary: "#ffff00" },
      header: { announcement: { text: "x", background: "#111827", foreground: "#1f2937" } },
    },
    // Tema v4: oferta y colores por elemento.
    { colors: { sale: "#b91c1c" } },
    { colors: { sale: "#f87171" } },
    {
      element_colors: {
        footer: { background: "#111827", foreground: "#374151" },
        nav_bar: { background: "#ffffff", foreground: "#111827", active: "#93c5fd" },
        hero: { background: "#111827", foreground: "#ffffff" },
      },
    },
  ];

  it.each(samples.map((s) => [JSON.stringify(s), s] as const))(
    "mismas fallas para %s",
    async (_, s) => {
      const [row] = await admin<{ issues: string[] }[]>`
      select app.theme_contrast_issues(${admin.json(s as postgres.JSONValue)}) as issues`;
      expect(themeContrastIssues(s)).toEqual(row!.issues);
    },
  );
});
