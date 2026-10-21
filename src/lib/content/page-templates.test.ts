import { describe, expect, it } from "vitest";

import { HomeSectionsV2 } from "@/lib/theme/schema";

import { findPageTemplate, PAGE_TEMPLATES } from "./page-templates";

describe("plantillas de página", () => {
  it("hay Contacto, Preguntas frecuentes y Nosotros", () => {
    expect(PAGE_TEMPLATES.map((t) => t.key)).toEqual(["contacto", "preguntas", "nosotros"]);
    expect(findPageTemplate("contacto")?.title).toBe("Contacto");
    expect(findPageTemplate("x")).toBeUndefined();
  });

  it.each(PAGE_TEMPLATES.map((t) => [t.key, t] as const))(
    "%s: bloques válidos y marcadores a la vista para reemplazar",
    (_, t) => {
      expect(HomeSectionsV2.safeParse(t.sections).success).toBe(true);
      expect(t.sections.length).toBeGreaterThan(0);
      // Lo que la dueña debe reemplazar va entre corchetes; nada promete resultados.
      expect(JSON.stringify(t) + t.body_html).toMatch(/\[[^\]]+\]/);
      expect(t.body_html).not.toMatch(/<script|on\w+=/i);
    },
  );

  it("Contacto usa el bloque de contacto con mapa", () => {
    expect(findPageTemplate("contacto")!.sections.map((s) => s.type)).toContain("contact_map");
  });
});
