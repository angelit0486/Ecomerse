import { describe, expect, it } from "vitest";

import { needsLegalReview } from "./legal-review";

/**
 * Misma regla que la validación de lanzamiento (`20261014000400_store_launch.sql`):
 * una política está pendiente si conserva la marca de plantilla o un párrafo
 * que solo tiene un marcador entre corchetes.
 */
describe("needsLegalReview", () => {
  it("la plantilla recién creada está pendiente", () => {
    expect(
      needsLegalReview(
        "<p><strong>Plantilla en borrador.</strong> Completa cada sección…</p><h2>Plazo</h2><p>[Plazo]</p>",
      ),
    ).toBe(true);
  });

  it("sin la marca, un párrafo con solo un marcador la deja pendiente", () => {
    expect(needsLegalReview("<h2>Plazo</h2><p> [Plazo para solicitar un cambio] </p>")).toBe(true);
  });

  it("vacía también está pendiente", () => {
    expect(needsLegalReview("   ")).toBe(true);
  });

  it("completa no está pendiente, aunque mencione corchetes dentro de una frase", () => {
    expect(
      needsLegalReview("<h2>Plazo</h2><p>Tienes 30 días [naturales] para pedir un cambio.</p>"),
    ).toBe(false);
  });
});
