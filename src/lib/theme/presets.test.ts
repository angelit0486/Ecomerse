import { describe, expect, it } from "vitest";

import { contrastIssues } from "./palette";
import { THEME_PRESETS } from "./presets";
import { ThemeSettingsV2 } from "./schema";

describe("estilos sugeridos", () => {
  it.each(THEME_PRESETS.map((p) => [p.key, p] as const))(
    "%s cumple el contraste y el esquema del tema",
    (_, preset) => {
      expect(contrastIssues(preset.colors, preset.buttonStyle)).toEqual([]);
      const parsed = ThemeSettingsV2.safeParse({
        colors: preset.colors,
        typography: { heading: preset.heading, body: preset.body },
        shape: { radius: preset.radius, button_style: preset.buttonStyle },
      });
      expect(parsed.success).toBe(true);
    },
  );

  it("las claves no se repiten", () => {
    const keys = THEME_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
