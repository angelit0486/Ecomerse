import { describe, expect, it } from "vitest";

import { publishIssueMessage } from "../messages";
import { friendlyRowError, importErrorText } from "./labels";

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

describe("friendlyRowError", () => {
  it("antepone el nombre en español y conserva la columna del archivo", () => {
    expect(friendlyRowError("price: escribe un importe como 199.50")).toBe(
      "Precio (columna price): escribe un importe como 199.50",
    );
    expect(friendlyRowError("regulatory_usage: valor no válido")).toBe(
      "Ficha sanitaria (columna regulatory_usage): valor no válido",
    );
  });

  it("deja igual los mensajes sin columna o de columnas desconocidas", () => {
    expect(friendlyRowError("un producto puede tener hasta 100 variantes")).toBe(
      "un producto puede tener hasta 100 variantes",
    );
    expect(friendlyRowError("rara: algo")).toBe("rara: algo");
  });
});
