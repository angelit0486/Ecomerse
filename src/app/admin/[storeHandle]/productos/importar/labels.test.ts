import { describe, expect, it } from "vitest";

import { publishIssueMessage } from "../messages";
import { importErrorText } from "./labels";

describe("importErrorText", () => {
  it("traduce los códigos de publicación del error de la importación", () => {
    expect(
      importErrorText(
        "Fila 12: no se puede publicar (compliance_field_missing:usage,price_zero)",
        publishIssueMessage,
      ),
    ).toBe(
      "Fila 12: no se puede publicar. Falta en la ficha sanitaria: modo de uso. Hay variantes activas con precio 0.",
    );
  });

  it("deja igual cualquier otro error", () => {
    expect(importErrorText("Fila 3: dato no válido en variants", publishIssueMessage)).toBe(
      "Fila 3: dato no válido en variants",
    );
  });
});
