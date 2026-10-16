import { describe, expect, it } from "vitest";

import { publishIssueMessage, qualityIssueMessage } from "./messages";

describe("publishIssueMessage", () => {
  it("traduce los avisos de §14.3 y los de cumplimiento con su campo", () => {
    expect(publishIssueMessage("price_zero")).toBe("Hay variantes activas con precio 0.");
    expect(publishIssueMessage("compliance_field_missing:usage")).toBe(
      "Falta en la ficha sanitaria: modo de uso.",
    );
    expect(publishIssueMessage("compliance_forbidden_term:no_cura")).toMatch(/término/);
    expect(publishIssueMessage("compliance_profile_pending")).toMatch(/no están revisadas/);
  });

  it("un código desconocido o del prototipo se muestra tal cual", () => {
    expect(publishIssueMessage("nuevo_codigo")).toBe("nuevo_codigo");
    expect(publishIssueMessage("constructor")).toBe("constructor");
    expect(publishIssueMessage("compliance_field_missing:constructor")).toBe(
      "Falta en la ficha sanitaria: constructor.",
    );
  });
});

describe("qualityIssueMessage (revisión del catálogo)", () => {
  it("traduce los avisos y deja los bloqueos de publicación a publishIssueMessage", () => {
    expect(qualityIssueMessage("image_missing")).toBe("No tiene imágenes.");
    expect(qualityIssueMessage("price_zero")).toBe(publishIssueMessage("price_zero"));
    expect(qualityIssueMessage("constructor")).toBe("constructor");
  });
});
