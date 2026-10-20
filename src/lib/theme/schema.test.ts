import { describe, expect, it } from "vitest";

import { isValidLink, isValidSocialUrl, type SocialNetwork } from "./links";
import { themeContrastIssues } from "./palette";
import { HomeSectionsV2, ThemeSettingsV2 } from "./schema";
import { LINK_CASES, SECTIONS_CASES, SETTINGS_CASES, SOCIAL_CASES } from "./theme-schema-cases";

describe("enlaces de la tienda", () => {
  it.each(LINK_CASES.map((c) => [c.value, c.valid] as const))("%s → %s", (value, valid) => {
    expect(isValidLink(value)).toBe(valid);
  });

  it.each(SOCIAL_CASES.map((c) => [c.network, c.url, c.valid] as const))(
    "%s %s → %s",
    (network, url, valid) => {
      expect(isValidSocialUrl(network as SocialNetwork, url)).toBe(valid);
    },
  );
});

describe("Theme schema v2", () => {
  it.each(SETTINGS_CASES.map((c) => [c.name, c] as const))("tema: %s", (_, c) => {
    expect(ThemeSettingsV2.safeParse(c.value).success).toBe(c.valid);
  });

  it.each(SECTIONS_CASES.map((c) => [c.name, c] as const))("portada: %s", (_, c) => {
    expect(HomeSectionsV2.safeParse(c.value).success).toBe(c.valid);
  });

  it("los errores llegan en español y en el campo", () => {
    const result = ThemeSettingsV2.safeParse({ seo: { title: "a".repeat(71) } });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(["seo", "title"]);
    expect(result.error!.issues[0]!.message).toBe("Máximo 70 caracteres.");
  });
});

describe("contraste del tema", () => {
  it("la barra de anuncio exige 4.5:1", () => {
    const bar = (foreground: string) => ({
      header: { announcement: { text: "x", background: "#ffffff", foreground } },
    });
    expect(themeContrastIssues(bar("#767676"))).toEqual([]);
    expect(themeContrastIssues(bar("#777777"))).toEqual(["announcement"]);
  });

  it("un botón outline exige 4.5:1 para primary; uno sólido, 3:1", () => {
    const colors = { primary: "#949494" }; // ≈ 3.03:1 sobre blanco
    expect(themeContrastIssues({ colors })).toEqual([]);
    expect(themeContrastIssues({ colors, shape: { button_style: "outline" } })).toEqual([
      "primary",
    ]);
  });
});
