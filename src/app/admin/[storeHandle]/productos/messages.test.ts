import { describe, expect, it } from "vitest";

import { publishIssueMessage } from "./messages";

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
